import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";
import { runtimeHashes } from "../dist/server/runtime-reader.js";

await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(path.resolve("output/playwright/task-times-"));
const root = path.join(run, "example");
const support = path.join(root, ".workflow-system/runtime/support");
await mkdir(path.dirname(support), { recursive: true });
await cp("tests/fixtures/runtime-vn05", support, { recursive: true });
async function cli(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(support, "assistance.mjs"), "task", "--root", root],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || stdout));
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
async function setTime(ref, time) {
  const filename = path.join(root, ref);
  const record = JSON.parse(await readFile(filename, "utf8"));
  record.recorded_at = time;
  await writeFile(filename, JSON.stringify(record));
}
const closed = await cli({
  action: "prepare",
  plan: { title: "已关闭的合成任务", steps: [] },
});
await cli({
  action: "adopt",
  task_id: closed.task_id,
  plan_ref: closed.ref,
  decision_source: "test",
  decision_text: "synthetic adoption",
});
const closure = await cli({
  action: "close",
  task_id: closed.task_id,
  decision_source: "test",
  decision_text: "synthetic closure",
  remaining_work: [],
});
const active = await cli({
  action: "prepare",
  plan: { title: "正在进行的合成任务", steps: [] },
});
await cli({
  action: "adopt",
  task_id: active.task_id,
  plan_ref: active.ref,
  decision_source: "test",
  decision_text: "synthetic adoption",
});
await setTime(closed.ref, "2026-10-01T00:00:00.000Z");
await setTime(closure.ref, "2026-10-13T01:00:00.000Z");
await setTime(active.ref, "2026-10-12T02:00:00.000Z");
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const project = await runtime.registry.add({
  name: "任务时间验收",
  root,
  config: defaultConfig(),
});
await runtime.registry.selectRuntime(project.id, {
  sourceDirectory: support,
  moduleHashes: await runtimeHashes(support),
  workflowHome: "docs/workflow",
  accept: true,
});
await runtime.store.refresh(project.id);
let sourceReads = 0;
const originalSource = runtime.store.taskSource.bind(runtime.store);
runtime.store.taskSource = (...args) => {
  sourceReads++;
  return originalSource(...args);
};
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
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));
  await page.goto(base);
  await page
    .getByRole("heading", { name: project.name, exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Task 视图", exact: true }).click();
  const closedCard = page
    .locator(".task-card")
    .filter({ hasText: "已关闭的合成任务" });
  const activeCard = page
    .locator(".task-card")
    .filter({ hasText: "正在进行的合成任务" });
  await closedCard
    .locator('time[datetime="2026-10-01T00:00:00.000Z"]')
    .waitFor();
  await closedCard
    .locator('time[datetime="2026-10-13T01:00:00.000Z"]')
    .waitFor();
  await activeCard
    .locator('time[datetime="2026-10-12T02:00:00.000Z"]')
    .waitFor();
  assert.match(
    await activeCard.locator(".task-card-times").innerText(),
    /完成时间\s*未完成/,
  );
  assert.equal(await activeCard.locator("time").count(), 1);
  assert.equal(sourceReads, 3);
  await page.getByRole("button", { name: "当前", exact: true }).click();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await closedCard
    .locator('time[datetime="2026-10-13T01:00:00.000Z"]')
    .waitFor();
  assert.equal(
    sourceReads,
    3,
    "Reopening visible cards reuses the snapshot's cached times",
  );
  assert.equal(requests.filter((url) => url.endsWith("/refresh")).length, 0);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflowingTimes = await page.locator(".task-card").evaluateAll(
      (cards) =>
        cards.filter((card) => {
          const bottom = card.getBoundingClientRect().bottom;
          return [
            ...card.querySelectorAll(
              ".task-card-times > span, .task-card-action",
            ),
          ].some((child) => child.getBoundingClientRect().bottom > bottom - 8);
        }).length,
    );
    assert.equal(
      overflowingTimes,
      0,
      `Loaded timestamps must stay inside their cards at ${width}px`,
    );
    await page.screenshot({ path: path.join(run, `times-${width}.png`) });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `Horizontal overflow at ${width}px`,
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        sourceReads,
        errors,
        checks: [
          "actual creation/closure events",
          "active task has no completion time",
          "cached reads",
          "no automatic refresh",
          "1440/1024/390 layouts",
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
