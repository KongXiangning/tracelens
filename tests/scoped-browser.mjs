import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  mkdir,
  readFile,
  readlink,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const inputFile = process.env.TRACELENS_TEST_INPUT;
if (!inputFile)
  throw new Error(
    "Set TRACELENS_TEST_INPUT to setup-scoped-browser inputs.json",
  );
const input = JSON.parse(await readFile(inputFile, "utf8")),
  base = process.env.TRACELENS_BROWSER_BASE || "http://127.0.0.1:4439";
const evidence = path.join(path.dirname(inputFile), "evidence");
await mkdir(evidence, { recursive: true });
const results = [],
  requests = [],
  errors = [];
const browser = await chromium.launch({
  channel: process.env.TRACELENS_BROWSER_EXECUTABLE ? undefined : "msedge",
  executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  const url = new URL(r.url());
  if (url.pathname.startsWith("/api/"))
    requests.push({
      method: r.method(),
      path: url.pathname,
      at: new Date().toISOString(),
    });
});
const checks = (label, observed) =>
  results.push({ label, at: new Date().toISOString(), observed });
async function shot(name) {
  await page.screenshot({ path: path.join(evidence, name + ".png") });
  await writeFile(
    path.join(evidence, name + ".txt"),
    await page.locator("body").innerText(),
  );
}
async function tree(root) {
  const result = {};
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isSymbolicLink())
        result[path.relative(root, p)] = `symlink:${await readlink(p)}`;
      else
        result[path.relative(root, p)] = createHash("sha256")
          .update(await readFile(p))
          .digest("hex");
    }
  }
  await walk(root);
  return result;
}
const before = {
  alpha: await tree(input.alpha),
  beta: await tree(input.beta),
  missing: await tree(input.missing),
};
try {
  await page.goto(base);
  await page
    .getByRole("button", { name: "INT 合成范围 A", exact: true })
    .click();
  const trust = page.locator(".runtime-trust");
  if ((await trust.getAttribute("open")) === null)
    await trust.locator("summary").click();
  await page
    .getByRole("textbox", { name: "可信 Runtime 目录" })
    .fill(input.sourceDirectory);
  await page.getByRole("button", { name: "核对可信来源", exact: true }).click();
  await page
    .getByRole("button", {
      name: "信任这些字节用于此副本的只读查询",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".runtime-status")?.textContent.includes("2/3") &&
      !document.querySelector(".scan-strip")?.textContent.includes("正在扫描"),
  );
  await trust.locator("summary").click();
  assert.equal(requests.filter((r) => r.path.endsWith("/task-page")).length, 0);
  checks(
    "initial summary is partial; no automatic page request",
    await page.locator(".runtime-status").innerText(),
  );
  await shot("01-first-page");
  await page.getByRole("button", { name: /读取下一页 Task/ }).click();
  await page.waitForFunction(() =>
    document.querySelector(".runtime-status")?.textContent.includes("3/3"),
  );
  assert.equal(requests.filter((r) => r.path.endsWith("/task-page")).length, 1);
  assert.equal(await page.locator("[data-overview-card]").count(), 4);
  await page
    .getByRole("button", { name: "展开子需求 · R-PIPELINE", exact: true })
    .click();
  const cards = await page
    .locator("[data-overview-card]")
    .evaluateAll((es) => es.map((e) => e.dataset.overviewCard));
  assert.deepEqual(cards, [
    "R-PIPELINE",
    "R-IMPORT",
    "R-DELTA",
    "R-NEW",
    "R-UNORDERED",
  ]);
  assert.equal(
    await page.getByRole("heading", { name: "需求全景", exact: true }).count(),
    1,
  );
  checks("explicit continuation and single neutral overview", {
    cards,
    status: await page.locator(".runtime-status").innerText(),
  });
  await shot("02-overview");
  await page.getByRole("button", { name: "需求", exact: true }).click();
  await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .selectOption({ label: "G-DEMO · 固定知识集演示阶段" });
  await page
    .getByRole("combobox", { name: "被评估对象", exact: true })
    .selectOption({ label: "working-copy · sample-copy-a @sample-baseline" });
  await page.locator("[data-node-id=R-IMPORT]").click();
  assert.equal(
    await page.locator(".scoped-conclusion").getAttribute("data-conclusion"),
    "satisfied",
  );
  checks(
    "same requirement in demo scope",
    await page.locator(".scoped-conclusion").innerText(),
  );
  await shot("03-demo");
  await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .selectOption({ label: "G-LIVE · 持续更新目标" });
  assert.equal(
    await page.locator(".scoped-conclusion").getAttribute("data-conclusion"),
    "partially-satisfied",
  );
  checks(
    "same requirement in live scope",
    await page.locator(".scoped-conclusion").innerText(),
  );
  await page
    .getByRole("combobox", { name: "结论筛选", exact: true })
    .selectOption("gaps");
  assert.deepEqual(
    new Set(
      await page
        .locator("[data-node-id]")
        .evaluateAll((es) => es.map((e) => e.dataset.nodeId)),
    ),
    new Set(["G-ALL", "G-LIVE", "R-PIPELINE", "R-IMPORT", "G-DEMO"]),
  );
  await page.getByRole("checkbox", { name: "展开所选需求局部依赖" }).check();
  assert.equal(await page.locator("[data-node-id=R-DELTA]").count(), 1);
  checks(
    "gap ancestors and local dependency",
    await page
      .locator("[data-node-id]")
      .evaluateAll((es) => es.map((e) => e.dataset.nodeId)),
  );
  await shot("04-gap-graph");
  await page
    .getByRole("button", { name: "查看结论依据 · A-LIVE", exact: true })
    .click();
  assert.match(
    await page.locator(".product-detail").innerText(),
    /失败恢复明确未达到约定/,
  );
  await page
    .getByRole("button", { name: /docs\/product\/ASSESSMENTS.md:79/ })
    .first()
    .click();
  await page.waitForFunction(() =>
    document.body.textContent.includes("[A-LIVE] 持续使用范围"),
  );
  checks(
    "report and raw source navigation",
    "A-LIVE partial result and full source readable",
  );
  await shot("05-report-source");
  await page.getByRole("button", { name: "返回上一视图", exact: true }).click();
  await page.getByRole("button", { name: "返回上一视图", exact: true }).click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "结论筛选", exact: true })
      .inputValue(),
    "gaps",
  );
  assert.match(
    await page
      .getByRole("combobox", { name: "所选目标", exact: true })
      .inputValue(),
    /product:/,
  );
  assert.equal(await page.locator(".compact-task-list > li").count(), 2);
  const taskLinks = page.getByRole("button", {
    name: "查看 Task / Step",
    exact: true,
  });
  assert.equal(await taskLinks.count(), 2);
  await page.route(
    "**/task-detail",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "injected single-detail failure" }),
      }),
    { times: 1 },
  );
  await taskLinks.first().click();
  await page
    .getByText(/任务详情暂不可用：.*injected single-detail failure/)
    .waitFor();
  assert.equal(await page.locator(".task-item").count(), 3);
  checks(
    "single detail response failure stays local",
    "explicit injected 503; three-task list retained",
  );
  await shot("06a-local-detail-failure");
  await page.getByRole("button", { name: "返回上一视图", exact: true }).click();
  await page.locator("html").evaluate((el) => {
    el.scrollTop = Math.min(180, el.scrollHeight - el.clientHeight);
  });
  await taskLinks.first().evaluate((el) =>
    el.addEventListener(
      "click",
      () => {
        window.__scopedReturnScroll = document.scrollingElement.scrollTop;
      },
      { once: true },
    ),
  );
  await taskLinks.first().click();
  await page
    .getByRole("heading", { name: "Task 生命周期：已关闭", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".runtime-task-detail").innerText(),
    new RegExp(input.closed),
  );
  await page
    .getByRole("button", {
      name: "S2 · 恢复尚未执行 · not-started",
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".runtime-task-detail > section")]
      .find((el) => el.querySelector("h4")?.textContent === "Step S2")
      ?.querySelector("pre")
      ?.textContent.includes('"state": "not-started"'),
  );
  checks(
    "closed task retains unfinished step",
    await page.locator(".runtime-task-detail").innerText(),
  );
  await shot("06-closed-step");
  await page.getByRole("button", { name: "返回 Task", exact: true }).click();
  await page
    .locator(".runtime-task-detail")
    .getByText(/原始来源 ·/)
    .click();
  await page
    .getByRole("button", { name: input.preparedRef, exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".runtime-task-detail > section")]
      .find((el) => el.querySelector("h4")?.textContent.startsWith("来源："))
      ?.querySelector("pre")
      ?.textContent.includes('"title": "合成导入任务"'),
  );
  checks("on-demand source read", "saved plan bytes visible");
  const sourceFile = path.join(input.alpha, input.preparedRef),
    sourceBytes = await readFile(sourceFile);
  await rm(sourceFile);
  await page
    .getByRole("button", { name: input.preparedRef, exact: true })
    .click();
  await page.getByText(/来源未核对：/).waitFor();
  assert.equal(await page.locator(".task-item").count(), 3);
  await writeFile(sourceFile, sourceBytes);
  checks(
    "single source failure is local",
    "list and closed lifecycle retained; synthetic source restored byte-for-byte",
  );
  await shot("07-local-source-failure");
  await page.getByRole("button", { name: "返回上一视图", exact: true }).click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "结论筛选", exact: true })
      .inputValue(),
    "gaps",
  );
  assert.equal(
    await page.locator(".scoped-conclusion").getAttribute("data-conclusion"),
    "partially-satisfied",
  );
  checks(
    "return restores goal/object/filter/requirement",
    "G-LIVE, working-copy, gaps, R-IMPORT retained",
  );
  await page.waitForFunction(
    () =>
      Math.abs(
        document.scrollingElement.scrollTop - window.__scopedReturnScroll,
      ) <= 2,
  );
  const restoredScroll = await page.evaluate(() => ({
    expected: window.__scopedReturnScroll,
    actual: document.scrollingElement.scrollTop,
  }));
  assert.ok(
    restoredScroll.expected > 0,
    "navigation needs a nonzero scroll position",
  );
  checks("return restores nonzero scroll", restoredScroll);
  await page
    .getByRole("combobox", { name: "结论筛选", exact: true })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .selectOption({ label: "G-DEMO · 固定知识集演示阶段" });
  await page
    .getByRole("combobox", { name: "被评估对象", exact: true })
    .selectOption({ label: "release · sample-release-0" });
  assert.equal(
    await page.locator(".scoped-conclusion").getAttribute("data-conclusion"),
    "not-satisfied",
  );
  checks(
    "another object is not-satisfied",
    await page.locator(".scoped-conclusion").innerText(),
  );
  await page
    .getByRole("combobox", { name: "被评估对象", exact: true })
    .selectOption({ label: "working-copy · sample-copy-a @sample-baseline" });
  await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .selectOption({ label: "G-ALL · 可使用的内容导入系统" });
  await page.locator("[data-node-id=G-ALL]").click();
  assert.equal(
    await page.locator(".scoped-conclusion").getAttribute("data-conclusion"),
    "undetermined",
  );
  checks(
    "overall result is independent unknown",
    await page.locator(".scoped-conclusion").innerText(),
  );
  await page
    .getByRole("combobox", { name: "所选目标", exact: true })
    .selectOption({ label: "G-DEMO · 固定知识集演示阶段" });
  await page.locator("[data-node-id=R-NEW]").click();
  assert.match(await page.locator(".compact-task-list").innerText(), /冲突/);
  await page.getByText(/演变历史 ·/).click();
  assert.match(
    await page.locator(".product-selected-detail").innerText(),
    /replaces · R-OLD/,
  );
  checks(
    "identity conflict and historical replacement",
    "R-NEW binding conflict; R-OLD retained historically",
  );
  await shot("08-conflict-history");
  await page
    .getByRole("button", { name: "INT 同仓副本 B", exact: true })
    .click();
  assert.equal(await page.locator(".runtime-trust").count(), 1);
  const btrust = page.locator(".runtime-trust");
  await btrust.locator("summary").click();
  await page
    .getByRole("textbox", { name: "可信 Runtime 目录" })
    .fill(input.sourceDirectory);
  await page.getByRole("button", { name: "核对可信来源", exact: true }).click();
  await page
    .getByRole("button", {
      name: "信任这些字节用于此副本的只读查询",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".runtime-status")?.textContent.includes("2/3") &&
      !document.querySelector(".scan-strip")?.textContent.includes("正在扫描"),
  );
  await page.getByRole("button", { name: /读取下一页 Task/ }).click();
  await page.waitForFunction(() =>
    document.querySelector(".runtime-status")?.textContent.includes("3/3"),
  );
  await page.getByRole("button", { name: "任务", exact: true }).click();
  assert.equal(await page.locator(".task-item").count(), 3);
  checks(
    "same IDs in second copy have separate registered view",
    await page.locator(".runtime-status").innerText(),
  );
  await page
    .getByRole("button", { name: "INT 无 Runtime C", exact: true })
    .click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".runtime-status")?.textContent.includes("暂不可用"),
  );
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await page
    .getByRole("button", { name: "展开子需求 · R-PIPELINE", exact: true })
    .click();
  assert.equal(await page.locator("[data-overview-card]").count(), 5);
  assert.match(
    await page.locator("[data-overview-card=R-IMPORT]").innerText(),
    /任务数据暂不可用/,
  );
  checks(
    "no Runtime keeps product and unknown task availability",
    await page.locator(".runtime-status").innerText(),
  );
  await shot("09-product-without-runtime");
  assert.deepEqual(
    {
      alpha: await tree(input.alpha),
      beta: await tree(input.beta),
      missing: await tree(input.missing),
    },
    before,
  );
  assert.deepEqual(errors, []);
  checks("all observed project bytes unchanged; no page errors", true);
  await writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        passed: true,
        inputFile,
        sourceType: input.sourceType,
        distributionManifest: input.distributionManifest,
        base,
        results,
        requests,
        errors,
        hashes: before,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, evidence, checks: results.length }),
  );
} catch (error) {
  await shot("failure");
  await writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      { passed: false, error: String(error), results, requests, errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
