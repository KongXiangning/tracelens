import { describe, expect, it } from "vitest";
import {
  buildProductIndex,
  productWorkItemKey,
} from "../src/server/product-index.js";
import { parseInput } from "../src/server/parser.js";
import type { Task } from "../src/shared/types.js";
import type {
  ProductBinding,
  ProductItem,
  ProductMetadata,
  ProductSnapshot,
  ProductSource,
  ProductSourceCheck,
  ProductWorkItem,
} from "../src/shared/product-types.js";

const source = (path = "docs/product.md", line = 1) => ({
  documentId: `doc:${path}`,
  path,
  line,
  digest: "actual-file-digest",
  section: null,
});
function item(
  id: string,
  type: ProductItem["type"],
  metadata: Partial<ProductMetadata> = {},
  filename = "docs/product.md",
): ProductItem {
  return {
    key: `/workcopy:project:${id}`,
    id,
    type,
    title: id,
    metadata: { id, type: type as ProductMetadata["type"], ...metadata },
    body: `## [${id}] ${id}\n`,
    source: source(filename),
    endLine: 30,
    metadataLine: 2,
    usable: true,
    definitionSha256: type === "requirement" ? "definition-digest" : null,
    diagnostics: [],
  };
}
function product(items: ProductItem[]): ProductSnapshot {
  return {
    status: "ready",
    manifestPath: ".workflow-system/PRODUCT.yaml",
    manifest: {
      schema: "vnext-product-manifest/v2",
      project_id: "project",
      entry: "docs/product.md",
      managed_paths: ["docs/*.md"],
      source_paths: ["TASKS/**"],
      exclude_paths: [],
      maintenance: "enabled",
    },
    manifestSource: null,
    items: [item("PROJECT", "project"), ...items],
    relations: [],
    bindings: [],
    assessments: [],
    sources: [],
    diagnostics: [],
    coverage: {
      complete: true,
      paths: ["docs/product.md"],
      omitted: [],
      excluded: [],
    },
    workingCopy: "/workcopy",
  };
}
function binding(
  id = "B",
  taskId: string | null = "task-real",
  file = "TASKS/task.md",
): ProductBinding {
  return {
    id,
    task: { task_id: taskId, source: { kind: "file", path: file } },
    role: "implementation",
    coverage: "指定需求范围",
    origin: "declared",
    state: "active",
  };
}
function task(
  id = "task-real",
  filename = "TASKS/task.md",
  status = "active",
): Task {
  const location = source(filename, 4);
  return {
    id: `ui:${filename}`,
    realTaskId: id,
    identitySources: [location],
    number: "TASK-811",
    title: "Task",
    current: filename.endsWith("CURRENT_TASK.md"),
    source: location,
    statuses: [{ text: status, checked: null, source: location }],
    goals: [],
    steps: [],
    checks: [],
    issues: [],
  };
}
function checked(
  p: ProductSnapshot,
  owner: ProductItem,
  reference: ProductSource,
  overrides: Partial<ProductSourceCheck> = {},
) {
  p.sources.push({
    id: `source:${p.sources.length}`,
    ownerKey: owner.key,
    role: "task_bindings.task.source",
    reference,
    readState: "read",
    locationState: "located",
    byteState: "unknown",
    source: reference.kind === "file" ? source(reference.path) : null,
    endLine: 30,
    detail: "已读取",
    ...overrides,
  });
}
function work(
  id: string,
  overrides: Partial<ProductWorkItem> = {},
): ProductWorkItem {
  return {
    id,
    title: id,
    outcome: "预期产出",
    scope: "指定范围",
    targets: [{ target: "R", coverage: "指定范围" }],
    state: "included",
    origin: "initial",
    ...overrides,
  };
}
const codes = (p: ProductSnapshot) => p.diagnostics.map((d) => d.code);

describe("PRODUCT task identity and provenance", () => {
  it("matches true ID rather than display number, retaining complete multi-task and repair metadata", () => {
    const a = binding("A");
    const repair = {
      ...binding("R", "task-repair", "TASKS/repair.md"),
      role: "repair",
      origin: "inferred" as const,
      reason: "反馈指向旧范围",
      sources: [{ kind: "text" as const, label: "依据", text: "反馈" }],
      repairs: [
        {
          task: a.task,
          coverage: "修复原 A 的部分范围",
          sources: [{ kind: "text" as const, label: "报告", text: "失败样例" }],
        },
      ],
      plan_items: [{ plan_id: "P", work_item_id: "W" }],
    };
    const r = item("R", "requirement", {
      scope: "current",
      task_bindings: [a, repair],
    });
    const p = product([
      r,
      item("P", "plan", {
        intent_state: "adopted",
        targets: [{ target: "R", coverage: "范围" }],
        work_items: [work("W")],
      }),
    ]);
    checked(p, r, a.task.source);
    checked(p, r, repair.task.source);
    buildProductIndex(p, [task(), task("task-repair", "TASKS/repair.md")]);
    expect(p.bindings.map((view) => view.match.state)).toEqual([
      "matched",
      "matched",
    ]);
    expect(p.bindings[1].binding).toEqual(repair);
    expect(p.bindings[1].repairs[0]).toMatchObject({
      coverage: "修复原 A 的部分范围",
      match: { state: "matched", taskIds: ["ui:TASKS/task.md"] },
    });
    expect(p.bindings[1].planItems[0].key).toBe(
      productWorkItemKey(p.items.find((i) => i.id === "P")!.key, "W"),
    );
    a.task.task_id = "TASK-811";
    buildProductIndex(p, [task()]);
    expect(p.bindings[0].match).toMatchObject({
      state: "conflict",
      taskIds: [],
    });
  });

  it("keeps null historical identity as a navigable source without inventing a task", () => {
    const b = binding("history", null);
    const r = item("R", "requirement", { task_bindings: [b] });
    const p = product([r]);
    checked(p, r, b.task.source);
    buildProductIndex(p, [task()]);
    expect(p.bindings[0].match).toMatchObject({
      state: "identity-unknown",
      taskIds: [],
      sourceCheckId: "source:0",
    });
    expect(codes(p)).toContain("TASK_ID_UNCONFIRMED");
  });

  it("does not attach an old binding when the same CURRENT_TASK file changes focus", () => {
    const file = "docs/workflow/CURRENT_TASK.md";
    const b = binding("old", "task-old", file);
    const r = item("R", "requirement", { task_bindings: [b] });
    const p = product([r]);
    checked(p, r, b.task.source);
    const current = (id: string) =>
      parseInput("project", {
        path: file,
        kind: "management",
        raw: `<!-- vnext-task-view/v1 -->\n# CURRENT_TASK\n## Current work\n- Task: TASK-811 (${id}) — task\n`,
        digest: id,
        bytes: 200,
        modifiedAt: "now",
      }).task!;
    const old = current("task-old"),
      next = current("task-new");
    expect(next.id).toBe(old.id);
    p.sources[0].source!.digest = old.source.digest;
    buildProductIndex(p, [old]);
    expect(p.bindings[0].match.state).toBe("matched");
    p.sources[0].source!.digest = next.source.digest;
    buildProductIndex(p, [next]);
    expect(p.bindings[0].match).toMatchObject({
      state: "conflict",
      taskIds: [],
    });
  });

  it("requires valid source scope and avoids stale byte, section and line matches", () => {
    const b = binding();
    b.task.source = {
      kind: "file",
      path: "TASKS/task.md",
      lines: { start: 10, end: 20 },
    };
    const r = item("R", "requirement", { task_bindings: [b] });
    const p = product([r]);
    checked(p, r, b.task.source);
    buildProductIndex(p, [task()]);
    expect(p.bindings[0].match.state).toBe("conflict");
    b.task.source = { kind: "file", path: "TASKS/task.md", section: "History" };
    p.sources = [];
    checked(p, r, b.task.source, {
      source: { ...source("TASKS/task.md", 10), section: "History" },
    });
    buildProductIndex(p, [task()]);
    expect(p.bindings[0].match.state).toBe("conflict");
    b.task.source = {
      kind: "file",
      path: "TASKS/task.md",
      sha256: "a".repeat(64),
    };
    p.sources = [];
    checked(p, r, b.task.source, { byteState: "changed" });
    buildProductIndex(p, [task()]);
    expect(p.bindings[0].match.state).toBe("conflict");
    p.sources[0].byteState = "same-bytes";
    p.sources[0].readState = "not-read";
    buildProductIndex(p, [task()]);
    expect(p.bindings[0].match.state).toBe("unresolved");
  });

  it("matches identity inside a resolved parent heading or item, while requiring exact fallback when no range exists", () => {
    const filename = "TASKS/t.md";
    const current = parseInput("project", {
      path: filename,
      kind: "management",
      raw: "# Task document\n## Task information\n- Task ID: real-task\n- Task number: TASK-811\n",
      digest: "same-bytes",
      bytes: 100,
      modifiedAt: "now",
    }).task!;
    const b = binding("B", "real-task", filename);
    b.task.source = { kind: "file", path: filename, section: "Task document" };
    const r = item("R", "requirement", { task_bindings: [b] });
    const p = product([r]);
    checked(p, r, b.task.source, {
      source: {
        ...source(filename),
        section: "Task document",
        digest: "same-bytes",
      },
      endLine: 6,
    });
    buildProductIndex(p, [current]);
    expect(p.bindings[0].match.state).toBe("matched");
    p.sources[0].endLine = 2;
    buildProductIndex(p, [current]);
    expect(p.bindings[0].match.state).toBe("conflict");
    p.sources[0].endLine = undefined;
    buildProductIndex(p, [current]);
    expect(p.bindings[0].match.state).toBe("conflict");
    p.sources[0].source!.section = "Task information";
    buildProductIndex(p, [current]);
    expect(p.bindings[0].match.state).toBe("matched");
    b.task.source = {
      kind: "file",
      path: filename,
      item_id: "HISTORICAL-TASK",
    };
    p.sources = [];
    checked(p, r, b.task.source, {
      source: { ...source(filename), digest: "same-bytes" },
      endLine: 6,
    });
    buildProductIndex(p, [current]);
    expect(p.bindings[0].match.state).toBe("matched");
  });

  it("retains multiple source observations and exposes conflicting document-reported statuses", () => {
    const b = binding();
    const r = item("R", "requirement", { task_bindings: [b] });
    const p = product([r]);
    checked(p, r, b.task.source);
    buildProductIndex(p, [
      task(),
      task("task-real", "TASKS/other.md", "completed"),
    ]);
    expect(p.bindings[0].match).toMatchObject({
      state: "matched",
      taskIds: ["ui:TASKS/task.md", "ui:TASKS/other.md"],
    });
    expect(codes(p)).toContain("TASK_STATUS_CONFLICT");
  });

  it("permits unique binding-declared real ID navigation from a read source but does not call it source-verified", () => {
    const b = binding("B", "task-real", "reports/event.json");
    const r = item("R", "requirement", { task_bindings: [b] });
    const p = product([r]);
    checked(p, r, b.task.source);
    buildProductIndex(p, [task()]);
    expect(p.bindings[0].match.state).toBe("matched");
    expect(p.bindings[0].match.detail).toContain("未独立验证任务身份");
    buildProductIndex(p, [task(), task("task-other", "reports/event.json")]);
    expect(p.bindings[0].match.state).toBe("conflict");
  });

  it("keeps dismissed and duplicate bindings instead of reactivating or folding their scope", () => {
    const b = binding();
    const dismissed = { ...b, state: "dismissed" as const, reason: "用户否定" };
    const r = item("R", "requirement", {
      task_bindings: [b, { ...b }, dismissed],
    });
    const p = product([r]);
    checked(p, r, b.task.source);
    buildProductIndex(p, [task()]);
    expect(p.bindings).toHaveLength(3);
    expect(new Set(p.bindings.map((view) => view.key)).size).toBe(3);
    expect(p.bindings[2].binding.state).toBe("dismissed");
    expect(codes(p)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_BINDING_ID",
        "DUPLICATE_BINDING_CANDIDATE",
      ]),
    );
  });
});

describe("PRODUCT cross-object semantics", () => {
  it("preserves link origin/state while separating target resolution and direction", () => {
    const r = item("R", "requirement", {
      links: [
        {
          id: "L",
          relation: "supports",
          target: "G",
          origin: "declared",
          state: "active",
        },
        {
          id: "L",
          relation: "addresses",
          target: "D",
          origin: "inferred",
          state: "dismissed",
          reason: "错误方向已否定",
          sources: [{ kind: "text", text: "依据", label: "讨论" }],
        },
        {
          id: "BAD",
          relation: "addresses",
          target: "D",
          origin: "declared",
          state: "active",
        },
        {
          id: "MISSING",
          relation: "references",
          target: "none",
          origin: "declared",
          state: "active",
        },
      ],
    });
    const p = product([r, item("G", "goal"), item("D", "design")]);
    buildProductIndex(p, []);
    expect(p.relations.map((relation) => relation.resolution)).toEqual([
      "resolved",
      "invalid-direction",
      "invalid-direction",
      "missing",
    ]);
    expect(p.relations[1].link).toEqual(r.metadata.links![1]);
    expect(codes(p)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_LINK_ID",
        "LINK_DIRECTION",
        "UNRESOLVED_TARGET",
      ]),
    );
  });

  it("does not choose a duplicate current definition or a project entry from another file", () => {
    const a = item("R", "requirement"),
      b = item("R", "requirement", {}, "docs/duplicate.md");
    const p = product([
      a,
      b,
      item("D", "design", {
        links: [
          {
            id: "L",
            relation: "addresses",
            target: "R",
            origin: "declared",
            state: "active",
          },
        ],
      }),
      item("SECOND", "project", {}, "docs/other.md"),
    ]);
    buildProductIndex(p, []);
    expect(a.usable).toBe(false);
    expect(b.usable).toBe(false);
    expect(p.relations[0]).toMatchObject({
      resolution: "ambiguous",
      targetKey: null,
    });
    expect(codes(p)).toEqual(
      expect.arrayContaining(["AMBIGUOUS_ID", "PROJECT_ENTRY"]),
    );
    expect(p.items).toHaveLength(5);
  });

  it("does not treat separate invalid blank IDs as duplicate current identities", () => {
    const a = item("", "unknown"),
      b = item("", "unknown", {}, "docs/broken.md");
    a.usable = false;
    b.usable = false;
    const p = product([a, b]);
    buildProductIndex(p, []);
    expect(codes(p)).not.toContain("AMBIGUOUS_ID");
    expect(p.items).toContain(a);
    expect(p.items).toContain(b);
  });

  it("keeps work order, scoped plan identities and dependency issues without deriving progress", () => {
    const firstWorks = [
      work("W", {
        depends_on: [{ item_id: "X", kind: "order", reason: "arranged" }],
      }),
      work("X", {
        origin: "added",
        state: "withdrawn",
        depends_on: [
          { item_id: "W", kind: "prerequisite", reason: "cycle" },
          { item_id: "MISSING", kind: "order", reason: "missing" },
        ],
        targets: [{ target: "D", coverage: "outside" }],
        replaces: ["W", "MISSING"],
      }),
      work("NONE", { targets: [] }),
    ];
    const one = item("P1", "plan", {
      targets: [{ target: "R", coverage: "range" }],
      work_items: firstWorks,
    });
    const two = item("P2", "plan", {
      targets: [{ target: "R", coverage: "range" }],
      work_items: [work("W")],
    });
    const b = binding();
    b.plan_items = [
      { plan_id: "P1", work_item_id: "W" },
      { plan_id: "P2", work_item_id: "W" },
    ];
    const r = item("R", "requirement", { task_bindings: [b] });
    const p = product([r, one, two, item("D", "design")]);
    buildProductIndex(p, []);
    expect(one.metadata.work_items).toEqual(firstWorks);
    expect(p.bindings[0].planItems.map((ref) => ref.key)).toEqual([
      productWorkItemKey(one.key, "W"),
      productWorkItemKey(two.key, "W"),
    ]);
    expect(codes(p)).toEqual(
      expect.arrayContaining([
        "WORK_DEPENDENCY_CYCLE",
        "WORK_DEPENDENCY_WITHDRAWN",
        "WORK_DEPENDENCY_MISSING",
        "WORK_OUTSIDE_PLAN",
        "TARGET_TYPE",
        "WORK_BASIS_MISSING",
        "WORK_TARGET_UNKNOWN",
        "WORK_REPLACEMENT_MISSING",
        "WORK_REPLACEMENT_ACTIVE",
      ]),
    );
    expect(p.assessments[0].state).toBe("unselected");
  });

  it("refuses ambiguous or dangling plan references while retaining all work definitions", () => {
    const b = binding();
    b.plan_items = [
      { plan_id: "P", work_item_id: "W" },
      { plan_id: "MISSING", work_item_id: "W" },
    ];
    const r = item("R", "requirement", { task_bindings: [b] });
    const plan = item("P", "plan", {
      targets: [{ target: "R", coverage: "range" }],
      work_items: [work("W"), work("W")],
    });
    const p = product([r, plan]);
    buildProductIndex(p, []);
    expect(p.bindings[0].planItems.map((ref) => ref.state)).toEqual([
      "ambiguous",
      "missing",
    ]);
    expect(plan.metadata.work_items).toHaveLength(2);
    expect(codes(p)).toEqual(
      expect.arrayContaining(["DUPLICATE_WORK_ITEM", "BINDING_WORK_ITEM"]),
    );
  });
});

describe("explicitly selected, scoped delivery reports", () => {
  const basis: ProductSource = {
    kind: "file",
    path: "history/requirement.md",
    item_id: "R",
    sha256: "a".repeat(64),
  };
  const assessment = (id = "A", overrides: Partial<ProductMetadata> = {}) =>
    item(id, "assessment", {
      target: "R",
      target_basis: basis,
      target_definition_sha256: "definition-digest",
      subject: { kind: "commit", value: "explicit-commit" },
      implementation: "delivered-reported",
      verification: "pass-reported",
      checked_at: "earlier",
      sources: [{ kind: "file", path: "reports/pass.txt" }],
      ...overrides,
    });

  it("does not auto-select latest PASS and rejects a selected assessment for another requirement", () => {
    const r = item("R", "requirement");
    const p = product([r, assessment()]);
    buildProductIndex(p, []);
    expect(p.assessments[0].state).toBe("unselected");
    r.metadata.assessment_id = "MISSING";
    buildProductIndex(p, []);
    expect(p.assessments[0].state).toBe("missing");
    r.metadata.assessment_id = "A";
    p.items.find((entry) => entry.id === "A")!.metadata.target = "OTHER";
    buildProductIndex(p, []);
    expect(p.assessments[0]).toMatchObject({
      state: "target-mismatch",
      assessmentKey: null,
    });
  });

  it("separates exact historical bytes, current definition and pending counterevidence", () => {
    const r = item("R", "requirement", { assessment_id: "A" });
    const a = assessment("A", {
      pending_sources: [{ kind: "file", path: "reports/new-failure.txt" }],
    });
    const p = product([r, a]);
    checked(p, a, basis, { byteState: "same-bytes" });
    buildProductIndex(p, []);
    expect(p.assessments[0]).toMatchObject({
      state: "selected",
      definitionState: "same",
      historicalState: "verified",
    });
    expect(p.assessments[0].detail).toContain("新材料仍待对账");
    expect(codes(p)).toContain("PENDING_SOURCES");
    r.definitionSha256 = "changed-definition";
    buildProductIndex(p, []);
    expect(p.assessments[0]).toMatchObject({
      definitionState: "changed",
      historicalState: "verified",
    });
    expect(codes(p)).toContain("DEFINITION_CHANGED");
    p.sources[0].byteState = "changed";
    buildProductIndex(p, []);
    expect(p.assessments[0].historicalState).toBe("changed");
    p.sources[0].readState = "not-read";
    buildProductIndex(p, []);
    expect(p.assessments[0].historicalState).toBe("unknown");
    expect(a.metadata.pending_sources).toHaveLength(1);
  });

  it("reports missing evidence and unknown definitions without discarding readable reports", () => {
    const r = item("R", "requirement", { assessment_id: "A" });
    const a = assessment("A", { target_definition_sha256: null, sources: [] });
    const p = product([
      r,
      a,
      item("C", "change", {
        deltas: [{ target: "gone", before: "old", after: null }],
      }),
    ]);
    buildProductIndex(p, []);
    expect(p.assessments[0]).toMatchObject({
      state: "selected",
      definitionState: "unknown",
      historicalState: "unknown",
    });
    expect(codes(p)).toEqual(
      expect.arrayContaining([
        "DEFINITION_UNKNOWN",
        "REPORT_SOURCE_MISSING",
        "CHANGE_TARGET",
      ]),
    );
    expect(a.usable).toBe(true);
  });
});
