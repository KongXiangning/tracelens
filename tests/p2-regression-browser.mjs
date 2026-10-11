// Focused regressions for the three reviewed P2s. Synthetic copies only;
// the pinned Runtime fixture is not a new distribution/install acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { parse, stringify } from "yaml";
import { createApp } from "../dist/server/app.js";
import {
  runtimeBudgets,
  runtimeHashes,
} from "../dist/server/runtime-reader.js";
import { runtimeModules } from "../dist/shared/runtime-types.js";

const output = path.resolve("output/playwright");
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, "p2-regression-"));
const scopedRoot = path.join(run, "scoped"),
  invalidRoot = path.join(run, "invalid");
for (const root of [scopedRoot, invalidRoot])
  await cp("examples/product-scoped", root, { recursive: true });

async function mutate(root, name, change) {
  const file = path.join(root, "docs/product", name),
    raw = await readFile(file, "utf8");
  const end = raw.indexOf("\n---", 4),
    document = parse(raw.slice(4, end));
  change(document.items);
  await writeFile(file, `---\n${stringify(document)}---${raw.slice(end + 4)}`);
}
async function tree(root) {
  const hashes = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else
        hashes[path.relative(root, filename)] = createHash("sha256")
          .update(await readFile(filename))
          .digest("hex");
    }
  }
  await walk(root);
  return hashes;
}
await mutate(scopedRoot, "PROJECT.md", (items) => {
  items
    .find((i) => i.id === "G-DEMO")
    .assessment_scopes.push({
      target: "R-IMPORT",
      scope_id: "SECOND",
      coverage: "另一明确范围",
    });
});
await mutate(invalidRoot, "ASSESSMENTS.md", (items) => {
  items[0].subject.value = { invalid: "retained for inspection" };
});

const support = path.join(scopedRoot, ".workflow-system/runtime/support");
await mkdir(support, { recursive: true });
for (const name of runtimeModules)
  await cp(
    path.resolve("tests/fixtures/runtime-vn05", name),
    path.join(support, name),
  );
async function prepare(title) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(support, "assistance.mjs"), "task", "--root", scopedRoot],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0)
          throw new Error(stderr || stdout || `Runtime exit ${code}`);
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(
      JSON.stringify({ action: "prepare", plan: { title, steps: [] } }),
    );
  });
}
await prepare("Paging task one");
await prepare("Paging task two");
runtimeBudgets.pageSize = 1;
const { app, registry, store } = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const config = {
  rules: { management: [], requirements: [], design: [], planning: [] },
  excludes: [],
  product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
};
const scoped = await registry.add({
  name: "P2 范围与分页",
  root: scopedRoot,
  config,
});
await registry.selectRuntime(scoped.id, {
  sourceDirectory: support,
  moduleHashes: await runtimeHashes(support),
  workflowHome: "docs/workflow",
  accept: true,
});
const first = (await store.refresh(scoped.id)).snapshot;
const demoDigest = first.product.items.find(
  (i) => i.id === "G-DEMO",
).definitionSha256;
// Keep the existing synthetic reports applicable to the expanded declaration.
await mutate(scopedRoot, "ASSESSMENTS.md", (items) => {
  for (const item of items)
    if (item.applicability.goal_id === "G-DEMO")
      item.goal_definition_sha256 = demoDigest;
});
await store.refresh(scoped.id);
const invalid = await registry.add({
  name: "P2 异常报告",
  root: invalidRoot,
  config,
});
await store.refresh(invalid.id);
const before = {
  scoped: await tree(scopedRoot),
  invalid: await tree(invalidRoot),
};
const results = [],
  errors = [];
let browser, page;
const check = (name, observed) => results.push({ name, observed });
async function shot(name) {
  await page.screenshot({ path: path.join(run, `${name}.png`) });
  await writeFile(
    path.join(run, `${name}.txt`),
    await page.locator("body").innerText(),
  );
}
async function chooseGoal(label) {
  await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .selectOption({ label });
}
async function conclusion(value) {
  await page
    .locator(`.scoped-conclusion[data-conclusion="${value}"]`)
    .waitFor();
}
async function refresh() {
  const response = page.waitForResponse((r) => r.url().endsWith("/refresh"));
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  const view = await (await response).json();
  await page.waitForFunction(
    (id) => document.body.textContent.includes(id),
    view.snapshot.id.slice(0, 8),
  );
  return view;
}
try {
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const channel =
    process.env.TRACELENS_BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined);
  browser = await chromium.launch({
    channel,
    executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
    headless: process.env.HEADED !== "1",
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "需求全景", exact: true }).waitFor();

  await page.getByRole("button", { name: "需求", exact: true }).click();
  await chooseGoal("G-DEMO · 固定知识集演示阶段");
  await page
    .getByRole("combobox", { name: "被评估对象", exact: true })
    .selectOption({ label: "working-copy · sample-copy-a @sample-baseline" });
  await page.locator("[data-node-id=R-IMPORT]").click();
  await page
    .getByRole("combobox", { name: "适用范围", exact: true })
    .selectOption("FULL");
  await conclusion("satisfied");
  await chooseGoal("G-LIVE · 持续更新目标");
  await conclusion("partially-satisfied");
  assert.match(
    await page.locator(".scoped-conclusion").innerText(),
    /RECOVERABLE/,
  );
  assert.equal(
    await page.getByRole("combobox", { name: "适用范围", exact: true }).count(),
    0,
  );
  await page
    .getByRole("combobox", { name: "结论筛选", exact: true })
    .selectOption("gaps");
  await page.locator("[data-node-id=R-IMPORT]").waitFor();
  check(
    "goal switch does not reuse another goal's scope or drop the gap",
    "FULL/satisfied → RECOVERABLE/partially-satisfied; R-IMPORT remains in gaps",
  );
  await shot("01-goal-switch");
  await chooseGoal("G-DEMO · 固定知识集演示阶段");
  await conclusion("satisfied");
  assert.equal(
    await page
      .getByRole("combobox", { name: "适用范围", exact: true })
      .inputValue(),
    "FULL",
  );
  await page
    .getByRole("combobox", { name: "结论筛选", exact: true })
    .selectOption("all");
  await page
    .getByRole("button", { name: "查看结论依据 · A-DEMO", exact: true })
    .click();
  await page.locator('[data-product-id="A-DEMO"]').waitFor();
  await page.getByRole("button", { name: "返回上一视图", exact: true }).click();
  await conclusion("satisfied");
  assert.equal(
    await page
      .getByRole("combobox", { name: "适用范围", exact: true })
      .inputValue(),
    "FULL",
  );
  check(
    "return preserves the goal-specific explicit scope",
    "G-DEMO/FULL and selected R-IMPORT restored after report navigation",
  );

  await page.getByRole("button", { name: "P2 异常报告", exact: true }).click();
  await page.getByRole("heading", { name: "需求全景", exact: true }).waitFor();
  // Composition is folded by default; malformed reports must still allow
  // reaching the child without affecting the readable requirement inventory.
  assert.equal(await page.locator("[data-overview-card]").count(), 4);
  await page
    .getByRole("button", { name: "展开子需求 · R-PIPELINE", exact: true })
    .click();
  assert.equal(await page.locator("[data-overview-card]").count(), 5);
  await page.getByRole("button", { name: "需求", exact: true }).click();
  await page
    .getByText("搜索与条目导航（含历史/旧格式）", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "A-DEMO · 演示范围", exact: true })
    .click();
  const report = page.locator('[data-product-id="A-DEMO"]');
  await report.getByText("完整原始元数据", { exact: true }).click();
  assert.match(
    await report.locator(".product-metadata pre").innerText(),
    /retained for inspection/,
  );
  assert.match(await report.innerText(), /结构不可用 · 原文保留/);
  await shot("02-invalid-report");
  await chooseGoal("G-LIVE · 持续更新目标");
  await page
    .getByRole("combobox", { name: "被评估对象", exact: true })
    .selectOption({ label: "working-copy · sample-copy-a @sample-baseline" });
  await page
    .getByRole("button", { name: "展开子需求 · R-PIPELINE", exact: true })
    .click();
  await page.locator("[data-node-id=R-IMPORT]").click();
  await conclusion("partially-satisfied");
  check(
    "invalid subject remains local and inspectable",
    "overview, navigation, raw malformed report and valid G-LIVE conclusion remain readable; no page error",
  );
  await shot("03-valid-report-retained");

  await page
    .getByRole("button", { name: "P2 范围与分页", exact: true })
    .click();
  await page.getByRole("heading", { name: "需求全景", exact: true }).waitFor();
  // Only hold transport delivery: Runtime and API responses are real.
  let releasePage, pageArrived, oldPage;
  const pageGate = new Promise((resolve) => (releasePage = resolve));
  const receivedPage = new Promise((resolve) => (pageArrived = resolve));
  const handler = async (route) => {
    const response = await route.fetch();
    oldPage = await response.json();
    pageArrived();
    await pageGate;
    await route.fulfill({ response });
  };
  await page.route("**/task-page", handler);
  let fresh;
  try {
    await page.getByRole("button", { name: /读取下一页 Task/ }).click();
    await receivedPage;
    fresh = await refresh();
    const delivered = page.waitForResponse((r) =>
      r.url().endsWith("/task-page"),
    );
    releasePage();
    await (await delivered).finished();
    await page
      .getByRole("button", { name: "读取下一页 Task（已读 1/2）", exact: true })
      .waitFor();
    assert.notEqual(fresh.snapshot.id, oldPage.snapshot.id);
    const currentServer = store.view(scoped.id).snapshot.id;
    assert.equal(currentServer, fresh.snapshot.id);
    assert.match(
      await page.locator(".workspace-footer").innerText(),
      new RegExp(fresh.snapshot.id.slice(0, 8)),
    );
    check("late page response cannot overwrite a completed refresh", {
      fresh: fresh.snapshot.id,
      discarded: oldPage.snapshot.id,
      currentServer,
    });
  } finally {
    releasePage();
    await page.unroute("**/task-page", handler);
  }
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".runtime-task-detail code")?.textContent === id,
    fresh.snapshot.tasks[0].realTaskId,
  );
  await page
    .getByRole("heading", { name: "Task 生命周期：草案", exact: true })
    .waitFor();
  assert.equal(await page.getByText(/任务详情暂不可用/).count(), 0);
  await shot("04-fresh-task-detail");
  const continued = page.waitForResponse((r) => r.url().endsWith("/task-page"));
  await page.getByRole("button", { name: /读取下一页 Task/ }).click();
  const complete = await (await continued).json();
  assert.equal(complete.snapshot.runtime.tasks.length, 2);
  await page.waitForFunction(() =>
    document.querySelector(".runtime-status")?.textContent.includes("2/2"),
  );
  await page.getByRole("button", { name: /TASK-002 Paging task two/ }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".runtime-task-detail code")?.textContent === id,
    complete.snapshot.tasks.find((task) => task.number === "TASK-002")
      .realTaskId,
  );
  await page
    .getByRole("heading", { name: "Task 生命周期：草案", exact: true })
    .waitFor();
  assert.equal(await page.getByText(/任务详情暂不可用/).count(), 0);
  check(
    "new batch still supports explicit paging and task detail",
    "fresh 1/2 → 2/2; both task detail requests succeed without 409",
  );
  await shot("05-normal-pagination");

  assert.deepEqual(errors, []);
  const after = {
    scoped: await tree(scopedRoot),
    invalid: await tree(invalidRoot),
  };
  assert.deepEqual(after, before);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify({ passed: true, results, errors, before, after }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks: results.length, run }));
} catch (error) {
  if (page) await shot("failure").catch(() => {});
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      { passed: false, error: String(error), results, errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await app.close();
}
