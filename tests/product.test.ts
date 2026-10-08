import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { parse, stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/server/snapshot.js";
import { limits, SnapshotReader, discover } from "../src/server/scanner.js";
import {
  parseProductDocument,
  productKey,
  requirementDefinitionDigest,
} from "../src/server/product-parser.js";
import { parseInput } from "../src/server/parser.js";
import type { Project } from "../src/shared/types.js";
import { ProjectRegistry } from "../src/server/registry.js";
import { SnapshotStore } from "../src/server/snapshot.js";
import { locateProductSource } from "../src/server/product.js";
import type { ProductSourceCheck } from "../src/shared/product-types.js";

const run = promisify(execFile);
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
let directory: string;
let root: string;
const originalLimits = { ...limits };
function project(overrides: Partial<Project["config"]> = {}): Project {
  return {
    id: "local-registry",
    name: "合成中文 产品",
    root,
    configVersion: 1,
    config: {
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
      product: { enabled: true },
      ...overrides,
    },
  };
}
async function load(
  example = "product-comprehensive",
  overrides: Partial<Project["config"]> = {},
) {
  await cp(path.resolve("examples", example), root, { recursive: true });
  return buildSnapshot(project(overrides), new Date().toISOString());
}
async function write(relative: string, contents: string | Buffer) {
  const filename = path.join(root, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}
function parseDoc(raw: string) {
  return parseProductDocument(root, "product-id", "registry", {
    path: "docs/mixed.md",
    kind: "unclassified",
    raw,
    digest: sha(raw),
    bytes: Buffer.byteLength(raw),
    modifiedAt: "2026-10-08T00:00:00Z",
  });
}
const requirement = (id = "REQ-A", extra = "") =>
  `  - id: ${id}\n    type: requirement\n    scope: current\n${extra}`;
const body = (id = "REQ-A", title = "完整需求") =>
  `## [${id}] ${title}\n### 需求内容\n有效输入和异常输入完整保留。\n### 范围边界\n不含未来未选择的范围。\n### 验收要求\n保留可观察的输入和预期。\n`;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "tracelens-product-"));
  root = path.join(directory, "中文 工作副本 with spaces");
  await mkdir(root);
});
afterEach(async () => {
  Object.assign(limits, originalLimits);
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^tracelens-product-/);
  await rm(directory, { recursive: true, force: true });
});

describe("pinned PRODUCT contract and snapshot", () => {
  it("counts bytes of decoding failures against the same budget", async () => {
    await write("broken.txt", Buffer.from([255, 254]));
    await write("next.txt", "a");
    limits.totalBytes = 2;
    const reader = new SnapshotReader(root);
    await expect(reader.read("broken.txt")).rejects.toThrow();
    expect(reader.bytes).toBe(2);
    await expect(reader.read("next.txt")).rejects.toThrow(/上限/);
    expect(reader.inputs.size).toBe(0);
  });
  it("does not interpret heading-like frontmatter scalar text as a source item boundary", () => {
    const raw = `---\nschema: vnext-product-doc/v2\nitems:\n${requirement()}    extensions:\n      note: |\n        ## [REQ-A] 元数据里的伪标题\n---\n${body()}`;
    const input = {
      path: "docs/product/source.md",
      raw,
      digest: sha(raw),
      bytes: Buffer.byteLength(raw),
      modifiedAt: "now",
    };
    const check: ProductSourceCheck = {
      key: "source",
      ownerKey: "owner",
      pointer: "/sources/0",
      role: "关联依据",
      ref: {
        kind: "file",
        path: input.path,
        item_id: "REQ-A",
        section: "验收要求",
      },
      readState: "read",
      locationState: "not-located",
      digestState: "unknown",
      actualDigest: input.digest,
      target: null,
      endLine: null,
    };
    locateProductSource(check, input, {
      documentId: "document",
      path: input.path,
      line: 1,
      section: null,
      digest: input.digest,
    });
    expect(check.locationState).toBe("located");
    expect(raw.split("\n")[check.target!.line - 1]).toBe("### 验收要求");
  });
  it("keeps historical definition/byte checks separate from current alignment, pending feedback and report selection", async () => {
    const initial = await load();
    const req = initial.product!.items.find((i) => i.id === "REQ-IMPORT")!;
    const old = `---\nschema: vnext-product-doc/v2\nitems:\n${stringify([
      req.metadata,
    ])
      .split("\n")
      .filter(Boolean)
      .map((line) => `  ${line}`)
      .join("\n")}\n---\n${req.body}`;
    await write("docs/product/history/REQUIREMENTS-before.md", old);
    const filename = path.join(root, "docs/product/PROJECT.md");
    const raw = await readFile(filename, "utf8");
    const front = /^---\n([\s\S]*?)\n---/.exec(raw)!;
    const metadata = parse(front[1]);
    const report = metadata.items.find(
      (i: { id: string }) => i.id === "AS-BASE",
    );
    report.target_definition_sha256 = req.definitionSha256;
    report.target_basis.sha256 = sha(old);
    const design = metadata.items.find(
      (i: { id: string }) => i.id === "DES-IMPORT",
    );
    design.links[0].state = "dismissed";
    design.links[0].reason = "明确否定的合成依据，仍须保留";
    await writeFile(
      filename,
      `---\n${stringify(metadata)}---${raw.slice(front[0].length)}`,
    );
    const aligned = await buildSnapshot(project(), "now");
    expect(
      aligned.product!.assessments.find((a) => a.selectedId === "AS-BASE"),
    ).toMatchObject({
      definitionAlignment: "same",
      historicalDefinitionAlignment: "same",
    });
    expect(
      aligned.product!.sources.find((s) => s.pointer === "/target_basis"),
    ).toMatchObject({ digestState: "same-bytes" });
    expect(
      aligned.product!.relations.find(
        (r) => r.declaration.relation === "addresses",
      )!.declaration,
    ).toMatchObject({
      state: "dismissed",
      reason: "明确否定的合成依据，仍须保留",
    });
    const changedRaw = (await readFile(filename, "utf8")).replace(
      "支持单设备与双设备有效输入",
      "支持三设备的新输入范围",
    );
    await writeFile(filename, changedRaw);
    const changed = await buildSnapshot(project(), "now");
    expect(
      changed.product!.assessments.find((a) => a.selectedId === "AS-BASE"),
    ).toMatchObject({
      definitionAlignment: "changed",
      historicalDefinitionAlignment: "same",
    });
    expect(
      changed.product!.items.find((i) => i.id === "AS-BASE")!.metadata!
        .verification,
    ).toBe("pass-reported");
    expect(changed.product!.sources.some((s) => s.role === "待核对材料")).toBe(
      true,
    );
    report.target = "REQ-EXPORT";
    await writeFile(
      filename,
      `---\n${stringify(metadata)}---${raw.slice(front[0].length)}`,
    );
    const mismatch = await buildSnapshot(project(), "now");
    expect(
      mismatch.product!.assessments.find((a) => a.selectedId === "AS-BASE")!
        .selection,
    ).toBe("target-mismatch");
  });
  it("reads managed files beyond generic navigation depth and removes withdrawn registration without deleting source raw", async () => {
    await load();
    const manifestFile = path.join(root, ".workflow-system/PRODUCT.yaml");
    const m = parse(await readFile(manifestFile, "utf8"));
    const filename = "docs/product/deep/a/b/c/d/current.md";
    await write(
      filename,
      `---\nschema: vnext-product-doc/v2\nitems:\n${requirement("REQ-DEEP")}---\n${body("REQ-DEEP")}`,
    );
    m.managed_paths.push(filename);
    m.source_paths.push("docs/product/deep/**");
    await writeFile(manifestFile, stringify(m));
    const deep = await buildSnapshot(project(), "now");
    expect(
      deep.product!.items.some((i) => i.usable && i.id === "REQ-DEEP"),
    ).toBe(true);
    m.managed_paths = [m.entry];
    await writeFile(manifestFile, stringify(m));
    const withdrawn = await buildSnapshot(project(), "now", deep);
    expect(withdrawn.product!.items.some((i) => i.id === "REQ-DEEP")).toBe(
      false,
    );
    expect(withdrawn.documents.some((d) => d.path === filename)).toBe(false);
    expect(await readFile(path.join(root, filename), "utf8")).toContain(
      "REQ-DEEP",
    );
  });
  it("applies PRODUCT directory exclusions before generic and adopted-plan reads", async () => {
    await load();
    const filename = "docs/evidence/baseline-report.md";
    const manifestFile = path.join(root, ".workflow-system/PRODUCT.yaml");
    const m = parse(await readFile(manifestFile, "utf8"));
    m.exclude_paths = ["docs/evidence"];
    await writeFile(manifestFile, stringify(m));
    const snapshot = await buildSnapshot(
      project({
        rules: {
          management: [filename],
          requirements: [],
          design: [],
          planning: [],
        },
      }),
      "now",
    );
    expect(snapshot.documents.some((d) => d.path === filename)).toBe(false);
    expect(
      snapshot
        .product!.sources.filter(
          (s) =>
            s.ref.kind === "file" && s.ref.path.startsWith("docs/evidence/"),
        )
        .every((s) => s.readState === "excluded"),
    ).toBe(true);
  });
  it("matches the official offline reader and preserves all nine types, scopes, reports and actual byte hashes", async () => {
    const snapshot = await load();
    const p = snapshot.product!;
    const { stdout } = await run(process.execPath, [
      path.resolve("tests/vendor/product/offline-reader.mjs"),
      root,
    ]);
    const official = JSON.parse(stdout);
    expect(p.items.filter((i) => i.usable)).toHaveLength(12);
    expect(new Set(p.items.map((i) => i.type)).size).toBe(9);
    expect(
      new Set(
        p.items
          .filter((i) => i.type === "requirement")
          .map((i) => i.metadata!.scope),
      ).size,
    ).toBe(4);
    expect(
      p.items
        .filter((i) => i.usable)
        .map((i) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          metadata: i.metadata,
          body: i.body,
          path: i.source.path,
          line: i.source.line,
          definition_sha256: i.definitionSha256,
        })),
    ).toEqual(official.items);
    expect(p.workItems.map((w) => w.declaration.id)).toEqual(
      official.plan_tasks[0].work_items.map(
        (w: { work_item_id: string }) => w.work_item_id,
      ),
    );
    expect(p.coverage.complete).toBe(true);
    expect(p.bindings[0]).toMatchObject({
      match: "unknown-identity",
      taskIds: [],
    });
    expect(p.assessments.find((a) => a.selectedId === "AS-BASE")).toMatchObject(
      { definitionAlignment: "unknown", historicalState: "available" },
    );
    expect(p.sources.find((s) => s.pointer === "/raw_ref")).toMatchObject({
      readState: "read",
      digestState: "same-bytes",
    });
    expect(
      p.sources.some((s) => s.role === "待核对材料" && s.readState === "read"),
    ).toBe(true);
    expect(p.items.some((i) => i.source.path.includes("history"))).toBe(false);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.statements).toEqual([]);
    for (const doc of snapshot.documents)
      expect(doc.digest).toBe(sha(await readFile(path.join(root, doc.path))));
    expect(
      snapshot.documents.filter((d) => d.path.endsWith("PROJECT.md")),
    ).toHaveLength(1);
    const req = p.items.find((i) => i.id === "REQ-IMPORT")!;
    expect(req.source.line).toBe(req.headings[0].line);
    expect(
      snapshot.documents
        .find((d) => d.id === req.source.documentId)!
        .raw.split("\n")[req.source.line - 1],
    ).toContain("## [REQ-IMPORT]");
  });
  it("uses root AST headings, accepts BOM/CRLF, preserves complete bodies and absolute metadata lines", () => {
    const raw =
      `\uFEFF---\n schema: vnext-product-doc/v2\n items:\n${requirement()}---\n# 合成文档\n${body()}\n\`\`\`md\n## [FAKE] 代码标题\n\`\`\`\n> ## [FAKE2] 引用标题\n\n- 列表\n\n  ## [FAKE3] 列表标题\n\n## 附录\n不是需求正文。\n`
        .replace(/\n/g, "\r\n")
        .replace(/^ schema:/m, "schema:")
        .replace(/^ items:/m, "items:");
    const parsed = parseDoc(raw);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].usable).toBe(true);
    expect(parsed.items[0].body).toContain("[FAKE3]");
    expect(parsed.items[0].body).not.toContain("## 附录");
    expect(parsed.items[0].metadataLocations["/scope"]).toBe(6);
    expect(parsed.items[0].source.line).toBe(9);
    expect(parsed.items[0].definitionSha256).toBe(
      requirementDefinitionDigest(parsed.items[0]),
    );
  });
  it("isolates safe bad item metadata and sections, but rejects a syntactically damaged frontmatter", () => {
    const good = requirement();
    const parsed = parseDoc(
      `---\nschema: vnext-product-doc/v2\nitems:\n${good}${requirement("REQ-B", "    status: done\n")}---\n${body()}${body("REQ-B")}`,
    );
    expect(parsed.items.map((i) => i.usable)).toEqual([true, false]);
    expect(parsed.items[1].rawMetadata).toMatchObject({ status: "done" });
    expect(parsed.items[1].body).toContain("验收要求");
    for (const bad of [
      "items: [\n  - broken",
      "items:\n  - id: &name REQ-A\n    type: requirement\n    scope: current\n",
      "items:\n  - id: REQ-A\n    type: requirement\n    scope: current\n    scope: planned\n",
    ]) {
      const result = parseDoc(
        `---\nschema: vnext-product-doc/v2\n${bad}\n---\n${body()}`,
      );
      expect(result.items.filter((i) => i.usable)).toHaveLength(0);
      expect(result.diagnostics.some((d) => d.code.startsWith("YAML_"))).toBe(
        true,
      );
    }
    const missingSection = parseDoc(
      `---\nschema: vnext-product-doc/v2\nitems:\n${good}---\n## [REQ-A] 需求\n### 需求内容\n只有内容。`,
    );
    expect(missingSection.items[0].usable).toBe(false);
  });
  it("keeps case-sensitive product IDs isolated from Windows path aliases and worktree namespaces", () => {
    const parsed = parseDoc(
      `---\nschema: vnext-product-doc/v2\nitems:\n${requirement("REQ-A")}${requirement("req-a")}---\n${body("REQ-A")}${body("req-a")}`,
    );
    expect(parsed.items.every((i) => i.usable)).toBe(true);
    expect(parsed.items[0].key).not.toBe(parsed.items[1].key);
    expect(productKey(root, "same-project", "REQ-A")).not.toBe(
      productKey(root + "-other-worktree", "same-project", "REQ-A"),
    );
  });
  it("preserves duplicates without newest-file selection and retains unsupported manifest raw", async () => {
    await load();
    const manifestPath = path.join(root, ".workflow-system/PRODUCT.yaml");
    const manifest = parse(await readFile(manifestPath, "utf8"));
    manifest.managed_paths.push("docs/product/duplicate.md");
    await writeFile(manifestPath, stringify(manifest));
    await write(
      "docs/product/duplicate.md",
      `---\nschema: vnext-product-doc/v2\nitems:\n${requirement("REQ-IMPORT")}---\n${body("REQ-IMPORT")}`,
    );
    const duplicate = (await buildSnapshot(project(), "now")).product!;
    expect(duplicate.items.filter((i) => i.id === "REQ-IMPORT")).toHaveLength(
      2,
    );
    expect(
      duplicate.items
        .filter((i) => i.id === "REQ-IMPORT")
        .every((i) => !i.usable),
    ).toBe(true);
    expect(
      new Set(
        duplicate.items.filter((i) => i.id === "REQ-IMPORT").map((i) => i.key),
      ).size,
    ).toBe(2);
    expect(
      duplicate.relations.find((r) => r.declaration.relation === "addresses")
        ?.resolution,
    ).toBe("ambiguous");
    await writeFile(manifestPath, "schema: vnext-product-manifest/v99\n");
    const unsupported = await buildSnapshot(project(), "now");
    expect(unsupported.product!.status).toBe("unsupported");
    expect(unsupported.product!.items).toEqual([]);
    expect(
      unsupported.documents.some(
        (d) => d.roles?.includes("product-manifest") && d.raw.includes("v99"),
      ),
    ).toBe(true);
  });
  it("does not expand old project config; previews scope and persists explicit opt-in/version changes", async () => {
    await load();
    const disabled = await buildSnapshot(
      project({ product: undefined }),
      "now",
    );
    expect(disabled.product!.status).toBe("disabled");
    expect(disabled.documents).toEqual([]);
    const preview = await discover(root, path.join(directory, "tool-data"));
    expect(preview.product!.manifest!.managed_paths).toEqual([
      "docs/product/PROJECT.md",
    ]);
    expect(preview.config.product?.enabled).not.toBe(true);
    const registry = new ProjectRegistry(path.join(directory, "tool-data"));
    const initial = await registry.add({
      name: "旧项目",
      root,
      config: disabled.config,
    });
    const changed = await registry.update(initial.id, {
      name: initial.name,
      config: project().config,
    });
    expect(changed.configVersion).toBe(initial.configVersion + 1);
    const restarted = new ProjectRegistry(registry.dataDir);
    await restarted.load();
    expect(restarted.get(initial.id).config.product?.enabled).toBe(true);
  });
  it("interprets v1 independently without enabling v2 bindings or migrating bytes", () => {
    const result = parseDoc(
      `---\nschema: vnext-product-doc/v1\nitems:\n${requirement()}---\n${body()}`,
    );
    expect(result.items[0]).toMatchObject({ version: 1, usable: true });
    const invalid = parseDoc(
      `---\nschema: vnext-product-doc/v1\nitems:\n${requirement("REQ-A", "    task_bindings: []\n")}---\n${body()}`,
    );
    expect(invalid.items[0].usable).toBe(false);
  });
  it("reads exact TXT/JSON sources, retains URI/exclusions/out-of-range and never scans source directories", async () => {
    await load();
    await write("docs/evidence/single.json", '{"observed":true}\n');
    await write("docs/evidence/not-referenced.txt", "不应被读取\n");
    const filename = path.join(root, "docs/product/PROJECT.md");
    let raw = await readFile(filename, "utf8");
    raw = raw.replace(
      "  - id: GOAL-IMPORT\n",
      `  - id: GOAL-IMPORT\n    sources:\n      - {kind: file, path: docs/evidence/single.json, lines: {start: 1, end: 1}}\n      - {kind: file, path: docs/evidence/blocked.md}\n      - {kind: file, path: outside.txt}\n      - {kind: uri, uri: 'https://example.invalid/private'}\n      - {kind: file, path: ../outside.txt}\n`,
    );
    await writeFile(filename, raw);
    const snapshot = await buildSnapshot(
      project({ excludes: ["docs/evidence/blocked.md"] }),
      "now",
    );
    expect(snapshot.documents.some((d) => d.path.endsWith("single.json"))).toBe(
      true,
    );
    expect(
      snapshot.documents.some((d) => d.path.endsWith("not-referenced.txt")),
    ).toBe(false);
    const states = snapshot
      .product!.sources.filter(
        (s) =>
          s.ownerKey ===
          snapshot.product!.items.find((i) => i.id === "GOAL-IMPORT")!.key,
      )
      .map((s) => s.readState);
    expect(states).toEqual([
      "read",
      "excluded",
      "outside",
      "external",
      "unsafe",
    ]);
    const changed = await readFile(filename);
    expect(sha(changed)).toBe(sha(raw));
  });
  it("shares bounded cache and preserves unrecorded source contents when the budget is exhausted", async () => {
    await load();
    const reader = new SnapshotReader(root);
    const first = await reader.read("docs/evidence/baseline-report.md");
    await write("docs/evidence/baseline-report.md", "已变化\n");
    const second = await reader.read("docs/evidence/baseline-report.md");
    expect(second.digest).toBe(first.digest);
    expect(reader.bytes).toBe(first.bytes);
    const manifestBytes = (
      await readFile(path.join(root, ".workflow-system/PRODUCT.yaml"))
    ).length;
    const managedBytes = (
      await readFile(path.join(root, "docs/product/PROJECT.md"))
    ).length;
    limits.totalBytes = manifestBytes + managedBytes;
    const limited = await buildSnapshot(project(), "now");
    expect(limited.product!.items.filter((i) => i.usable)).toHaveLength(12);
    expect(
      limited
        .product!.sources.filter((s) => s.ref.kind === "file")
        .every((s) => s.readState === "not-read"),
    ).toBe(true);
    expect(limited.product!.coverage.complete).toBe(true);
  });
  it("rejects junction sources and records incomplete managed enumeration without discarding independent paths", async () => {
    await load();
    const outside = path.join(directory, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "source.txt"), "外部\n");
    await symlink(
      outside,
      path.join(root, "docs/evidence/link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const manifestPath = path.join(root, ".workflow-system/PRODUCT.yaml");
    const manifest = parse(await readFile(manifestPath, "utf8"));
    manifest.managed_paths.push("docs/evidence/link/*.md");
    await writeFile(manifestPath, stringify(manifest));
    const filename = path.join(root, "docs/product/PROJECT.md");
    await writeFile(
      filename,
      (await readFile(filename, "utf8")).replace(
        "  - id: GOAL-IMPORT\n",
        "  - id: GOAL-IMPORT\n    sources: [{kind: file, path: docs/evidence/link/source.txt}]\n",
      ),
    );
    const snapshot = await buildSnapshot(project(), "now");
    expect(snapshot.product!.coverage.complete).toBe(false);
    expect(snapshot.product!.items.filter((i) => i.usable)).toHaveLength(12);
    expect(
      snapshot.product!.sources.some(
        (s) =>
          s.ref.kind === "file" &&
          s.ref.path.includes("link") &&
          s.readState === "unavailable",
      ),
    ).toBe(true);
  });
  it("supports no/multiple plans, keeps original ordering and resolves plan-scoped work identity", async () => {
    const none = await load("product-planning/no-plan");
    expect(none.product!.workItems).toHaveLength(0);
    expect(
      none.product!.items.filter((i) => i.type === "requirement").length,
    ).toBeGreaterThan(1);
    await rm(root, { recursive: true });
    await mkdir(root);
    const multiple = await load("product-planning/multiple-plans");
    expect(
      multiple.product!.items.filter((i) => i.type === "plan"),
    ).toHaveLength(3);
    const { stdout } = await run(process.execPath, [
      path.resolve("tests/vendor/product/offline-reader.mjs"),
      root,
    ]);
    const official = JSON.parse(stdout);
    for (const plan of official.plan_tasks)
      expect(
        multiple
          .product!.workItems.filter(
            (w) =>
              multiple.product!.items.find((i) => i.key === w.planKey)?.id ===
              plan.plan_id,
          )
          .map((w) => w.declaration.id),
      ).toEqual(
        plan.work_items.map((w: { work_item_id: string }) => w.work_item_id),
      );
    const keys = multiple.product!.workItems.map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      multiple.product!.diagnostics.some((d) =>
        /未实现|遗漏需求/.test(d.message),
      ),
    ).toBe(false);
  });
  it("traces E6 inserted repair and real task identity without treating steps as tasks or creating C", async () => {
    await load("product-e6");
    const filename = path.join(root, "docs/product/REQUIREMENTS.md");
    const raw = await readFile(filename, "utf8");
    const match = /---\n([\s\S]*?)\n---/.exec(raw)!;
    const metadata = parse(match[1]);
    metadata.items[0].task_bindings = metadata.items[0].task_bindings.filter(
      (b: { id: string }) => b.id !== "B-C",
    );
    metadata.items[0].task_bindings.find(
      (b: { id: string }) => b.id === "B-R",
    ).task.step_id = "P4";
    await writeFile(
      filename,
      `---\n${stringify(metadata)}---${raw.slice(match[0].length)}`,
    );
    for (const [id, status] of [
      ["A", "closed"],
      ["B", "active"],
      ["R", "closed"],
    ])
      await write(
        `TASKS/${id}.md`,
        `---\ntask_id: example-task-${id}\n---\n# 任务 ${id}\n- 任务编号: TASK-81${id === "A" ? "1" : id === "B" ? "2" : "3"}\n- 任务状态: ${status}\n`,
      );
    const snapshot = await buildSnapshot(
      project({
        rules: {
          management: ["TASKS/*.md"],
          requirements: [],
          design: [],
          planning: [],
        },
      }),
      "now",
    );
    const p = snapshot.product!;
    expect(p.workItems.map((w) => w.declaration.id)).toEqual([
      "E6A",
      "E6B",
      "E6R",
      "E6C",
    ]);
    const repair = p.bindings.find((b) => b.declaration.id === "B-R")!;
    expect(repair).toMatchObject({
      match: "matched",
      declaration: { role: "repair", task: { step_id: "P4" } },
    });
    expect(repair.repairs[0].taskIds).toHaveLength(1);
    expect(
      p.workItems.find((w) => w.declaration.id === "E6C")!.bindingKeys,
    ).toEqual([]);
    expect(snapshot.tasks).toHaveLength(3);
    expect(
      snapshot.tasks.find((t) => t.taskId === "example-task-A")!.statuses[0]
        .text,
    ).toBe("closed");
    expect(p.items.find((i) => i.id === "REQ-IMPORT")!.metadata!.scope).toBe(
      "current",
    );
  });
  it("does not reattach a historical binding when CURRENT_TASK focus changes; preserves conflicts", async () => {
    await load();
    const filename = path.join(root, "docs/product/PROJECT.md");
    await writeFile(
      filename,
      (await readFile(filename, "utf8"))
        .replace("task_id: null", "task_id: real-one")
        .replace(
          "path: docs/evidence/baseline-report.md, note:",
          "path: docs/workflow/CURRENT_TASK.md, note:",
        ),
    );
    const manifestPath = path.join(root, ".workflow-system/PRODUCT.yaml");
    const manifest = parse(await readFile(manifestPath, "utf8"));
    manifest.source_paths.push("docs/workflow/*.md");
    await writeFile(manifestPath, stringify(manifest));
    const current = (real: string) =>
      `<!-- vnext-task-view/v1 -->\n# CURRENT_TASK\n## Current work\n- Task: TASK-811 (${real}) — 合成焦点\n- Step: P4\n`;
    await write("docs/workflow/CURRENT_TASK.md", current("real-one"));
    const first = await buildSnapshot(project(), "now");
    expect(first.product!.bindings[0].match).toBe("matched");
    expect(first.tasks[0]).toMatchObject({
      number: "TASK-811",
      taskId: "real-one",
      statuses: [],
    });
    await write("docs/workflow/CURRENT_TASK.md", current("real-two"));
    const second = await buildSnapshot(project(), "now", first);
    expect(second.product!.bindings[0]).toMatchObject({
      match: "conflict",
      taskIds: [],
    });
    const task = parseInput("registry", {
      path: "TASKS/info.md",
      kind: "management",
      raw: "---\ntask_id: one\n---\n# Task\n- task_id: two\n",
      digest: sha("fixture"),
      bytes: 50,
      modifiedAt: "now",
    }).task!;
    expect(task.identityConflict).toBe(true);
    expect(task.taskId).toBeNull();
  });
  it("refreshes moved identities, withdrawals and broken manifests atomically and rejects stale snapshot IDs", async () => {
    await load();
    const registry = new ProjectRegistry(path.join(directory, "tool-data"));
    const registered = await registry.add({
      name: "合成产品",
      root,
      config: project().config,
    });
    const store = new SnapshotStore(registry);
    const first = (await store.refresh(registered.id)).snapshot!;
    await rename(
      path.join(root, "docs/product/PROJECT.md"),
      path.join(root, "docs/product/moved.md"),
    );
    const manifestPath = path.join(root, ".workflow-system/PRODUCT.yaml");
    const manifest = parse(await readFile(manifestPath, "utf8"));
    manifest.entry = "docs/product/moved.md";
    manifest.managed_paths = [manifest.entry];
    await writeFile(manifestPath, stringify(manifest));
    const moved = (await store.refresh(registered.id)).snapshot!;
    expect(moved.product!.items[0].key).toBe(first.product!.items[0].key);
    expect(moved.product!.items[0].source.path).toBe("docs/product/moved.md");
    expect(() =>
      store.document(registered.id, first.documents[0].id, first.id),
    ).toThrow(/快照已变化/);
    await writeFile(manifestPath, "schema: [broken\n");
    const broken = (await store.refresh(registered.id)).snapshot!;
    expect(broken.id).not.toBe(moved.id);
    expect(broken.product!.status).toBe("unavailable");
    expect(broken.product!.items).toEqual([]);
    await rename(root, root + "-removed");
    const failed = await store.refresh(registered.id);
    expect(failed.attempt?.state).toBe("failed");
    expect(failed.snapshot!.id).toBe(broken.id);
  });
});
