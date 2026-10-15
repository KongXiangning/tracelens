import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { parse, stringify } from "yaml";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";
import { dispositionBasis } from "../dist/shared/evidence-dispositions.js";
import { projectAssessmentReviewText } from "../dist/shared/assessment-review-export.js";

// The browser and server use only this copied fixture and isolated registry.
await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(
  path.resolve("output/playwright/evidence-presentation-"),
);
const root = path.join(run, "fixture");
await cp("examples/product-scoped", root, { recursive: true });
const assessmentPath = path.join(root, "docs/product/ASSESSMENTS.md");
await writeFile(
  assessmentPath,
  (await readFile(assessmentPath, "utf8")).replace(
    "vnext-product-doc/v3",
    "vnext-product-doc/v6",
  ),
);
const sourcePath = "docs/evidence/responsibility.md";
const sourceText =
  "# Responsibility decision\nThe fixed demonstration obligation is unchanged.\n";
await writeFile(path.join(root, sourcePath), sourceText);
const manifestPath = path.join(root, ".workflow-system/PRODUCT.yaml");
const manifest = parse(await readFile(manifestPath, "utf8"));
manifest.source_paths.push(sourcePath);
await writeFile(manifestPath, stringify(manifest));
const source = {
  kind: "file",
  path: sourcePath,
  sha256: createHash("sha256").update(sourceText).digest("hex"),
};
async function editReport(change) {
  const raw = await readFile(assessmentPath, "utf8");
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  assert.ok(header);
  const document = parse(header[1]);
  change(document.items.find((item) => item.id === "A-DEMO"));
  await writeFile(
    assessmentPath,
    `---\n${stringify(document)}---${raw.slice(header[0].length)}`,
  );
}
await editReport((report) => {
  report.pending_sources = [source];
});
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  codexHome: path.join(run, "codex"),
  webRoot: path.resolve("dist/web"),
});
let browser, page;
const errors = [];
const checks = [];
try {
  const config = defaultConfig();
  config.product = {
    enabled: true,
    manifestPath: ".workflow-system/PRODUCT.yaml",
  };
  const project = await runtime.registry.add({
    name: "局部处置页面回归",
    root,
    config,
  });
  const initial = (await runtime.store.refresh(project.id)).snapshot.product;
  const report = initial.items.find((item) => item.id === "A-DEMO");
  assert.ok(report.usable);
  const basis = dispositionBasis(initial, report);
  assert.ok(basis);
  const disposition = {
    change_id: "responsibility-browser-regression",
    kind: "scope-change",
    source,
    disposition: "no-impact",
    reason: "The fixed demonstration obligation is unchanged.",
    checked_at: "2026-10-15T08:00:00Z",
    basis,
  };
  await editReport((report) => {
    report.evidence_dispositions = [disposition];
  });
  const savedReport = await readFile(assessmentPath);
  await runtime.store.refresh(project.id);
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  const card = page.locator('[data-overview-card="R-IMPORT"]');
  async function showOverview() {
    await page.goto(base);
    const showAll = page.getByRole("button", {
      name: "显示全部需求",
      exact: true,
    });
    await page.getByRole("region", { name: "项目待核对信息" }).waitFor();
    if (await showAll.isVisible()) await showAll.click();
    await card.waitFor();
  }
  async function exportData() {
    const response = await page.request.get(
      `${base}/api/projects/${project.id}/overview`,
    );
    assert.ok(response.ok());
    const { snapshot } = await response.json();
    const text = projectAssessmentReviewText(
      snapshot.overview.reviewRequirements,
      snapshot,
    );
    return JSON.parse(text.slice(text.indexOf("{")));
  }
  async function openReport() {
    await card
      .getByRole("button", { name: "查看验收记录 · R-IMPORT", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const result = dialog.locator('[data-overview-assessment="A-DEMO"]');
    await result.locator(".result-evidence > summary").click();
    await result.getByRole("button", { name: /查看报告与依据/ }).click();
    await page.locator(".requirements-v3-page").waitFor();
    return page.locator('[data-evidence-report="A-DEMO"]').first();
  }
  await showOverview();
  assert.match(
    await page.getByRole("region", { name: "项目待核对信息" }).innerText(),
    /没有验收待核对项/,
  );
  assert.equal((await exportData()).summary.reports, 0);
  assert.equal(
    await page
      .getByRole("button", { name: "复制全部待核对信息", exact: true })
      .isDisabled(),
    true,
  );
  let evidence = await openReport();
  assert.equal(
    await evidence.locator('[data-evidence-state="pending"]').count(),
    0,
  );
  assert.match(
    await evidence
      .locator('[data-evidence-state="handled"] > summary')
      .innerText(),
    /1 项/,
  );
  const reused = evidence.locator('[data-evidence-state="reused"]');
  await reused.locator("summary").click();
  assert.match(await reused.innerText(), /responsibility-browser-regression/);
  assert.match(await reused.innerText(), /2026-10-15T08:00:00Z/);
  assert.match(await reused.innerText(), /原报告结论与检查时间保留/);
  assert.match(await reused.innerText(), /R-IMPORT \/ G-DEMO \/ FULL/);
  await page.screenshot({
    path: path.join(run, "01-reused-report.png"),
    fullPage: true,
  });
  // This is reachable in the normal report overview, without opening raw fields.
  await reused
    .getByRole("button", { name: /docs\/evidence\/responsibility.md:1/ })
    .click();
  await page.locator(".documents-page").waitFor();
  assert.match(
    await page.locator(".documents-page").innerText(),
    /Responsibility decision/,
  );
  await page.goBack();
  await page.locator('[data-evidence-report="A-DEMO"]').first().waitFor();
  await page.goBack();
  await card.waitFor();
  checks.push(
    "Handled history and exact reuse explain zero pending in the normal report overview; source navigation and browser back preserve the report and overview.",
  );
  assert.deepEqual(
    await readFile(assessmentPath),
    savedReport,
    "Reading and navigation must preserve the original report bytes",
  );

  await editReport((report) => {
    report.evidence_dispositions = [
      { ...disposition, disposition: "deferred" },
    ];
  });
  await runtime.store.refresh(project.id);
  await showOverview();
  const expected = await exportData();
  assert.deepEqual(expected.summary, {
    changes: 1,
    requirements: 1,
    reports: 1,
    issues: 1,
  });
  assert.match(
    await page.getByRole("region", { name: "项目待核对信息" }).innerText(),
    /1 项变更 · 影响 1 项需求、1 份报告/,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copiedReview = text;
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: "复制全部待核对信息", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "已复制全部待核对信息" })
    .waitFor();
  const copied = await page.evaluate(() => window.copiedReview);
  assert.deepEqual(
    JSON.parse(copied.slice(copied.indexOf("{"))).summary,
    expected.summary,
  );
  await card
    .getByRole("button", { name: "查看待核对原因 · R-IMPORT", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  assert.equal(
    await dialog.locator('[data-review-category="scope-change"]').count(),
    1,
  );
  assert.match(await dialog.innerText(), /A-DEMO/);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  evidence = await openReport();
  assert.match(
    await evidence.locator('[data-evidence-state="pending"]').innerText(),
    /1 项/,
  );
  assert.equal(
    await evidence.locator('[data-evidence-state="handled"]').count(),
    0,
  );
  assert.equal(
    await evidence.locator('[data-evidence-state="reused"]').count(),
    0,
  );
  await evidence
    .locator('[data-evidence-state="unresolved"] > summary')
    .click();
  assert.match(await evidence.innerText(), /暂缓处理/);
  // The retained original fields must use the same effective pending result.
  await page
    .locator("summary")
    .filter({ hasText: "完整原文、关系与原始字段" })
    .click();
  assert.equal(
    await page
      .locator(
        '[data-evidence-report="A-DEMO"] [data-evidence-state="pending"]',
      )
      .count(),
    1,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(run, `02-pending-report-${width}.png`),
      fullPage: true,
    });
  }
  await page.goBack();
  await card.waitFor();
  checks.push(
    "A deferred disposition stays pending in the overview, report details, review dialog and copied export, with one change and preserved original report context.",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify({ checks, errors, run }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors, run }));
} catch (error) {
  if (page) {
    await page.screenshot({
      path: path.join(run, "error.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(run, "error.txt"),
      await page.locator("body").innerText(),
    );
  }
  console.error(JSON.stringify({ run, error: String(error) }));
  throw error;
} finally {
  await browser?.close();
  await runtime.app.close();
}
