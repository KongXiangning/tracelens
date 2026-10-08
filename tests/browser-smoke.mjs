import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { chromium } from "playwright";

const workspace = process.cwd();
const output = path.join(workspace, "output", "playwright");
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, "acceptance-"));
const alpha = path.join(
  run,
  "中文 项目 Alpha 长路径用于核对目录与引用的可读性",
);
const beta = path.join(run, "中文 项目 Beta");
const gamma = path.join(run, "中文 项目 Gamma 文档导航");
const codexHome = path.join(run, "codex-home");
await mkdir(codexHome);
const codexState = JSON.stringify({
  "local-projects": {
    alpha: { name: "Codex Alpha", rootPaths: [alpha] },
    missing: { name: "失效登记", rootPaths: [path.join(run, "missing-codex")] },
  },
});
await writeFile(path.join(codexHome, ".codex-global-state.json"), codexState);
await cp(path.join(workspace, "examples", "示例项目 Alpha"), alpha, {
  recursive: true,
});
await cp(path.join(workspace, "examples", "示例项目 Beta"), beta, {
  recursive: true,
});
await cp(path.join(workspace, "examples", "示例项目 Gamma vNext"), gamma, {
  recursive: true,
});
await mkdir(path.join(gamma, "docs/records"));
await writeFile(
  path.join(gamma, "docs/disconnected-design.md"),
  "# 尚未登记的设计\n\n候选正文在手动纳入后可读。\n",
);
await writeFile(path.join(gamma, "docs/records/change.md"), "# 可选变更记录\n");
const gammaSeedIndexPath = path.join(gamma, "docs/README.md");
await writeFile(
  gammaSeedIndexPath,
  `${await readFile(gammaSeedIndexPath, "utf8")}\n[变更记录](records/change.md)\n`,
);
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
let service;
async function start() {
  service = spawn(process.execPath, ["dist/server/index.js"], {
    cwd: workspace,
    windowsHide: true,
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
    const timeout = setTimeout(
      () => reject(new Error("Production service startup timed out")),
      30000,
    );
    let log = "";
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
async function stop() {
  if (service && service.exitCode === null) {
    const exit = once(service, "exit");
    service.kill("SIGTERM");
    await exit;
  }
}
let browser;
const steps = [];
const errors = [];
const expectedDiagnostics = [];
const externalRequests = [];
let refreshCount = 0;
let page;
async function visible(locator) {
  await locator.first().waitFor({ state: "visible" });
}
async function screenshot(name) {
  await page.screenshot({
    path: path.join(run, `${name}.png`),
    fullPage: false,
  });
}
async function projects() {
  return (await fetch(`${base}/api/projects`)).json();
}
async function view(id) {
  return (await fetch(`${base}/api/projects/${id}/snapshot`)).json();
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
async function add(root, name, empty = false, codex = false) {
  await page
    .getByRole("button", { name: "添加项目", exact: true })
    .first()
    .click();
  await visible(page.getByRole("button", { name: /失效登记/ }));
  assert.equal(
    await page.getByRole("button", { name: /失效登记/ }).isDisabled(),
    true,
  );
  await screenshot("codex-project-picker");
  if (codex) {
    await page.getByRole("textbox", { name: "搜索 Codex 项目" }).fill("Alpha");
    await page.getByRole("button", { name: /Codex Alpha/ }).click();
  } else {
    await page.getByRole("tab", { name: "浏览目录" }).click();
    await page
      .getByRole("textbox", { name: "服务机器目录路径" })
      .fill(path.dirname(root));
    await page.getByRole("button", { name: "前往目录", exact: true }).click();
    await page
      .getByRole("button", { name: path.basename(root), exact: true })
      .click();
    await page.getByRole("button", { name: "选择当前目录" }).click();
  }
  await page.getByRole("textbox", { name: "项目名称", exact: true }).fill(name);
  if (empty) {
    await page.getByText("高级扫描设置", { exact: true }).click();
    await page
      .getByRole("checkbox", { name: "刷新时从 vNext 文档入口自动发现" })
      .uncheck();
    for (const type of ["管理文档", "需求文档", "设计文档", "规划文档"])
      await page.getByRole("textbox", { name: type, exact: true }).fill("");
  }
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/refresh") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "添加并扫描" }).click();
  await response;
  await visible(page.getByRole("heading", { name, exact: true }));
  await visible(page.getByRole("heading", { name: "项目概览", exact: true }));
  return (await projects()).find((p) => p.root === path.resolve(root));
}
async function nav(name) {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "Page overflowed horizontally",
  );
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
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      (message.location().url.endsWith("/api/discover") ||
        message.location().url.endsWith("/api/project-sources/directories")) &&
      message.text().includes("400 (Bad Request)")
    )
      expectedDiagnostics.push(message.text());
    else errors.push(message.text());
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(base) && !request.url().startsWith("data:"))
      externalRequests.push(request.url());
    if (request.method() === "POST" && request.url().endsWith("/refresh"))
      refreshCount++;
  });
  // Delay real responses only to inspect pending UI states; scan results are never mocked.
  let releaseLoading;
  const loadingGate = new Promise((resolve) => {
    releaseLoading = resolve;
  });
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") await loadingGate;
    await route.continue();
  });
  await page.goto(base);
  await visible(page.getByRole("heading", { name: "正在连接本地服务" }));
  await screenshot("loading");
  const loadedProjects = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "GET",
  );
  releaseLoading();
  await loadedProjects;
  await page.unroute("**/api/projects");
  await visible(page.getByRole("heading", { name: "添加你的第一个项目" }));
  await screenshot("empty");
  await nav("vNext 使用说明");
  await visible(
    page.getByRole("heading", { name: "vNext 使用说明", exact: true }),
  );
  assert.equal(await page.locator(".guide-scenario").count(), 23);
  assert.equal(
    await page.getByRole("button", { name: "刷新", exact: true }).count(),
    0,
  );
  await screenshot("1440-vnext-guide");
  await page
    .getByRole("textbox", { name: "搜索 vNext 场景" })
    .fill("EXECUTE-STEP finish");
  await page
    .getByRole("combobox", { name: "筛选 vNext 场景" })
    .selectOption("交付与提交");
  assert.equal(await page.locator(".guide-scenario").count(), 1);
  await page.locator(".guide-scenario summary").click();
  const guidePrompt = await page
    .getByRole("textbox", {
      name: "提示词：步骤已实现和审查：明确收尾",
      exact: true,
    })
    .inputValue();
  assert.ok(guidePrompt.startsWith("$execute-step 请使用 finish 模式"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .getByRole("button", {
      name: "复制提示词：步骤已实现和审查：明确收尾",
      exact: true,
    })
    .click();
  await visible(page.getByText("已复制", { exact: true }));
  assert.equal(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
    guidePrompt.replace(/\r\n/g, "\n"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".guide-group").scrollIntoViewIfNeeded();
  await screenshot("390-vnext-guide-prompt");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .getByRole("textbox", { name: "搜索 vNext 场景" })
    .fill("no-matching-vnext-scenario");
  await visible(page.getByText("没有匹配场景", { exact: true }));
  await page.getByRole("textbox", { name: "搜索 vNext 场景" }).fill("");
  await page
    .getByRole("combobox", { name: "筛选 vNext 场景" })
    .selectOption("");
  await page.locator(".guide-intro").scrollIntoViewIfNeeded();
  await screenshot("390-vnext-guide");
  assert.equal((await projects()).length, 0);
  assert.equal(refreshCount, 0);
  steps.push(
    "Global vNext guide works without a project; 23 scenarios cover 11 canonical skills; category/search/no-match, real clipboard, 1440/390 layouts; no registration or scan side effects",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav("概览");
  // Invalid local paths are reported inside the form and remain correctable.
  await page
    .getByRole("button", { name: "添加项目", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "浏览目录" }).click();
  await page
    .getByRole("textbox", { name: "服务机器目录路径", exact: true })
    .fill(path.join(run, "missing"));
  await page.getByRole("button", { name: "前往目录", exact: true }).click();
  await visible(page.getByRole("alert"));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const a = await add(alpha, "Alpha · 中文与长路径", false, true);
  const before = await view(a.id);
  await visible(
    page
      .getByText("配置文件缺失")
      .or(page.getByText("状态声明冲突", { exact: false }))
      .first(),
  );
  await screenshot("overview");
  await noOverflow();
  steps.push(
    "Initial loading, empty state, stale Codex registration disabled, invalid server path and real Codex shortcut > discover > add > scan",
  );

  const readsOnlyStart = refreshCount;
  await nav("vNext 使用说明");
  assert.equal(await page.locator(".scan-strip").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "刷新", exact: true }).count(),
    0,
  );
  assert.equal((await view(a.id)).snapshot.id, before.snapshot.id);
  assert.equal(refreshCount, readsOnlyStart);
  await nav("概览");
  await page
    .getByRole("button", {
      name: "20261001-001 实现离线目录索引与可恢复读取",
      exact: true,
    })
    .click();
  await visible(page.getByRole("heading", { name: "验收清单", exact: true }));
  await screenshot("tasks");
  await page
    .getByRole("button", { name: "索引的设计依据 / 恢复策略", exact: true })
    .click();
  await visible(page.locator(".source-highlight"));
  assert.equal(
    await page.locator(".source-highlight").first().textContent(),
    "恢复策略",
  );
  assert.equal(await page.evaluate(() => window.tracelensInjected), undefined);
  assert.equal(await page.locator(".markdown img").count(), 0);
  assert.equal(
    await page.locator('.markdown a[href^="javascript:"]').count(),
    0,
  );
  await screenshot("document-source");
  await page.getByRole("button", { name: "原文", exact: true }).click();
  assert.equal(
    await page.locator(".source-highlight").first().getAttribute("data-line"),
    "7",
  );
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page
    .locator(".document-reader")
    .getByRole("button", { name: "关联", exact: true })
    .click();
  await visible(page.locator(".react-flow__node"));
  assert.ok((await page.locator(".react-flow__node").count()) >= 3);
  assert.ok(
    await page
      .locator(".react-flow__edge-path")
      .evaluateAll((paths) => paths.some((p) => p.getTotalLength() > 20)),
  );
  await screenshot("relations");
  await page.locator(".react-flow__edge").first().click();
  await visible(page.locator(".relation-list .highlight"));
  assert.equal(await page.locator(".relation-list .highlight").count(), 3);
  await page
    .getByRole("group", {
      name: "打开关联节点 实现离线目录索引与可恢复读取",
      exact: true,
    })
    .click();
  await visible(page.getByRole("heading", { name: "实施步骤", exact: true }));
  await page
    .getByRole("button", {
      name: "docs/workflow/CURRENT_TASK.md:9",
      exact: true,
    })
    .click();
  await visible(page.locator(".source-highlight"));
  await nav("文档");
  await page
    .getByRole("textbox", { name: "搜索文档" })
    .fill("no-matching-document");
  await visible(page.getByText("无匹配文档", { exact: true }));
  await page.getByRole("textbox", { name: "搜索文档" }).fill("");
  assert.equal(refreshCount, readsOnlyStart);
  assert.equal((await view(a.id)).snapshot.id, before.snapshot.id);
  steps.push(
    "Overview > task > resolved section > raw source > reverse graph edge evidence and clickable task node; browsing never scanned; injection blocked",
  );

  await page.getByRole("button", { name: "配置扫描范围", exact: true }).click();
  await page
    .getByRole("textbox", { name: "排除规则", exact: true })
    .fill("docs/design/unknown.md");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await visible(page.getByText("配置已变更，需刷新", { exact: true }));
  assert.equal((await view(a.id)).snapshot.id, before.snapshot.id);
  assert.equal(
    await page
      .locator(".document-item")
      .filter({ hasText: "unknown.md" })
      .count(),
    1,
  );
  await refresh();
  assert.equal(
    await page
      .locator(".document-item")
      .filter({ hasText: "unknown.md" })
      .count(),
    0,
  );
  steps.push(
    "Configuration saves without scanning; old scope is displayed until explicit refresh and exclusion removes document",
  );

  const taskFile = path.join(alpha, "docs/workflow/CURRENT_TASK.md");
  const original = await readFile(taskFile, "utf8");
  const longTitle =
    "刷新后的任务标题：中文内容与 very-long-unbroken-document-title-for-layout-verification-20261002";
  await writeFile(
    taskFile,
    original.replace("实现离线目录索引与可恢复读取", longTitle),
  );
  await writeFile(
    path.join(alpha, "docs/design/new.md"),
    "# 手动刷新新增设计\n\n## 新章节\n\n刷新后可见",
  );
  await rm(path.join(alpha, "docs/design/storage.md"));
  await nav("概览");
  await visible(
    page.getByRole("button", {
      name: "20261001-001 实现离线目录索引与可恢复读取",
      exact: true,
    }),
  );
  const oldId = (await view(a.id)).snapshot.id;
  let releaseRefresh;
  const scanGate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/refresh", async (route) => {
    await scanGate;
    await route.continue();
  });
  const pending = refresh();
  await visible(page.getByRole("button", { name: "扫描中", exact: true }));
  assert.equal((await view(a.id)).snapshot.id, oldId);
  await screenshot("scanning-old-snapshot");
  releaseRefresh();
  await pending;
  await page.unroute("**/refresh");
  await visible(
    page.getByRole("button", {
      name: `20261001-001 ${longTitle}`,
      exact: true,
    }),
  );
  await nav("文档");
  assert.equal(
    await page
      .locator(".document-item")
      .filter({ hasText: "storage.md" })
      .count(),
    0,
  );
  assert.equal(
    await page.locator(".document-item").filter({ hasText: "new.md" }).count(),
    1,
  );
  await nav("任务");
  await noOverflow();
  await screenshot("long-title");
  await writeFile(
    path.join(alpha, "docs/design/binary.md"),
    Buffer.from([0xff, 0, 1]),
  );
  await page.getByRole("button", { name: "配置扫描范围", exact: true }).click();
  await page
    .getByRole("textbox", { name: "设计文档", exact: true })
    .fill("docs/design/*.md");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await writeFile(
    path.join(alpha, ".workflow-system/PROJECT_PROFILE.yaml"),
    "paths: [broken",
  );
  const partial = await refresh();
  assert.equal(partial.attempt.state, "partial");
  await nav("概览");
  await visible(page.getByText("读取失败：", { exact: false }));
  await visible(page.getByText("YAML 解析失败", { exact: false }));
  await screenshot("partial");
  steps.push(
    "Real sample mutations: edit task, add/delete documents, pending refresh keeps old content, read and YAML failure publish usable partial snapshot",
  );

  const b = await add(beta, "Beta · 独立项目");
  await visible(
    page.getByRole("button", {
      name: "20261002-002 整理小型知识库",
      exact: true,
    }),
  );
  await page
    .getByRole("button", { name: "Alpha · 中文与长路径", exact: true })
    .click();
  await visible(
    page.getByRole("button", {
      name: `20261001-001 ${longTitle}`,
      exact: true,
    }),
  );
  const old = await view(a.id);
  await rename(alpha, `${alpha}-moved`);
  const failed = await refresh();
  assert.equal(failed.attempt.state, "failed");
  assert.equal(failed.snapshot.id, old.snapshot.id);
  assert.equal(failed.snapshot.completedAt, old.snapshot.completedAt);
  await visible(page.getByText("已保留上次快照", { exact: false }));
  await screenshot("failed-old-snapshot");
  await nav("任务");
  await visible(page.getByRole("heading", { name: longTitle, exact: true }));
  await rename(`${alpha}-moved`, alpha);
  await stop();
  await start();
  await page.reload();
  await visible(page.getByRole("heading", { name: "尚未扫描", exact: true }));
  assert.equal((await projects()).length, 2);
  assert.deepEqual(
    (await projects()).find((p) => p.id === a.id).config.excludes,
    ["docs/design/unknown.md"],
  );
  assert.equal((await view(a.id)).snapshot, null);
  await screenshot("restart-unscanned");
  await refresh();
  await page
    .getByRole("button", { name: "Beta · 独立项目", exact: true })
    .click();
  await visible(page.getByRole("heading", { name: "尚未扫描", exact: true }));
  await rename(beta, `${beta}-moved`);
  const noOld = await refresh();
  assert.equal(noOld.snapshot, null);
  assert.equal(noOld.attempt.state, "failed");
  await visible(page.getByText("没有可展示的旧快照", { exact: false }));
  await screenshot("failed-no-snapshot");
  await rename(`${beta}-moved`, beta);
  await refresh();
  await visible(
    page.getByRole("button", {
      name: "20261002-002 整理小型知识库",
      exact: true,
    }),
  );
  steps.push(
    "Two projects stay independent; whole-root failure retains previous ID/time/content; restart preserves registration/config but has no snapshot; first failure is explicit",
  );

  const emptyRoot = path.join(run, "empty-project");
  await mkdir(emptyRoot);
  await add(emptyRoot, "Empty · 零匹配", true);
  await visible(page.getByText("扫描范围内没有可读文档", { exact: false }));
  await nav("任务");
  await visible(
    page.getByRole("heading", { name: "尚无任务记录", exact: true }),
  );
  await nav("关联");
  await visible(
    page.getByRole("heading", { name: "暂无可展示的关联节点", exact: true }),
  );
  await page.getByRole("button", { name: "移除项目", exact: true }).click();
  const removed = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" && r.url().includes("/api/projects/"),
  );
  await page.getByRole("button", { name: "移除登记", exact: true }).click();
  await removed;
  assert.equal((await projects()).length, 2);
  assert.deepEqual(
    await (await import("node:fs/promises")).readdir(emptyRoot),
    [],
  );
  steps.push(
    "Valid zero-match state across pages and removal preserves observed directory",
  );

  await page
    .getByRole("button", { name: "Alpha · 中文与长路径", exact: true })
    .click();
  await refresh();
  for (const size of [
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const name of ["概览", "任务", "文档", "关联"]) {
      await nav(name);
      await noOverflow();
      await screenshot(`${size.width}-${name}`);
    }
    await page
      .getByRole("button", { name: "配置扫描范围", exact: true })
      .click();
    await noOverflow();
    await screenshot(`${size.width}-configuration`);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("button", { name: "添加项目", exact: true })
      .first()
      .click();
    await visible(page.getByRole("button", { name: /Codex Alpha/ }));
    assert.equal(
      await page.getByRole("button", { name: /Codex Alpha/ }).isDisabled(),
      true,
    );
    await noOverflow();
    await screenshot(`${size.width}-codex-picker`);
    await page.getByRole("tab", { name: "浏览目录" }).click();
    await page.getByRole("textbox", { name: "服务机器目录路径" }).fill(alpha);
    await page.getByRole("button", { name: "前往目录", exact: true }).click();
    await visible(page.getByRole("button", { name: "docs", exact: true }));
    await noOverflow();
    await screenshot(`${size.width}-server-directory-picker`);
    await page.getByRole("button", { name: "上级目录", exact: true }).click();
    await visible(
      page.getByRole("button", { name: path.basename(alpha), exact: true }),
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const g = await add(gamma, "Gamma · vNext 自动导航");
  await visible(
    page.getByRole("heading", { name: "文档登记与缺口", exact: true }),
  );
  await visible(page.getByText("用户需求完整性：尚未确认。", { exact: false }));
  const firstGamma = (await view(g.id)).snapshot;
  assert.equal(
    firstGamma.documents.find((d) => d.path === "docs/product/requirements.md")
      .kind,
    "requirements",
  );
  assert.equal(
    firstGamma.documents.find((d) => d.path === "docs/design/storage.md").kind,
    "design",
  );
  assert.equal(
    firstGamma.documents.find((d) => d.path === "docs/misc.md").kind,
    "unclassified",
  );
  assert.ok(firstGamma.navigation.entries.some((e) => e.status === "draft"));
  assert.ok(
    firstGamma.navigation.inventory.candidates.includes(
      "docs/disconnected-design.md",
    ),
  );
  assert.ok(
    !firstGamma.documents.some((d) => d.path === "docs/disconnected-design.md"),
  );
  const candidatePanel = page.locator(".navigation-audit .candidate-documents");
  await candidatePanel.locator(":scope > summary").click();
  await page
    .getByRole("textbox", { name: "搜索未登记文档" })
    .fill("disconnected");
  await visible(
    candidatePanel.getByText("docs/disconnected-design.md", { exact: true }),
  );
  await page
    .getByRole("textbox", { name: "搜索未登记文档" })
    .fill("no-candidate-match");
  await visible(
    candidatePanel.getByText("本次盘点范围内没有匹配的未登记文件", {
      exact: true,
    }),
  );
  await page.getByRole("textbox", { name: "搜索未登记文档" }).fill("");
  assert.equal((await view(g.id)).snapshot.id, firstGamma.id);
  await page
    .getByRole("button", { name: "文档整理提示词", exact: true })
    .click();
  const prompt = await page
    .getByRole("textbox", { name: "文档整理提示词", exact: true })
    .inputValue();
  assert.ok(prompt.includes("docs/product/requirements.md"));
  assert.ok(prompt.includes("不要补造"));
  assert.ok(prompt.includes("的 agent"));
  assert.ok(prompt.includes("docs/disconnected-design.md"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "复制提示词", exact: true }).click();
  await visible(page.getByRole("button", { name: "已复制", exact: true }));
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipboard.replace(/\r\n/g, "\n"), prompt.replace(/\r\n/g, "\n"));
  await screenshot("organization-prompt");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  const gammaIndexFile = path.join(gamma, "docs/README.md");
  const gammaIndex = await readFile(gammaIndexFile, "utf8");
  await mkdir(path.join(gamma, "docs/requirements"));
  await writeFile(
    path.join(gamma, "docs/requirements/added.md"),
    "---\nstatus: active\n---\n# AI 登记后的新增需求\n\n需要显示新增需求。\n",
  );
  await writeFile(
    gammaIndexFile,
    gammaIndex.replace(
      "## 需求",
      "## 需求\n\n新增需求：[补充需求][added]\n\n[added]: requirements/added.md",
    ),
  );
  assert.equal((await view(g.id)).snapshot.id, firstGamma.id);
  await refresh();
  assert.equal(
    (await view(g.id)).snapshot.documents.find(
      (d) => d.path === "docs/requirements/added.md",
    ).kind,
    "requirements",
  );
  await nav("文档");
  await page
    .getByRole("combobox", { name: "文档类型", exact: true })
    .selectOption("unclassified");
  await visible(page.locator(".document-item").filter({ hasText: "misc.md" }));
  await nav("概览");
  await page
    .locator(".navigation-audit summary")
    .first()
    .evaluate((el) => {
      el.parentElement.open = true;
    });
  await page
    .getByRole("combobox", { name: "登记文档类型" })
    .selectOption("requirements");
  await page
    .locator(".registration-evidence .source-link")
    .filter({ hasText: "docs/README.md:" })
    .first()
    .click();
  await visible(page.locator(".source-highlight"));
  await nav("概览");
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page
      .locator(".navigation-audit summary")
      .first()
      .evaluate((el) => {
        el.parentElement.open = true;
      });
    await page.locator(".navigation-audit").scrollIntoViewIfNeeded();
    await noOverflow();
    await screenshot(`${size.width}-navigation-audit`);
    await candidatePanel.locator(":scope > summary").evaluate((el) => {
      el.parentElement.open = true;
    });
    await candidatePanel.scrollIntoViewIfNeeded();
    await noOverflow();
    await screenshot(`${size.width}-candidate-documents`);
    if (size.width === 390) {
      await page
        .getByRole("button", { name: "文档整理提示词", exact: true })
        .click();
      await noOverflow();
      await screenshot("390-organization-prompt");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .last()
        .click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeCandidateConfig = (await view(g.id)).snapshot.id;
  await page.getByRole("button", { name: "配置扫描范围", exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "允许读取 records 目录中的 Markdown / YAML 文档",
    })
    .check();
  await page
    .getByRole("textbox", { name: "候选文档盘点目录", exact: false })
    .fill("docs");
  await page
    .getByRole("textbox", { name: "设计文档", exact: true })
    .fill("docs/disconnected-design.md");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await visible(page.getByText("配置已变更，需刷新", { exact: true }));
  const storedCandidateConfig = (await projects()).find(
    (p) => p.id === g.id,
  ).config;
  assert.equal(storedCandidateConfig.includeRecords, true);
  assert.deepEqual(storedCandidateConfig.candidateRoots, ["docs"]);
  assert.equal((await view(g.id)).snapshot.id, beforeCandidateConfig);
  const includedCandidates = (await refresh()).snapshot;
  assert.ok(
    includedCandidates.documents.some(
      (d) =>
        d.path === "docs/disconnected-design.md" &&
        d.raw.includes("手动纳入后可读"),
    ),
  );
  assert.ok(
    includedCandidates.documents.some(
      (d) => d.path === "docs/records/change.md",
    ),
  );
  assert.ok(
    !includedCandidates.navigation.inventory.candidates.includes(
      "docs/disconnected-design.md",
    ),
  );
  steps.push(
    "Candidate inventory and search distinguish unregistered files without reading bodies; project-agent prompt includes candidates; records opt-in and candidate roots persist without implicit refresh; explicit inclusion reads the document; desktop/mobile candidate layouts",
  );
  await unlink(gammaIndexFile);
  await writeFile(
    path.join(gamma, "docs/requirements/added.md"),
    "# 索引失效后重新读取的新正文\n\n索引失效不能复用旧正文。\n",
  );
  await refresh();
  const missingIndex = (await view(g.id)).snapshot;
  assert.ok(missingIndex.navigation.incomplete);
  assert.ok(
    missingIndex.navigation.entries.some(
      (e) => e.path === "docs/README.md" && e.availability === "missing",
    ),
  );
  assert.ok(
    missingIndex.documents
      .find((d) => d.path === "docs/requirements/added.md")
      .raw.includes("重新读取的新正文"),
  );
  await visible(
    page.getByText("本次导航核对不完整，请查看导航与读取提示", { exact: true }),
  );
  await page.locator(".navigation-audit").scrollIntoViewIfNeeded();
  await screenshot("deleted-index-diagnostics");
  await nav("文档");
  await page
    .getByRole("combobox", { name: "文档类型", exact: true })
    .selectOption("all");
  await page
    .locator(".document-item")
    .filter({ hasText: "索引失效后重新读取的新正文" })
    .click();
  await visible(
    page
      .locator(".document-reader")
      .getByText("索引失效不能复用旧正文。", { exact: true }),
  );
  await screenshot("deleted-index-fresh-source");
  await page.getByRole("button", { name: "移除项目", exact: true }).click();
  const gammaRemoved = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" &&
      r.url().includes(`/api/projects/${g.id}`),
  );
  await page.getByRole("button", { name: "移除登记", exact: true }).click();
  await gammaRemoved;
  assert.equal((await projects()).length, 2);
  steps.push(
    "Standard vNext documentation_files > existing index > automatic requirements/design/planning with status and unknown classifications; prompt copied; paragraph reference-link index edits discovered on refresh; deleted known index shows diagnostics and rereads fresh source; registration evidence opens exact source; 1440/390 audit layouts",
  );
  await nav("概览");
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  assert.equal(
    await readFile(path.join(codexHome, ".codex-global-state.json"), "utf8"),
    codexState,
  );
  steps.push(
    "Server directory traversal, parent navigation, duplicate Codex registration disabled, both pickers at 1024/390, Codex metadata unchanged; all four pages and no unexpected browser errors/external requests",
  );
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        date: new Date().toISOString(),
        browser: await browser.version(),
        productionURL: base,
        steps,
        errors,
        expectedDiagnostics,
        externalRequests,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ result: "passed", artifacts: run, steps }, null, 2),
  );
} catch (error) {
  if (page) await screenshot("failure").catch(() => {});
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "failed",
        steps,
        errors,
        externalRequests,
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  await stop();
}
