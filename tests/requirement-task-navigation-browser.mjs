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
  for (let pass = 0; pass < 2; pass++) {
    await card.getByRole("button", { name: "查看需求", exact: true }).click();
    await page
      .locator('.requirements-v3-inspector[data-product-id="R-IMPORT"]')
      .waitFor();
    await page.waitForFunction(() => {
      const node = document.querySelector(
        '.requirements-v3-node.is-selected [data-node-id="R-IMPORT"]',
      );
      const canvas = document.querySelector(".requirements-v3-graph");
      if (!node || !canvas) return false;
      const a = node.getBoundingClientRect(),
        b = canvas.getBoundingClientRect();
      return (
        a.top >= b.top &&
        a.bottom <= b.bottom &&
        a.left >= b.left &&
        a.right <= b.right
      );
    });
    await page.getByRole("tab", { name: "完整正文", exact: true }).click();
    const panel = page.locator(".requirements-v3-panel");
    assert.match(await panel.innerText(), /需求正文起点/);
    assert.match(await panel.innerText(), /需求正文终点/);
    await panel.evaluate(
      (element) => (element.scrollTop = element.scrollHeight),
    );
    assert.equal(
      await panel
        .locator(":scope > .requirements-v3-panel-content")
        .getByText("需求正文终点", { exact: true })
        .isVisible(),
      true,
    );
    if (pass === 0)
      await page
        .getByRole("button", { name: "展开子需求 · R-PIPELINE", exact: true })
        .click();
    await page.getByRole("button", { name: "概览", exact: true }).click();
    await card.waitFor();
  }
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
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        errors,
        checks: [
          "focus already visible and folded requirement",
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
