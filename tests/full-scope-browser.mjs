// Actual browser interaction over an installed-helper host result. The supplied
// product observations are finite synthetic inputs, never real business proof.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../dist/server/app.js";
import { runtimeHashes } from "../dist/server/runtime-reader.js";

const hostRoot = process.env.TRACELENS_FULL_SCOPE_ROOT;
if (!hostRoot || !path.isAbsolute(hostRoot))
  throw new Error(
    "TRACELENS_FULL_SCOPE_ROOT must name the saved synthetic host project",
  );
await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(path.resolve("output/playwright/full-scope-"));
const scopedRoot = path.join(run, "scoped");
await cp("examples/product-scoped", scopedRoot, { recursive: true });
const { app, registry, store } = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const config = {
  readingMode: "custom",
  autoDiscover: false,
  rules: { management: [], requirements: [], design: [], planning: [] },
  excludes: [],
  product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
};
const host = await registry.add({
  name: "宿主完整规划合成结果",
  root: hostRoot,
  config,
});
const support = path.join(hostRoot, ".workflow-system/runtime/support");
await registry.selectRuntime(host.id, {
  sourceDirectory: support,
  moduleHashes: await runtimeHashes(support),
  workflowHome: "docs/workflow",
  accept: true,
});
const snapshot = (await store.refresh(host.id)).snapshot;
await writeFile(
  path.join(run, "host-snapshot.json"),
  JSON.stringify(snapshot, null, 2),
);
const scoped = await registry.add({
  name: "原范围缺口回归",
  root: scopedRoot,
  config,
});
await store.refresh(scoped.id);
async function tree(root) {
  const hashes = {};
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isSymbolicLink())
        hashes[path.relative(root, p)] = `symlink:${await readlink(p)}`;
      else if (e.isFile())
        hashes[path.relative(root, p)] = createHash("sha256")
          .update(await readFile(p))
          .digest("hex");
    }
  }
  await walk(root);
  return hashes;
}
const before = { host: await tree(hostRoot), scoped: await tree(scopedRoot) };
const checks = [],
  errors = [],
  requests = [];
let browser, page;
const check = (name, observed) => checks.push({ name, observed });
async function shot(name) {
  await page.screenshot({ path: path.join(run, name + ".png") });
  await writeFile(
    path.join(run, name + ".txt"),
    await page.locator("body").innerText(),
  );
}
const cardIds = () =>
  page
    .locator("[data-overview-card]")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-overview-card")),
    );
try {
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/"))
      requests.push({ method: r.method(), path: u.pathname });
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "宿主完整规划合成结果", exact: true })
    .click();
  await page.getByRole("heading", { name: "需求全景", exact: true }).waitFor();
  assert.deepEqual(await cardIds(), [
    "R-COLLECT",
    "R-STORE",
    "R-IMPORT",
    "R-QUERY",
  ]);
  await page
    .getByRole("button", { name: "展开子需求 · R-STORE", exact: true })
    .click();
  assert.equal(
    await page.locator('[data-overview-card="R-PROVENANCE"]').count(),
    1,
  );
  await page
    .getByRole("button", { name: "展开子需求 · R-IMPORT", exact: true })
    .click();
  await page
    .getByRole("button", { name: "收起子需求 · R-STORE", exact: true })
    .click();
  assert.equal(
    await page.locator('[data-overview-card="R-PROVENANCE"]').count(),
    1,
  );
  assert.equal(await page.locator('[data-overview-card="R-BOM"]').count(), 1);
  const parent = page.locator('[data-overview-card="R-IMPORT"]');
  assert.match(await parent.innerText(), /已暂停 1/);
  assert.match(await parent.innerText(), /已关闭 1/);
  assert.match(await parent.innerText(), /关联待核对/);
  check(
    "shared child survives folding one parent; parent Task lifecycle is independent from association conflict",
    await cardIds(),
  );
  await shot("01-overview-dag");

  await parent
    .getByRole("button", { name: "查看需求详情", exact: true })
    .click();
  const detail = page.locator('[data-product-id="R-IMPORT"]');
  await detail.waitFor();
  assert.equal(await detail.locator(".compact-task-list > li").count(), 2);
  const groups = detail.locator(".compact-task-list > li");
  assert.match(await groups.first().innerText(), /已暂停/);
  assert.match(await groups.first().innerText(), /关联待核对/);
  await groups.first().locator("summary").click();
  assert.match(await groups.first().innerText(), /R-BOM/);
  assert.match(await groups.first().innerText(), /R-PROVENANCE/);
  await groups
    .first()
    .getByRole("button", { name: "查看 Task / Step", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Task 生命周期：已暂停", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "返回上一视图", exact: true }).click();
  await detail.waitFor();
  await page.getByRole("button", { name: "返回上一视图", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "收起子需求 · R-IMPORT", exact: true })
      .count(),
    1,
  );
  check(
    "Task navigation and return retain expansion and every original coverage",
    "paused Task is navigable; report/source conflict does not replace its lifecycle",
  );
  await shot("02-task-return");

  await page.getByRole("button", { name: "需求", exact: true }).click();
  await page
    .getByRole("combobox", { name: "被评估对象", exact: true })
    .selectOption({
      label:
        "working-copy · 组合观察-synthetic-v1 @declared-synthetic-input04 （人为设定的有限样本观察材料，非实际日志或宿主复现）",
    });
  // G-SAMPLE is visible under the selected overall goal and must use its own
  // report tuple, rather than the selected G-USE tuple.
  const sampleNode = page.locator('[data-node-id="G-SAMPLE"]');
  await sampleNode.waitFor();
  assert.match(await sampleNode.innerText(), /已满足/);
  await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .selectOption({ label: "G-SAMPLE · 固定样本组合核对" });
  await page.locator('[data-node-id="R-STORE"]').click();
  let scopedConclusion = page.locator(".scoped-conclusion");
  await scopedConclusion
    .locator('[data-report-excerpts="A-STORE-SAMPLE"]')
    .waitFor();
  assert.match(await scopedConclusion.innerText(), /当前适用报告/);
  assert.match(await scopedConclusion.innerText(), /原文片段/);
  const excerpt = scopedConclusion
    .locator('[data-report-excerpts="A-STORE-SAMPLE"] > div')
    .first();
  const sourceTitle = await excerpt
    .locator(".source-link")
    .getAttribute("title");
  assert.match(sourceTitle, /ASSESSMENTS.md:\d+/);
  await excerpt.locator(".source-link").click();
  await page
    .getByRole("button", { name: "返回上一视图", exact: true })
    .waitFor();
  await shot("03-report-source");
  await page.getByRole("button", { name: "返回上一视图", exact: true }).click();
  await page.locator('[data-product-id="R-STORE"]').waitFor();
  await page.locator('[data-node-id="R-QUERY"]').click();
  assert.equal(
    await page.locator(".scoped-conclusion").getAttribute("data-conclusion"),
    "undetermined",
  );
  assert.match(
    await page.locator(".scoped-conclusion").innerText(),
    /已知局部成果|已知关键词定位/,
  );
  check(
    "goal nodes use own report; direct parent evidence and unknown remainder remain separate with source return",
    sourceTitle,
  );

  await page
    .getByRole("button", { name: "收起全部子需求", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "搜索需求图", exact: true })
    .fill("R-PROVENANCE");
  await page.locator('[data-node-id="R-PROVENANCE"]').waitFor();
  assert.equal(await page.locator('[data-node-id="R-PROVENANCE"]').count(), 1);
  await page.locator('[data-node-id="R-PROVENANCE"]').click();
  await page.getByRole("button", { name: "文档", exact: true }).click();
  await page.getByRole("button", { name: "需求", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "搜索需求图", exact: true })
      .inputValue(),
    "R-PROVENANCE",
  );
  await page.locator('[data-product-id="R-PROVENANCE"]').waitFor();
  check(
    "search and return reveal the folded shared child once with all relevant ancestors",
    await page
      .locator("[data-node-id]")
      .evaluateAll((n) => n.map((x) => x.getAttribute("data-node-id"))),
  );
  await shot("04-search-return");

  // Inject only a failed transport response. No project files are changed.
  const oldBatch = store.view(host.id).snapshot.id;
  await page.route("**/refresh", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "合成刷新传输失败" }),
    }),
  );
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("合成刷新传输失败", { exact: false }).waitFor();
  assert.equal(store.view(host.id).snapshot.id, oldBatch);
  assert.equal(
    await page
      .getByRole("textbox", { name: "搜索需求图", exact: true })
      .inputValue(),
    "R-PROVENANCE",
  );
  await shot("05-refresh-failure");
  await page.unroute("**/refresh");
  const refreshed = page.waitForResponse((r) => r.url().endsWith("/refresh"));
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  assert.ok((await refreshed).ok());
  await page.locator('[data-node-id="R-PROVENANCE"]').waitFor();
  check(
    "failure retains old batch and UI selection; successful refresh continues",
    { oldBatch, current: store.view(host.id).snapshot.id },
  );

  await page
    .getByRole("button", { name: "原范围缺口回归", exact: true })
    .click();
  await page.getByRole("button", { name: "需求", exact: true }).click();
  await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .selectOption({ label: "G-LIVE · 持续更新目标" });
  await page
    .getByRole("combobox", { name: "被评估对象", exact: true })
    .selectOption({ label: "working-copy · sample-copy-a @sample-baseline" });
  await page
    .getByRole("combobox", { name: "结论筛选", exact: true })
    .selectOption("gaps");
  await page.locator('[data-node-id="R-IMPORT"]').waitFor();
  await page.locator('[data-node-id="R-PIPELINE"]').waitFor();
  assert.equal(await page.locator('[data-node-id="R-IMPORT"]').count(), 1);
  check(
    "gap filtering exposes a folded child and its parent without manufacturing a gap from unknown",
    "original partial R-IMPORT remains reachable under R-PIPELINE",
  );
  await shot("06-gap-ancestor");
  assert.deepEqual(errors, []);
  const after = { host: await tree(hostRoot), scoped: await tree(scopedRoot) };
  assert.deepEqual(after, before);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        requests,
        before,
        after,
        browser: await browser.version(),
        limitations:
          "one Linux Chromium host; finite synthetic observations; no Windows/real business proof",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, run }));
} catch (error) {
  if (page) await shot("failure").catch(() => {});
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      { passed: false, error: String(error), checks, errors, requests },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await app.close();
}
