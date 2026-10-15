import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";

// All registrations and form submissions are confined to copied fixtures.
await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(path.resolve("output/playwright/overview-"));
const dataDir = path.join(run, "registry");
const codexHome = path.join(run, "codex");
await mkdir(codexHome);
const names = ["范围化验收合成项目", "无 PRODUCT 合成项目", "另一窗口合成项目"];
const roots = names.map((name) => path.join(run, name));
await cp("examples/product-scoped", roots[0], { recursive: true });
await cp("examples/示例项目 Alpha", roots[1], { recursive: true });
await cp("examples/示例项目 Beta", roots[2], { recursive: true });
// Pin the report's original file bytes, then change only whitespace outside the
// definitions. This must require a file review without claiming a requirement changed.
const definitionFile = path.join(roots[0], "docs/product/PROJECT.md");
const originalDefinition = await readFile(definitionFile, "utf8");
const recordedFileHash = createHash("sha256")
  .update(originalDefinition)
  .digest("hex");
const assessmentFile = path.join(roots[0], "docs/product/ASSESSMENTS.md");
await writeFile(
  path.join(codexHome, ".codex-global-state.json"),
  JSON.stringify({
    "local-projects": Object.fromEntries(
      names.map((name, i) => [
        String(i),
        { name, rootPaths: [roots[i]], hostId: "local" },
      ]),
    ),
  }),
);
const options = { dataDir, codexHome, webRoot: path.resolve("dist/web") };
let runtime = await createApp(options);
let browser;
const checks = [];
const errors = [];
const screenshots = [];
let releaseProjects;

async function addProject(page, name) {
  await page.locator(".overview-add-project").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: new RegExp(name) }).click();
  await dialog.getByRole("button", { name: "添加并扫描", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .locator(".project-switch-card.active")
    .filter({ hasText: name })
    .waitFor();
}

async function projectNames(page) {
  return page.locator(".project-switch-card > span").allTextContents();
}

async function screenshot(page, name) {
  const filename = path.join(run, `${name}.png`);
  await page.screenshot({ path: filename });
  screenshots.push(filename);
}

async function checkCardAlignment(page) {
  const cards = await page
    .locator(".overview-route-grid > [data-overview-card]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const sections = [
          ".overview-card-intro",
          ".overview-requirement-assessments",
          ".overview-task-summary",
          ".overview-card-actions",
        ].map((selector) => {
          const section = node.querySelector(selector);
          const rect = section.getBoundingClientRect();
          return {
            top: rect.top - box.top,
            bottom: rect.bottom - box.top,
            overflow: section.scrollHeight > section.clientHeight + 1,
          };
        });
        return { width: box.width, height: box.height, sections };
      }),
    );
  assert.ok(cards.length > 1);
  for (const card of cards) {
    assert.ok(
      Math.abs(card.height - cards[0].height) <= 1,
      "Cards must have equal heights across all rows",
    );
    assert.ok(
      Math.abs(card.width - cards[0].width) <= 1,
      "Cards must have equal widths",
    );
    card.sections.forEach((section, i) => {
      assert.ok(
        Math.abs(section.top - cards[0].sections[i].top) <= 1,
        "Card sections must align",
      );
      assert.equal(
        section.overflow,
        false,
        `Card section ${i} must not overlap: ${JSON.stringify(card)}`,
      );
    });
  }
  return cards[0].height;
}

async function checkDialogBounds(page) {
  const bounds = await page.getByRole("dialog").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: innerWidth,
      overflow: node.scrollWidth > node.clientWidth + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  assert.ok(bounds.left >= -1 && bounds.right <= bounds.width + 1);
  assert.equal(
    bounds.overflow,
    false,
    "Review dialog must not overflow horizontally",
  );
  assert.equal(
    bounds.pageOverflow,
    false,
    "Review dialog must preserve page bounds",
  );
}

function reviewPayload(text) {
  const start = text.indexOf("{");
  assert.ok(
    start >= 0,
    "Copied review information must include structured data",
  );
  return JSON.parse(text.slice(start));
}

async function copyAllReviews(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.copiedProjectReviewText = value;
        },
      },
    });
  });
  await page
    .getByRole("button", { name: "复制全部待核对信息", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "已复制全部待核对信息" })
    .waitFor();
  const text = await page.evaluate(() => window.copiedProjectReviewText);
  return { text, data: reviewPayload(text) };
}

try {
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const port = new URL(base).port;
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
  const fullReads = [];
  page.on("request", (request) => {
    if (/\/snapshot(?:\?|$)/.test(request.url())) fullReads.push(request.url());
  });
  await page.goto(base);
  await page.getByRole("heading", { name: "添加你的第一个项目" }).waitFor();
  assert.equal(
    await page.locator(".overview-theme .overview-brand-mark").count(),
    1,
  );
  const sidebarColor = await page
    .locator(".sidebar")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await screenshot(page, "01-empty");

  await addProject(page, names[0]);
  await page.getByRole("button", { name: "显示全部需求", exact: true }).click();
  const card = page.locator('[data-overview-card="R-IMPORT"]');
  await card.waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-overview-card="R-IMPORT"]')
      ?.textContent.includes("已满足 1"),
  );
  assert.match(await card.innerText(), /已满足 1/);
  assert.match(await card.innerText(), /部分满足 1/);
  assert.doesNotMatch(await card.innerText(), /固定知识集全量入库/);
  await screenshot(page, "02-layout-check");
  const cardHeight = await checkCardAlignment(page);
  assert.equal(
    await page
      .locator(".overview-dashboard")
      .evaluate((node) => node.firstElementChild.className),
    "overview-hero",
  );
  assert.equal(
    await page.locator(".overview-assessments").evaluate((node) => node.open),
    false,
  );
  assert.equal(
    await page
      .locator(".sidebar")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    sidebarColor,
  );
  checks.push(
    "Empty, loading and ready projects share one layout; scoped verdicts retain their coverage and delivery objects.",
  );
  await screenshot(page, "02-ready");
  assert.equal(fullReads.length, 0, "Overview must not fetch full snapshots");
  assert.equal(
    await page.locator(".overview-record-details .navigation-audit").count(),
    0,
  );
  assert.equal(
    await page.locator(".overview-reading-details .product-status").count(),
    0,
  );
  assert.ok((await page.locator("*").count()) < 4000);
  await page.evaluate(() => {
    window.overviewMutations = 0;
    window.overviewObserver = new MutationObserver(
      (records) => (window.overviewMutations += records.length),
    );
    window.overviewObserver.observe(
      document.querySelector(".overview-dashboard"),
      { subtree: true, childList: true, attributes: true, characterData: true },
    );
  });
  const focusSync = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/projects" &&
      response.request().method() === "GET",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await focusSync;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await page.evaluate(() => window.overviewMutations),
    0,
    "Unchanged focus sync should preserve the DOM",
  );
  await page.evaluate(() => window.overviewObserver.disconnect());

  const reviewMarker = card.getByRole("button", {
    name: "查看待核对原因 · R-IMPORT",
    exact: true,
  });
  let reviewDialog;
  async function verifyRealReview() {
    const beforeReviewReads = fullReads.length;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reviewMarker.click();
    reviewDialog = page.getByRole("dialog");
    await reviewDialog
      .getByRole("heading", { name: "待核对原因", exact: true })
      .waitFor();
    assert.ok(
      await reviewDialog
        .getByRole("heading", { name: /^来源文件变化/ })
        .count(),
    );
    assert.equal(
      await reviewDialog.getByText("需求定义变化", { exact: true }).count(),
      0,
      "A file-byte change outside the definition must not claim the requirement changed",
    );
    assert.equal(
      await reviewDialog
        .locator('[data-review-reason="target-definition-changed"]')
        .count(),
      0,
    );
    assert.match(await reviewDialog.innerText(), /A-DEMO/);
    assert.equal(
      await reviewDialog
        .locator(".assessment-review-comparisons:visible")
        .count(),
      0,
    );
    await reviewDialog
      .getByText("来源与技术核对明细", { exact: true })
      .first()
      .click();
    assert.match(await reviewDialog.innerText(), /docs\/product\/PROJECT\.md/);
    await reviewDialog
      .locator("summary")
      .filter({ hasText: "查看可发送给 agent 的核对信息" })
      .click();
    const reviewText = reviewDialog.getByRole("textbox", {
      name: "待核对信息",
      exact: true,
    });
    const handoff = await reviewText.inputValue();
    assert.match(handoff, /R-IMPORT/);
    assert.match(handoff, /A-DEMO/);
    assert.match(handoff, /docs\/product\/PROJECT\.md/);
    assert.match(handoff, /来源文件变化/);
    assert.match(handoff, new RegExp(recordedFileHash));
    assert.match(
      handoff,
      new RegExp(
        createHash("sha256").update(`${originalDefinition}\n`).digest("hex"),
      ),
    );
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.copiedReviewText = value;
          },
        },
      });
    });
    await reviewDialog
      .getByRole("button", { name: "复制核对信息", exact: true })
      .click();
    await reviewDialog
      .getByRole("status")
      .filter({ hasText: "已复制核对信息" })
      .waitFor();
    assert.equal(await page.evaluate(() => window.copiedReviewText), handoff);
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error(
          "Clipboard deliberately unavailable in this copied-fixture test",
        );
      };
    });
    await reviewDialog
      .locator("summary")
      .filter({ hasText: "查看可发送给 agent 的核对信息" })
      .click();
    assert.equal(await reviewText.isVisible(), false);
    await reviewDialog
      .getByRole("button", { name: "复制核对信息", exact: true })
      .click();
    await reviewDialog
      .getByRole("alert")
      .filter({ hasText: "剪贴板不可用" })
      .waitFor();
    assert.equal(await reviewText.isVisible(), true);
    assert.equal(await reviewText.inputValue(), handoff);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await checkDialogBounds(page);
      await screenshot(page, `02-review-reasons-${width}`);
      await reviewDialog
        .locator("[data-review-reason]")
        .first()
        .scrollIntoViewIfNeeded();
      await screenshot(page, `02-review-evidence-${width}`);
    }
    await reviewDialog
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await reviewDialog.waitFor({ state: "detached" });
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "查看待核对原因 · R-IMPORT",
    );
    assert.equal(
      await reviewMarker.evaluate((node) => document.activeElement === node),
      true,
      "Closing review reasons should return focus to the original card marker",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(
      fullReads.length,
      beforeReviewReads,
      "Review reasons and handoff use only overview data",
    );
    checks.push(
      "Real source-file byte changes expose report and source evidence without falsely reporting definition changes; review information copies successfully and remains selectable after clipboard failure at desktop and mobile widths.",
    );
    return handoff;
  }

  await card
    .getByRole("button", { name: "查看验收记录 · R-IMPORT", exact: true })
    .click();
  const reports = page.getByRole("dialog");
  assert.match(
    await reports.innerText(),
    /固定知识集全量入库；排除持续更新及失败恢复/,
  );
  assert.match(await reports.innerText(), /合成证据明确全量入库可用/);
  assert.equal(
    await reports.locator(".overview-assessment-link:visible").count(),
    0,
  );
  await reports
    .locator('[data-overview-assessment="A-DEMO"] .result-evidence > summary')
    .click();
  assert.match(await reports.innerText(), /sample-copy-a @ sample-baseline/);
  assert.equal(fullReads.length, 0, "Verdict summary uses only overview data");
  assert.equal(await checkCardAlignment(page), cardHeight);
  await reports.locator('[data-overview-assessment="A-DEMO"] button').click();
  await page.locator(".requirements-v3-page").waitFor();
  assert.match(
    await page.locator(".requirements-v3-page").innerText(),
    /A-DEMO/,
  );
  await page.goBack();
  await card.waitFor();
  const beforeDetails = fullReads.length;
  // Deliberately large diagnostic response to verify page bounds and unmounting.
  await page.route("**/snapshot?*snapshotId=*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.snapshot.warnings = Array.from({ length: 85 }, (_, i) => ({
      code: "fixture",
      message: `分页诊断 ${i + 1}`,
    }));
    await route.fulfill({ response, json: body });
  });
  await page.locator(".overview-record-details > summary").click();
  await page.locator(".overview-record-details .navigation-audit").waitFor();
  assert.equal(fullReads.length, beforeDetails + 1);
  assert.match(fullReads.at(-1), /snapshotId=/);
  const warningSection = page.locator(".diagnostics > details").first();
  await warningSection.locator(":scope > summary").click();
  await warningSection.locator(".record-pagination").waitFor();
  assert.equal(await warningSection.locator("li").count(), 40);
  await warningSection.getByRole("button", { name: "下一页" }).click();
  assert.match(
    await warningSection.locator("li").first().innerText(),
    /分页诊断 41/,
  );
  await warningSection.getByRole("button", { name: "下一页" }).click();
  assert.equal(await warningSection.locator("li").count(), 5);
  assert.equal(
    await warningSection.getByRole("button", { name: "下一页" }).isDisabled(),
    true,
  );
  await warningSection.locator(":scope > summary").click();
  await warningSection.locator("li").first().waitFor({ state: "detached" });
  await page.unroute("**/snapshot?*snapshotId=*");
  await page.locator(".overview-record-details > summary").click();
  await page
    .locator(".overview-record-details .navigation-audit")
    .waitFor({ state: "detached" });
  await page.locator(".overview-record-details > summary").click();
  await page.locator(".overview-record-details .navigation-audit").waitFor();
  assert.equal(
    fullReads.length,
    beforeDetails + 1,
    "Reopening the same snapshot shares the detailed fetch",
  );
  await page.locator(".overview-record-details > summary").click();
  checks.push(
    "Overview avoids full snapshots; closed details unmount, reopening reuses the exact snapshot, and unchanged focus produces no DOM mutations.",
  );
  checks.push(
    "A card verdict opens its exact report, then returns to the same overview.",
  );

  let heldProjects;
  const projectsHeld = new Promise((resolve) => {
    heldProjects = resolve;
  });
  const projectsReleased = new Promise((resolve) => {
    releaseProjects = resolve;
  });
  let holdNext = true;
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "GET" || !holdNext)
      return route.continue();
    holdNext = false;
    const response = await route.fetch();
    heldProjects();
    await projectsReleased;
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await projectsHeld;
  await addProject(page, names[1]);
  await page.locator(".overview-pending").waitFor();
  assert.deepEqual(await projectNames(page), names.slice(0, 2));
  releaseProjects();
  await page.unrouteAll({ behavior: "wait" });
  assert.deepEqual(await projectNames(page), names.slice(0, 2));
  assert.equal(
    await page.getByRole("heading", { name: "项目概览", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .locator(".overview-record-details")
      .evaluate((node) => node.open),
    false,
  );
  assert.equal(
    await page
      .locator(".sidebar")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    sidebarColor,
  );
  checks.push(
    "A delayed older project-list response cannot hide a newly added project; missing PRODUCT uses the same overview.",
  );
  await screenshot(page, "03-missing-product");

  const other = await browser.newPage();
  other.on("pageerror", (error) => errors.push(error.message));
  await other.goto(base);
  await other.locator(".overview-hero").waitFor();
  await addProject(other, names[2]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    () => document.querySelectorAll(".project-switch-card").length === 3,
  );
  assert.deepEqual(await projectNames(page), names);
  await other.close();
  await page.reload();
  await page.locator(".overview-hero").waitFor();
  assert.deepEqual(await projectNames(page), names);
  const registrations = JSON.parse(
    await readFile(path.join(dataDir, "projects.json"), "utf8"),
  );
  assert.deepEqual(
    registrations.map((project) => project.name),
    names,
  );
  for (const project of registrations) await runtime.store.refresh(project.id);
  await runtime.app.close();
  runtime = await createApp(options);
  await runtime.app.listen({ host: "127.0.0.1", port: Number(port) });
  await page.reload();
  await page.locator(".overview-hero").waitFor();
  assert.deepEqual(await projectNames(page), names);
  checks.push(
    "Other-window additions sync on focus; all project identities survive page reload and service restart.",
  );

  await page.locator(`[data-project-id="${registrations[1].id}"]`).click();
  await page.locator(".overview-pending").waitFor();
  await page.locator(`[data-project-id="${registrations[0].id}"]`).click();
  await card.waitFor();
  for (const width of [1920, 1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await checkCardAlignment(page);
    await page.locator(".overview-route-heading").scrollIntoViewIfNeeded();
    await screenshot(page, `04-overview-${width}`);
  }
  checks.push(
    "Project switching preserves the overview layout; cards have equal dimensions and aligned content at 1920, 1440, 1024 and 390 widths with no overflow. Report dialogs preserve the card layout.",
  );
  await writeFile(
    assessmentFile,
    (await readFile(assessmentFile, "utf8")).replaceAll(
      "target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: R-IMPORT}",
      `target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: R-IMPORT, sha256: ${recordedFileHash}}`,
    ),
  );
  await writeFile(definitionFile, `${originalDefinition}\n`);
  await runtime.store.refresh(registrations[0].id);
  await page.reload();
  await card.waitFor();
  const realReviewHandoff = await verifyRealReview();
  const beforeProjectReviewReads = fullReads.length;
  const realProjectReview = await copyAllReviews(page);
  const realOverview = await (
    await page.request.get(
      `${base}/api/projects/${registrations[0].id}/overview`,
    )
  ).json();
  assert.equal(realProjectReview.data.project.id, registrations[0].id);
  assert.equal(
    realProjectReview.data.project.snapshotId,
    realOverview.snapshot.id,
  );
  assert.equal(
    realProjectReview.data.project.completedAt,
    realOverview.snapshot.completedAt,
  );
  const realImportReview = realProjectReview.data.requirements.find(
    (entry) => entry.requirement.id === "R-IMPORT",
  );
  assert.ok(realImportReview);
  assert.deepEqual(
    realImportReview.reports,
    reviewPayload(realReviewHandoff).reports,
    "Project handoff must preserve the exact single-card report and evidence",
  );
  const demoReport = realImportReview.reports.find(
    (entry) => entry.report.id === "A-DEMO",
  );
  assert.equal(demoReport.report.subject.revision, "sample-baseline");
  assert.equal(demoReport.report.source.path, "docs/product/ASSESSMENTS.md");
  assert.match(realProjectReview.text, new RegExp(recordedFileHash));
  assert.match(
    realProjectReview.text,
    new RegExp(
      createHash("sha256").update(`${originalDefinition}\n`).digest("hex"),
    ),
  );
  assert.equal(fullReads.length, beforeProjectReviewReads);
  checks.push(
    "Project-wide copying preserves the current project/snapshot, exact single-card reports, source locations, recorded/current SHA-256 values and delivery revision without a full-snapshot read.",
  );
  // Project summary fixture exercises independent verdict, review and Task dimensions.
  let emptyProjectReviewFixture = false;
  await page.route("**/overview*", async (route) => {
    if (!route.request().url().includes("/api/projects/"))
      return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const data = body.snapshot.overview;
    const template = data.planned.find((item) => item.id === "R-IMPORT");
    function fixtureCard(id, conclusions, review, state) {
      return {
        ...template,
        id,
        key: id,
        title: `${id} 筛选样例`,
        firstTask: undefined,
        assessmentRecords: conclusions.map((conclusion, index) => ({
          report: {
            ...template.assessmentRecords[0].report,
            key: `${id}:report:${index}`,
            id: `${id}:report:${index}`,
            metadata: {
              ...template.assessmentRecords[0].report.metadata,
              applicability: {
                ...template.assessmentRecords[0].report.metadata.applicability,
              },
              conclusion,
            },
          },
          selection: {
            conclusion: review ? "undetermined" : conclusion,
            reasons: review ? ["合成来源待核对"] : [],
          },
        })),
        taskState: state
          ? {
              total: state === "身份未确认" ? 0 : 1,
              unconfirmed: state === "身份未确认" ? 1 : 0,
              associationPending: state === "身份未确认" ? 1 : 0,
              states: [{ label: state, tone: "slate", count: 1 }],
            }
          : { total: 0, unconfirmed: 0, associationPending: 0, states: [] },
      };
    }
    const green = fixtureCard("S-GREEN", ["satisfied"], true, "进行中");
    green.work = { current: true, recorded: true, latestTask: "合成执行记录" };
    green.assessmentRecords[0].review = {
      issues: [
        {
          code: "source-file-changed",
          category: "source-change",
          title: "来源文件变化",
          detail: "来源文件摘要不同；需求定义摘要相同。",
          action: "核对文件修改是否影响原报告依据，再记录核对结果。",
          comparisons: [
            {
              label: "来源文件摘要",
              recorded: "a".repeat(64),
              current: "b".repeat(64),
            },
          ],
          sources: [
            {
              label: "需求定义依据",
              reference: {
                kind: "file",
                path: "docs/product/PROJECT.md",
                item_id: "R-IMPORT",
              },
              source: template.assessmentRecords[0].report.source,
              status: "已读到；条目已定位；文件变化；需求定义相同",
            },
          ],
        },
      ],
    };
    green.assessmentRecords.push({
      report: {
        ...green.assessmentRecords[0].report,
        key: "S-GREEN:normal-report",
        id: "S-GREEN:normal-report",
        title: "无待核对原因的正常报告",
      },
      selection: { conclusion: "satisfied", reasons: [] },
    });
    const amber = fixtureCard(
      "S-AMBER",
      ["partially-satisfied"],
      true,
      "已关闭",
    );
    amber.work = {
      current: false,
      recorded: false,
      latestTask: "",
      pending: true,
    };
    amber.assessmentRecords[0].review = {
      issues: [
        {
          code: "definition-changed",
          category: "scope-change",
          title: "需求定义变化",
          detail: "R-IMPORT 的当前需求定义摘要与报告记录不同。",
          action: "比较原需求和当前需求，重新核对报告是否覆盖新增要求。",
          comparisons: [
            {
              label: "需求定义摘要",
              recorded: "c".repeat(64),
              current: "d".repeat(64),
            },
          ],
          sources: [
            {
              label: "当前需求定义",
              reference: {
                kind: "file",
                path: "docs/product/PROJECT.md",
                item_id: "R-IMPORT",
              },
              source: template.assessmentRecords[0].report.source,
            },
          ],
        },
      ],
    };
    const sharedBoundary = {
      code: "pending-evidence",
      category: "scope-change",
      change: {
        id: "shared-boundary",
        kind: "scope-change",
        source: {
          kind: "file",
          path: "decisions/shared-boundary.md",
          sha256: "e".repeat(64),
        },
      },
      title: "共享职责变更",
      detail: "同一职责变更只调查一次，分别保留领域义务映射。",
      action: "核对实际受影响的局部义务。",
    };
    const blue = fixtureCard("S-BLUE", ["undetermined"], true);
    blue.assessmentRecords[0].review = { issues: [sharedBoundary] };
    blue.assessmentRecords[0].report.metadata.applicability.coverage =
      "BLUE 的领域义务";
    data.planned = [
      green,
      amber,
      blue,
      fixtureCard("S-MIXED", ["satisfied", "partially-satisfied"], false),
      fixtureCard("S-EMPTY", [], false),
      fixtureCard("S-DONE", ["satisfied"], false, "已完成"),
      fixtureCard("S-PENDING", ["satisfied"], true, "身份未确认"),
    ];
    data.unordered = [fixtureCard("U-AMBER", ["partially-satisfied"], true)];
    data.unordered[0].assessmentRecords[0].review = {
      issues: [sharedBoundary],
    };
    data.unordered[0].assessmentRecords[0].report.metadata.applicability.coverage =
      "AMBER 的领域义务";
    // These are deliberately synthetic summary fields, not an actual scan result.
    // A project export includes non-current requirements that have no overview card.
    data.reviewRequirements = emptyProjectReviewFixture
      ? []
      : [
          ...data.planned,
          ...data.unordered,
          {
            ...fixtureCard("S-HISTORICAL", ["satisfied"], true),
            scope: "planned",
          },
        ];
    body.snapshot.revision = emptyProjectReviewFixture
      ? "filter-fixture-no-review"
      : "filter-fixture";
    await route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.locator('[data-overview-card="S-GREEN"]').waitFor();
  const expandRange = page.getByRole("button", { name: /展开完整范围/ });
  if (await expandRange.count()) await expandRange.click();
  const filterBar = page.getByRole("region", { name: "完整范围筛选" });
  const tasks = filterBar.getByRole("combobox", { name: "筛选 Task 关联情况" });
  const beforeFilterReads = fullReads.length;
  const allReviewsButton = page.getByRole("button", {
    name: "复制全部待核对信息",
    exact: true,
  });
  assert.equal(
    await filterBar
      .getByRole("button", { name: "复制全部待核对信息", exact: true })
      .count(),
    0,
    "Project copying must stay outside the card filter controls",
  );
  const syntheticProjectReview = await copyAllReviews(page);
  assert.deepEqual(syntheticProjectReview.data.summary, {
    changes: 5,
    requirements: 6,
    reports: 6,
    issues: 6,
  });
  const sharedChange = syntheticProjectReview.data.changeGroups.find((group) =>
    group.changeIds.includes("shared-boundary"),
  );
  assert.equal(sharedChange.affectedReports.length, 2);
  const projectChanges = page.locator(".project-assessment-review-groups");
  await projectChanges.locator(":scope > summary").click();
  const sharedChangeView = projectChanges
    .locator(".assessment-review-change")
    .filter({ hasText: "shared-boundary" });
  assert.equal(await sharedChangeView.count(), 1);
  for (const text of [
    "S-BLUE:report:0",
    "U-AMBER:report:0",
    "BLUE 的领域义务",
    "AMBER 的领域义务",
  ])
    assert.match(await sharedChangeView.innerText(), new RegExp(text));
  await projectChanges.locator(":scope > summary").click();
  assert.deepEqual(
    syntheticProjectReview.data.requirements
      .map((entry) => entry.requirement.id)
      .sort(),
    [
      "S-GREEN",
      "S-AMBER",
      "S-BLUE",
      "S-PENDING",
      "U-AMBER",
      "S-HISTORICAL",
    ].sort(),
  );
  assert.equal(
    syntheticProjectReview.data.requirements.find(
      (entry) => entry.requirement.id === "S-HISTORICAL",
    ).requirement.scope,
    "planned",
  );
  assert.doesNotMatch(
    syntheticProjectReview.text,
    /S-GREEN:normal-report|无待核对原因的正常报告|S-MIXED|S-DONE|S-EMPTY/,
  );
  for (const [id, code, recorded, current] of [
    ["S-GREEN", "source-file-changed", "a", "b"],
    ["S-AMBER", "definition-changed", "c", "d"],
  ]) {
    const entry = syntheticProjectReview.data.requirements.find(
      (entry) => entry.requirement.id === id,
    );
    assert.deepEqual(entry.reports[0].reasonCodes, [code]);
    assert.deepEqual(entry.reports[0].issues[0].comparisons, [
      {
        label: id === "S-GREEN" ? "来源文件摘要" : "需求定义摘要",
        recorded: recorded.repeat(64),
        current: current.repeat(64),
      },
    ]);
    assert.equal(
      entry.reports[0].issues[0].sources[0].reference.path,
      "docs/product/PROJECT.md",
    );
  }
  const originalPins = await page
    .locator("[data-overview-card]")
    .evaluateAll((cards) =>
      Object.fromEntries(
        cards.map((card) => [
          card.dataset.overviewCard,
          card.querySelector(".overview-route-pin").textContent,
        ]),
      ),
    );
  const colors = await page
    .locator(".overview-route-card .overview-verdict-pill")
    .evaluateAll((pills) =>
      Object.fromEntries(
        pills.map((pill) => [
          pill.dataset.conclusion,
          getComputedStyle(pill).backgroundColor,
        ]),
      ),
    );
  assert.equal(
    new Set(Object.values(colors)).size,
    3,
    "Original satisfied, partial and undetermined verdicts must use different colors",
  );
  assert.equal(
    await page
      .locator('[data-overview-card="S-GREEN"] .overview-review-marker')
      .count(),
    1,
  );
  assert.match(
    await page.locator('[data-overview-card="S-GREEN"]').innerText(),
    /适用性待核对/,
  );
  assert.equal(
    await page
      .locator(
        '[data-overview-card="S-MIXED"] .overview-card-verdict-strip > span',
      )
      .count(),
    2,
  );
  const beforeReviewReads = fullReads.length;
  for (const [id, reason, excludedReason] of [
    ["S-GREEN", "来源文件变化", "需求定义变化"],
    ["S-AMBER", "需求定义变化", "来源文件变化"],
  ]) {
    await page
      .getByRole("button", { name: `查看待核对原因 · ${id}`, exact: true })
      .click();
    reviewDialog = page.getByRole("dialog");
    await reviewDialog
      .getByRole("heading", { name: "待核对原因", exact: true })
      .waitFor();
    assert.equal(
      await reviewDialog.getByText(reason, { exact: true }).count(),
      1,
    );
    assert.equal(
      await reviewDialog.getByText(excludedReason, { exact: true }).count(),
      0,
    );
    assert.match(await reviewDialog.innerText(), new RegExp(`${id}:report:0`));
    assert.equal(
      await reviewDialog
        .locator('[data-review-report="S-GREEN:normal-report"]')
        .count(),
      0,
      "Only reports with review reasons belong in the review dialog",
    );
    assert.doesNotMatch(
      await reviewDialog.innerText(),
      /无待核对原因的正常报告/,
    );
    await checkDialogBounds(page);
    await reviewDialog
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  }
  assert.equal(fullReads.length, beforeReviewReads);
  async function expectCards(ids) {
    await page.waitForFunction(
      (expected) =>
        JSON.stringify(
          [...document.querySelectorAll("[data-overview-card]")]
            .map((card) => card.dataset.overviewCard)
            .sort(),
        ) === JSON.stringify(expected.sort()),
      ids,
    );
  }
  async function clearFilters() {
    await filterBar
      .getByRole("button", { name: "清除筛选", exact: true })
      .click();
    await expectCards(Object.keys(originalPins));
  }
  await filterBar
    .getByRole("button", { name: "筛选已满足", exact: true })
    .click();
  await expectCards(["S-GREEN", "S-MIXED", "S-DONE"]);
  for (const id of ["S-GREEN", "S-MIXED", "S-DONE"])
    assert.equal(
      await page
        .locator(`[data-overview-card="${id}"] .overview-route-pin`)
        .innerText(),
      originalPins[id],
    );
  await filterBar
    .getByRole("button", { name: "筛选部分满足", exact: true })
    .click();
  await expectCards(["S-GREEN", "S-MIXED", "S-DONE"]);
  await filterBar
    .getByRole("button", { name: "筛选待核对", exact: true })
    .click();
  await expectCards(["S-GREEN"]);
  await tasks.selectOption("active");
  await expectCards(["S-GREEN"]);
  assert.equal(
    (await copyAllReviews(page)).text,
    syntheticProjectReview.text,
    "Verdict, review and Task filters must not reduce the project handoff",
  );
  await page
    .locator(
      '[data-overview-card="S-GREEN"] .overview-requirement-assessments button',
    )
    .click();
  assert.match(
    await page.getByRole("dialog").innerText(),
    /原报告：已满足 · 待核对/,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await clearFilters();
  await filterBar
    .getByRole("button", { name: "筛选尚未判定", exact: true })
    .click();
  await expectCards(["S-GREEN", "S-AMBER", "S-BLUE", "S-PENDING", "U-AMBER"]);
  await clearFilters();
  await filterBar
    .getByRole("button", { name: "筛选无验收记录", exact: true })
    .click();
  await expectCards(["S-EMPTY"]);
  await clearFilters();
  await filterBar
    .getByRole("button", { name: "筛选未满足", exact: true })
    .click();
  await expectCards([]);
  assert.match(
    await page.locator(".overview-filter-empty").innerText(),
    /没有匹配项/,
  );
  await clearFilters();
  for (const [value, ids] of [
    ["associated", ["S-GREEN", "S-AMBER", "S-DONE", "S-PENDING"]],
    ["unassociated", ["S-BLUE", "S-MIXED", "S-EMPTY", "U-AMBER"]],
    ["association-pending", ["S-PENDING"]],
    ["completed", ["S-DONE"]],
    ["closed", ["S-AMBER"]],
    ["status-pending", ["S-PENDING"]],
  ]) {
    await tasks.selectOption(value);
    await expectCards(ids);
  }
  await clearFilters();
  for (const [name, ids] of [
    ["显示已开展", ["S-GREEN"]],
    [
      "显示进展待核对",
      Object.keys(originalPins).filter((id) => id !== "S-GREEN"),
    ],
    ["显示全部需求", Object.keys(originalPins)],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expectCards(ids);
    assert.equal(
      (await copyAllReviews(page)).text,
      syntheticProjectReview.text,
      "Requirement visibility must not reduce the project handoff",
    );
  }
  assert.equal(
    fullReads.length,
    beforeFilterReads,
    "Filters must use the lightweight summary without new detail reads",
  );
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkCardAlignment(page);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await filterBar.scrollIntoViewIfNeeded();
    await screenshot(page, `05-verdict-filters-${width}`);
    await allReviewsButton.scrollIntoViewIfNeeded();
    assert.equal(await allReviewsButton.isVisible(), true);
  }
  checks.push(
    "Current applicability verdicts retain distinct colors and symbols, while original verdicts remain in report details; multi-select verdicts combine with review and Task filters, preserve numbers, include unordered matches and read no full snapshots.",
  );
  checks.push(
    "Review dialogs distinguish file changes from definition changes and omit reports with no review reason.",
  );
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error(
        "Deliberate project clipboard failure in synthetic fixture",
      );
    };
  });
  await allReviewsButton.click();
  const projectReviewDialog = page.getByRole("dialog");
  await projectReviewDialog
    .getByRole("heading", { name: "全部待核对信息", exact: true })
    .waitFor();
  const projectReviewText = projectReviewDialog.getByRole("textbox", {
    name: "全部待核对信息",
    exact: true,
  });
  assert.equal(
    await projectReviewText.inputValue(),
    syntheticProjectReview.text,
  );
  await projectReviewDialog
    .getByRole("alert")
    .filter({ hasText: "剪贴板不可用" })
    .waitFor();
  await projectReviewText.evaluate((node) => node.select());
  assert.equal(
    await projectReviewText.evaluate(
      (node) => node.selectionEnd - node.selectionStart,
    ),
    syntheticProjectReview.text.length,
    "The complete handoff must remain manually selectable after copy failure",
  );
  await checkDialogBounds(page);
  await screenshot(page, "05-project-review-fallback-390");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (value) => {
      window.copiedProjectReviewText = value;
    };
  });
  await projectReviewDialog
    .getByRole("button", { name: "复制全部待核对信息", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "已复制全部待核对信息" })
    .first()
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.copiedProjectReviewText),
    syntheticProjectReview.text,
  );
  await projectReviewDialog
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  emptyProjectReviewFixture = true;
  await page.reload();
  await page.locator('[data-overview-card="S-GREEN"]').waitFor();
  assert.equal(await allReviewsButton.isDisabled(), true);
  await page.getByText("当前项目没有验收待核对项", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("status")
      .filter({ hasText: "已复制全部待核对信息" })
      .count(),
    0,
    "A new project summary must not retain a previous copy-success message",
  );
  checks.push(
    "Project handoff includes planned, unordered and non-current review requirements, omits normal reports, ignores all card filters, and offers selectable clipboard-failure fallback plus retry at 390px; an empty project review list disables copying.",
  );
  await page.unroute("**/overview*");
  await page.locator(`[data-project-id="${registrations[1].id}"]`).click();
  await page.locator(".overview-pending").waitFor();
  const switchedProjectCopy = page.getByRole("button", {
    name: "复制全部待核对信息",
    exact: true,
  });
  assert.ok(
    (await switchedProjectCopy.count()) === 0 ||
      (await switchedProjectCopy.isDisabled()),
    "Switching to a project without review data must not expose the old handoff",
  );
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "Project switching must not retain the previous project handoff dialog",
  );
  await page.locator(`[data-project-id="${registrations[0].id}"]`).click();
  await page.reload();
  await card.waitFor();
  await reviewMarker.click();
  reviewDialog = page.getByRole("dialog");
  await reviewDialog
    .getByText("来源与技术核对明细", { exact: true })
    .first()
    .click();
  await reviewDialog
    .locator(".source-link")
    .filter({ hasText: "docs/product/PROJECT.md" })
    .first()
    .click();
  await page.locator(".documents-page").waitFor();
  assert.match(
    await page.locator(".documents-page").innerText(),
    /PROJECT\.md/,
  );
  await page.goBack();
  await card.waitFor();
  await reviewMarker.click();
  await page
    .getByRole("dialog")
    .locator('[data-review-report="A-DEMO"]')
    .getByRole("button", { name: /查看报告与依据/ })
    .click();
  await page.locator(".requirements-v3-page").waitFor();
  assert.match(
    await page.locator(".requirements-v3-page").innerText(),
    /A-DEMO/,
  );
  await page.goBack();
  await card.waitFor();
  checks.push(
    "Review evidence opens its exact source document and report, then returns to the same card.",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify({ result: "passed", checks, errors, screenshots }, null, 2),
  );
  console.log(
    JSON.stringify({ result: "passed", checks, artifacts: run }, null, 2),
  );
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) {
    await screenshot(failedPage, "failure");
    await writeFile(
      path.join(run, "failure-page.txt"),
      await failedPage.locator("body").innerText(),
    );
  }
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      { result: "failed", checks, errors, screenshots, failure: String(error) },
      null,
      2,
    ),
  );
  console.error(`Browser acceptance artifacts: ${run}`);
  throw error;
} finally {
  releaseProjects?.();
  await browser?.close();
  await runtime.app.close();
}
