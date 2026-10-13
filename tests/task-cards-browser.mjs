import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";

await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(path.resolve("output/playwright/task-cards-"));
const root = path.join(run, "example");
await cp("examples/示例项目 Alpha", root, { recursive: true });
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const project = await runtime.registry.add({
  name: "Task 卡片验收",
  root,
  config: defaultConfig(),
});
const view = await runtime.store.refresh(project.id);
// Synthetic presentation data intentionally arrives out of order.
view.snapshot.runtime = undefined;
view.snapshot.tasks = [
  ["older", "TASK-2", "第二项当前任务", true],
  ["latest", "TASK-010", "第十项任务：验证卡片标题与编号排序", false],
  ["middle", "TASK-9", "第九项任务", false],
  ["unknown", null, "没有编号的任务", false],
].map(([id, number, title, current]) => ({
  id,
  number,
  title,
  current,
  source: {
    documentId: "synthetic",
    path: "docs/tasks.md",
    line: 1,
    section: null,
    digest: "",
  },
  statuses: [],
  goals: [],
  steps: [],
  checks: [],
  issues: [],
}));
const errors = [];
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
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/projects/*/snapshot?*", (route) =>
    route.fulfill({ json: view }),
  );
  await page.goto(base);
  await page
    .getByRole("heading", { name: project.name, exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Task 视图", exact: true }).click();
  const cards = page.locator(".task-card");
  await cards.first().waitFor();
  assert.deepEqual(await cards.locator(".task-number").allTextContents(), [
    "TASK-010",
    "TASK-9",
    "TASK-2",
    "未记录编号",
  ]);
  assert.equal(await cards.first().getAttribute("aria-pressed"), "true");
  await cards.filter({ hasText: "第二项当前任务" }).click();
  await page
    .locator(".task-detail h2")
    .filter({ hasText: "第二项当前任务" })
    .waitFor();
  await page.getByRole("textbox", { name: "搜索任务" }).fill("第九项");
  assert.equal(await cards.count(), 1);
  await page.getByRole("textbox", { name: "搜索任务" }).fill("");
  await page.getByRole("button", { name: "当前", exact: true }).click();
  assert.equal(await cards.count(), 1);
  assert.equal(await cards.locator(".task-number").innerText(), "TASK-2");
  await page.getByRole("button", { name: "全部", exact: true }).click();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(run, `cards-${width}.png`),
      fullPage: true,
    });
  }
  // Reproduce the reported layout with both many cards and a long detail.
  const template = view.snapshot.tasks[0];
  for (let index = 11; index <= 40; index++) {
    view.snapshot.tasks.push({
      ...template,
      id: `long-${index}`,
      number: `TASK-${index}`,
      title:
        index % 2 === 0
          ? `提供跨平台发行安装脚本与一键 mTLS 证书工具 ${index}`
          : `${"网页版 Codex 会话页优先使用 IPC 数据通道并保留原通道降级，支持完整长标题悬停阅读。".repeat(4)} ${index}`,
      current: false,
    });
  }
  for (const task of view.snapshot.tasks) {
    task.goals = Array.from({ length: 60 }, (_, index) => ({
      text: `详情记录 ${index + 1}：验证阅读长任务详情时，左侧卡片、搜索和筛选始终可见且可操作。`,
      checked: null,
      source: task.source,
    }));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByRole("button", { name: "Task 视图", exact: true }).click();
  await cards.first().waitFor();
  const detail = page.locator(".tasks-page .browser-detail");
  const grid = page.locator(".task-card-grid");
  async function checkCardContentBounds() {
    const layout = await cards.evaluateAll((elements) =>
      elements.map((card) => {
        const title = card.querySelector(".task-card-title");
        return {
          height: card.getBoundingClientRect().height,
          titleHeight: title.getBoundingClientRect().height,
          tooltipMatches: title.title === title.textContent,
        };
      }),
    );
    assert.ok(
      layout.every((card) => card.height === 190),
      "Every card keeps the default fixed height",
    );
    assert.ok(
      layout.every((card) => card.titleHeight <= 54 && card.tooltipMatches),
      "Titles use at most three lines and preserve the full hover text",
    );
    const overflow = await cards.evaluateAll((elements) =>
      elements.flatMap((card) => {
        const box = card.getBoundingClientRect();
        return [
          ...card.querySelectorAll(
            ".task-card-times > span, .task-card-action, strong",
          ),
        ]
          .filter(
            (child) => child.getBoundingClientRect().bottom > box.bottom - 8,
          )
          .map((child) => ({
            task: card.querySelector(".task-number").textContent,
            content: child.textContent,
          }));
      }),
    );
    assert.deepEqual(
      overflow,
      [],
      "Titles, both timestamp rows and the action must fit inside each card",
    );
  }
  for (const size of [
    { width: 2965, height: 900 },
    { width: 1440, height: 900 },
    { width: 1024, height: 720 },
    { width: 1440, height: 600 },
  ]) {
    await page.setViewportSize(size);
    await checkCardContentBounds();
    await detail.evaluate((element) => (element.scrollTop = 0));
    await grid.evaluate((element) => (element.scrollTop = 0));
    const before = await page.locator(".browser-list").boundingBox();
    await detail.hover();
    await page.mouse.wheel(0, 1600);
    await page.waitForFunction(
      () => document.querySelector(".tasks-page .browser-detail").scrollTop > 0,
    );
    const after = await page.locator(".browser-list").boundingBox();
    assert.equal(
      after.y,
      before.y,
      "Detail scrolling must keep the left pane in place",
    );
    assert.equal(await grid.evaluate((element) => element.scrollTop), 0);
    assert.equal(
      await page.evaluate(() => document.scrollingElement.scrollTop),
      0,
    );
    assert.ok(after.y >= 0 && after.y + after.height <= size.height + 1);
    assert.equal(
      await page.getByRole("textbox", { name: "搜索任务" }).isVisible(),
      true,
    );
    const detailScroll = await detail.evaluate((element) => element.scrollTop);
    await grid.hover();
    await page.mouse.wheel(0, 900);
    await page.waitForFunction(
      () => document.querySelector(".task-card-grid").scrollTop > 0,
    );
    assert.equal(
      await detail.evaluate((element) => element.scrollTop),
      detailScroll,
    );
    await cards.nth(1).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".tasks-page .browser-detail").scrollTop === 0,
    );
    await detail.hover();
    await page.mouse.wheel(0, 1600);
    await page.waitForFunction(
      () => document.querySelector(".tasks-page .browser-detail").scrollTop > 0,
    );
    await page.screenshot({
      path: path.join(
        run,
        `independent-scroll-${size.width}-${size.height}.png`,
      ),
    });
    await cards.first().click();
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await checkCardContentBounds();
  await page.screenshot({ path: path.join(run, "long-title-cards-390.png") });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        errors,
        checks: [
          "numeric descending order",
          "latest selected by default",
          "selection and detail",
          "search and filter",
          "1440/1024/390 layouts",
          "left pane remains visible while long details scroll",
          "independent card and detail scrolling at 2965/1440/1024 widths and 600px height",
          "task selection resets detail scroll",
        ],
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
