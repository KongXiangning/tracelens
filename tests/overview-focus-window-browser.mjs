import assert from "node:assert/strict";
import path from "node:path";
import {
  cp,
  mkdir,
  mkdtemp,
  writeFile,
  readdir,
  readFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";
import { buildOverviewData } from "../dist/shared/overview-data.js";
import { requirementWork } from "../dist/shared/overview-progress.js";
import { contributionSummary } from "../dist/shared/product-contribution.js";
import { overviewTaskStates } from "../dist/shared/overview-model.js";
import { readRequirementWork } from "../dist/server/requirement-work.js";
import { currentWork } from "../dist/shared/overview-focus.js";

await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(
  path.resolve("output/playwright/overview-focus-window-"),
);
const root = path.join(run, "project");
await cp("examples/product-scoped", root, { recursive: true });
async function tree(directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) values.push(...(await tree(filename)));
    else
      values.push([
        filename,
        createHash("sha256")
          .update(await readFile(filename))
          .digest("hex"),
      ]);
  }
  return values.sort(([a], [b]) => a.localeCompare(b));
}
const before = await tree(root);
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
// Explicit synthetic saved scope mappings and Runtime query facts. The production
// reader/selector chain derives visibility; no work booleans are injected.
const taskSource = {
  kind: "text",
  text: "captured synthetic Task identity",
  label: "test",
};
const fullFacts = new Map(
  Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    const task = {
      task_id: `task-${number}`,
      title: `合成 Task ${number}`,
      display_id: `TASK-${number}`,
      lifecycle:
        index < 5 || index === 6 || index === 8 || index === 9
          ? "closed"
          : "active",
      adopted_plan_ref: "plan",
      current_step_id: index === 7 ? "S1" : null,
      steps: [
        {
          id: "S1",
          state:
            index < 5 ? "finished" : index === 7 ? "executed" : "not-started",
          ...(index < 5 || index === 7 || index === 8 || index === 9
            ? { execution_ref: `execution-${number}` }
            : {}),
        },
        ...(index === 7 ? [{ id: "S2", state: "not-started" }] : []),
      ],
    };
    return [task.task_id, task];
  }),
);
const rows = Array.from({ length: 24 }, (_, index) => {
  const number = index + 1;
  const taskId = index === 11 ? "task-8" : `task-${number}`;
  const task = {
    task_id: taskId,
    plan_ref: "plan",
    step_id: index === 11 ? "S2" : "S1",
    source: taskSource,
  };
  return {
    key: `binding-${number}`,
    ownerKey: `R${number}`,
    planItems: [],
    repairs: [],
    binding: {
      id: `binding-${number}`,
      task,
      role: "implementation",
      ...(index !== 9
        ? { contribution: index === 8 ? "supporting" : "direct" }
        : {}),
      state: "active",
      origin: "declared",
      coverage: `scope ${number}`,
      reason: "explicit scope mapping",
      sources: [taskSource],
    },
    match: {
      task,
      taskIds: [`ui-${taskId}`],
      state: "matched",
      detail: "synthetic exact identity",
    },
  };
});
const unorderedRow = structuredClone(rows[0]);
unorderedRow.key = "unordered-binding";
unorderedRow.ownerKey = "UNORDERED";
rows.push(unorderedRow);
const workProduct = {
  items: rows.map((row) => ({
    key: row.ownerKey,
    id: row.ownerKey,
    type: "requirement",
    usable: true,
    metadata: { scope: "current" },
  })),
  bindings: rows,
  relations: [],
};
const summary = {
  source: "runtime-query",
  freshness: "queried",
  viewRevision: "scope-facts",
  batchId: "scope-batch",
  workflowHome: "docs/workflow",
  readAt: "2026-10-14T10:00:00Z",
  complete: true,
  total: 24,
  currentTaskId: "task-8",
  issues: [],
  diagnostics: [],
  tasks: [...fullFacts.values()].map((task) => {
    const { steps, ...result } = task;
    return {
      ...result,
      ...(task.lifecycle === "active" ? { current_step: steps[0] } : {}),
    };
  }),
};
const detailRequests = [];
const observed = await readRequirementWork(
  project,
  workProduct,
  summary,
  {
    detail: async (_project, _runtime, taskId) => {
      detailRequests.push(taskId);
      return {
        status: "available",
        source: "runtime-query",
        viewRevision: summary.viewRevision,
        task: fullFacts.get(taskId),
      };
    },
  },
  () => true,
);
assert.deepEqual(detailRequests.sort(), [
  "task-1",
  "task-2",
  "task-3",
  "task-4",
  "task-5",
  "task-7",
  "task-8",
]);
const workSnapshot = {
  product: workProduct,
  runtime: observed,
  tasks: observed.tasks.map((task) => ({
    id: `ui-${task.task_id}`,
    realTaskId: task.task_id,
    runtimeLifecycle: task.lifecycle,
    runtimeBatchId: observed.batchId,
    number: task.display_id,
    statuses: [],
  })),
};
data.planned = Array.from({ length: 24 }, (_, index) => ({
  ...data.planned[0],
  key: `R${index + 1}`,
  id: `R${String(index + 1).padStart(2, "0")}`,
  title: `需求 ${index + 1}`,
  firstTask: undefined,
  assessmentRecords: [],
  childCount: 0,
  dependencies: [],
  description: `合成范围 ${index + 1}：已保存的工作依据`,
  contributionSummary: contributionSummary([rows[index]]),
  taskState: overviewTaskStates(workSnapshot, [rows[index]]),
  work: requirementWork(workSnapshot, [rows[index]]),
}));
data.currentWork = currentWork(workSnapshot);
data.taskCount = overviewTaskStates(workSnapshot, rows).total;
data.unordered = [
  {
    ...data.planned[0],
    key: "UNORDERED",
    id: "R-UNORDERED",
    title: "已执行的未排序需求",
    work: requirementWork(workSnapshot, [unorderedRow]),
  },
];
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
const snapshot = {
  ...view.snapshot,
  revision: "actual-scope-progress",
  overview: data,
};
delete snapshot.product;
delete snapshot.documents;
const otherProject = await runtime.registry.add({
  name: "独立显示选择",
  root: await (async () => {
    const directory = path.join(run, "other-project");
    await cp(root, directory, { recursive: true });
    return directory;
  })(),
  config: defaultConfig(),
});
const otherBefore = await tree(otherProject.root);
const otherData = {
  ...structuredClone(data),
  planned: [structuredClone(data.planned[0]), structuredClone(data.planned[5])],
  unordered: [],
  currentWork: undefined,
};
const otherSnapshot = {
  ...snapshot,
  projectId: otherProject.id,
  overview: otherData,
};
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
  await page.route("**/api/projects/*/overview*", (route) => {
    const projectId = new URL(route.request().url()).pathname.split("/")[3];
    return route.fulfill({
      json: {
        ...view,
        snapshot: projectId === otherProject.id ? otherSnapshot : snapshot,
      },
    });
  });
  await page.goto(base);
  await page.locator(`[data-project-id="${project.id}"]`).click();
  const cards = () =>
    page
      .locator("[data-overview-card]")
      .evaluateAll((elements) =>
        elements.map((element) => element.dataset.overviewCard),
      );
  await page.locator('[data-overview-card="R08"]').waitFor();
  const expectedCards = [
    "R08",
    "R05",
    "R04",
    "R03",
    "R02",
    "R01",
    "R-UNORDERED",
  ];
  assert.deepEqual(await cards(), expectedCards);
  assert.match(
    await page.locator('[data-overview-card="R08"]').innerText(),
    /正在进行/,
  );
  assert.match(
    await page.locator('[data-overview-card="R01"]').innerText(),
    /已进行/,
  );
  assert.equal(
    await page.getByRole("combobox", { name: "进度定位" }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: /展开完整范围|收起完整范围/ })
      .count(),
    0,
  );
  assert.equal(
    await page.locator(".overview-unordered-details > summary").count(),
    0,
  );
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
  const filter = page.getByRole("combobox", { name: "筛选 Task 关联情况" });
  await filter.selectOption("active");
  assert.deepEqual(
    await cards(),
    ["R08"],
    "Queued scopes in the same current Task stay hidden even when filtering active Tasks",
  );
  await filter.selectOption("closed");
  assert.deepEqual(
    await cards(),
    expectedCards.slice(1),
    "Closed Tasks without an execution never enter the cards",
  );
  await filter.selectOption("all");
  await filter.selectOption("active");
  await page.getByRole("button", { name: "显示全部需求", exact: true }).click();
  assert.equal(
    await filter.inputValue(),
    "all",
    "Visibility changes clear secondary filters",
  );
  assert.equal(
    (await cards()).length,
    25,
    "All requirements appear inline without a limit",
  );
  assert.match(
    await page.locator('[data-overview-card="R06"]').innerText(),
    /未开始/,
  );
  assert.match(
    await page.locator('[data-overview-card="R10"]').innerText(),
    /进展待核对/,
  );
  await page.reload();
  await page.locator('[data-overview-card="R24"]').waitFor();
  assert.equal((await cards()).length, 25);
  assert.equal(
    await page
      .getByRole("button", { name: "显示全部需求", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("button", { name: "显示进展待核对", exact: true })
    .click();
  assert.deepEqual(
    await cards(),
    ["R10", "R09"],
    "Unclassified/supporting facts cannot establish scope execution",
  );
  await page.locator(`[data-project-id="${otherProject.id}"]`).click();
  await page.locator('[data-overview-card="R01"]').waitFor();
  assert.deepEqual(
    await cards(),
    ["R01"],
    "Another project starts with its own default",
  );
  await page.getByRole("button", { name: "显示全部需求", exact: true }).click();
  assert.equal((await cards()).length, 2);
  await page.locator(`[data-project-id="${project.id}"]`).click();
  await page.locator('[data-overview-card="R10"]').waitFor();
  assert.deepEqual(
    await cards(),
    ["R10", "R09"],
    "Project-specific selection survives switching",
  );
  await page.getByRole("button", { name: "显示已开展", exact: true }).click();
  assert.deepEqual(await cards(), expectedCards);
  await page.evaluate(() =>
    localStorage.setItem(
      `tracelens-progress:${document.querySelector("[data-project-id]").dataset.projectId}`,
      "R20",
    ),
  );
  await page.reload();
  await page.locator('[data-overview-card="R08"]').waitFor();
  assert.deepEqual(
    await cards(),
    expectedCards,
    "Old manual anchors cannot change scope-based visibility",
  );
  const savedWork = [...data.planned, ...data.unordered].map(
    (item) => item.work,
  );
  [...data.planned, ...data.unordered].forEach((item) => {
    item.work = { current: false, recorded: false, latestTask: "" };
  });
  snapshot.revision = "no-scope-execution";
  await page.reload();
  await page.locator(".overview-empty").waitFor();
  assert.deepEqual(
    await cards(),
    [],
    "No reliable evidence means zero cards, never a fallback to the first four",
  );
  assert.match(
    await page.locator(".overview-empty").innerText(),
    /当前显示范围没有需求/,
  );
  [...data.planned, ...data.unordered].forEach((item, index) => {
    item.work = savedWork[index];
  });
  snapshot.revision = "scope-execution-restored";
  await page.reload();
  await page.locator('[data-overview-card="R08"]').waitFor();
  assert.deepEqual(await cards(), expectedCards);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const hero = await page.locator(".overview-hero").boundingBox();
    const currentPanel = await page
      .locator(".overview-current-work")
      .boundingBox();
    assert.ok(
      currentPanel.y + currentPanel.height <= hero.y + hero.height + 1,
      "Current scope evidence must not be clipped by the hero height",
    );
    const position = await resultsPosition();
    await chooser.selectOption("plan");
    await checkToolbar();
    assert.deepEqual(await resultsPosition(), position);
    await page.locator(".overview-focus-tools").screenshot({
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
  assert.deepEqual(await tree(root), before);
  assert.deepEqual(await tree(otherProject.root), otherBefore);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        checks: [
          "all performed requirements including older and unordered scopes, with ongoing scope 08",
          "outcomes only in detail dialog",
          "plan explicit selection and collapse",
          "queued, closed-without-execution, supporting and unclassified scopes remain hidden under filters",
          "no card collapse, no manual progress anchor, no neighbouring-window fallback",
          "all/pending visibility, secondary-filter reset, reload persistence and project isolation",
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
