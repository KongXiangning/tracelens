import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";
import { buildOverviewData } from "../dist/shared/overview-data.js";

await mkdir("output/playwright", { recursive: true });
const output = await mkdtemp(path.resolve("output/playwright/review-results-"));
const runtime = await createApp({
  dataDir: path.join(output, "registry"),
  webRoot: path.resolve("dist/web"),
});
const project = await runtime.registry.add({
  name: "核对结果展示验证",
  root: path.resolve("examples/product-scoped"),
  config: {
    ...defaultConfig(),
    readingMode: "custom",
    product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
  },
});
const realFile = process.argv[2];
const view = realFile
  ? JSON.parse((await readFile(realFile, "utf8")).replace(/^\uFEFF/, ""))
  : structuredClone(await runtime.store.refresh(project.id));
const snapshot = view.snapshot;
snapshot.projectId = project.id;
let cases;
if (realFile) {
  cases = [
    ["REQ-20260222-server-admin-privilege-mode", 6, "部分满足"],
    ["REQ-20260222-session-retention-reconnect", 7, "已满足"],
  ];
} else {
  const item = snapshot.product.items.find((i) => i.id === "R-IMPORT");
  item.body = "### 功能点\n- 身份审计\n- 设备提示";
  const report = snapshot.product.items.find((i) => i.id === "A-LIVE");
  report.metadata.checked_at = "2026-10-15T15:00:00+08:00";
  report.metadata.extensions = {
    startup: {
      state: "无法确认",
      basis: "核对已完成：原始执行记录缺失，无法确认实际进展。",
    },
  };
  report.metadata.conclusion = "undetermined";
  report.body =
    "### 交付与验证依据\n已完成材料核对，缺少设备结果。\n\n| 功能义务 | 评估结论 | 原因 | 来源 |\n|---|---|---|---|\n| 原功能1 身份审计 | 未通过 | 拒绝路径缺少审计关联。 | evidence.md |\n| 原功能2 设备提示 | 无法评估 | 目标设备不可得。 | device.md |\n\n### 剩余与待核对\n- 补齐拒绝审计关联。\n- 设备恢复后补验提示。";
  snapshot.product.bindings = [];
  cases = [["R-IMPORT", 2, "无法判定是否满足"]];
}
const overview = {
  ...snapshot,
  revision: "review-results",
  overview: buildOverviewData(snapshot),
};
delete overview.product;
delete overview.documents;
let browser;
const errors = [];
try {
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/projects/*/overview*", (r) =>
    r.fulfill({ json: { ...view, snapshot: overview } }),
  );
  await page.route("**/api/projects/*/snapshot*", (r) =>
    r.fulfill({ json: view }),
  );
  await page.goto(base);
  await page
    .getByRole("button", { name: "显示已有核对结果", exact: true })
    .click();
  for (const [id, count, conclusion] of cases) {
    const card = page.locator(`[data-overview-card="${id}"]`);
    await card.waitFor();
    assert.match(
      await card.locator(".overview-progress-tag").innerText(),
      realFile ? /已核对 · 已开始过/ : /已核对 · 无法确认/,
    );
    await card
      .getByRole("button", { name: `查看进展核对结果 · ${id}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.ok(
      (await dialog.locator(".progress-result section > p").first().innerText())
        .length > 15,
    );
    assert.equal(await dialog.locator(".source-link:visible").count(), 0);
    await page.screenshot({ path: path.join(output, `${id}-progress.png`) });
    await page.keyboard.press("Escape");
    await card.getByRole("button", { name: "查看需求", exact: true }).click();
    const detail = page.locator(`[data-requirement-id="${id}"]`);
    await detail.waitFor();
    assert.match(
      await detail.locator(".rd-report-applicability").innerText(),
      new RegExp(conclusion),
    );
    assert.equal(await detail.locator(".rd-feature").count(), count);
    const rows = detail.locator(".rd-feature");
    assert.equal(
      await rows.locator(".rd-feature-description:visible").count(),
      0,
    );
    if (realFile) {
      const definitions = await rows
        .locator(".rd-feature-description")
        .allTextContents();
      assert.ok(
        definitions.every((text) => !/^已移至独立要求/.test(text.trim())),
        "Referenced definitions are resolved inline",
      );
      assert.match(
        definitions[0],
        id.includes("admin")
          ? /显式配置standard\/elevated/
          : /客户端断开后保留有效会话和PTY/,
      );
      assert.match(definitions[0], /范围边界/);
      assert.match(definitions[0], /验收要求/);
    }
    assert.equal(
      await rows.locator(".rd-badge").filter({ hasText: "未逐点列出" }).count(),
      0,
    );
    const detailUrl = page.url();
    await rows.first().locator(".rd-feature-heading").click();
    assert.equal(
      await rows.first().locator(".rd-feature-description").isVisible(),
      true,
    );
    assert.equal(
      page.url(),
      detailUrl,
      "Complete definition opens inline without navigation",
    );
    await rows.first().locator(".rd-feature-heading").click();
    assert.equal(
      await rows.first().locator(".rd-feature-description").isVisible(),
      false,
    );
    await rows.first().locator(".rd-feature-heading").click();
    assert.ok(
      (await rows.first().locator(".rd-feature-report").first().innerText())
        .length > 30,
    );
    assert.equal(await rows.first().locator(".source-link:visible").count(), 0);
    if (!realFile) {
      assert.match(await rows.nth(0).innerText(), /评估未通过/);
      assert.match(await rows.nth(0).innerText(), /拒绝路径缺少审计关联/);
      assert.match(await rows.nth(1).innerText(), /无法评估/);
      await rows.nth(1).locator("summary").first().click();
      assert.match(await rows.nth(1).innerText(), /目标设备不可得/);
    }
    await detail.locator(".rd-functional-points").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${id}-detail.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await rows.locator(".rd-feature-description:visible").count(),
      realFile ? 1 : 2,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({ path: path.join(output, `${id}-narrow.png`) });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await detail.locator(".rd-back").click();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify({ source: realFile || "synthetic", cases, errors }, null, 2),
  );
  console.log(output);
} finally {
  await browser?.close();
  await runtime.app.close();
}
