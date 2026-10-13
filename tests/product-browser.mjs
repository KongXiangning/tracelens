import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { parse, stringify } from "yaml";
import { chromium } from "playwright";

// Production UI acceptance. Every mutation below is confined to copied, synthetic
// fixtures under output/. Neither originals nor a private project are ever scanned.
const workspace = process.cwd();
const output = path.join(workspace, "output", "playwright");
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, "product-acceptance-"));
const originals = ["product-comprehensive", "product-e6", "product-planning"];
async function treeDigest(root) {
  const hashes = {};
  async function walk(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory())
        await walk(path.join(directory, entry.name), name);
      else
        hashes[name] = createHash("sha256")
          .update(await readFile(path.join(directory, entry.name)))
          .digest("hex");
    }
  }
  await walk(root);
  return hashes;
}
const originalDigests = await Promise.all(
  originals.map((name) => treeDigest(path.join(workspace, "examples", name))),
);
async function copyFixture(fixture, name) {
  const root = path.join(run, name);
  await cp(path.join(workspace, "examples", fixture), root, {
    recursive: true,
  });
  return root;
}
const comprehensive = await copyFixture(
  "product-comprehensive",
  "中文 产品总览 超长项目路径与范围核对",
);
const e6 = await copyFixture("product-e6", "E6 中文后续工作与范围修复");
const noPlan = await copyFixture(
  "product-planning/no-plan",
  "没有预先计划的完整范围",
);
const multiple = await copyFixture(
  "product-planning/multiple-plans",
  "多份独立计划与同名工作项",
);
const reordered = await copyFixture(
  "product-planning/reordered",
  "B A C 重排与历史报告",
);
const missing = path.join(run, "PRODUCT 入口缺失");
await mkdir(missing);
const unsupported = await copyFixture(
  "product-planning/no-plan",
  "PRODUCT 不支持的版本",
);
const badItem = await copyFixture(
  "product-comprehensive",
  "单条损坏仍可阅读原文",
);
const manifestFile = ".workflow-system/PRODUCT.yaml";
const primaryFile = "docs/product/PROJECT.md";
const longTitle =
  "设备数据导入与中文超长范围标题 very-long-unbroken-product-requirement-title-for-responsive-layout-verification-20261008";
async function readDoc(root, filename) {
  const raw = await readFile(path.join(root, filename), "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(match, `Expected frontmatter: ${filename}`);
  return { metadata: parse(match[1]), body: match[2] };
}
async function writeDoc(root, filename, document) {
  await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  await writeFile(
    path.join(root, filename),
    `---\n${stringify(document.metadata, { aliasDuplicateObjects: false })}---\n${document.body}`,
  );
}
const full = await readDoc(comprehensive, primaryFile);
full.body = full.body.replace(
  "## [REQ-IMPORT] 设备数据导入",
  `## [REQ-IMPORT] ${longTitle}`,
);
const requirement = full.metadata.items.find(
  (item) => item.id === "REQ-IMPORT",
);
const codePath = "docs/evidence/source.js";
requirement.sources ??= [];
requirement.sources.push({
  kind: "file",
  path: codePath,
  lines: { start: 2, end: 2 },
});
await mkdir(path.dirname(path.join(comprehensive, codePath)), {
  recursive: true,
});
await writeFile(
  path.join(comprehensive, codePath),
  '// Captured source, never executed.\nconst text = "TASK-777 fake task";\n',
);
const taskA = {
  task_id: "browser-task-baseline",
  source: { kind: "file", path: "docs/evidence/TASKS/TASK-901.md" },
};
const taskR = {
  task_id: "browser-task-repair",
  source: { kind: "file", path: "docs/evidence/TASKS/TASK-902.md" },
};
requirement.task_bindings.push(
  {
    id: "B-REAL",
    task: taskA,
    role: "implementation",
    coverage: "合成单设备历史范围，保持原任务关闭声明",
    origin: "declared",
    state: "active",
    plan_items: [{ plan_id: "PLAN-IMPORT", work_item_id: "W-BASE" }],
  },
  {
    id: "B-REPAIR",
    task: taskR,
    role: "repair",
    coverage: "只处理本次异常输入反馈的局部范围",
    origin: "declared",
    state: "active",
    plan_items: [{ plan_id: "PLAN-IMPORT", work_item_id: "W-CHECK" }],
    repairs: [
      {
        task: taskA,
        coverage: "仅历史单设备导入相关交付，不重开整个原任务",
        sources: [{ kind: "file", path: "docs/evidence/incoming-report.md" }],
      },
    ],
  },
);
await writeDoc(comprehensive, primaryFile, full);
for (const [number, id, title, state] of [
  ["901", taskA.task_id, "中文历史导入实施", "closed"],
  ["902", taskR.task_id, "中文局部异常输入修复", "active"],
]) {
  const filename = path.join(
    comprehensive,
    `docs/evidence/TASKS/TASK-${number}.md`,
  );
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(
    filename,
    `# ${title}\n\n## 任务信息\n\n- task_id: ${id}\n- 任务编号: TASK-${number}\n- 任务标题: ${title}\n- 当前状态: ${state}\n\n## 验收标准\n- [ ] 使用实际记录核对合成范围\n`,
  );
}
const unsupportedManifest = path.join(unsupported, manifestFile);
await writeFile(
  unsupportedManifest,
  (await readFile(unsupportedManifest, "utf8")).replace(
    "vnext-product-manifest/v2",
    "vnext-product-manifest/v999",
  ),
);
const broken = await readDoc(badItem, primaryFile);
broken.metadata.items.find((item) => item.id === "REQ-EXPORT").scope =
  "not-a-supported-scope";
await writeDoc(badItem, primaryFile, broken);
const codexHome = path.join(run, "codex-home");
await mkdir(codexHome);
await writeFile(path.join(codexHome, ".codex-global-state.json"), "{}");
const fixtureInfo = {
  run,
  comprehensive,
  e6,
  noPlan,
  multiple,
  reordered,
  missing,
  unsupported,
  badItem,
  codexHome,
  dataDir: path.join(run, "tool-data"),
};
await writeFile(
  path.join(run, "fixtures.json"),
  JSON.stringify(fixtureInfo, null, 2),
);
if (process.env.TRACELENS_PREPARE_ONLY === "1") {
  console.log(JSON.stringify(fixtureInfo, null, 2));
  process.exit(0);
}
// This optional preflight validates the derived data without opening sockets or
// launching a browser. Its report explicitly does not claim interactive QA.
if (process.env.TRACELENS_PREFLIGHT_ONLY === "1") {
  const { buildSnapshot } = await import("../dist/server/snapshot.js");
  const snapshots = {};
  for (const [id, root] of Object.entries({
    comprehensive,
    e6,
    noPlan,
    multiple,
    reordered,
    missing,
    unsupported,
    badItem,
  })) {
    snapshots[id] = await buildSnapshot(
      {
        id: `product-browser-preflight-${id}`,
        name: id,
        root,
        configVersion: "preflight",
        config: {
          autoDiscover: false,
          product: { enabled: true, manifestPath: manifestFile },
          rules: { management: [], requirements: [], design: [], planning: [] },
          excludes: [],
        },
      },
      new Date().toISOString(),
    );
  }
  const product = snapshots.comprehensive.product;
  assert.equal(product.items.length, 12);
  assert.equal(
    product.items.every((item) => item.usable),
    true,
  );
  assert.equal(new Set(product.items.map((item) => item.type)).size, 9);
  assert.equal(snapshots.comprehensive.tasks.length, 2);
  assert.equal(
    product.bindings.find((binding) => binding.binding.id === "B-REAL").match
      .state,
    "matched",
  );
  assert.equal(
    product.bindings.find((binding) => binding.binding.id === "B-REPAIR").match
      .state,
    "matched",
  );
  assert.equal(
    product.bindings.find((binding) => binding.binding.id === "B-REPAIR")
      .repairs[0].match.state,
    "matched",
  );
  assert.equal(
    snapshots.e6.product.bindings.some(
      (binding) => binding.binding.id === "B-C",
    ),
    true,
  );
  assert.equal(
    snapshots.e6.product.items
      .find((item) => item.id === "PLAN-IMPORT")
      .metadata.work_items.some((item) => item.id === "E6C"),
    true,
  );
  assert.equal(
    snapshots.noPlan.product.items.some((item) => item.type === "plan"),
    false,
  );
  assert.equal(
    snapshots.multiple.product.items.filter((item) => item.type === "plan")
      .length,
    3,
  );
  assert.equal(snapshots.missing.product.status, "missing");
  assert.equal(snapshots.unsupported.product.status, "unsupported");
  assert.equal(
    snapshots.badItem.product.items.find((item) => item.id === "REQ-EXPORT")
      .usable,
    false,
  );
  assert.equal(
    snapshots.badItem.product.items.find((item) => item.id === "REQ-IMPORT")
      .usable,
    true,
  );
  for (const snapshot of Object.values(snapshots))
    for (const item of snapshot.product.items) {
      const document = snapshot.documents.find(
        (document) => document.id === item.source.documentId,
      );
      assert.equal(document.digest, item.source.digest);
      assert.ok(
        document.raw.split("\n")[item.source.line - 1].includes(`[${item.id}]`),
      );
    }
  for (let i = 0; i < originals.length; i++)
    assert.deepEqual(
      await treeDigest(path.join(workspace, "examples", originals[i])),
      originalDigests[i],
    );
  const result = {
    result: "fixture-preflight-passed",
    browserVerification: "not-run",
    artifacts: run,
    fixtures: Object.fromEntries(
      Object.entries(snapshots).map(([id, snapshot]) => [
        id,
        {
          status: snapshot.product.status,
          items: snapshot.product.items.length,
          tasks: snapshot.tasks.length,
        },
      ]),
    ),
  };
  await writeFile(
    path.join(run, "preflight-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
let service, browser, page;
const steps = [],
  errors = [],
  externalRequests = [],
  screenshots = [];
let refreshCount = 0;
async function start() {
  service = spawn(process.execPath, ["dist/server/index.js"], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      CODEX_HOME: codexHome,
      TRACELENS_DATA_DIR: path.join(run, "tool-data"),
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let log = "";
    const timeout = setTimeout(
      () => reject(new Error(`Production startup timed out: ${log}`)),
      30000,
    );
    service.stdout.on("data", (chunk) => {
      log += chunk;
      if (log.includes(`TraceLens: ${base}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    service.stderr.on("data", (chunk) => {
      log += chunk;
    });
    service.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    service.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Service exited (${code}): ${log}`));
    });
  });
}
async function visible(locator) {
  await locator.first().waitFor({ state: "visible" });
}
async function screenshot(name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(run, filename), fullPage: false });
  screenshots.push(filename);
}
async function projects() {
  return (await fetch(`${base}/api/projects`)).json();
}
async function view(id) {
  return (await fetch(`${base}/api/projects/${id}/snapshot`)).json();
}
async function nav(name) {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function noOverflow(label) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > innerWidth + 1 &&
          getComputedStyle(element).position !== "fixed",
      )
      .slice(0, 8)
      .map((element) => `${element.tagName}.${element.className}`),
  }));
  assert.ok(
    result.scroll <= result.width + 1,
    `${label}: horizontal overflow ${JSON.stringify(result)}`,
  );
}
async function refresh() {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/refresh") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  const result = await (await response).json();
  await visible(page.getByRole("button", { name: "刷新", exact: true }));
  return result;
}
async function selectItem(id) {
  await nav("需求");
  await page
    .getByRole("combobox", { name: "产品条目类型" })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "产品范围筛选" })
    .selectOption("all");
  await page.getByRole("textbox", { name: "搜索产品条目" }).fill("");
  await page
    .locator(".product-browser .document-item")
    .filter({
      has: page.locator(".doc-kind", { hasText: new RegExp(` · ${id}$`) }),
    })
    .click();
  await visible(page.locator(`.product-detail[data-product-id="${id}"]`));
}
async function add(root, name) {
  await page
    .getByRole("button", { name: "添加项目", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "浏览目录" }).click();
  await page
    .getByRole("textbox", { name: "服务机器目录路径" })
    .fill(path.dirname(root));
  await page.getByRole("button", { name: "前往目录", exact: true }).click();
  await page
    .getByRole("button", { name: path.basename(root), exact: true })
    .click();
  await page.getByRole("button", { name: "选择当前目录" }).click();
  await page.getByRole("textbox", { name: "项目名称", exact: true }).fill(name);
  await visible(page.getByRole("region", { name: "vNext 文档状态" }));
  assert.equal(
    await page.getByRole("checkbox", { name: "启用标准产品文档读取" }).count(),
    0,
  );
  assert.equal(
    await page.locator("dialog .registration-row:visible").count(),
    0,
  );
  if (name === "综合产品 · 中文与超长标题") {
    assert.equal(
      (await projects()).length,
      0,
      "Preview must not register a project",
    );
    assert.equal(refreshCount, 0, "Preview must not refresh");
    await screenshot("1440-vnext-automatic-preview");
  }
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/refresh") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "添加并扫描" }).click();
  await response;
  await visible(page.getByRole("heading", { name, exact: true }));
  await visible(page.getByRole("button", { name: "刷新", exact: true }));
  return (await projects()).find(
    (project) => project.root === path.resolve(root),
  );
}
async function assertSource(source, snapshot) {
  const document = snapshot.documents.find(
    (entry) => entry.id === source.documentId,
  );
  assert.ok(document, "Source belongs to current snapshot");
  await page
    .getByRole("button", { name: `${source.path}:${source.line}`, exact: true })
    .first()
    .click();
  await visible(page.locator(".document-reader"));
  await page.getByRole("button", { name: "原文", exact: true }).click();
  const highlight = page.locator(".document-reader .source-highlight");
  await visible(highlight);
  assert.equal(await highlight.getAttribute("data-line"), String(source.line));
  assert.equal(
    await highlight.locator("code").textContent(),
    document.raw.split("\n")[source.line - 1] || " ",
  );
}
async function mark(message) {
  steps.push(message);
  console.log(`PASS ${message}`);
}

try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
    channel:
      process.env.TRACELENS_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: process.env.HEADED !== "1",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(base) && !request.url().startsWith("data:"))
      externalRequests.push(request.url());
    if (request.method() === "POST" && request.url().endsWith("/refresh"))
      refreshCount++;
  });
  await page.goto(base);
  const main = await add(comprehensive, "综合产品 · 中文与超长标题");
  let mainView = await view(main.id);
  await nav("需求");
  assert.equal(mainView.snapshot.product.status, "ready");
  assert.equal(
    mainView.snapshot.product.items.every((item) => item.usable),
    true,
  );
  assert.equal(
    mainView.snapshot.product.bindings.find(
      (binding) => binding.binding.id === "B-REAL",
    ).match.state,
    "matched",
  );
  assert.equal(
    mainView.snapshot.product.bindings.find(
      (binding) => binding.binding.id === "B-REPAIR",
    ).repairs[0].match.state,
    "matched",
  );
  assert.equal(mainView.snapshot.product.items.length, 12);
  const codeCheck = mainView.snapshot.product.sources.find(
    (check) =>
      check.reference.kind === "file" && check.reference.path === codePath,
  );
  assert.equal(codeCheck.readState, "read");
  await selectItem("REQ-IMPORT");
  await page
    .locator(".product-detail > details.product-coverage > summary")
    .click();
  await page
    .getByRole("button", { name: `${codePath}:2`, exact: true })
    .first()
    .click();
  await visible(page.locator(".document-reader .raw-document"));
  await visible(
    page.locator('.document-reader .source-highlight[data-line="2"]'),
  );
  await mark(
    "Explicit code source opens captured plain text at its exact line without execution or task synthesis",
  );
  await nav("需求");
  await mark(
    "Directory selection previews vNext documentation without file choices; add automatically reads standard PRODUCT entries",
  );

  // Delay both data and the lazy product script to prove navigation CSS is an
  // entry asset, independent of snapshot completion or product module loading.
  let releaseSnapshot, releaseProduct;
  const snapshotGate = new Promise((resolve) => {
    releaseSnapshot = resolve;
  });
  const productGate = new Promise((resolve) => {
    releaseProduct = resolve;
  });
  const snapshotRoute = `**/api/projects/${main.id}/snapshot`;
  await page.route(snapshotRoute, async (route) => {
    await snapshotGate;
    await route.continue();
  });
  await page.route("**/assets/product-*.js", async (route) => {
    await productGate;
    await route.continue();
  });
  await page.reload();
  await visible(
    page.getByRole("heading", { name: "正在读取快照", exact: true }),
  );
  await visible(page.getByRole("navigation", { name: "主导航" }));
  assert.equal(
    await page
      .locator(".sidebar")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgb(247, 251, 255)",
  );
  assert.equal(await page.locator(".overview-dashboard").count(), 0);
  await screenshot("1440-startup-before-snapshot");
  releaseSnapshot();
  await visible(page.getByText("正在读取产品概况…", { exact: true }));
  assert.equal(
    await page
      .locator(".sidebar")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgb(247, 251, 255)",
  );
  await screenshot("1440-startup-before-product-module");
  releaseProduct();
  await visible(page.getByRole("heading", { name: "完整范围", exact: true }));
  await page.unroute(snapshotRoute);
  await page.unroute("**/assets/product-*.js");
  await mark(
    "First paint and delayed snapshot/product module use the same modern navigation; startup never displays the legacy shell",
  );

  const overviewReads = refreshCount;
  await nav("概览");
  await visible(page.getByRole("heading", { name: "完整范围", exact: true }));
  assert.equal(await page.locator(".overview-theme").count(), 1);
  const overviewPlan = mainView.snapshot.product.items.find(
    (item) => item.type === "plan",
  );
  assert.deepEqual(
    await page
      .locator("[data-roadmap-work]")
      .evaluateAll((cards) => cards.map((card) => card.dataset.roadmapWork)),
    overviewPlan.metadata.work_items.slice(0, 3).map((work) => work.id),
  );
  // Task lifecycles stay on requirement/Task views, never stand in for WorkItem completion.
  await visible(page.getByRole("heading", { name: "当前工作", exact: true }));
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await noOverflow(`${size.width} redesigned overview`);
    await screenshot(`${size.width}-overview-dashboard`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator('[data-roadmap-work="W-BASE"]')
    .getByRole("button", { name: /W-BASE/ })
    .click();
  await visible(page.locator('[data-work-item-id="W-BASE"]'));
  assert.equal(
    refreshCount,
    overviewReads,
    "Overview navigation never refreshes",
  );
  await nav("需求");
  await mark(
    "Reference overview layout shows real goals, original work order and document task states at 1440/1024/390; detail navigation preserves identity and does not refresh",
  );

  const browseRefreshCount = refreshCount;
  const typeSelect = page.getByRole("combobox", { name: "产品条目类型" });
  for (const type of [
    "project",
    "goal",
    "module",
    "requirement",
    "design",
    "plan",
    "change",
    "assessment",
    "discussion",
  ]) {
    await typeSelect.selectOption(type);
    assert.equal(
      await page.locator(".product-browser .document-item").count(),
      mainView.snapshot.product.items.filter((item) => item.type === type)
        .length,
      `Filter ${type}`,
    );
  }
  await typeSelect.selectOption("all");
  for (const scope of ["current", "planned", "candidate", "retired"]) {
    await page
      .getByRole("combobox", { name: "产品范围筛选" })
      .selectOption(scope);
    assert.equal(
      await page.locator(".product-browser .document-item").count(),
      mainView.snapshot.product.items.filter(
        (item) => item.metadata.scope === scope,
      ).length,
      `Filter ${scope}`,
    );
  }
  await page
    .getByRole("combobox", { name: "产品范围筛选" })
    .selectOption("all");
  await page
    .getByRole("textbox", { name: "搜索产品条目" })
    .fill("没有这样的业务条目");
  await visible(page.getByText("当前筛选无匹配条目", { exact: true }));
  await selectItem("REQ-IMPORT");
  await visible(page.getByRole("heading", { name: longTitle, exact: true }));
  await visible(page.getByText("报告通过", { exact: true }));
  await visible(
    page.getByRole("heading", { name: "待对账新材料 · 1 项", exact: true }),
  );
  await visible(
    page.getByText("仅报告旧单设备有效输入；不包含双设备与异常输入。", {
      exact: true,
    }),
  );
  await page
    .getByRole("button", { name: "DES-IMPORT · 导入解析提案", exact: true })
    .click();
  const design = mainView.snapshot.product.items.find(
    (item) => item.id === "DES-IMPORT",
  );
  await assertSource(design.source, mainView.snapshot);
  await screenshot("1440-design-exact-source-line");
  await mark(
    "All nine types and four scopes, empty search, complete long Chinese requirement, old passing report plus pending evidence, design relation and exact raw snapshot source line",
  );

  await selectItem("REQ-IMPORT");
  await page
    .locator('[data-binding-id="B-REAL"]')
    .getByRole("button", { name: "PLAN-IMPORT / W-BASE", exact: true })
    .click();
  await visible(page.getByRole("heading", { name: "总体规划", exact: true }));
  assert.deepEqual(
    await page
      .locator(".product-work-card")
      .evaluateAll((cards) => cards.map((card) => card.dataset.workItemId)),
    ["W-CHECK", "W-BASE", "W-DUAL"],
  );
  await visible(page.locator('[data-work-item-id="W-BASE"].source-highlight'));
  await page
    .locator('[data-work-item-id="W-BASE"] [data-binding-id="B-REAL"]')
    .getByRole("button", { name: "TASK-901 · 中文历史导入实施", exact: true })
    .click();
  await visible(
    page.getByRole("heading", { name: "中文历史导入实施", exact: true }),
  );
  await visible(
    page.getByRole("heading", { name: "产品业务与计划反查", exact: true }),
  );
  await visible(
    page.getByRole("heading", {
      name: "涉及本任务交付范围的后续修复",
      exact: true,
    }),
  );
  const reverse = page.locator(
    '.task-product-links [data-binding-id="B-REAL"]',
  );
  await reverse
    .getByRole("button", {
      name: `需求 · REQ-IMPORT · ${longTitle}`,
      exact: true,
    })
    .click();
  await visible(page.getByRole("heading", { name: longTitle, exact: true }));
  const repair = page.locator('[data-binding-id="B-REPAIR"]');
  await visible(
    repair.getByText("仅历史单设备导入相关交付，不重开整个原任务", {
      exact: false,
    }),
  );
  await repair
    .getByRole("button", {
      name: "TASK-902 · 中文局部异常输入修复",
      exact: true,
    })
    .click();
  await visible(
    page.getByRole("heading", { name: "中文局部异常输入修复", exact: true }),
  );
  await page
    .locator('.task-product-links [data-binding-id="B-REPAIR"]')
    .getByRole("button", { name: "PLAN-IMPORT / W-CHECK", exact: true })
    .click();
  await visible(page.locator('[data-work-item-id="W-CHECK"].source-highlight'));
  await selectItem("REQ-IMPORT");
  await page
    .getByRole("button", { name: "AS-BASE · 历史单设备报告", exact: true })
    .click();
  await visible(page.locator('.product-detail[data-product-id="AS-BASE"]'));
  await visible(page.getByText("报告通过", { exact: true }));
  await visible(
    page.getByRole("heading", { name: "待对账新材料 · 1 项", exact: true }),
  );
  assert.equal(
    refreshCount,
    browseRefreshCount,
    "Navigation must not refresh or read live files",
  );
  assert.equal((await view(main.id)).snapshot.id, mainView.snapshot.id);
  await screenshot("1440-assessment-old-report-and-pending");
  await mark(
    "Requirement → project plan ordered work → real task → reverse requirement → scoped repair task → reverse work → explicitly selected old assessment; navigation never refreshes",
  );

  for (const size of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await selectItem("REQ-IMPORT");
    await noOverflow(`${size.width} requirement`);
    await page.locator(".product-detail").scrollIntoViewIfNeeded();
    await screenshot(`${size.width}-long-chinese-requirement`);
    await nav("规划");
    await noOverflow(`${size.width} planning`);
    await page
      .locator('[data-work-item-id="W-CHECK"]')
      .scrollIntoViewIfNeeded();
    await screenshot(`${size.width}-scoped-repair-plan`);
    await page.getByRole("button", { name: "项目设置", exact: true }).click();
    await page.getByText("高级扫描设置", { exact: true }).click();
    await page
      .getByRole("button", { name: "更新读取预览", exact: true })
      .click();
    await visible(page.getByRole("region", { name: "vNext 文档状态" }));
    await noOverflow(`${size.width} configuration`);
    await screenshot(`${size.width}-product-configuration`);
    await page.getByRole("button", { name: "取消", exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mark(
    "1440, 1024 and 390px requirement, plan/repair and configuration layouts have no horizontal overflow; screenshots captured",
  );

  await selectItem("REQ-IMPORT");
  const previousIdentity = mainView.snapshot.product.items.find(
    (item) => item.id === "REQ-IMPORT",
  ).key;
  const currentDoc = await readDoc(comprehensive, primaryFile);
  const moveIndex = currentDoc.metadata.items.findIndex(
    (item) => item.id === "REQ-IMPORT",
  );
  const [movedMetadata] = currentDoc.metadata.items.splice(moveIndex, 1);
  const movedBody = currentDoc.body.match(
    /^## \[REQ-IMPORT\][\s\S]*?(?=^## \[|$(?![\s\S]))/m,
  )?.[0];
  assert.ok(movedBody);
  currentDoc.body = currentDoc.body.replace(movedBody, "");
  await writeDoc(comprehensive, primaryFile, currentDoc);
  await writeDoc(comprehensive, "docs/product/移动后的完整需求.md", {
    metadata: { schema: "vnext-product-doc/v2", items: [movedMetadata] },
    body: `# 移动后的业务定义\n\n${movedBody}`,
  });
  const mainManifest = parse(
    await readFile(path.join(comprehensive, manifestFile), "utf8"),
  );
  mainManifest.managed_paths = ["docs/product/*.md"];
  await writeFile(
    path.join(comprehensive, manifestFile),
    stringify(mainManifest),
  );
  const beforeRefresh = (await view(main.id)).snapshot.id;
  let releaseRefresh;
  const gate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/refresh", async (route) => {
    await gate;
    await route.continue();
  });
  const pending = refresh();
  await visible(page.getByRole("button", { name: "扫描中", exact: true }));
  assert.equal((await view(main.id)).snapshot.id, beforeRefresh);
  await visible(page.getByRole("heading", { name: longTitle, exact: true }));
  await screenshot("1440-refresh-pending-keeps-product");
  releaseRefresh();
  mainView = await pending;
  await page.unroute("**/refresh");
  const moved = mainView.snapshot.product.items.find(
    (item) => item.id === "REQ-IMPORT",
  );
  assert.equal(
    moved.key,
    previousIdentity,
    "Moving a PRODUCT block must preserve stable selection identity",
  );
  assert.equal(moved.source.path, "docs/product/移动后的完整需求.md");
  await visible(page.getByRole("heading", { name: longTitle, exact: true }));
  await assertSource(moved.source, mainView.snapshot);
  await selectItem("REQ-IMPORT");
  await rm(path.join(comprehensive, "docs/product/移动后的完整需求.md"));
  mainView = await refresh();
  await visible(
    page.getByRole("heading", { name: "所选条目已退出本次范围", exact: true }),
  );
  assert.equal(
    await page.locator(".product-detail").count(),
    0,
    "Removed identity cannot fall back to first or same-name item",
  );
  await screenshot("1440-removed-requirement-explicit-invalid-selection");
  await mark(
    "Isolated copied requirement moves across files with stable identity/exact new source; refresh pending keeps old view; removing selected identity shows explicit invalid state without fallback",
  );

  const e6Project = await add(e6, "E6 · 原版与 C 未创建变体");
  await nav("规划");
  await visible(page.locator('[data-work-item-id="E6C"]'));
  assert.deepEqual(
    await page
      .locator(".product-work-card")
      .evaluateAll((cards) => cards.map((card) => card.dataset.workItemId)),
    ["E6A", "E6B", "E6R", "E6C"],
  );
  assert.equal(
    await page
      .locator('[data-work-item-id="E6C"] [data-binding-id="B-C"]')
      .count(),
    1,
    "Canonical E6 fixture already contains C's declared task identity",
  );
  const e6Doc = await readDoc(e6, "docs/product/REQUIREMENTS.md");
  const e6Req = e6Doc.metadata.items.find((item) => item.id === "REQ-IMPORT");
  e6Req.task_bindings = e6Req.task_bindings.filter(
    (binding) => binding.id !== "B-C",
  );
  await writeDoc(e6, "docs/product/REQUIREMENTS.md", e6Doc);
  const e6View = await refresh();
  assert.equal(
    e6View.snapshot.product.items
      .find((item) => item.id === "PLAN-IMPORT")
      .metadata.work_items.some((work) => work.id === "E6C"),
    true,
  );
  const cCard = page.locator('[data-work-item-id="E6C"]');
  assert.equal(await cCard.locator(".product-binding").count(), 0);
  await visible(
    cCard.getByText("未记录任务关联。工作项保留，不创建假任务 ID。", {
      exact: true,
    }),
  );
  await visible(
    cCard.getByRole("button", { name: "PLAN-IMPORT / E6R", exact: true }),
  );
  await visible(
    page
      .locator('[data-work-item-id="E6R"]')
      .getByText("后加工作", { exact: true }),
  );
  await screenshot("1440-e6-c-not-created-work-preserved");
  await selectItem("REQ-IMPORT");
  await visible(page.getByText("报告失败", { exact: true }));
  await visible(
    page.getByRole("heading", { name: "待对账新材料 · 1 项", exact: true }),
  );
  await mark(
    "Canonical E6 C binding verified; copied C-not-created variant removes only B-C, retaining E6C order/dependency and added scoped repair, old failure and pending evidence",
  );

  const reorderedProject = await add(reordered, "重排 · 原顺序与历史报告");
  await nav("规划");
  await visible(page.locator('[data-work-item-id="B"]'));
  assert.deepEqual(
    await page
      .locator(".product-work-card")
      .evaluateAll((cards) => cards.map((card) => card.dataset.workItemId)),
    ["B", "A", "C"],
  );
  for (const id of ["A", "C"])
    assert.equal(
      await page
        .locator(`[data-work-item-id="${id}"] .product-binding`)
        .count(),
      0,
    );
  assert.equal(
    await page
      .locator('[data-work-item-id="B"] [data-binding-id="B-NEW"]')
      .count(),
    1,
  );
  const reorderedSnapshot = (await view(reorderedProject.id)).snapshot;
  assert.equal(reorderedSnapshot.product.items.length, 10);
  assert.equal(reorderedSnapshot.tasks.length, 0);
  await selectItem("REQ-IMPORT");
  await visible(page.getByText("报告通过", { exact: true }));
  await visible(
    page.getByRole("heading", { name: "待对账新材料 · 1 项", exact: true }),
  );
  await screenshot("1440-reordered-old-report-and-pending");
  await nav("规划");
  await screenshot("1440-reordered-B-A-C");
  await mark(
    "Current handoff fixture keeps B/A/C order, only B's explicit binding, historical partial pass and pending evidence without synthesizing tasks",
  );

  const noPlanProject = await add(noPlan, "无计划 · 动态业务选择");
  await nav("规划");
  await visible(page.getByText("未记录项目计划", { exact: true }));
  const noPlanSnapshot = (await view(noPlanProject.id)).snapshot;
  const business = noPlanSnapshot.product.items.filter((item) =>
    ["goal", "module", "requirement", "design"].includes(item.type),
  );
  assert.equal(
    await page.locator(".product-scope-list > div").count(),
    business.length,
  );
  assert.equal(await page.locator(".product-work-card").count(), 0);
  await visible(
    page.getByText("保留全部 current / planned / candidate / retired", {
      exact: false,
    }),
  );
  await screenshot("1440-no-plan-full-known-business-scope");
  const multiProject = await add(multiple, "多计划 · 不合并同名工作");
  await visible(page.getByRole("heading", { name: "完整范围", exact: true }));
  await visible(
    page.getByText("尚未唯一选定适用路线图；不按时间或文件顺序选择全项目计划", {
      exact: true,
    }),
  );
  const overviewMulti = (await view(multiProject.id)).snapshot;
  const overviewChooser = page.getByRole("combobox", { name: "阅读路线图" });
  await overviewChooser.selectOption(
    overviewMulti.product.items.find((item) => item.id === "PLAN-IMPORT").key,
  );
  assert.deepEqual(
    await page
      .locator("[data-roadmap-work]")
      .evaluateAll((cards) => cards.map((card) => card.dataset.roadmapWork)),
    ["W-VERIFY", "W-BASE", "W-RELEASE"],
  );
  await overviewChooser.selectOption(
    overviewMulti.product.items.find((item) => item.id === "PLAN-EXPORT").key,
  );
  assert.equal(await page.locator("[data-roadmap-work]").count(), 1);
  await nav("规划");
  await visible(
    page.getByRole("heading", { name: "请选择要查看的计划", exact: true }),
  );
  assert.equal(await page.locator(".product-work-card").count(), 0);
  const multiSnapshot = (await view(multiProject.id)).snapshot;
  const importPlan = multiSnapshot.product.items.find(
    (item) => item.id === "PLAN-IMPORT",
  );
  const exportPlan = multiSnapshot.product.items.find(
    (item) => item.id === "PLAN-EXPORT",
  );
  const planPicker = page.getByRole("combobox", { name: "选择项目计划" });
  await planPicker.selectOption(importPlan.key);
  assert.deepEqual(
    await page
      .locator(".product-work-card")
      .evaluateAll((cards) => cards.map((card) => card.dataset.workItemId)),
    ["W-VERIFY", "W-BASE", "W-RELEASE"],
  );
  const importWorkId = await page
    .locator('[data-work-item-id="W-RELEASE"]')
    .getAttribute("id");
  await visible(
    page
      .locator('[data-work-item-id="W-RELEASE"]')
      .getByText("其余输入与集成复验，细节待核对", { exact: false }),
  );
  await planPicker.selectOption(exportPlan.key);
  assert.equal(await page.locator(".product-work-card").count(), 1);
  const exportWorkId = await page
    .locator('[data-work-item-id="W-RELEASE"]')
    .getAttribute("id");
  assert.notEqual(
    importWorkId,
    exportWorkId,
    "Duplicate work ID must be scoped by plan identity",
  );
  await visible(
    page
      .locator('[data-work-item-id="W-RELEASE"]')
      .getByText("导出方案与验收范围核对", { exact: false }),
  );
  await screenshot("1440-multiple-plans-distinct-work-identity");
  await planPicker.selectOption(importPlan.key);
  await rm(path.join(multiple, "docs/product/PLAN-IMPORT.md"));
  await refresh();
  await visible(
    page.getByRole("heading", { name: "所选计划已退出本次范围", exact: true }),
  );
  assert.equal(await page.locator(".product-work-card").count(), 0);
  assert.equal(await planPicker.inputValue(), "");
  await mark(
    "No-plan retains all known business scope without fake work; multiple plans require explicit chooser, preserve original work order and isolate duplicate IDs; deleted selected plan never falls back",
  );

  for (const [root, name, status, heading] of [
    [missing, "缺失入口", "missing", "未发现 PRODUCT 入口"],
    [unsupported, "不支持入口版本", "unsupported", "不支持的 PRODUCT 版本"],
    [badItem, "损坏条目原文保留", "partial", "PRODUCT 部分可用"],
  ]) {
    const project = await add(root, name);
    await nav("需求");
    const state = (await view(project.id)).snapshot.product;
    assert.equal(state.status, status);
    await visible(page.getByRole("heading", { name: heading, exact: true }));
    if (status === "missing") {
      await page
        .getByRole("button", { name: "交给 vNext 整理", exact: true })
        .click();
      const prompt = await page
        .getByRole("textbox", { name: "文档整理提示词", exact: true })
        .inputValue();
      assert.ok(prompt.includes("maintain-project"));
      assert.ok(prompt.includes(".workflow-system/PRODUCT.yaml"));
      assert.ok(prompt.includes("不要求用户上传、选择缺失文件"));
      await screenshot("1440-missing-product-vnext-handoff");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .last()
        .click();
    }
    if (status === "partial") {
      await selectItem("REQ-EXPORT");
      await visible(page.getByText("结构不可用 · 原文保留", { exact: true }));
      await visible(
        page.getByText("后续提供已导入记录的离线导出。", { exact: true }),
      );
      assert.equal(
        state.items.some((item) => item.id === "REQ-IMPORT" && item.usable),
        true,
      );
      await assertSource(
        state.items.find((item) => item.id === "REQ-EXPORT").source,
        (await view(project.id)).snapshot,
      );
    }
    await screenshot(`1440-product-${status}`);
  }
  await mark(
    "Missing and unsupported PRODUCT entry states remain explicit; a malformed item preserves diagnostics/raw body/source while valid neighboring items remain usable",
  );

  assert.deepEqual(errors, [], "No browser runtime/console errors");
  assert.deepEqual(
    externalRequests,
    [],
    "No runtime or external network requests",
  );
  for (let i = 0; i < originals.length; i++)
    assert.deepEqual(
      await treeDigest(path.join(workspace, "examples", originals[i])),
      originalDigests[i],
      `Original ${originals[i]} fixture unchanged`,
    );
  await mark(
    "No unexpected browser errors/external requests; original comprehensive, E6 and planning fixture bytes are unchanged",
  );
  const result = {
    result: "passed",
    date: new Date().toISOString(),
    browser: await browser.version(),
    productionURL: base,
    steps,
    errors,
    externalRequests,
    screenshots,
  };
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      { result: "passed", artifacts: run, steps, screenshots },
      null,
      2,
    ),
  );
} catch (error) {
  if (page) {
    await screenshot("failure").catch(() => {});
    await writeFile(path.join(run, "failure.html"), await page.content()).catch(
      () => {},
    );
  }
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "failed",
        steps,
        errors,
        externalRequests,
        screenshots,
        error: String(error),
        stack: error.stack,
      },
      null,
      2,
    ),
  );
  console.error(`PRODUCT browser artifacts: ${run}`);
  throw error;
} finally {
  if (browser) await browser.close();
  if (service && service.exitCode === null) {
    const exit = once(service, "exit");
    service.kill("SIGTERM");
    await exit;
  }
}
