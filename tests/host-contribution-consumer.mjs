import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import { assertNoLinks } from "../dist/server/config.js";
import { buildSnapshot } from "../dist/server/snapshot.js";
import { buildOverviewData } from "../dist/shared/overview-data.js";

// Explicitly opt-in and read-only. No Runtime trust and no observed helper execution.
const rootArg = process.argv[2];
if (!rootArg)
  throw new Error(
    "Pass the authorized isolated Agent host root as the first argument",
  );
const root = await realpath(path.resolve(rootArg));
const output = path.resolve(
  process.argv[3] || "output/host-contribution-consumer",
);
await assertNoLinks(output);
const relativeOutput = path.relative(root, output);
if (
  !relativeOutput ||
  (!relativeOutput.startsWith(".." + path.sep) &&
    relativeOutput !== ".." &&
    !path.isAbsolute(relativeOutput))
)
  throw new Error("Evidence output must be outside the observed root");
async function tree(prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) {
      files.push([
        relative,
        `symlink:${await readlink(path.join(root, relative))}`,
      ]);
      continue;
    }
    if (entry.isDirectory()) files.push(...(await tree(relative)));
    else
      files.push([
        relative,
        createHash("sha256")
          .update(await readFile(path.join(root, relative)))
          .digest("hex"),
      ]);
  }
  return files.sort(([a], [b]) => a.localeCompare(b));
}
const before = await tree();
const project = {
  id: "isolated-agent-host-consumption",
  name: "实际 Agent 隔离宿主输出",
  root,
  configVersion: 1,
  config: {
    readingMode: "vnext",
    autoDiscover: true,
    rules: { management: [], requirements: [], design: [], planning: [] },
    excludes: [],
    product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
  },
};
const snapshot = await buildSnapshot(project, new Date().toISOString());
const overview = buildOverviewData(snapshot);
const product = snapshot.product;
assert.ok(product?.manifest);
assert.ok(product.items.every((item) => item.usable));
assert.equal(
  snapshot.runtime?.source,
  "file-snapshot",
  "Read the saved same-root Task view; do not execute the observed helper",
);
assert.equal(snapshot.runtime.currentTaskId, null);
assert.equal(
  overview.currentWork.taskId,
  null,
  "An adopted active Task must not become current by array order",
);
const parse = product.items.find((item) => item.id === "REQ-PARSE");
const batch = product.items.find((item) => item.id === "REQ-BATCH");
assert.equal(parse.version, 5);
assert.equal(batch.version, 5);
const rows = product.bindings;
const old = rows.find((row) => row.binding.id === "B-OLD-PARSER");
const verify = rows.find((row) => row.binding.id === "B-VERIFY-PARSER-INPUTS");
const support = rows.find((row) => row.ownerKey === batch.key);
assert.equal(old.binding.contribution, "direct");
assert.equal(verify.binding.contribution, "direct");
assert.equal(verify.binding.role, "verification");
assert.equal(support.binding.contribution, "supporting");
assert.equal(
  snapshot.runtime.tasks.find(
    (task) => task.task_id === old.binding.task.task_id,
  ).lifecycle,
  "closed",
);
const adopted = snapshot.runtime.tasks.find(
  (task) => task.task_id === verify.binding.task.task_id,
);
assert.equal(adopted.lifecycle, "active");
assert.equal(adopted.plan_status, "adopted");
assert.ok(
  adopted.steps.length > 0 &&
    adopted.steps.every((step) => step.state === "not-started"),
);
assert.equal(adopted.executions.length, 0);
assert.equal(adopted.tests.length, 0);
assert.ok(
  rows.some(
    (row) =>
      row.binding.task.task_id === null &&
      row.binding.contribution === undefined,
  ),
);
assert.ok(
  rows.some(
    (row) =>
      row.binding.id === "B-DISMISSED-FONT" &&
      row.binding.state === "dismissed",
  ),
);
const batchSummary = [...overview.planned, ...overview.unordered].find(
  (item) => item.id === "REQ-BATCH",
);
assert.equal(batchSummary.contributionSummary.direct, 0);
assert.equal(batchSummary.contributionSummary.supporting, 1);
assert.equal(batchSummary.assessmentRecords.length, 0);
assert.equal(overview.confirmedOutcomes.items.length, 1);
assert.equal(overview.confirmedOutcomes.items[0].requirementId, "REQ-PARSE");
assert.equal(overview.confirmedOutcomes.items[0].scopeId, "PARSE-BASE");
assert.equal(overview.confirmedOutcomes.items[0].conclusion, "satisfied");
assert.ok(
  overview.confirmedOutcomes.items[0].subject.limitations.includes(
    "未执行新三类验证",
  ),
);
assert.deepEqual(overview.roadmapSummary, []);
const after = await tree();
assert.deepEqual(
  after,
  before,
  "Every observed file must remain byte-identical",
);
await mkdir(output, { recursive: true });
const result = {
  result: "passed",
  root,
  provenance:
    "Actual saved outputs of an independent Agent in an authorized isolated host; not a real business project",
  readOnly: {
    fileCount: before.length,
    beforeDigest: createHash("sha256")
      .update(JSON.stringify(before))
      .digest("hex"),
    afterDigest: createHash("sha256")
      .update(JSON.stringify(after))
      .digest("hex"),
    helperExecuted: false,
    runtimeSource: snapshot.runtime.source,
  },
  assertions: [
    "v3/v5 usable mixed documents",
    "closed direct parser and supporting batch remain distinct",
    "new adopted verification is not started and has no execution/test",
    "current null preserved despite active task",
    "legacy null identity and dismissed relation preserved",
    "only PARSE-BASE applicable scoped outcome",
    "no Roadmap produces no invented next item",
  ],
  snapshotId: snapshot.id,
  currentWork: overview.currentWork,
  contributionSummary: overview.contributionSummary,
  confirmedOutcomes: overview.confirmedOutcomes,
  runtimeTasks: snapshot.runtime.tasks.map((task) => ({
    task_id: task.task_id,
    lifecycle: task.lifecycle,
    plan_status: task.plan_status,
    steps: task.steps.map((step) => ({ id: step.id, state: step.state })),
    executions: task.executions.length,
    tests: task.tests.length,
  })),
  diagnostics: product.diagnostics,
};
await writeFile(
  path.join(output, "result.json"),
  JSON.stringify(result, null, 2),
);
await writeFile(
  path.join(output, "observed-file-hashes.json"),
  JSON.stringify(before, null, 2),
);
await writeFile(
  path.join(output, "overview.json"),
  JSON.stringify(overview, null, 2),
);
console.log(
  JSON.stringify(
    {
      result: result.result,
      filesUnchanged: before.length,
      runtime: snapshot.runtime.source,
      outcomes: overview.confirmedOutcomes.items.map((outcome) => [
        outcome.requirementId,
        outcome.scopeId,
      ]),
      artifacts: output,
    },
    null,
    2,
  ),
);
