import assert from "node:assert/strict";
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
    .locator(".overview-breadcrumb-project")
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

  await card
    .getByRole("button", { name: "查看验收记录 · R-IMPORT", exact: true })
    .click();
  const reports = page.getByRole("dialog");
  assert.match(
    await reports.innerText(),
    /固定知识集全量入库；排除持续更新及失败恢复/,
  );
  assert.match(await reports.innerText(), /sample-copy-a @ sample-baseline/);
  assert.equal(fullReads.length, 0, "Verdict summary uses only overview data");
  assert.equal(await checkCardAlignment(page), cardHeight);
  await reports.locator('[data-overview-assessment="A-DEMO"] button').click();
  await page.locator(".requirements-v3-page").waitFor();
  assert.match(
    await page.locator(".requirements-v3-page").innerText(),
    /A-DEMO/,
  );
  await page.getByRole("button", { name: "返回上一视图" }).click();
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
  // Project summary fixture exercises independent verdict, review and Task dimensions.
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
    data.planned = [
      fixtureCard("S-GREEN", ["satisfied"], true, "进行中"),
      fixtureCard("S-AMBER", ["partially-satisfied"], true, "已关闭"),
      fixtureCard("S-BLUE", ["undetermined"], true),
      fixtureCard("S-MIXED", ["satisfied", "partially-satisfied"], false),
      fixtureCard("S-EMPTY", [], false),
      fixtureCard("S-DONE", ["satisfied"], false, "已完成"),
      fixtureCard("S-PENDING", ["satisfied"], true, "身份未确认"),
    ];
    data.unordered = [fixtureCard("U-AMBER", ["partially-satisfied"], true)];
    body.snapshot.revision = "filter-fixture";
    await route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.locator('[data-overview-card="S-GREEN"]').waitFor();
  const filterBar = page.getByRole("region", { name: "需求路线图筛选" });
  const tasks = filterBar.getByRole("combobox", { name: "筛选 Task 关联情况" });
  const beforeFilterReads = fullReads.length;
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
    /原报告：已满足/,
  );
  assert.equal(
    await page
      .locator(
        '[data-overview-card="S-MIXED"] .overview-card-verdict-strip > span',
      )
      .count(),
    2,
  );
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
  await expectCards(["S-GREEN", "S-MIXED", "S-DONE", "S-PENDING"]);
  for (const id of ["S-GREEN", "S-MIXED", "S-DONE", "S-PENDING"])
    assert.equal(
      await page
        .locator(`[data-overview-card="${id}"] .overview-route-pin`)
        .innerText(),
      originalPins[id],
    );
  await filterBar
    .getByRole("button", { name: "筛选部分满足", exact: true })
    .click();
  await expectCards([
    "S-GREEN",
    "S-MIXED",
    "S-DONE",
    "S-PENDING",
    "S-AMBER",
    "U-AMBER",
  ]);
  await filterBar
    .getByRole("button", { name: "筛选待核对", exact: true })
    .click();
  await expectCards(["S-GREEN", "S-PENDING", "S-AMBER", "U-AMBER"]);
  await tasks.selectOption("active");
  await expectCards(["S-GREEN"]);
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
  await expectCards(["S-BLUE"]);
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
  }
  checks.push(
    "Original verdicts retain distinct colors and symbols with separate review markers; multi-select verdicts combine with review and Task filters, preserve numbers, include unordered matches and read no full snapshots.",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify({ result: "passed", checks, errors, screenshots }, null, 2),
  );
  console.log(
    JSON.stringify({ result: "passed", checks, artifacts: run }, null, 2),
  );
} finally {
  releaseProjects?.();
  await browser?.close();
  await runtime.app.close();
}
