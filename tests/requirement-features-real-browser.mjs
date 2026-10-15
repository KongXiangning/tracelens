// Read the explicitly supplied LawAgent project through the production service.
// Registry, screenshots and results belong to TraceLens; observed documents stay read only.
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { discover } from "../dist/server/scanner.js";
import { selectAssessment } from "../dist/shared/product-view.js";

const root = process.argv[2];
assert.ok(
  root && path.isAbsolute(root),
  "Supply the native absolute LawAgent project path",
);
const files = [
  ".workflow-system/PRODUCT.yaml",
  ...(await readdir(path.join(root, "docs/product")))
    .filter((file) => file.endsWith(".md"))
    .map((file) => `docs/product/${file}`),
];
async function hashes() {
  return Promise.all(
    files.map(async (file) => [
      file,
      createHash("sha256")
        .update(await readFile(path.join(root, file)))
        .digest("hex"),
    ]),
  );
}
const before = await hashes();
await mkdir("output/playwright", { recursive: true });
const output = await mkdtemp(
  path.resolve("output/playwright/requirement-features-real-"),
);
const runtime = await createApp({
  dataDir: path.join(output, "registry"),
  webRoot: path.resolve("dist/web"),
});
let browser;
const errors = [];
const results = [];
try {
  const discovery = await discover(root, runtime.registry.dataDir);
  const project = await runtime.registry.add({
    name: "LawAgent · 功能点评估核查",
    root,
    config: discovery.config,
  });
  const view = await runtime.store.refresh(project.id);
  assert.ok(view.snapshot?.product);
  const product = view.snapshot.product;
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("button", { name: "显示全部需求", exact: true }).click();

  async function chooseAssessment(detail, report) {
    const goal = product.items.find(
      (item) => item.id === report.metadata.applicability.goal_id,
    );
    const goalPicker = detail.getByRole("combobox", { name: "详情评估目标" });
    if (await goalPicker.count()) await goalPicker.selectOption(goal.key);
    const subjectPicker = detail.getByRole("combobox", { name: "被评估对象" });
    const value = await subjectPicker.locator("option").evaluateAll(
      (options, subject) =>
        options.find((option) => {
          try {
            const parsed = JSON.parse(option.value);
            return (
              parsed.kind === subject.kind &&
              parsed.value === subject.value &&
              (parsed.revision || null) === (subject.revision || null)
            );
          } catch {
            return false;
          }
        })?.value,
      report.metadata.subject,
    );
    assert.ok(value, "Reported subject must be selectable");
    await subjectPicker.selectOption(value);
    const scopePicker = detail.getByRole("combobox", {
      name: "适用范围",
      exact: true,
    });
    if (await scopePicker.count())
      await scopePicker.selectOption(report.metadata.applicability.scope_id);
    const selected = selectAssessment(
      product,
      report.metadata.target,
      goal.id,
      report.metadata.subject,
      report.metadata.applicability.scope_id,
    );
    assert.deepEqual(
      selected.reasons,
      [],
      `${report.id}: ${selected.reasons.join(", ")}`,
    );
    await detail
      .locator('.rd-report-applicability[data-applicable="true"]')
      .waitFor();
    return selected;
  }

  const cases = [
    ["REQ-KERNEL", "AS-V3-KERNEL-C5-IDENTITY-20261014", 6],
    ["REQ-LAW", "AS-LAW-CURRENT-20261014", 7],
    ["REQ-CASE", "AS-CASE-CURRENT-20261014", 7],
    ["REQ-JUDICIAL", "AS-JUDICIAL-CURRENT-20261014", 6],
    ["REQ-EVIDENCE", "AS-EVIDENCE-CURRENT-20261014", 6],
  ];
  for (const [id, reportId, count] of cases) {
    const report = product.items.find((item) => item.id === reportId);
    assert.ok(report, reportId);
    await page
      .locator(`[data-overview-card="${id}"]`)
      .getByRole("button", { name: "查看需求", exact: true })
      .click();
    const detail = page.locator(
      `.requirement-detail-page[data-requirement-id="${id}"]`,
    );
    await detail.waitFor();
    if (id !== "REQ-KERNEL") {
      await detail
        .locator(`.rd-feature[data-report-id="${reportId}"]`)
        .first()
        .waitFor();
      assert.equal(
        await detail
          .locator('.rd-report-applicability[data-applicable="false"]')
          .count(),
        1,
        "Browsing quotes a unique report without implicitly choosing its object for acceptance",
      );
    }
    const selected = await chooseAssessment(detail, report);
    const panel = detail.locator(".rd-functional-points");
    assert.equal(await panel.locator(".rd-feature").count(), count);
    assert.equal(await panel.locator(".rd-bound-task").count(), 0);
    assert.equal(await detail.getByRole("progressbar").count(), 0);
    assert.doesNotMatch(
      await panel.innerText(),
      /执行待核对|功能点与 Task 的关联/,
    );
    const states = await panel.locator(".rd-feature").evaluateAll((rows) =>
      rows.map((row) => ({
        id: row.dataset.featureId,
        state: row.dataset.implementation,
        report: row.dataset.reportId || null,
      })),
    );

    if (id === "REQ-KERNEL") {
      assert.ok(
        states.every(
          (row) => row.state === "unassessed" && row.report === null,
        ),
      );
      assert.match(await panel.innerText(), /所选报告没有逐点表格/);
      await panel.locator(".rd-report-basis > summary").click();
      const old = product.items.find(
        (item) => item.id === "AS-IMPLEMENTATION-KERNEL-20261013",
      );
      await panel
        .getByRole("combobox", { name: "功能点评估报告" })
        .selectOption(old.key);
      assert.match(
        await panel.locator(".rd-report-context").last().innerText(),
        /2026-10-14|本次复用/,
      );
      assert.match(await panel.innerText(), /完整当前运行\/验收尚未判定/);
      assert.equal(
        await panel
          .locator('.rd-report-applicability[data-applicable="false"]')
          .count(),
        1,
      );
      assert.equal(
        await panel
          .locator('.rd-feature[data-implementation="implemented"]')
          .count(),
        5,
      );
      assert.equal(
        await panel
          .locator('.rd-feature[data-implementation="partial"]')
          .count(),
        1,
      );
      await panel.locator(".rd-report-basis > summary").click();
    } else {
      assert.ok(states.every((row) => row.report === reportId));
      if (id === "REQ-LAW") {
        assert.equal(states.filter((row) => row.state === "partial").length, 3);
        assert.equal(
          states.filter((row) => row.state === "implemented").length,
          4,
        );
        await panel
          .getByRole("button", { name: "部分实现 3", exact: true })
          .click();
        assert.equal(await panel.locator(".rd-feature").count(), 3);
        await panel
          .getByRole("button", { name: "全部 7", exact: true })
          .click();
      }
      if (id === "REQ-CASE") {
        assert.equal(states.filter((row) => row.state === "partial").length, 5);
        assert.equal(
          states.filter((row) => row.state === "recorded").length,
          2,
        );
      }
      if (["REQ-JUDICIAL", "REQ-EVIDENCE"].includes(id))
        assert.ok(states.every((row) => row.state === "recorded"));
    }
    const inspect =
      id === "REQ-JUDICIAL"
        ? ["F2", "F5", "F6"]
        : id === "REQ-EVIDENCE"
          ? ["F1", "F5"]
          : id === "REQ-CASE"
            ? ["F4"]
            : ["F1"];
    for (const feature of inspect)
      await panel.locator(`[data-feature-id="${feature}"] > summary`).click();
    if (id === "REQ-JUDICIAL")
      assert.match(
        await panel.innerText(),
        /closed_at[\s\S]*空正文MD[\s\S]*王令某/,
      );
    if (id === "REQ-EVIDENCE")
      assert.match(
        await panel.innerText(),
        /confidence\/review_status[\s\S]*embedding_input_checksum/,
      );
    if (id === "REQ-CASE")
      assert.match(await panel.innerText(), /内容生成未实现[\s\S]*条件提取/);
    await page.screenshot({
      path: path.join(output, `${id}.png`),
      fullPage: true,
    });
    results.push({
      requirement: id,
      selectedReport: reportId,
      conclusion: selected.conclusion,
      states,
    });
    if (id === "REQ-LAW") {
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "Narrow layout must not overflow",
      );
      await page.screenshot({
        path: path.join(output, "REQ-LAW-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    await detail.locator(".rd-back").click();
  }
  assert.deepEqual(
    await hashes(),
    before,
    "Observed product documents and manifest must be unchanged",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        root,
        documentBytesUnchanged: true,
        errors,
        requirements: results,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: "passed",
      artifacts: output,
      requirements: results.map(({ requirement, conclusion }) => ({
        requirement,
        conclusion,
      })),
    }),
  );
} finally {
  await browser?.close();
  await runtime.app.close();
}
