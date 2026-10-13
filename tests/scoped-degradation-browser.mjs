// Additional installed-candidate cases. Mutations below are synthetic test-actor
// preparation through the upstream CLI, never TraceLens application operations.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  writeFile,
  access,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
const inputFile = process.env.TRACELENS_TEST_INPUT;
if (!inputFile) throw new Error("TRACELENS_TEST_INPUT required");
const input = JSON.parse(await readFile(inputFile, "utf8"));
const run = await mkdtemp(path.join(path.dirname(inputFile), "additional-"));
const archive = path.join(run, "independent-project"),
  old = path.join(run, "old-snapshot"),
  legacy = path.join(run, "unmigrated-facts");
const base = process.env.TRACELENS_BROWSER_BASE || "http://127.0.0.1:4439";
const projectNames = {
  archive: `INT 独立项目归档 D ${path.basename(run)}`,
  old: `INT 旧文件快照 E ${path.basename(run)}`,
  legacy: `INT 未迁移事实 F ${path.basename(run)}`,
};
const hash = (b) => createHash("sha256").update(b).digest("hex"),
  operations = [],
  results = [],
  metrics = [];
async function cli(root, command, request) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, ".workflow-system/runtime/support/assistance.mjs"),
        command,
        "--root",
        root,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", async (code) => {
      clearTimeout(timer);
      operations.push({ root, command, request, code, stdout, stderr });
      metrics.push({
        command,
        detail: request.detail,
        elapsedMs: performance.now() - start,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
      });
      await writeFile(
        path.join(run, "operations.json"),
        JSON.stringify(operations, null, 2),
      );
      try {
        if (code) throw new Error(stderr || stdout);
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
async function tree(root) {
  const output = {};
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) await walk(file);
      else if (e.isSymbolicLink())
        output[path.relative(root, file)] = `symlink:${await readlink(file)}`;
      else output[path.relative(root, file)] = hash(await readFile(file));
    }
  }
  await walk(root);
  return output;
}
await cp(input.alpha, archive, { recursive: true });
await cp(input.alpha, old, { recursive: true });
await cp(input.missing, legacy, { recursive: true });
await mkdir(path.join(legacy, ".workflow-system/runtime/support"), {
  recursive: true,
});
for (const name of Object.keys(input.moduleHashes))
  await cp(
    path.join(input.sourceDirectory, name),
    path.join(legacy, ".workflow-system/runtime/support", name),
  );
await mkdir(path.join(legacy, "docs/workflow"), { recursive: true });
await writeFile(
  path.join(legacy, "docs/workflow/CURRENT_TASK.md"),
  "# Previously saved work\nUnstructured old task facts awaiting explicit association.\nDo not infer that the work never existed.\n",
);
const plan = await cli(archive, "archive", {
  action: "plan",
  refs: [input.preparedRef],
});
await cli(archive, "archive", { action: "create", refs: [input.preparedRef] });
await cli(archive, "archive", { action: "verify" });
await cli(archive, "archive", {
  action: "quarantine",
  refs: [input.preparedRef],
});
await assert.rejects(access(path.join(archive, input.preparedRef)));
const pageQuery = await cli(archive, "task-status", {
  detail: "summary",
  limit: 2,
});
const full = await cli(archive, "task-status", {
  detail: "task",
  task_ref: input.closed,
  expected_view_revision: pageQuery.view_revision,
});
const logical = await cli(archive, "read", {
  ref: input.preparedRef,
  offset: 0,
  limit: 65536,
});
assert.equal(
  Buffer.from(logical.data, "base64").toString("utf8"),
  await readFile(path.join(input.alpha, input.preparedRef), "utf8"),
);
await cli(old, "task", {
  action: "prepare",
  plan: { title: "Old snapshot task", steps: [] },
});
const snapshotPath = path.join(old, ".workflow-system/records/task-view.json"),
  snapshot = await readFile(snapshotPath);
await cli(old, "task", {
  action: "prepare",
  plan: { title: "Newer fact beyond old snapshot", steps: [] },
});
await writeFile(snapshotPath, snapshot);
metrics.push({
  command: "persisted-task-view",
  bytes: snapshot.length,
  taskCount: JSON.parse(snapshot).tasks.length,
});
const unassociated = await cli(legacy, "task-status", { detail: "summary" });
assert.ok(
  unassociated.issues.some((i) => i.code === "LEGACY_ASSOCIATION_REQUIRED"),
);
const before = {
  archive: await tree(archive),
  old: await tree(old),
  legacy: await tree(legacy),
};
const browser = await chromium.launch({
  channel: process.env.TRACELENS_BROWSER_EXECUTABLE ? undefined : "msedge",
  executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function shot(name) {
  await page.screenshot({ path: path.join(run, name + ".png") });
  await writeFile(
    path.join(run, name + ".txt"),
    await page.locator("body").innerText(),
  );
}
try {
  await page.goto(base);
  const session = await (await page.request.get(base + "/api/session")).json();
  const headers = { "x-tracelens-token": session.token };
  const projects = await (
      await page.request.get(base + "/api/projects")
    ).json(),
    config = projects.find((p) => p.root === input.alpha).config;
  const registers = [];
  for (const [name, root, trusted] of [
    [projectNames.archive, archive, true],
    [projectNames.old, old, false],
    [projectNames.legacy, legacy, true],
  ]) {
    const existing = projects.find((p) => p.root === root);
    const response =
      existing ||
      (await (
        await page.request.post(base + "/api/projects", {
          headers,
          data: { name, root, config },
        })
      ).json());
    assert.ok(response.id);
    registers.push(response);
    if (trusted) {
      const r = await page.request.post(
        `${base}/api/projects/${response.id}/runtime-trust`,
        {
          headers,
          data: {
            sourceDirectory: input.sourceDirectory,
            moduleHashes: input.moduleHashes,
            workflowHome: "docs/workflow",
            accept: true,
          },
        },
      );
      assert.ok(r.ok(), await r.text());
    }
  }
  await page.reload();
  await page
    .getByRole("button", { name: projectNames.archive, exact: true })
    .click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
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
  // Task IDs come from the actual facts; titles are deliberately duplicated.
  const item = page
    .locator(".task-item")
    .filter({ hasText: full.task.display_id || input.closed });
  await item.click();
  await page
    .getByRole("heading", { name: "Task 生命周期：已关闭", exact: true })
    .waitFor();
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
  results.push({
    label:
      "actual archived logical ref and same task ID in independent registered project",
    observed: {
      taskId: input.closed,
      storage: logical.storage,
      verification: logical.verification,
      looseAbsent: true,
    },
  });
  await shot("10-archive-source");
  await page
    .getByRole("button", { name: projectNames.old, exact: true })
    .click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".runtime-status")
      ?.textContent.includes("文件降级快照"),
  );
  assert.match(
    await page.locator(".runtime-status").first().innerText(),
    /4\/4.*更新时间未知/s,
  );
  await page.getByRole("button", { name: "任务", exact: true }).click();
  assert.equal(await page.locator(".task-item").count(), 4);
  results.push({
    label:
      "recognized old task-view snapshot is explicitly stale; newer facts not invented",
    observed: await page.locator(".runtime-status").first().innerText(),
  });
  await shot("11-old-snapshot");
  await page
    .getByRole("button", { name: projectNames.legacy, exact: true })
    .click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".runtime-status")
      ?.textContent.includes("不能确认零任务"),
  );
  await page.locator(".runtime-status").first().locator("summary").click();
  assert.match(
    await page.locator(".runtime-status").first().innerText(),
    /LEGACY_ASSOCIATION_REQUIRED/,
  );
  await page.getByRole("button", { name: "概览", exact: true }).click();
  assert.equal(await page.locator("[data-overview-card]").count(), 4);
  await page
    .getByRole("button", { name: "展开子需求 · R-PIPELINE", exact: true })
    .click();
  assert.equal(await page.locator("[data-overview-card]").count(), 5);
  results.push({
    label:
      "unmigrated facts preserve explicit association gap without claiming empty facts",
    observed: await page.locator(".runtime-status").first().innerText(),
  });
  await shot("12-unmigrated-facts");
  // A synthetic normal write between summary pages must restart, never append mixed versions.
  await page
    .getByRole("button", { name: projectNames.archive, exact: true })
    .click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".runtime-status")?.textContent.includes("2/3") &&
      !document.querySelector(".scan-strip")?.textContent.includes("正在扫描"),
  );
  assert.deepEqual(
    {
      archive: await tree(archive),
      old: await tree(old),
      legacy: await tree(legacy),
    },
    before,
  );
  await cli(archive, "task", {
    action: "prepare",
    plan: { title: "Normal write between pages", steps: [] },
  });
  const afterWriter = await tree(archive);
  await page.getByRole("button", { name: /读取下一页 Task/ }).click();
  await page.waitForFunction(() =>
    document.querySelector(".runtime-status")?.textContent.includes("2/4"),
  );
  await page.locator(".runtime-status").first().locator("summary").click();
  assert.match(
    await page.locator(".runtime-status").first().innerText(),
    /续页时版本变化/,
  );
  await page.getByRole("button", { name: /读取下一页 Task/ }).click();
  await page.waitForFunction(() =>
    document.querySelector(".runtime-status")?.textContent.includes("4/4"),
  );
  assert.deepEqual(await tree(archive), afterWriter);
  results.push({
    label:
      "normal upstream write during browser paging restarts first batch then reads four tasks",
    observed: await page.locator(".runtime-status").first().innerText(),
  });
  await shot("13-concurrent-write");
  await page
    .getByRole("button", { name: "INT 同仓副本 B", exact: true })
    .click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".runtime-status")?.textContent.includes("2/3") &&
      !document.querySelector(".scan-strip")?.textContent.includes("正在扫描"),
  );
  results.push({
    label: "independent project update does not leak into same-repo copy",
    observed: "D=4 tasks, B=3 tasks; separate registration/root",
  });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "report.json"),
    JSON.stringify(
      {
        passed: true,
        source: input,
        roots: { archive, old, legacy },
        registers,
        results,
        metrics,
        plan,
        query: pageQuery,
        full,
        logicalRead: { ...logical, data: undefined },
        unassociated,
        errors,
        hashes: { before, afterWriter },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, run, checks: results.length, metrics }),
  );
} catch (e) {
  await shot("failure");
  await writeFile(
    path.join(run, "report.json"),
    JSON.stringify(
      { passed: false, error: String(e), results, operations, metrics, errors },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
}
