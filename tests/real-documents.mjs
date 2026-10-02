import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { discover } from "../dist/server/scanner.js";

const originalRoot = process.env.TRACELENS_REAL_PROJECT;
if (!originalRoot || !path.isAbsolute(originalRoot))
  throw new Error(
    "Set TRACELENS_REAL_PROJECT to a native absolute TermLink directory. Only selected documents are copied and read.",
  );
const output = path.resolve("output/playwright");
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, "real-documents-"));
const copyRoot = path.join(run, "只读文档副本");
const files = [
  ".workflow-system/PROJECT_PROFILE.yaml",
  "docs/README.md",
  "docs/workflow/DOCUMENT_CATALOG.md",
  "docs/workflow/CURRENT_TASK.md",
  "docs/workflow/STATUS.md",
  "docs/workflow/ROADMAP.md",
  "docs/workflow/TASKS/TASK-20260716-002-fix-web-codex-reasoning-permissions-data.md",
  "docs/workflow/TASKS/20260617-002-web-codex-session-ipc-first-data-routing.md",
  "docs/product/PRODUCT_REQUIREMENTS.md",
  "docs/architecture/CURRENT_STATE.md",
];
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const manifest = [];
for (const file of files) {
  const original = path.join(originalRoot, file);
  const digest = hash(await readFile(original));
  const destination = path.join(copyRoot, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(original, destination);
  assert.equal(hash(await readFile(destination)), digest);
  manifest.push({ path: file, sha256: digest });
}
const runtime = await createApp({ dataDir: path.join(run, "tool-data") });
let browser;
try {
  const discovery = await discover(copyRoot, runtime.registry.dataDir);
  const project = await runtime.registry.add({
    name: "TermLink · 真实文档只读副本",
    root: copyRoot,
    config: discovery.config,
  });
  const view = await runtime.store.refresh(project.id);
  assert.ok(view.snapshot);
  const snapshot = view.snapshot;
  assert.equal(
    snapshot.documents.find(
      (d) => d.path === "docs/product/PRODUCT_REQUIREMENTS.md",
    ).kind,
    "requirements",
  );
  assert.equal(
    snapshot.documents.find(
      (d) => d.path === "docs/architecture/CURRENT_STATE.md",
    ).kind,
    "design",
  );
  assert.ok(
    snapshot.navigation.entries
      .find((e) => e.path === "docs/product/PRODUCT_REQUIREMENTS.md")
      .sources.some((s) => s.path === "docs/README.md"),
  );
  assert.equal(
    snapshot.tasks.filter((t) => t.current).length,
    0,
    "Template placeholder must not become an active task",
  );
  const archive = snapshot.tasks.find((t) => t.number === "20260716-002");
  assert.ok(archive);
  assert.equal(archive.statuses[0].text, "archived");
  assert.equal(archive.steps.length, 5);
  assert.ok(archive.checks.filter((c) => c.checked === true).length >= 8);
  assert.ok(snapshot.statements.some((s) => s.kind === "achievement"));
  assert.ok(snapshot.statements.some((s) => s.kind === "risk"));
  for (const task of snapshot.tasks)
    for (const entry of [
      ...task.statuses,
      ...task.goals,
      ...task.steps,
      ...task.checks,
    ]) {
      const document = snapshot.documents.find(
        (d) => d.id === entry.source.documentId,
      );
      assert.equal(document.digest, entry.source.digest);
      assert.ok(
        document.raw.split("\n")[entry.source.line - 1].trim(),
        "Extracted source line must exist in scanned text",
      );
    }
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    channel:
      process.env.TRACELENS_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(base);
  await page.getByText("未记录当前任务", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(run, "real-overview.png") });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "任务", exact: true })
    .click();
  await page.locator(".task-item").filter({ hasText: "20260716-002" }).click();
  await page
    .getByRole("heading", {
      name: "修复 Web Codex 会话配置数据与头部重复路径",
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: path.join(run, "real-archive-task.png") });
  await page.locator(".task-detail > .source-link").click();
  await page.locator(".source-highlight").first().waitFor();
  await page.getByRole("button", { name: "原文", exact: true }).click();
  assert.match(
    await page.locator(".source-highlight").first().textContent(),
    /20260716-002/,
  );
  await page.screenshot({ path: path.join(run, "real-source.png") });
  assert.deepEqual(pageErrors, []);
  for (const file of manifest) {
    assert.equal(
      hash(await readFile(path.join(originalRoot, file.path))),
      file.sha256,
      "Observed original changed during validation",
    );
    assert.equal(
      hash(await readFile(path.join(copyRoot, file.path))),
      file.sha256,
      "Read-only copy was modified by scanner",
    );
  }
  const result = {
    result: "passed",
    originalRoot,
    documents: snapshot.documents.length,
    tasks: snapshot.tasks.length,
    statements: snapshot.statements.length,
    relations: snapshot.relations.length,
    warnings: snapshot.warnings.length,
    browser: await browser.version(),
    manifest,
    limitations:
      "Selected TermLink document samples only; not a claim of compatibility with all vNext versions or complete user requirements. Standard Profile/index navigation and known frontmatter fields are interpreted; arbitrary backtick prose and runtime fields are not interpreted. Missing registrations in this deliberately narrowed copy remain diagnostics.",
  };
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, artifacts: run }, null, 2));
} finally {
  if (browser) await browser.close();
  await runtime.app.close();
}
