import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";

// Exercise writes only against an isolated example and registry.
await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(path.resolve("output/playwright/project-settings-"));
const root = path.join(run, "项目 副本");
await cp("examples/示例项目 Alpha", root, { recursive: true });
const support = path.join(root, ".workflow-system/runtime/support");
await mkdir(path.dirname(support), { recursive: true });
await cp("tests/fixtures/runtime-vn05", support, { recursive: true });
await writeFile(
  path.join(root, ".workflow-system/PROJECT_PROFILE.yaml"),
  "paths:\n  workflow_home: notes/工作流\n",
);
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const project = await runtime.registry.add({
  name: "项目设置验收",
  root,
  config: defaultConfig(),
});
const requests = [];
const errors = [];
const count = (method, pathname) =>
  requests.filter((r) => r.method === method && r.pathname === pathname).length;
const refreshPath = `/api/projects/${project.id}/refresh`;
let browser;
try {
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({
      method: request.method(),
      pathname: new URL(request.url()).pathname,
    }),
  );
  await page.goto(base);
  await page
    .getByRole("heading", { name: project.name, exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Task 视图", exact: true }).click();
  assert.equal(await page.locator(".runtime-trust").count(), 0);
  await page.getByRole("button", { name: "项目设置", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const name = dialog.getByRole("textbox", { name: "项目名称", exact: true });
  assert.equal(await name.isEnabled(), true);
  await name.fill("尚未保存的名称");
  await dialog
    .getByText("Runtime 来源信任 · 尚未选择", { exact: true })
    .click();
  await dialog.getByRole("button", { name: "确认信任并刷新" }).waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="可信 Runtime 目录"]')
      ?.value.includes("support"),
  );
  const directory = dialog.getByRole("textbox", { name: "可信 Runtime 目录" });
  assert.equal(await directory.inputValue(), support);
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "Runtime workflow home" })
      .inputValue(),
    "notes/工作流",
  );
  assert.equal(count("POST", "/api/discover"), 0);
  assert.equal(count("POST", refreshPath), 0);

  // A fresh project-list object on window focus must not reset edited fields or scan.
  await directory.fill(path.join(run, "手动目录"));
  const sync = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/projects",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sync;
  await page.screenshot({ path: path.join(run, "settings-edited.png") });
  assert.equal(await directory.inputValue(), path.join(run, "手动目录"));
  assert.equal(await name.inputValue(), "尚未保存的名称");
  assert.equal(count("POST", "/api/discover"), 0);
  assert.equal(count("POST", refreshPath), 0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "项目设置", exact: true }).click();
  await dialog
    .getByText("Runtime 来源信任 · 尚未选择", { exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="可信 Runtime 目录"]')?.disabled,
  );
  const refreshed = page.waitForResponse(
    (r) => new URL(r.url()).pathname === refreshPath,
  );
  await dialog.getByRole("button", { name: "确认信任并刷新" }).click();
  await refreshed;
  await dialog
    .getByText("Runtime 来源信任 · 已登记", { exact: true })
    .waitFor();
  assert.equal(
    runtime.registry.get(project.id).runtimeTrust.sourceDirectory,
    support,
  );
  assert.equal(count("POST", refreshPath), 1);
  assert.equal(
    count("PATCH", `/api/projects/${project.id}`),
    0,
    "Trust must not submit the enclosing project form",
  );
  assert.equal(count("POST", "/api/discover"), 0);
  await dialog.getByText("高级扫描设置", { exact: true }).click();
  const previewed = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/discover",
  );
  await dialog
    .getByRole("button", { name: "更新读取预览", exact: true })
    .click();
  await previewed;
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("dialog button")].find(
        (button) => button.textContent === "取消",
      )?.disabled,
  );
  assert.equal(count("POST", "/api/discover"), 1);
  assert.equal(count("POST", refreshPath), 1);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify({ result: "passed", requests, errors }, null, 2),
  );
  console.log(JSON.stringify({ result: "passed", artifacts: run }));
} finally {
  await browser?.close();
  await runtime.app.close();
}
