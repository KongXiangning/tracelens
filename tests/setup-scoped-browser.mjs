// Disposable implementer inputs. Source-copy validation is not VN-05 installed acceptance.
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse, stringify } from "yaml";
import { createHash } from "node:crypto";
let support = path.resolve(
  process.env.TRACELENS_TEST_RUNTIME_SUPPORT ||
    "../vibe-coding-workflow-system/runtime/vnext/support",
);
const packageDir =
  process.env.TRACELENS_TEST_PACKAGE_DIR &&
  path.resolve(process.env.TRACELENS_TEST_PACKAGE_DIR);
const modules = [
  "assistance.mjs",
  "task-management.mjs",
  "task-event-codec.mjs",
  "record-storage.mjs",
];
const output = path.resolve(
  process.env.TRACELENS_TEST_OUTPUT_ROOT || "output/playwright",
);
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, "scoped-"));
const alpha = path.join(run, "copy-a"),
  beta = path.join(run, "copy-b"),
  missing = path.join(run, "without-runtime");
const operations = [],
  hash = (b) => createHash("sha256").update(b).digest("hex");
async function invoke(entry, command, request, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [entry, command, "--root", alpha, ...extra],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill(), 60000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", async (code) => {
      clearTimeout(timer);
      operations.push({
        entry,
        command,
        request,
        extra,
        code,
        stdout,
        stderr,
        at: new Date().toISOString(),
      });
      await writeFile(
        path.join(run, "operations.json"),
        JSON.stringify(operations, null, 2),
      );
      try {
        if (code) reject(new Error(stderr || stdout));
        else resolve(JSON.parse(stdout));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
const installed = path.join(alpha, ".workflow-system/runtime/support");
let distribution;
if (packageDir) {
  await mkdir(alpha, { recursive: true });
  await writeFile(
    path.join(alpha, "package.json"),
    '{"name":"tracelens-int-synthetic","private":true,"type":"module"}\n',
  );
  const result = await invoke(
    path.join(packageDir, "dist/cli.js"),
    "install",
    {},
    ["--json"],
  );
  if (result.status !== "installed") throw new Error("public install failed");
  distribution = JSON.parse(
    await readFile(
      path.join(packageDir, "payload/distribution-manifest.json"),
      "utf8",
    ),
  );
  if (
    distribution.manifest_digest !==
    "9a3bc3f567b31ae7ca4ad579c78ce74b7b5035b85230aa1d1ce435b123cfe909"
  )
    throw new Error("wrong VN05 candidate");
  const checks = [];
  for (const artifact of distribution.artifacts) {
    const actual = hash(await readFile(path.join(alpha, artifact.target_path)));
    if (actual !== artifact.checksum)
      throw new Error(`installed asset mismatch ${artifact.target_path}`);
    checks.push({ path: artifact.target_path, sha256: actual });
  }
  await writeFile(
    path.join(run, "installed-assets.json"),
    JSON.stringify({ manifest: distribution.manifest_digest, checks }, null, 2),
  );
  support = installed;
  const sample = path.join(support, "product-maintenance/examples/scoped"),
    helper = path.join(support, "product-maintenance.js");
  await invoke(helper, "apply", {
    files: [
      {
        path: ".workflow-system/PRODUCT.yaml",
        expected_sha256: null,
        content: await readFile(
          path.join(sample, ".workflow-system/PRODUCT.yaml"),
          "utf8",
        ),
      },
    ],
  });
  await mkdir(path.join(alpha, "docs/evidence"), { recursive: true });
  await cp(
    path.join(sample, "docs/evidence/import.md"),
    path.join(alpha, "docs/evidence/import.md"),
  );
  await invoke(helper, "apply", {
    files: await Promise.all(
      ["PROJECT.md", "ASSESSMENTS.md"].map(async (name) => ({
        path: `docs/product/${name}`,
        expected_sha256: null,
        content: await readFile(
          path.join(sample, "docs/product", name),
          "utf8",
        ),
      })),
    ),
  });
} else {
  await cp("examples/product-scoped", alpha, { recursive: true });
  await mkdir(installed, { recursive: true });
  for (const name of modules)
    await cp(path.join(support, name), path.join(installed, name));
}
const moduleHashes = {};
for (const name of modules)
  moduleHashes[name] = hash(await readFile(path.join(support, name)));
const task = (request) =>
  invoke(path.join(installed, "assistance.mjs"), "task", request);
async function save(relative, content) {
  const file = path.join(alpha, relative);
  if (packageDir)
    await invoke(path.join(installed, "product-maintenance.js"), "apply", {
      files: [
        {
          path: relative,
          expected_sha256: hash(await readFile(file)),
          content,
        },
      ],
    });
  else await writeFile(file, content);
}
const prepared = await task({
  action: "prepare",
  plan: {
    title: "合成导入任务",
    goal: "仅用于页面验收",
    steps: [
      { id: "S1", title: "全量导入" },
      { id: "S2", title: "恢复尚未执行" },
    ],
  },
});
await task({
  action: "adopt",
  task_id: prepared.task_id,
  plan_ref: prepared.ref,
  decision_source: "implementer-synthetic",
  decision_text: "采用合成计划",
});
await task({
  action: "close",
  task_id: prepared.task_id,
  remaining_work: ["S2 恢复尚未执行"],
  decision_source: "implementer-synthetic",
  decision_text: "保留缺口后关闭合成任务",
});
const paused = await task({
  action: "prepare",
  plan: { title: "合成导入任务", steps: [{ id: "S1", title: "等待资料" }] },
});
await task({
  action: "adopt",
  task_id: paused.task_id,
  plan_ref: paused.ref,
  decision_source: "implementer-synthetic",
  decision_text: "采用另一身份",
});
await task({
  action: "pause",
  task_id: paused.task_id,
  remaining_work: ["等待资料"],
  decision_source: "implementer-synthetic",
  decision_text: "暂停合成任务",
});
const orphan = await task({
  action: "prepare",
  plan: { title: "无需求归属的草稿", steps: [] },
});
const filename = path.join(alpha, "docs/product/PROJECT.md"),
  raw = await readFile(filename, "utf8"),
  end = raw.indexOf("\n---", 4),
  value = parse(raw.slice(4, end));
const binding = (id, taskId, ref) => ({
  id,
  task: { task_id: taskId, source: { kind: "file", path: ref } },
  role: "implementation",
  coverage: "合成关联，只观察任务与证据",
  origin: "declared",
  state: "active",
});
value.items.find((i) => i.id === "R-IMPORT").task_bindings = [
  binding("B-CLOSED", prepared.task_id, prepared.ref),
  binding("B-LOST", prepared.task_id, "docs/evidence/archived-plan.json"),
  binding("B-PAUSED", paused.task_id, paused.ref),
];
value.items.find((i) => i.id === "R-NEW").task_bindings = [
  binding("B-CONFLICT", prepared.task_id, "docs/evidence/identity.json"),
];
await save(
  "docs/product/PROJECT.md",
  `---\n${stringify(value)}---${raw.slice(end + 4)}`,
);
await writeFile(
  path.join(alpha, "docs/evidence/identity.json"),
  JSON.stringify({
    task_id: "explicitly-different-identity",
    title: "明确身份矛盾",
    lifecycle: "draft",
  }),
);
const manifestFile = path.join(alpha, ".workflow-system/PRODUCT.yaml"),
  manifest = parse(await readFile(manifestFile, "utf8"));
manifest.source_paths.push(
  prepared.ref,
  paused.ref,
  "docs/evidence/identity.json",
  "docs/evidence/archived-plan.json",
);
await save(".workflow-system/PRODUCT.yaml", stringify(manifest));
await rm(path.join(alpha, ".workflow-system/records/task-view.json"));
await cp(alpha, beta, { recursive: true });
await cp("examples/product-scoped", missing, { recursive: true });
await writeFile(
  path.join(run, "inputs.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      sourceType: packageDir
        ? "VN05 actual tgz public CLI installation"
        : "VN03 source helper copy, not formal VN05 installation",
      packageDir,
      distributionManifest: distribution?.manifest_digest,
      sourceDirectory: support,
      moduleHashes,
      alpha,
      beta,
      missing,
      closed: prepared.task_id,
      paused: paused.task_id,
      orphan: orphan.task_id,
      preparedRef: prepared.ref,
      dataDir: path.join(run, "registry"),
    },
    null,
    2,
  ),
);
console.log(path.join(run, "inputs.json"));
