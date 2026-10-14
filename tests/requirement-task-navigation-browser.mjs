import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";
import { buildOverviewData } from "../dist/shared/overview-data.js";

await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(
  path.resolve("output/playwright/requirement-task-navigation-"),
);
const root = path.join(run, "example");
await cp("examples/product-scoped", root, { recursive: true });
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const project = await runtime.registry.add({
  name: "需求任务导航验收",
  root,
  config: defaultConfig(),
});
const view = structuredClone(await runtime.store.refresh(project.id));
const snapshot = view.snapshot;
const requirement = snapshot.product.items.find(
  (item) => item.id === "R-IMPORT",
);
requirement.body =
  "### 需求内容\n需求正文起点\n\n" +
  "完整业务要求应逐条保留，不能用摘要替代。\n\n".repeat(65) +
  "需求正文终点";
snapshot.documents = snapshot.documents.map((doc) => ({
  ...doc,
  raw: "",
  contentOmitted: true,
}));
snapshot.tasks = ["a", "b", "c"].map((name, index) => ({
  id: `ui-${name}`,
  realTaskId: `task-${name}`,
  number: `TASK-00${index + 1}`,
  title: `导航合成任务 ${name}`,
  runtimeLifecycle: "active",
  current: false,
  source: requirement.source,
  statuses: [],
  goals: [],
  steps: [],
  checks: [],
  issues: [],
}));
const taskRef = (name) => ({
  task_id: `task-${name}`,
  source: { kind: "text", label: "合成关联", text: "浏览器导航测试数据" },
});
snapshot.product.bindings.push(
  ...["a", "b"].map((name) => ({
    key: `synthetic-binding-${name}`,
    ownerKey: requirement.key,
    binding: {
      id: `binding-${name}`,
      task: taskRef(name),
      role: "implementation",
      coverage: "当前需求的合成范围",
      origin: "declared",
      state: "active",
    },
    match: {
      task: taskRef(name),
      taskIds: [`ui-${name}`],
      state: "matched",
      detail: "合成身份匹配",
    },
    planItems: [],
    repairs: [],
  })),
);
snapshot.runtime = {
  source: "runtime-query",
  workflowHome: "docs/workflow",
  viewRevision: "old-view",
  readAt: snapshot.completedAt,
  freshness: "queried",
  complete: true,
  total: 3,
  tasks: snapshot.tasks.map((task) => ({
    task_id: task.realTaskId,
    lifecycle: "active",
  })),
  issues: [],
  diagnostics: [],
  batchId: "synthetic-batch",
};
const pendingRequirement = snapshot.product.items.find(
  (item) => item.id === "R-DELTA",
);
snapshot.product.bindings.push(
  ...["identity-unknown", "unresolved"].map((state) => {
    const ref = {
      task_id: state === "unresolved" ? "task-missing" : null,
      label: `待核对任务 ${state}`,
      source: { kind: "text", text: "未定位的关联声明" },
    };
    return {
      key: `pending-${state}`,
      ownerKey: pendingRequirement.key,
      binding: {
        id: `pending-${state}`,
        task: ref,
        role: "implementation",
        coverage: "待核对范围",
        origin: "declared",
        state: "active",
      },
      match: { task: ref, taskIds: [], state, detail: "尚未找到对应任务记录" },
      planItems: [],
      repairs: [],
    };
  }),
);
const reviewSource = snapshot.product.sources.find((source) => source.source);
for (const state of ["identity-unknown", "unresolved", "conflict"]) {
  const ref = {
    task_id: state === "identity-unknown" ? null : "task-a",
    label: `混合待核对 ${state}`,
    source: { kind: "text", text: "混合关联核对依据" },
  };
  snapshot.product.bindings.push({
    key: `mixed-${state}`,
    ownerKey: requirement.key,
    binding: {
      id: `mixed-${state}`,
      task: ref,
      role: "implementation",
      coverage: "待核对范围",
      origin: "declared",
      state: "active",
      reason: "混合关联核对依据",
    },
    match: {
      task: ref,
      taskIds: state === "conflict" ? ["ui-a"] : [],
      state,
      detail: `混合核对原因 ${state}`,
      sourceCheckId: reviewSource.id,
    },
    planItems: [],
    repairs: [],
  });
}
const featurePlan = {
  ...requirement,
  key: "detail-plan",
  id: "DETAIL-PLAN",
  type: "plan",
  title: "详情功能拆分",
  metadata: {
    id: "DETAIL-PLAN",
    type: "plan",
    work_items: ["入口导航", "功能聚合", "关联追踪", "尚未关联"].map(
      (title, index) => ({
        id: `F${index + 1}`,
        title,
        outcome: `真实结构化功能 ${title}`,
        scope: title,
        targets: [{ target: requirement.id, coverage: title }],
        state: "included",
        origin: "initial",
      }),
    ),
  },
};
snapshot.product.items.push(featurePlan);
for (const [name, workId] of [
  ["a", "F1"],
  ["b", "F2"],
]) {
  const row = snapshot.product.bindings.find(
    (entry) => entry.key === `synthetic-binding-${name}`,
  );
  Object.assign(row.binding, {
    contribution: "direct",
    reason: "范围直接实现",
    sources: [row.binding.task.source],
    coverage: workId,
  });
  Object.assign(row.binding.task, { plan_ref: `plan-${name}`, step_id: "S1" });
  row.planItems = [
    {
      planId: featurePlan.id,
      workItemId: workId,
      key: `${featurePlan.key}:work:${workId}`,
      state: "resolved",
    },
  ];
  const task = snapshot.runtime.tasks.find(
    (entry) => entry.task_id === `task-${name}`,
  );
  Object.assign(task, {
    adopted_plan_ref: `plan-${name}`,
    current_step_id: "S1",
    steps: [
      {
        id: "S1",
        title: workId,
        state: name === "a" ? "executed" : "in-progress",
        execution_ref: `execution-${name}`,
      },
    ],
  });
}
const thirdFeature = structuredClone(
  snapshot.product.bindings.find(
    (entry) => entry.key === "synthetic-binding-b",
  ),
);
thirdFeature.key = "synthetic-binding-third";
thirdFeature.binding.id = "binding-third";
thirdFeature.binding.coverage = "F3";
thirdFeature.binding.task.step_id = "S2";
thirdFeature.planItems = [
  {
    planId: featurePlan.id,
    workItemId: "F3",
    key: `${featurePlan.key}:work:F3`,
    state: "resolved",
  },
];
snapshot.product.bindings.push(thirdFeature);
snapshot.runtime.tasks
  .find((entry) => entry.task_id === "task-b")
  .steps.push({ id: "S2", state: "not-started" });
snapshot.runtime.currentTaskId = "task-b";
snapshot.tasks.find((entry) => entry.realTaskId === "task-b").runtimeBatchId =
  snapshot.runtime.batchId;
pendingRequirement.body +=
  "\n### 功能点与输入输出\n\n- 来源快照。\n- 稳定身份。\n- 专业域。\n- 版本分离。\n- 领域关系。\n- 标签审计。\n\n输入 → 输出：不是功能点\n\n### 异常恢复\n- 不是功能点";
snapshot.product.items.push({
  ...pendingRequirement,
  key: "body-feature-report",
  id: "BODY-FEATURE-REPORT",
  type: "assessment",
  title: "正文逐点实施核对",
  metadata: {
    id: "BODY-FEATURE-REPORT",
    type: "assessment",
    target: pendingRequirement.id,
  },
  body: `### 交付与验证依据\n\n| 功能点 | 实施状态 | 验证状态 | 具体缺口 |\n|---|---|---|---|\n| ${pendingRequirement.id}/F1 来源快照。 | 已实施 | 本轮仅静态核对 | 未重新执行运行验证 |`,
});
const overview = {
  ...snapshot,
  revision: "synthetic-revision",
  overview: buildOverviewData(snapshot),
};
delete overview.product;
delete overview.documents;
const errors = [];
let stepRequests = 0;
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
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/projects/*/overview*", (route) =>
    route.fulfill({ json: { ...view, snapshot: overview } }),
  );
  await page.route("**/api/projects/*/snapshot?*", (route) =>
    route.fulfill({ json: view }),
  );
  await page.route("**/api/projects/*/task-times", (route) =>
    route.fulfill({
      json: {
        createdAt: null,
        completedAt: null,
        createdRef: null,
        completedRef: null,
        issues: [],
      },
    }),
  );
  await page.route("**/api/projects/*/task-detail", (route) => {
    const request = route.request().postDataJSON();
    if (request.stepId) {
      stepRequests++;
      return route.fulfill({
        status: 503,
        json: { error: "QUERY_VIEW_CHANGED" },
      });
    }
    return route.fulfill({
      json: {
        status: "available",
        source: "runtime-query",
        viewRevision: "old-view",
        task: {
          task_id: request.taskId,
          lifecycle: "active",
          reviews: [],
          steps: [
            {
              id: "S1",
              title: "强调显示的实施步骤",
              state: "finished",
              execution: { result: "synthetic result" },
            },
            { id: "S2", title: "保留未开始的实施步骤", state: "not-started" },
          ],
        },
      },
    });
  });
  await page.goto(base);
  const card = page.locator('[data-overview-card="R-IMPORT"]');
  await card.waitFor();
  await card.getByRole("button", { name: "查看待核对关联 · R-IMPORT" }).click();
  await page.locator(".task-pending-bindings").waitFor();
  for (const state of ["identity-unknown", "unresolved", "conflict"]) {
    assert.match(
      await page.locator(".task-pending-bindings").innerText(),
      new RegExp(`混合核对原因 ${state}`),
    );
  }
  assert.equal(await page.locator(".task-pending-binding").count(), 3);
  assert.ok(
    (await page.locator(".task-pending-binding .source-link").count()) > 0,
  );
  await page.reload();
  await page.locator(".task-pending-bindings").waitFor();
  assert.equal(await page.locator(".task-pending-binding").count(), 3);
  await page.locator(".task-card").first().click();
  await page
    .getByRole("button", { name: "关联待核对 · 3", exact: true })
    .click();
  await page.locator(".task-pending-bindings").waitFor();
  await page.goBack();
  await page
    .locator(".task-detail h2")
    .filter({ hasText: "导航合成任务" })
    .waitFor();
  await page.goForward();
  await page.locator(".task-pending-bindings").waitFor();
  await page.screenshot({
    path: path.join(run, "association-review-entry.png"),
  });
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: "显示全部需求", exact: true }).click();
  await page
    .getByRole("combobox", { name: "筛选 Task 关联情况" })
    .selectOption("associated");
  for (let pass = 0; pass < 2; pass++) {
    const entry =
      pass === 0
        ? card.getByRole("button", { name: "查看需求", exact: true })
        : card.locator("h3 button");
    await entry.scrollIntoViewIfNeeded();
    const originalScroll = await page.evaluate(
      () => document.scrollingElement.scrollTop,
    );
    assert.ok(
      originalScroll > 0,
      "The originating overview has a real scroll position",
    );
    await entry.click();
    const detail = page.locator(
      '.requirement-detail-page[data-requirement-id="R-IMPORT"]',
    );
    await detail.waitFor();
    assert.equal(await detail.locator(".rd-feature").count(), 4);
    assert.match(await detail.locator(".rd-count").innerText(), /1 \/ 4/);
    assert.equal(
      await detail.getByRole("progressbar").getAttribute("aria-valuenow"),
      "25",
    );
    await detail.locator("#rd-body summary").click();
    assert.match(await detail.locator("#rd-body").innerText(), /需求正文起点/);
    assert.match(await detail.locator("#rd-body").innerText(), /需求正文终点/);
    await detail.locator("#rd-body summary").click();
    const functionalFeature = detail
      .locator(".rd-feature")
      .filter({ hasText: "功能聚合" });
    if (pass === 0) {
      assert.equal(
        await functionalFeature.locator(".rd-feature-description").isVisible(),
        false,
        "Feature details are collapsed by default",
      );
      await functionalFeature.locator(".rd-feature-heading").click();
    }
    assert.equal(
      await detail
        .locator(".rd-feature")
        .filter({ hasText: "功能聚合" })
        .locator(".rd-feature-description")
        .isVisible(),
      true,
      "One expansion shows the complete feature description",
    );
    await page.evaluate(() => {
      document.scrollingElement.scrollTop = 0;
    });
    await page.screenshot({
      path: path.join(run, `requirement-detail-${pass}.png`),
      fullPage: true,
    });
    if (pass === 0) {
      await detail
        .getByRole("group", { name: "功能点筛选" })
        .getByRole("button", { name: "进行中 1", exact: true })
        .click();
      await detail
        .locator(".rd-feature .rd-bound-task button.text-link")
        .click();
      await page.locator(".tasks-page").waitFor();
      await page.goBack();
      await detail.waitFor();
      assert.equal(await detail.locator(".rd-feature").count(), 1);
      assert.equal(
        await detail.locator(".rd-feature .rd-feature-body").isVisible(),
        true,
      );
      await detail
        .getByRole("group", { name: "功能点筛选" })
        .getByRole("button", { name: "全部 4", exact: true })
        .click();
    }
    await detail.locator(".rd-back").click();
    await card.waitFor();
    await page
      .waitForFunction(
        (scroll) => Math.abs(document.scrollingElement.scrollTop - scroll) < 3,
        originalScroll,
      )
      .catch(async (error) => {
        await writeFile(
          path.join(run, "scroll-restoration-failure.json"),
          JSON.stringify(
            {
              expected: originalScroll,
              observed: await page.evaluate(() => ({
                scroll: document.scrollingElement.scrollTop,
                state: history.state,
                height: document.scrollingElement.scrollHeight,
                viewport: innerHeight,
              })),
            },
            null,
            2,
          ),
        );
        throw error;
      });
    assert.equal(
      await page
        .getByRole("button", { name: "显示全部需求", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .getByRole("combobox", { name: "筛选 Task 关联情况" })
        .inputValue(),
      "associated",
    );
  }
  await page
    .getByRole("combobox", { name: "筛选 Task 关联情况" })
    .selectOption("all");
  await page.getByRole("button", { name: "需求视图", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索需求图", exact: true })
    .fill("内容入库");
  const goalBefore = await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .inputValue();
  const node = page.locator('.goal-graph-node[data-node-id="R-IMPORT"]');
  await node.click();
  const detailFromGraph = page.locator(
    '.requirement-detail-page[data-requirement-id="R-IMPORT"]',
  );
  await detailFromGraph.waitFor();
  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => {
    document.scrollingElement.scrollTop = 0;
  });
  await page.screenshot({
    path: path.join(run, "requirement-detail-narrow.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Narrow layout has no horizontal overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await detailFromGraph.locator(".rd-back").click();
  await page
    .getByRole("textbox", { name: "搜索需求图", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "搜索需求图", exact: true })
      .inputValue(),
    "内容入库",
  );
  assert.equal(
    await page
      .getByRole("combobox", { name: "所选目标", exact: true })
      .inputValue(),
    goalBefore,
  );
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await card.getByRole("button", { name: "Task ↗", exact: true }).click();
  const tasks = page.locator(".task-card");
  await tasks.first().waitFor();
  assert.equal(await tasks.count(), 2);
  assert.match(
    await page.locator(".task-requirement-scope").innerText(),
    /R-IMPORT/,
  );
  await tasks.filter({ hasText: "导航合成任务 b" }).click();
  assert.equal(
    await tasks.count(),
    2,
    "Selecting another Task preserves the requirement scope",
  );
  const historyLength = await page.evaluate(() => history.length);
  await page.goBack();
  await page
    .locator('.task-card[aria-pressed="true"]')
    .filter({ hasText: "导航合成任务 a" })
    .waitFor();
  assert.equal(await tasks.count(), 2);
  await page.goForward();
  await page
    .locator('.task-card[aria-pressed="true"]')
    .filter({ hasText: "导航合成任务 b" })
    .waitFor();
  assert.equal(await page.evaluate(() => history.length), historyLength);
  await page.reload();
  await page
    .locator('.task-card[aria-pressed="true"]')
    .filter({ hasText: "导航合成任务 b" })
    .waitFor();
  assert.equal(await tasks.count(), 2);
  assert.equal(
    await page.getByRole("button", { name: "返回上一视图" }).count(),
    0,
  );
  await page.locator(".runtime-step-card").filter({ hasText: "S1" }).click();
  await page.getByRole("heading", { name: "Step S1", exact: true }).waitFor();
  await page.getByText("执行结果：synthetic result", { exact: true }).waitFor();
  assert.match(
    await page.locator(".runtime-task-detail").innerText(),
    /synthetic result/,
  );
  assert.equal(
    stepRequests,
    0,
    "A full Task's Step is read locally even if the live journal changed",
  );
  await page
    .locator(".task-requirement-title")
    .filter({ hasText: "R-IMPORT" })
    .first()
    .waitFor();
  await page.screenshot({ path: path.join(run, "scoped-task-step.png") });
  await page.getByRole("button", { name: "查看全部任务", exact: true }).click();
  assert.equal(await tasks.count(), 3);
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await page
    .locator('[data-overview-card="R-DELTA"]')
    .getByRole("button", { name: "Task ↗", exact: true })
    .click();
  await page.locator(".tasks-page").waitFor();
  assert.match(
    await page.locator(".task-requirement-scope").innerText(),
    /R-DELTA/,
  );
  await page.locator(".task-pending-bindings").waitFor();
  assert.equal(await tasks.count(), 0);
  assert.equal(await page.locator(".task-pending-binding").count(), 2);
  assert.equal(await page.locator(".requirements-v3").count(), 0);
  await page.screenshot({ path: path.join(run, "pending-task-scope.png") });
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await page
    .locator('[data-overview-card="R-DELTA"]')
    .getByRole("button", { name: "查看需求", exact: true })
    .click();
  const bodyDetail = page.locator(
    '.requirement-detail-page[data-requirement-id="R-DELTA"]',
  );
  await bodyDetail.waitFor();
  assert.equal(await bodyDetail.locator(".rd-feature").count(), 6);
  assert.equal(
    await bodyDetail.getByRole("progressbar").getAttribute("aria-valuenow"),
    null,
    "Missing per-point execution must not be reported as 0% completed",
  );
  const bodyFeature = bodyDetail.locator(".rd-feature").first();
  assert.equal(
    await bodyFeature.locator(".rd-feature-body").isVisible(),
    false,
  );
  await bodyFeature.locator(".rd-feature-heading").click();
  assert.equal(
    await bodyFeature.locator(".rd-bound-task").count(),
    0,
    "Requirement-level bindings must not leak to a body feature",
  );
  assert.match(
    await bodyFeature.locator(".rd-feature-heading").innerText(),
    /原报告：已实施/,
  );
  assert.equal(
    await bodyFeature
      .locator(".rd-feature-report dd")
      .filter({ hasText: "本轮仅静态核对" })
      .isVisible(),
    true,
    "Per-point reports are visible after opening the feature, with no second expansion",
  );
  await bodyFeature.locator(".rd-feature-heading").click();
  assert.equal(
    await bodyFeature.locator(".rd-feature-body").isVisible(),
    false,
    "An opened feature can be collapsed again",
  );
  await bodyFeature.locator(".rd-feature-heading").click();
  assert.equal(
    await bodyFeature.locator(".rd-feature-description").count(),
    0,
    "A title-only definition is not repeated as its detailed explanation",
  );
  assert.match(
    await bodyFeature.locator(".rd-feature-report").innerText(),
    /本轮仅静态核对/,
  );
  assert.match(
    await bodyFeature.locator(".rd-feature-report").innerText(),
    /未重新执行运行验证/,
  );
  await page.evaluate(() => {
    document.scrollingElement.scrollTop = 0;
  });
  await page.screenshot({
    path: path.join(run, "body-features-with-records.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        errors,
        checks: [
          "title and view-requirement actions enter the same detail page",
          "exact feature execution, unassociated scopes and unique Task identities",
          "return restores overview filters and actual document scroll",
          "return restores requirement graph search and selected goal",
          "Task round-trip restores feature filters with explanations visible",
          "narrow layout without horizontal overflow",
          "explicit body feature inventory and per-point implementation/verification records",
          "feature details start collapsed, toggle closed again, and show reports with one expansion",
          "unknown execution is not a zero-percent completion result",
          "complete omitted-document body",
          "scope Tasks to requirement",
          "preserve scope on Task selection",
          "browser Back, Forward and reload preserve Task and scope",
          "same-view Step avoids stale query",
          "clear scope",
          "unresolved associations enter scoped Task view",
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
