import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";

await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(path.resolve("output/playwright/project-switch-"));
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const projects = [];
for (let index = 0; index < 8; index++) {
  const root = path.join(run, `project-${index}`);
  await mkdir(root);
  projects.push(
    await runtime.registry.add({
      name:
        index === 0
          ? "LawAgent"
          : `TermLink-rust-source-resolution-项目副本-${index}`,
      root,
      config: defaultConfig(),
    }),
  );
}
const errors = [];
const requests = [];
let browser;
try {
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));
  await page.goto(base);
  const tabs = page.locator(".project-switch-card");
  await tabs.first().waitFor();
  assert.equal(await tabs.count(), 8);
  assert.equal(await tabs.first().getAttribute("aria-pressed"), "true");
  await tabs.nth(1).click();
  await page
    .getByRole("heading", { name: projects[1].name, exact: true })
    .waitFor();
  assert.equal(await tabs.nth(1).getAttribute("aria-pressed"), "true");
  assert.equal(await tabs.first().getAttribute("aria-pressed"), "false");
  assert.match(await tabs.nth(1).getAttribute("title"), /project-1/);
  await tabs.nth(2).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: projects[2].name, exact: true })
    .waitFor();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await tabs.last().click();
    await page
      .getByRole("heading", { name: projects[7].name, exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    const strip = page.locator(".project-switcher-cards");
    assert.ok(
      await strip.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    );
    await page.screenshot({ path: path.join(run, `projects-${width}.png`) });
    await tabs.first().click();
  }
  await page.getByRole("button", { name: "添加项目", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(requests.filter((url) => url.endsWith("/refresh")).length, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        errors,
        checks: [
          "direct card switching",
          "active highlight",
          "keyboard switching",
          "long name and path tooltip",
          "horizontal scrolling and 390px layout",
          "add project entry",
          "no refresh on switching",
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
