import assert from "node:assert/strict";
import path from "node:path";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse, stringify } from "yaml";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { runtimeTasks } from "../dist/server/runtime-reader.js";
import { buildProductIndex } from "../dist/server/product-index.js";

// All disk writes are confined to disposable copies and the tool's registry.
// The current Task projection below is explicitly synthetic test memory, not
// Runtime/Agent acceptance evidence. Real saved host output is checked separately.
await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(path.resolve("output/playwright/binding-focus-"));
const root = path.join(run, "contribution");
const scopedRoot = path.join(run, "scoped");
await cp("examples/product-contribution", root, { recursive: true });
await cp("examples/product-scoped", scopedRoot, { recursive: true });
const manifestPath = path.join(root, ".workflow-system/PRODUCT.yaml");
const manifest = parse(await readFile(manifestPath, "utf8"));
manifest.managed_paths.push("docs/product/ROADMAP.md");
await writeFile(manifestPath, stringify(manifest));
const plans = ["PLAN-A", "PLAN-B"].map((id) => ({
  id,
  type: "plan",
  intent_state: "adopted",
  targets: [{ target: "REQ-TENANT", coverage: "合成租户范围" }],
  work_items: ["W20-B", "W06", "W09", "FAR"].map((work, index) => ({
    id: work,
    title: `${id} ${work}`,
    scope: "合成已保存安排",
    outcome: "合成结果",
    state: index === 3 ? "deferred" : "included",
    origin: "initial",
    targets: [{ target: "REQ-TENANT", coverage: work }],
    ...(work === "W09"
      ? {
          depends_on: [
            {
              item_id: "W20-B",
              kind: "prerequisite",
              reason: "明确的合成前提",
            },
          ],
        }
      : {}),
  })),
}));
await writeFile(
  path.join(root, "docs/product/ROADMAP.md"),
  `---\n${stringify({ schema: "vnext-product-doc/v4", items: plans })}---\n# 合成路线图\n${plans.map((plan) => `\n## [${plan.id}] ${plan.id}\n### 实施策略\n原顺序仅为保存安排。\n### 阶段与工作项说明\n远期项保留。\n### 调整与未决事项\n没有核对基线，不认证当前或下一项。\n`).join("")}`,
);
async function tree(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await tree(directory, relative)));
    else
      result.push([
        relative,
        createHash("sha256")
          .update(await readFile(path.join(directory, relative)))
          .digest("hex"),
      ]);
  }
  return result.sort(([a], [b]) => a.localeCompare(b));
}
const before = await Promise.all([tree(root), tree(scopedRoot)]);
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const config = {
  readingMode: "vnext",
  autoDiscover: true,
  rules: { management: [], requirements: [], design: [], planning: [] },
  excludes: [],
  product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
};
const project = await runtime.registry.add({
  name: "贡献聚焦合成项目",
  root,
  config,
});
const scoped = await runtime.registry.add({
  name: "范围成果合成项目",
  root: scopedRoot,
  config,
});
const snapshot = (await runtime.store.refresh(project.id)).snapshot;
await runtime.store.refresh(scoped.id);
assert.ok(snapshot.product.items.every((item) => item.usable));
snapshot.runtime = {
  source: "memory-snapshot",
  workflowHome: "docs/workflow",
  viewRevision: "synthetic-ui-revision",
  readAt: "2026-10-14T00:00:00Z",
  freshness: "stale-or-unknown",
  complete: true,
  total: 2,
  batchId: "synthetic-ui-batch",
  currentTaskId: "TASK-UNBOUND",
  tasks: [
    {
      task_id: "TASK-SAMPLE-PARSER",
      title: "合成历史解析工作",
      lifecycle: "closed",
    },
    {
      task_id: "TASK-UNBOUND",
      title: "合成无绑定当前工作",
      lifecycle: "active",
      steps: [{ id: "S1", state: "not-started" }],
    },
  ],
  issues: [],
  diagnostics: ["Explicitly synthetic in-memory browser test projection"],
};
snapshot.tasks = runtimeTasks(project, snapshot.runtime);
buildProductIndex(snapshot.product, snapshot.tasks);
if (process.env.TRACELENS_PREPARE_ONLY === "1") {
  const overview = runtime.store.overview(project.id).snapshot.overview;
  assert.equal(overview.currentWork.taskId, "TASK-UNBOUND");
  assert.equal(overview.currentWork.bindingCount, 0);
  assert.equal(overview.contributionSummary.direct, 1);
  assert.equal(overview.contributionSummary.supporting, 1);
  assert.equal(overview.roadmapSummary.length, 2);
  assert.ok(overview.roadmapSummary.every((plan) => plan.status === "unknown"));
  assert.deepEqual(await Promise.all([tree(root), tree(scopedRoot)]), before);
  await writeFile(
    path.join(run, "prepare-only.json"),
    JSON.stringify(
      {
        result: "prepared-only",
        browser: "not-run",
        projectId: project.id,
        snapshotId: snapshot.id,
        inputTreesUnchanged: true,
      },
      null,
      2,
    ),
  );
  await runtime.app.close();
  console.log(
    JSON.stringify(
      { result: "prepared-only", browser: "not-run", artifacts: run },
      null,
      2,
    ),
  );
  process.exit(0);
}
let browser;
const errors = [],
  requests = [],
  screenshots = [],
  checks = [];
try {
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({ method: request.method(), url: request.url() }),
  );
  const screenshot = async (name) => {
    const file = path.join(run, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    screenshots.push(file);
  };
  await page.goto(base);
  await page.locator(`[data-project-id="${project.id}"]`).click();
  await page.locator('[data-overview-card="REQ-INPUT"]').waitFor();
  for (const name of ["当前工作", "最近确认的成果", "近期安排", "完整范围"])
    await page.getByRole("heading", { name, exact: true }).waitFor();
  assert.match(
    await page
      .getByRole("region", { name: "当前工作", exact: true })
      .innerText(),
    /合成无绑定当前工作[\s\S]*本批未读到需求关联/,
  );
  assert.match(
    await page
      .getByRole("region", { name: "当前工作", exact: true })
      .innerText(),
    /内存降级快照/,
  );
  assert.match(
    await page.locator('[data-overview-card="REQ-INPUT"]').innerText(),
    /直接关系 1/,
  );
  assert.match(
    await page.locator('[data-overview-card="REQ-TENANT"]').innerText(),
    /支撑 1/,
  );
  assert.match(
    await page.locator('[data-overview-card="REQ-AUDIT"]').innerText(),
    /未分类 1/,
  );
  assert.equal(
    requests.filter((request) => /\/snapshot(?:\?|$)/.test(request.url)).length,
    0,
  );
  const chooser = page.getByRole("combobox", { name: "阅读路线图" });
  assert.equal(await chooser.inputValue(), "");
  const plan = snapshot.product.items.find((item) => item.id === "PLAN-A");
  await chooser.selectOption(plan.key);
  assert.equal(await page.locator('[data-roadmap-plan="PLAN-A"]').count(), 1);
  assert.equal(
    await page.locator('[data-roadmap-status="unknown"]').count(),
    1,
  );
  assert.deepEqual(
    await page
      .locator('[data-roadmap-plan="PLAN-A"] [data-roadmap-work]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.roadmapWork)),
    ["W20-B", "W06", "W09"],
  );
  assert.match(
    await page.locator('[data-roadmap-plan="PLAN-A"]').innerText(),
    /下一项尚未确定/,
  );
  await screenshot("01-focus-four-regions");
  checks.push(
    "Synthetic v5 direct/supporting/unknown rows, unbound current focus, stale source, multiple adopted plans and unknown baselines stay separate",
  );
  const fullReadCount = () =>
    requests.filter((request) => /\/snapshot(?:\?|$)/.test(request.url)).length;
  const beforeFilters = fullReadCount();
  const filter = page.getByRole("region", { name: "完整范围筛选" });
  await filter
    .getByRole("combobox", { name: "筛选 Task 关联情况" })
    .selectOption("closed");
  assert.equal(await page.locator("[data-overview-card]").count(), 2);
  assert.equal(fullReadCount(), beforeFilters);
  await page
    .locator('[data-overview-card="REQ-INPUT"]')
    .getByRole("button", { name: "查看需求", exact: false })
    .click();
  const inspector = page.getByRole("complementary", { name: "所选需求详情" });
  await inspector.getByRole("tab", { name: "Task", exact: true }).click();
  await inspector.getByText("关联范围与来源 · 1", { exact: true }).click();
  assert.match(await inspector.innerText(), /直接实施/);
  await inspector.getByRole("tab", { name: "依据", exact: true }).click();
  await inspector
    .getByRole("button", { name: "查看局部关系图", exact: false })
    .click();
  await page.locator(".product-graph-container").waitFor();
  assert.match(await page.locator("main").innerText(), /直接实施/);
  await screenshot("02-contribution-graph");
  await page.goBack();
  await page.locator(".requirements-v3-page").waitFor();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "概览", exact: false })
    .click();
  await chooser.waitFor();
  assert.equal(await chooser.inputValue(), plan.key);
  assert.equal(
    await filter
      .getByRole("combobox", { name: "筛选 Task 关联情况" })
      .inputValue(),
    "closed",
  );
  checks.push(
    "Details and graph retain role/contribution/owner; returning restores plan and filters without per-card task reads",
  );
  const beforeFocus = requests.length;
  const sync = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/projects" &&
      response.request().method() === "GET",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sync;
  assert.equal(
    requests.slice(beforeFocus).some((request) => request.method !== "GET"),
    false,
  );
  await page.locator(`[data-project-id="${scoped.id}"]`).click();
  await page.locator('[data-overview-card="R-IMPORT"]').waitFor();
  const outcomes = page.getByRole("region", {
    name: "最近确认的成果",
    exact: true,
  });
  assert.ok((await outcomes.locator("[data-confirmed-outcome]").count()) > 0);
  assert.match(await outcomes.innerText(), /核对时间/);
  await page.locator(`[data-project-id="${project.id}"]`).click();
  await chooser.waitFor();
  assert.equal(await chooser.inputValue(), plan.key);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await screenshot(`03-focus-${width}`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await Promise.all([tree(root), tree(scopedRoot)]), before);
  checks.push(
    "Project switching and no-op focus preserve state; applicable scoped outcomes are visible; observed input trees remain byte-identical",
  );
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        provenance:
          "synthetic copied Product inputs and explicitly injected in-memory Runtime projection",
        checks,
        errors,
        requests,
        screenshots,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ result: "passed", artifacts: run, checks }, null, 2),
  );
} finally {
  await browser?.close();
  await runtime.app.close();
}
