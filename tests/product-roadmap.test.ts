import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import path from "node:path";
import os from "node:os";
import { stringify } from "yaml";
import { buildSnapshot } from "../src/server/snapshot.js";
import {
  arrangementSnapshot,
  reconcileRoadmap,
} from "../src/server/product-roadmap.js";
import { RuntimeReader } from "../src/server/runtime-reader.js";
import { SnapshotCache } from "../src/server/snapshot-cache.js";
import { configFingerprint } from "../src/server/config.js";
import { FileIndex } from "../src/server/file-index.js";
import type { Project } from "../src/shared/types.js";
import type {
  ProductMetadata,
  ProductSnapshot,
  ProductSource,
} from "../src/shared/product-types.js";
import type { ProductPlanningSelector } from "../src/shared/product-roadmap.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const hash = (raw: string | Buffer) =>
  createHash("sha256").update(raw).digest("hex");
const text: ProductSource = {
  kind: "text",
  label: "合成核对",
  text: "仅限隔离合成测试，不是业务验收",
};
const sections: Record<string, string[]> = {
  project: ["项目定位", "盘点范围与未核对项"],
  goal: ["目标说明", "范围边界"],
  module: ["业务能力", "范围边界"],
  requirement: ["需求内容", "范围边界", "验收要求"],
  plan: ["实施策略", "阶段与工作项说明", "调整与未决事项"],
  change: ["变更说明", "影响与未同步项"],
};
const body = (m: ProductMetadata) =>
  `## [${m.id}] ${m.id}\n${sections[m.type].map((s) => `### ${s}\n明确当前范围。\n`).join("")}`;
const document = (items: ProductMetadata[], version = 4) =>
  `---\n${stringify(JSON.parse(JSON.stringify({ schema: `vnext-product-doc/v${version}`, items })))}---\n# 合成资料\n\n${items.map(body).join("\n")}`;
const link = (id: string, target: string, relation: string) => ({
  id,
  target,
  relation,
  state: "active" as const,
  origin: "declared" as const,
});
const requirements = (): ProductMetadata[] => [
  {
    id: "PROJECT",
    type: "project",
    inventory: {
      state: "partial",
      checked_sources: [text],
      unreviewed_sources: [],
    },
  },
  {
    id: "G",
    type: "goal",
    scope: "current",
    assessment_scopes: [
      { target: "R1", scope_id: "main", coverage: "明确当前范围" },
    ],
  },
  {
    id: "M",
    type: "module",
    scope: "current",
    links: [link("M-G", "G", "supports")],
  },
  {
    id: "R1",
    type: "requirement",
    scope: "current",
    links: [link("R1-M", "M", "part_of")],
  },
  {
    id: "R2",
    type: "requirement",
    scope: "current",
    links: [link("R2-R1", "R1", "part_of")],
  },
  { id: "R3", type: "requirement", scope: "current" },
];
const plan = (): ProductMetadata => ({
  id: "PLAN",
  type: "plan",
  intent_state: "adopted",
  targets: ["G", "R1", "R2", "R3"].map((target) => ({
    target,
    coverage: "明确当前范围",
  })),
  work_items: ["R1", "R2"].map((target, index) => ({
    id: `W${index + 1}`,
    title: target,
    outcome: "局部结果",
    scope: "部分范围",
    targets: [{ target, coverage: "部分范围" }],
    state: "included",
    origin: "initial",
    ...(index
      ? {
          depends_on: [
            {
              item_id: "W1",
              kind: "prerequisite" as const,
              reason: "明确前置，仅安排",
            },
          ],
        }
      : {}),
  })),
});
async function fixture(
  selector: ProductPlanningSelector = { kind: "project-current" },
  version = 4,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tracelens-roadmap-"));
  roots.push(root);
  const project: Project = {
    id: "roadmap-test",
    name: "Synthetic",
    root,
    configVersion: 1,
    config: {
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
      product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
    },
  };
  const put = async (relative: string, raw: string | Buffer) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), raw);
  };
  const defs = requirements(),
    roadmap = plan();
  await put(
    ".workflow-system/PRODUCT.yaml",
    stringify({
      schema: "vnext-product-manifest/v2",
      project_id: "roadmap-test",
      entry: "docs/product/PROJECT.md",
      managed_paths: ["docs/product/*.md"],
      source_paths: ["evidence/**"],
      exclude_paths: [],
      maintenance: "enabled",
    }),
  );
  const saveDefs = () =>
    put("docs/product/PROJECT.md", document(defs, version));
  const savePlan = () =>
    put("docs/product/ROADMAP.md", document([roadmap], version));
  await saveDefs();
  await savePlan();
  const read = async (coreOnly = false) =>
    (
      await buildSnapshot(project, new Date().toISOString(), undefined, {
        reader: new RuntimeReader(),
        isCurrent: () => true,
        scan: coreOnly
          ? { index: new FileIndex(), batched: true, coreOnly: true }
          : {},
      })
    ).product!;
  const initial = reconcileRoadmap(await read(), { plan_id: "PLAN", selector });
  expect(initial.snapshot_proposal).toBeDefined();
  roadmap.planning_baseline = {
    ...initial.snapshot_proposal!,
    project_id: "roadmap-test",
    checked_at: "2026-10-14T00:00:00Z",
    working_copy: root,
    sources: [text],
    unread_sources: [],
    exceptions: [],
  };
  await savePlan();
  return { root, project, defs, roadmap, read, put, savePlan, saveDefs };
}
async function files(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (relative = "") => {
    for (const e of await readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const name = path.join(relative, e.name);
      if (e.isDirectory()) await visit(name);
      else result[name] = hash(await readFile(path.join(root, name)));
    }
  };
  await visit();
  return result;
}
async function parity(f: Awaited<ReturnType<typeof fixture>>) {
  const before = await files(f.root);
  // Only this pinned test oracle executes, never an observed project's helper.
  const oracle = spawnSync(
    process.execPath,
    [
      path.resolve("tests/product-oracle/roadmap-v5/offline-reader.mjs"),
      f.root,
      "PLAN",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  expect(oracle.error).toBeUndefined();
  expect(oracle.stderr).toBe("");
  const expected = JSON.parse(oracle.stdout).roadmap_reconciliation;
  const observed = (await f.read()).roadmaps!.find(
    (r) => r.plan_id === "PLAN",
  )!;
  const { planKey: _key, diagnostics: _diagnostics, ...actual } = observed;
  const { diagnostics: _oracleDiagnostics, ...comparable } = expected;
  expect(actual).toEqual(comparable);
  expect(await files(f.root)).toEqual(before);
  return observed;
}

describe("pinned production Roadmap reconciliation", () => {
  it("pins immutable production offline-reader bytes", async () => {
    expect(
      hash(
        await readFile("tests/product-oracle/roadmap-v5/offline-reader.mjs"),
      ),
    ).toBe("4fd4f5538f19dcc1417dbd9f6940f1ebe86b8df9172a36a276769104d42f69c2");
  });
  it.each<ProductPlanningSelector>([
    { kind: "project-current" },
    { kind: "explicit-requirements", requirement_ids: ["R1"] },
    { kind: "target-subgraph", target_ids: ["G"] },
    { kind: "target-subgraph", target_ids: ["G"], exclude_ids: ["R1"] },
  ])(
    "matches production selector %j with unchanged definitions and arrangements",
    async (selector) => {
      const f = await fixture(selector);
      const result = await parity(f);
      expect(result.status).toBe("current");
      expect(result.development_gate).toBe(false);
      expect(result.delivery).toBe("not-evaluated");
      if (selector.kind === "project-current")
        expect(result.unarranged_requirements).toEqual(["R3"]);
      if (selector.kind === "target-subgraph" && !selector.exclude_ids) {
        expect(result.scope!.member_ids).toEqual(["R1", "R2"]);
        expect(result.scope!.unassigned).toEqual(["R3"]);
      }
    },
  );
  it("retains v5 support and identical definition/arrangement algorithms", async () => {
    const f = await fixture({ kind: "project-current" }, 5);
    const result = await parity(f);
    expect(result.status).toBe("current");
    f.defs.find((i) => i.id === "R1")!.task_bindings = [
      {
        id: "B",
        task: { task_id: null, source: text },
        role: "implementation",
        coverage: "部分范围",
        contribution: "direct",
        origin: "declared",
        state: "active",
      },
    ];
    await f.saveDefs();
    expect((await parity(f)).status).toBe("current");
    f.defs.find((i) => i.id === "R1")!.task_bindings![0].contribution =
      "supporting";
    await f.saveDefs();
    expect((await parity(f)).status).toBe("current");
  });
  it("exposes member, context, definition, arrangement changes and affected work without selecting next work", async () => {
    const f = await fixture();
    f.defs.find((i) => i.id === "R2")!.scope = "retired";
    f.defs.push({ id: "R4", type: "requirement", scope: "current" });
    f.defs.find((i) => i.id === "R1")!.links = [];
    f.roadmap.work_items!.reverse();
    await f.saveDefs();
    await f.savePlan();
    const result = await parity(f);
    expect(result.status).toBe("changes-pending");
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { kind: "member-added", id: "R4" },
        { kind: "member-exited", id: "R2" },
        { kind: "context-exited", id: "M" },
      ]),
    );
    expect(result.affected_work_items).toContain("W1");
    expect(result).not.toHaveProperty("next_work_item_id");
  });
  it.each(["no-adjustment", "deferred"] as const)(
    "preserves %s and sends a changed exact-version exception to stale_exceptions",
    async (disposition) => {
      const f = await fixture();
      const baseline = f.roadmap.planning_baseline!;
      const definition = baseline.definitions.find((d) => d.id === "R1")!;
      baseline.exceptions = [
        {
          target: "R1",
          algorithm: definition.algorithm,
          sha256: definition.sha256!,
          disposition,
          reason: "明确版本的处置",
          sources: [text],
          work_item_ids: ["W1"],
        },
      ];
      await f.savePlan();
      expect((await parity(f)).status).toBe(
        disposition === "deferred" ? "reviewed-deferred" : "current",
      );
      f.defs.find((i) => i.id === "R1")!.links = [];
      await f.saveDefs();
      const changed = await parity(f);
      expect(changed.status).toBe("changes-pending");
      expect(changed.stale_exceptions).toHaveLength(1);
      expect(changed.exceptions).toEqual([]);
    },
  );
  it.each([
    "working-copy",
    "project",
    "unread",
    "partial-definitions",
    "incomparable",
    "selector-duplicate",
    "arrangement-algorithm",
  ])("matches unknown degradation for %s", async (mutation) => {
    const f = await fixture();
    const b = f.roadmap.planning_baseline!;
    if (mutation === "working-copy") b.working_copy = "/different-copy";
    if (mutation === "project") b.project_id = "different-project";
    if (mutation === "unread") b.unread_sources = [text];
    if (mutation === "partial-definitions") b.definitions.shift();
    if (mutation === "incomparable")
      b.definitions[0].algorithm = "unknown-algorithm/v1";
    if (mutation === "selector-duplicate")
      b.selector = {
        kind: "explicit-requirements",
        requirement_ids: ["R1", "R1"],
      };
    if (mutation === "arrangement-algorithm")
      b.arrangement.algorithm = "unknown-arrangement/v1";
    await f.savePlan();
    const result = await parity(f);
    expect(result.status).toBe("unknown");
    expect(result.work_items).toHaveLength(2);
  });
  it("keeps local scopes local when unrelated requirements appear", async () => {
    const f = await fixture({
      kind: "explicit-requirements",
      requirement_ids: ["R1"],
    });
    f.defs.push({ id: "R4", type: "requirement", scope: "current" });
    await f.saveDefs();
    const result = await parity(f);
    expect(result.status).toBe("current");
    expect(result.scope!.outside_scope).toContain("R4");
  });
  it("refuses current when any registered identity file is unread or hides a duplicate", async () => {
    const f = await fixture({
      kind: "explicit-requirements",
      requirement_ids: ["R1"],
    });
    await f.put(
      "docs/product/hidden.md",
      "---\nschema: vnext-product-doc/v4\nitems: [\n---\n",
    );
    expect((await parity(f)).status).toBe("unknown");
    await f.put(
      "docs/product/hidden.md",
      document([{ id: "R1", type: "requirement", scope: "current" }]),
    );
    const duplicate = await parity(f);
    expect(duplicate.status).toBe("unknown");
    expect(duplicate.reasons).toContain("requirement-unavailable:R1");
  });
  it("requires explicit full registered enumeration attestation even for a local selector", async () => {
    const f = await fixture({
      kind: "explicit-requirements",
      requirement_ids: ["R1"],
    });
    for (const mutate of [
      (p: ProductSnapshot) => {
        p.coverage.complete = false;
      },
      (p: ProductSnapshot) => {
        delete p.coverage.registeredPaths;
      },
      (p: ProductSnapshot) => {
        p.coverage.registeredPaths = ["docs/product/ROADMAP.md"];
      },
    ]) {
      const p = await f.read();
      mutate(p);
      const result = reconcileRoadmap(p, { plan_id: "PLAN" });
      expect(result.status).toBe("unknown");
      expect(result.reasons).toContain("enumeration-incomplete");
      expect(result.work_items).toHaveLength(2);
    }
  });
  it("checks baseline and exception sources in the same snapshot and updates after staged evidence reads", async () => {
    const f = await fixture();
    await f.put("evidence/review.txt", "原始核对材料\n");
    f.roadmap.planning_baseline!.sources = [
      {
        kind: "file",
        path: "evidence/review.txt",
        sha256: hash("原始核对材料\n"),
      },
    ];
    await f.savePlan();
    const core = await f.read(true);
    const deferred = core.roadmaps![0];
    expect(deferred.status).toBe("unknown");
    expect(deferred.reasons).toContain("baseline-source-unavailable");
    expect(deferred.work_items).toHaveLength(2);
    expect(
      core.sources.find((s) => s.role === "planning_baseline.sources[0]")
        ?.readState,
    ).toBe("not-read");
    expect((await parity(f)).status).toBe("current");
    await f.put("evidence/review.txt", "变更后的字节\n");
    expect((await parity(f)).reasons).toContain("baseline-source-unavailable");
    f.roadmap.planning_baseline!.sources = [text];
    const d = f.roadmap.planning_baseline!.definitions[0];
    f.roadmap.planning_baseline!.exceptions = [
      {
        target: d.id,
        algorithm: d.algorithm,
        sha256: d.sha256!,
        disposition: "deferred",
        reason: "来源待核对",
        sources: [{ kind: "file", path: "evidence/missing.txt" }],
      },
    ];
    await f.savePlan();
    expect((await parity(f)).status).toBe("unknown");
  });
  it("does not ignore changed whole-file source bytes after a contribution-only edit", async () => {
    const f = await fixture({ kind: "project-current" }, 5);
    const filename = "docs/product/PROJECT.md";
    f.roadmap.planning_baseline!.sources = [
      {
        kind: "file",
        path: filename,
        sha256: hash(await readFile(path.join(f.root, filename))),
      },
    ];
    await f.savePlan();
    expect((await parity(f)).status).toBe("current");
    f.defs.find((i) => i.id === "R1")!.task_bindings = [
      {
        id: "B",
        task: { task_id: null, source: text },
        role: "implementation",
        contribution: "supporting",
        coverage: "支持范围",
        origin: "declared",
        state: "active",
      },
    ];
    await f.saveDefs();
    const result = await parity(f);
    expect(result.status).toBe("unknown");
    expect(result.changes).toEqual([]);
    expect(result.reasons).toContain("baseline-source-unavailable");
  });
  it("keeps plans browseable without baselines and excludes bookkeeping from arrangement hashes", async () => {
    const f = await fixture();
    delete f.roadmap.planning_baseline;
    await f.savePlan();
    const p = await f.read(),
      plan = p.items.find((i) => i.id === "PLAN")!;
    expect(p.roadmaps![0]).toMatchObject({
      status: "unknown",
      reasons: ["baseline-missing", "selector-required"],
    });
    expect(p.roadmaps![0].work_items).toHaveLength(2);
    const before = arrangementSnapshot(plan);
    plan.metadata.work_items![0].sources = [text];
    plan.metadata.sources = [text];
    expect(arrangementSnapshot(plan)).toEqual(before);
    plan.metadata.work_items![0].scope += "新安排";
    expect(arrangementSnapshot(plan)).not.toEqual(before);
  });
  it.each(["empty", "snapshot"])(
    "preserves v1 display data but invalidates derived caches (%s)",
    async (kind) => {
      const f = await fixture(),
        directory = await mkdtemp(
          path.join(os.tmpdir(), "tracelens-cache-v2-"),
        );
      roots.push(directory);
      const before = await files(f.root);
      const legacySnapshot =
        kind === "snapshot"
          ? {
              ...(await buildSnapshot(f.project, "2026-10-14T00:00:00Z")),
              treeFingerprint: "legacy-fingerprint",
            }
          : null;
      const cache = new SnapshotCache(directory);
      await mkdir(path.join(directory, "snapshots"));
      await writeFile(
        path.join(directory, "snapshots", `${f.project.id}.json.gz`),
        gzipSync(
          JSON.stringify({
            version: 1,
            root: f.root,
            configVersion: 1,
            config: configFingerprint(f.project.config),
            snapshot: legacySnapshot,
            files: [
              { path: "docs/product/PROJECT.md", parsed: { legacy: true } },
            ],
          }),
        ),
      );
      const restored = await cache.load(f.project);
      expect(restored).toEqual({
        snapshot: legacySnapshot
          ? { ...legacySnapshot, treeFingerprint: undefined }
          : null,
        files: [],
      });
      expect(restored?.snapshot?.treeFingerprint).toBeUndefined();
      await cache.save(f.project, restored!, () => true);
      expect(await cache.load(f.project)).toEqual(restored);
      expect(await files(f.root)).toEqual(before);
    },
  );
  it("retains production contribution diagnostics and normalized duplicate candidates", async () => {
    const f = await fixture({ kind: "project-current" }, 5);
    const req = f.defs.find((i) => i.id === "R1")!;
    const base = {
      id: "B1",
      task: { task_id: null, source: text },
      role: "implementation",
      coverage: "shared scope",
      origin: "declared" as const,
      state: "active" as const,
    };
    req.task_bindings = [
      {
        ...base,
        origin: "inferred",
        reason: "尚待采纳的明确来源",
        sources: [text],
      },
      {
        ...base,
        id: "B2",
        contribution: "direct",
        coverage: " shared   scope ",
      },
      {
        ...base,
        id: "B3",
        contribution: "supporting",
        task: {
          ...base.task,
          source: { ...text, label: "Other label" } as ProductSource,
          step_id: "different-step",
        },
      },
      { ...base, id: "B4", role: "reference", contribution: "direct" },
      {
        ...base,
        id: "B5",
        state: "dismissed",
        contribution: "supporting",
        role: "reference",
        reason: "retained rejection",
      },
    ];
    await f.saveDefs();
    const p = await f.read();
    expect(p.bindings).toHaveLength(5);
    expect(p.bindings[0].binding.origin).toBe("inferred");
    const codes = p.diagnostics
      .filter((d) => d.itemId === "R1")
      .map((d) => d.code);
    for (const code of [
      "BINDING_CONTRIBUTION_UNCLASSIFIED",
      "BINDING_BASIS_MISSING",
      "BINDING_ROLE_CONTRIBUTION",
      "BINDING_CONTRIBUTION_CONFLICT",
      "DUPLICATE_BINDING_CANDIDATE",
    ])
      expect(codes).toContain(code);
    expect((await parity(f)).status).toBe("current");
  });
  it("preserves old Goal material hashes and reports incomparable context", async () => {
    const f = await fixture();
    const goal = f.defs.splice(
      f.defs.findIndex((i) => i.id === "G"),
      1,
    )[0];
    delete goal.assessment_scopes;
    await f.saveDefs();
    await f.put("docs/product/GOAL.md", document([goal], 2));
    const result = await parity(f);
    expect(result.status).toBe("unknown");
    expect(result.reasons).toContain("goal-format-uncomparable:G");
    expect(result.scope!.context.find((d) => d.id === "G")?.sha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
  it("keeps invalid current scope declarations unknown while preserving production material hashes", async () => {
    const f = await fixture();
    const goal = f.defs.find((i) => i.id === "G")!;
    goal.assessment_scopes!.push({ ...goal.assessment_scopes![0] });
    await f.saveDefs();
    const result = await parity(f);
    expect(result.status).toBe("unknown");
    expect(result.reasons).toContain("scope-relations-invalid");
  });
});
