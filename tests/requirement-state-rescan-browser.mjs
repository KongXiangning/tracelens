// Explicit local-project regression: node tests/requirement-state-rescan-browser.mjs <base> <project-id>
// Saves the same TraceLens scan configuration; observed project files are read only.
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { SnapshotCache } from "../dist/server/snapshot-cache.js";
import { SnapshotStore, buildSnapshot } from "../dist/server/snapshot.js";
import { FileIndex } from "../dist/server/file-index.js";
import { RuntimeReader } from "../dist/server/runtime-reader.js";
import { buildOverviewData } from "../dist/shared/overview-data.js";

const [base, projectId] = process.argv.slice(2);
assert.ok(
  base && projectId,
  "Supply the local TraceLens URL and observed project id",
);
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const projects = await (await fetch(`${base}/api/projects`)).json();
const project = projects.find((item) => item.id === projectId);
assert.ok(project, "Project must already be registered");
await mkdir("output/playwright", { recursive: true });
const output = await mkdtemp(
  path.resolve("output/playwright/requirement-state-rescan-"),
);
const files = new Set(
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: project.root, maxBuffer: 32 * 1024 * 1024 },
  )
    .toString()
    .split("\0")
    .filter(Boolean),
);
async function collect(directory) {
  for (const entry of await readdir(path.join(project.root, directory), {
    withFileTypes: true,
  })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(relative);
    else if (entry.isFile()) files.add(relative);
  }
}
for (const directory of [".workflow-system", "docs", "TASKS", ".agents"])
  await collect(directory);
async function hashes() {
  const result = [];
  for (const file of [...files].sort())
    result.push([
      file,
      createHash("sha256")
        .update(await readFile(path.join(project.root, file)))
        .digest("hex"),
    ]);
  return result;
}
const before = await hashes();
const statusBefore = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
  cwd: project.root,
}).toString();
const session = await (await fetch(`${base}/api/session`)).json();
async function api(route, body, method = "POST") {
  const response = await fetch(`${base}/api${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-TraceLens-Token": session.token,
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `TraceLens ${route}: ${response.status}`);
  return response.json();
}
function targetState(data) {
  const requirements = [...data.planned, ...data.unordered];
  return ["REQ-KERNEL", "REQ-LAW"].map((id) => {
    const item = requirements.find((item) => item.id === id);
    assert.ok(item, id);
    assert.equal(item.work.recorded, true, `${id} has actual saved work`);
    assert.equal(
      item.work.current,
      false,
      "Closed historical work is not a currently running scope",
    );
    const records = item.assessmentRecords.map((record) => ({
      id: record.report.id,
      ...record.selection,
    }));
    const expected =
      id === "REQ-KERNEL"
        ? "AS-V3-KERNEL-C5-IDENTITY-20261014"
        : "AS-LAW-CURRENT-20261014";
    const record = records.find((record) => record.id === expected);
    assert.ok(record, expected);
    assert.deepEqual(record.reasons, []);
    assert.equal(
      record.conclusion,
      id === "REQ-KERNEL" ? "satisfied" : "partially-satisfied",
    );
    return {
      id,
      recorded: item.work.recorded,
      current: item.work.current,
      records,
    };
  });
}
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
  headless: true,
});
let cacheApp;
const errors = [],
  iterations = [];
try {
  // A fresh index exercises the complete read path without altering scan settings or sources.
  const fullScan = await buildSnapshot(
    project,
    new Date().toISOString(),
    undefined,
    {
      reader: new RuntimeReader(),
      isCurrent: () => true,
      scan: { index: new FileIndex() },
    },
  );
  const fullState = targetState(buildOverviewData(fullScan));
  assert.ok(
    fullScan.metrics.filesRead > 0,
    "Fresh index must exercise a complete scan",
  );
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  // Preserve live facts; do not auto-refresh unrelated projects while testing this project.
  await page.route("**/api/projects/*/overview*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), restored: false },
    });
  });
  await api(
    `/projects/${projectId}`,
    { name: project.name, config: project.config },
    "PATCH",
  );
  for (let index = 0; index < 3; index++) {
    const result = await api(`/projects/${projectId}/refresh`, {});
    assert.equal(result.snapshot.phase, "complete");
    const view = await (
      await fetch(`${base}/api/projects/${projectId}/overview`)
    ).json();
    const state = targetState(view.snapshot.overview);
    assert.deepEqual(state, fullState);
    if (iterations.length) assert.deepEqual(state, iterations[0].state);
    iterations.push({ state, metrics: result.snapshot.metrics });
    await page.goto(base);
    await page.locator(`[data-project-id="${projectId}"]`).click();
    await page.locator('[data-overview-card="REQ-LAW"]').waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "显示已开展", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const kernel = page.locator('[data-overview-card="REQ-KERNEL"]');
    const law = page.locator('[data-overview-card="REQ-LAW"]');
    assert.equal(await kernel.getAttribute("data-review"), null);
    assert.equal(await law.getAttribute("data-review"), null);
    assert.match(await law.innerText(), /已进行/);
    assert.match(await law.innerText(), /部分满足/);
    assert.equal(
      await law.locator(".overview-progress-tag[data-pending]").count(),
      0,
    );
    await kernel.screenshot({
      path: path.join(output, `01-scan-${index + 1}.png`),
    });
    await law.screenshot({
      path: path.join(output, `06-scan-${index + 1}.png`),
    });
    if (index === 0) {
      // Simulate a persisted pre-fix snapshot without the new derived evidence.
      const captured = (
        await (await fetch(`${base}/api/projects/${projectId}/snapshot`)).json()
      ).snapshot;
      captured.historicalWork = [];
      captured.product.sources.forEach((check) => {
        delete check.goalScopeComparison;
      });
      cacheApp = await createApp({
        dataDir: path.join(output, "isolated-cache"),
      });
      const cachedProject = await cacheApp.registry.add({
        name: project.name,
        root: project.root,
        config: project.config,
      });
      captured.projectId = cachedProject.id;
      captured.configVersion = cachedProject.configVersion;
      await new SnapshotCache(cacheApp.registry.dataDir).save(
        cachedProject,
        { snapshot: captured, files: [] },
        () => true,
      );
      const restored = new SnapshotStore(cacheApp.registry, async () => {
        throw new Error("Cache restore must not scan the observed project");
      });
      await restored.restore(cachedProject.id);
      assert.equal(restored.view(cachedProject.id).restored, true);
      assert.deepEqual(
        targetState(restored.overview(cachedProject.id).snapshot.overview),
        state,
      );
      assert.deepEqual(
        targetState(restored.overview(cachedProject.id).snapshot.overview),
        state,
      );
    }
  }
  assert.equal(
    iterations[1].metrics.filesRead,
    0,
    "Repeated scan uses the unchanged-tree path",
  );
  assert.equal(iterations[2].metrics.filesRead, 0);
  assert.deepEqual(errors, []);
  const afterFiles = new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: project.root, maxBuffer: 32 * 1024 * 1024 },
    )
      .toString()
      .split("\0")
      .filter(Boolean),
  );
  for (const file of files) afterFiles.add(file);
  files.clear();
  for (const file of afterFiles) files.add(file);
  for (const directory of [".workflow-system", "docs", "TASKS", ".agents"])
    await collect(directory);
  assert.deepEqual(
    await hashes(),
    before,
    "Observed project file bytes and file inventory remain unchanged",
  );
  assert.equal(
    execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: project.root,
    }).toString(),
    statusBefore,
  );
  const result = {
    result: "passed",
    state: iterations[0].state,
    scanMetrics: iterations.map((item) => item.metrics),
    fullScanMetrics: fullScan.metrics,
    cacheRestore: "passed",
    observedFileCount: before.length,
    observedFilesUnchanged: true,
    errors,
  };
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, artifacts: output }));
} finally {
  await browser.close();
  await cacheApp?.app.close();
}
