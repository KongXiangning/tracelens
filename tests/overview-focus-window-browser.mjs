import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";
import { buildOverviewData } from "../dist/shared/overview-data.js";

await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(
  path.resolve("output/playwright/overview-focus-window-"),
);
const root = path.join(run, "project");
await cp("examples/product-scoped", root, { recursive: true });
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const project = await runtime.registry.add({
  name: "进度关注范围验收",
  root,
  config: defaultConfig(),
});
const view = await runtime.store.refresh(project.id);
const data = structuredClone(buildOverviewData(view.snapshot));
data.planned = Array.from({ length: 24 }, (_, index) => ({
  ...data.planned[0],
  key: `R${index + 1}`,
  id: `R${String(index + 1).padStart(2, "0")}`,
  title: `需求 ${index + 1}`,
  firstTask: undefined,
  assessmentRecords: [],
  work: {
    current: false,
    recorded: index === 7,
    latestTask: index === 7 ? "TASK-8" : "",
  },
}));
data.unordered = [];
data.roadmapSummary = [
  {
    planKey: "plan",
    planId: "PLAN",
    title: "明确路线图",
    intentState: "adopted",
    status: "current",
    readable: true,
    totalWorkItems: 3,
    currentWorkItemIds: [],
    location: "unlocated",
    reasons: [],
    changeCount: 0,
    earlierPrerequisites: [],
    workItems: ["A", "B", "C"].map((id) => ({
      id,
      title: id,
      outcome: id,
      state: "included",
      origin: "initial",
      targets: [],
    })),
  },
];
const snapshot = { ...view.snapshot, revision: "focus-window", overview: data };
delete snapshot.product;
delete snapshot.documents;
const errors = [],
  writes = [];
let browser;
try {
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.route("**/api/projects/*/overview*", (route) =>
    route.fulfill({ json: { ...view, snapshot } }),
  );
  await page.goto(base);
  const cards = () =>
    page
      .locator("[data-overview-card]")
      .evaluateAll((elements) =>
        elements.map((element) => element.dataset.overviewCard),
      );
  await page.locator('[data-overview-card="R08"]').waitFor();
  assert.deepEqual(await cards(), ["R10", "R09", "R08", "R07", "R06"]);
  assert.equal(await page.locator("[data-confirmed-outcome]").count(), 0);
  assert.equal(
    await page.locator("[data-roadmap-work]").count(),
    0,
    "Even one adopted plan remains collapsed until explicitly selected",
  );
  const chooser = page.getByRole("combobox", { name: "阅读路线图" });
  const resultsPosition = () =>
    page.locator(".overview-results-link").evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const parent = button
        .closest(".overview-focus-tools")
        .getBoundingClientRect();
      return { x: rect.x - parent.x, y: rect.y - parent.y };
    });
  const initialResultsPosition = await resultsPosition();
  const checkToolbar = async () => {
    const button = await page.locator(".overview-results-link").boundingBox();
    const select = await chooser.boundingBox();
    assert.ok(
      button.y + button.height <= select.y,
      "The outcomes entry occupies a separate row above the roadmap selector",
    );
  };
  await checkToolbar();
  assert.equal(await chooser.inputValue(), "");
  await chooser.selectOption("plan");
  await checkToolbar();
  assert.deepEqual(
    await resultsPosition(),
    initialResultsPosition,
    "Expanding a plan keeps the outcomes entry anchored",
  );
  assert.equal(await page.locator("[data-roadmap-work]").count(), 3);
  await page.getByRole("button", { name: "收起近期安排", exact: true }).click();
  assert.equal(await page.locator("[data-roadmap-work]").count(), 0);
  await page.getByRole("button", { name: "展开近期安排", exact: true }).click();
  assert.equal(await page.locator("[data-roadmap-work]").count(), 3);
  await chooser.selectOption("");
  await page.getByRole("button", { name: /最近确认的成果/ }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "最近确认的成果", exact: true }),
  });
  await dialog.waitFor();
  assert.ok((await dialog.locator("[data-confirmed-outcome]").count()) > 0);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  assert.equal(await page.locator("[data-confirmed-outcome]").count(), 0);
  await page.getByRole("button", { name: /展开完整范围/ }).click();
  assert.deepEqual(
    await cards(),
    Array.from(
      { length: 24 },
      (_, index) => `R${String(24 - index).padStart(2, "0")}`,
    ),
  );
  await page.getByRole("button", { name: "收起完整范围", exact: true }).click();
  const anchor = page.getByRole("combobox", { name: "进度定位" });
  assert.equal(
    await page
      .getByRole("region", { name: "完整范围筛选" })
      .getByRole("combobox", { name: "进度定位" })
      .count(),
    1,
  );
  assert.equal(await page.locator(".overview-progress-control").count(), 0);
  await anchor.selectOption("R12");
  assert.deepEqual(await cards(), ["R14", "R13", "R12", "R11", "R10"]);
  await page.reload();
  await page.locator('[data-overview-card="R12"]').waitFor();
  assert.equal(await anchor.inputValue(), "R12");
  assert.deepEqual(await cards(), ["R14", "R13", "R12", "R11", "R10"]);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const position = await resultsPosition();
    await chooser.selectOption("plan");
    await checkToolbar();
    assert.deepEqual(await resultsPosition(), position);
    await page
      .locator(".overview-focus-tools")
      .screenshot({
        path: path.join(run, `arrangements-expanded-${width}.png`),
      });
    await page
      .getByRole("button", { name: "收起近期安排", exact: true })
      .click();
    assert.deepEqual(await resultsPosition(), position);
    await chooser.selectOption("");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(run, `focus-${width}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        checks: [
          "focus 08 and next two in descending order",
          "outcomes only in detail dialog",
          "plan explicit selection and collapse",
          "full descending range",
          "manual focus persists",
          "responsive without overflow",
          "no write requests",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ result: "passed", artifacts: run }));
} finally {
  await browser?.close();
  await runtime.app.close();
}
