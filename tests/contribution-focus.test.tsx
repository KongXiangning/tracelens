import path from "node:path";
import os from "node:os";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSnapshot } from "../src/server/snapshot.js";
import type {
  ProductBindingView,
  ProductItem,
  ProductSnapshot,
} from "../src/shared/product-types.js";
import type { Snapshot } from "../src/shared/types.js";
import {
  contributionDiagnostics,
  contributionSummary,
} from "../src/shared/product-contribution.js";
import {
  currentWork,
  confirmedOutcomes,
  roadmapSummaries,
} from "../src/shared/overview-focus.js";
import { buildOverviewData } from "../src/shared/overview-data.js";
import { CurrentWorkPanel, FocusResults } from "../src/web/overview-focus.js";
import { requirementBindings } from "../src/shared/product-hierarchy.js";
import { buildProductGraph } from "../src/web/product-graph.js";

const source = {
  documentId: "doc",
  path: "docs/PRODUCT.md",
  line: 1,
  section: null,
  digest: "a",
};
function item(
  id: string,
  type: ProductItem["type"] = "requirement",
): ProductItem {
  return {
    version: 5,
    key: id,
    id,
    type,
    title: id,
    metadata: { id, type: type as "requirement", scope: "current" },
    body: "",
    source,
    metadataLine: 1,
    endLine: 2,
    usable: true,
    definitionSha256: null,
    diagnostics: [],
  };
}
function binding(
  key: string,
  owner = "A",
  contribution?: "direct" | "supporting",
  taskId: string | null = "real-task",
): ProductBindingView {
  return {
    key,
    ownerKey: owner,
    binding: {
      id: key,
      task: {
        task_id: taskId,
        source: { kind: "text", text: "captured task", label: "source" },
        plan_ref: "plan-ref",
        step_id: owner,
      },
      role: "implementation",
      contribution,
      coverage: `Scope ${owner}`,
      reason: "Specific scope",
      sources: [{ kind: "text", text: "source material", label: "basis" }],
      origin: "declared",
      state: "active",
    },
    match: {
      task: {
        task_id: taskId,
        source: { kind: "text", text: "task", label: "source" },
      },
      taskIds: taskId ? ["task-key"] : [],
      state: taskId ? "matched" : "identity-unknown",
      detail: "known source",
    },
    planItems: [],
    repairs: [],
  };
}
function snapshot(rows: ProductBindingView[] = []): Snapshot {
  return {
    id: "snapshot",
    projectId: "project",
    configVersion: 1,
    startedAt: "2026-10-14T00:00:00Z",
    completedAt: "2026-10-14T00:00:00Z",
    outcome: "ready",
    documents: [],
    warnings: [],
    tasks: [
      {
        id: "task-key",
        realTaskId: "real-task",
        number: "TASK-001",
        title: "Broad task",
        current: true,
        runtimeLifecycle: "active",
        runtimeBatchId: "batch",
        source,
        statuses: [],
        goals: [],
        steps: [],
        checks: [],
        issues: [],
      },
    ],
    runtime: {
      source: "runtime-query",
      workflowHome: "docs/workflow",
      viewRevision: "revision",
      readAt: "2026-10-14T00:00:00Z",
      freshness: "queried",
      complete: true,
      total: 1,
      batchId: "batch",
      currentTaskId: "real-task",
      tasks: [
        {
          task_id: "real-task",
          title: "Broad task",
          lifecycle: "active",
          adopted_plan_ref: "plan-ref",
          steps: [
            {
              id: "A",
              state: "executed",
              execution_ref: "failed-execution",
              execution_result: "failed",
            },
            { id: "B", state: "not-started" },
          ],
        },
      ],
      diagnostics: [],
      issues: [],
    },
    product: {
      status: "ready",
      manifestPath: ".workflow-system/PRODUCT.yaml",
      manifest: null,
      manifestSource: null,
      workingCopy: "copy",
      coverage: { complete: true, paths: [], omitted: [], excluded: [] },
      items: [item("A"), item("B")],
      bindings: rows,
      relations: [],
      assessments: [],
      sources: [],
      diagnostics: [],
    },
  } as unknown as Snapshot;
}
const context = (value: Snapshot) => ({
  snapshot: value,
  open: () => {},
  openProduct: () => {},
  openTask: () => {},
  relations: () => {},
});
it("counts relationship rows and real identities separately without treating supporting/closed as satisfaction", () => {
  const rows = [
    binding("direct", "A", "direct"),
    binding("support", "B", "supporting"),
    binding("old", "B", undefined, null),
  ];
  const summary = contributionSummary(rows, "A");
  expect(summary).toMatchObject({
    relations: 3,
    direct: 1,
    supporting: 1,
    unclassified: 1,
    uniqueTasks: 1,
    confirmedTasks: 1,
    unconfirmedRelations: 1,
    overlappingTasks: 1,
    ownDirect: 1,
    descendantDirect: 0,
  });
  rows[1].binding.state = "dismissed";
  expect(contributionSummary(rows).relations).toBe(2);
  const value = snapshot(rows);
  value.runtime!.tasks[0].lifecycle = "closed";
  expect(confirmedOutcomes(value.product).items).toEqual([]);
  expect(contributionSummary(rows)).not.toHaveProperty("completed");
});
it("retains conflicts across equivalent coverage and null source display/hash differences without a direct winner", () => {
  const a = binding("a", "A", "direct", null),
    b = binding("b", "A", "supporting", null);
  a.binding.task.source = {
    kind: "file",
    path: "history.md",
    item_id: "TASK",
    note: "old",
    sha256: "a",
  };
  b.binding.task.source = {
    path: "history.md",
    kind: "file",
    sha256: "b",
    note: "new",
    item_id: "TASK",
  };
  b.binding.coverage = " Scope   A ";
  expect(contributionSummary([a, b])).toMatchObject({
    direct: 0,
    supporting: 0,
    conflict: 2,
    uniqueTasks: 0,
  });
  expect(contributionDiagnostics([a, b]).get(a.key)?.join()).toContain(
    "冲突贡献分类",
  );
  a.binding.role = "reference";
  expect(contributionDiagnostics([a]).get(a.key)?.join()).toContain(
    "reference + direct",
  );
});
it("preserves descendant owners and deduplicates shared-DAG Task identities without traversing dependencies", () => {
  const value = snapshot([binding("child", "B", "direct")]);
  value.product!.relations = [
    {
      key: "part",
      ownerKey: "B",
      targetKey: "A",
      resolution: "resolved",
      link: {
        id: "part",
        relation: "part_of",
        target: "A",
        origin: "declared",
        state: "active",
      },
    },
  ];
  const rows = requirementBindings(value.product!, value.product!.items[0]);
  expect(contributionSummary(rows, "A")).toMatchObject({
    ownDirect: 0,
    descendantDirect: 1,
    uniqueTasks: 1,
    owners: [{ ownerKey: "B" }],
  });
  value.product!.relations[0].link.relation = "depends_on";
  expect(requirementBindings(value.product!, value.product!.items[0])).toEqual(
    [],
  );
});
it("attributes only exact executed steps and adopted ranges; failure is activity, not delivery", () => {
  const a = binding("a", "A", "direct"),
    b = binding("b", "B", "direct");
  const value = snapshot([a, b]);
  const work = currentWork(value);
  expect(work.activityEvidence[0].label).toContain("已记录直接实施步骤执行");
  expect(work.activityEvidence[0].executionRef).toBe("failed-execution");
  expect(work.activityEvidence[1].label).toContain("尚未开始");
  a.binding.role = "verification";
  expect(currentWork(value).activityEvidence[0].label).toContain("直接验证");
  a.binding.origin = "inferred";
  expect(currentWork(value).activityEvidence[0].label).not.toContain(
    "已记录直接",
  );
  b.binding.origin = "inferred";
  expect(currentWork(value).activityEvidence[1].label).not.toContain("已安排");
  a.binding.origin = "declared";
  a.binding.task.plan_ref = "different-plan";
  expect(currentWork(value).activityEvidence[0].label).toContain(
    "范围是否开始待核对",
  );
});
it("keeps unbound and unpaged current focus with source age and a browse entrance", () => {
  const value = snapshot();
  expect(currentWork(value)).toMatchObject({
    taskId: "real-task",
    bindingCount: 0,
    taskKey: "task-key",
  });
  value.runtime!.tasks = [];
  value.runtime!.complete = false;
  value.runtime!.source = "memory-snapshot";
  value.runtime!.freshness = "stale-or-unknown";
  const work = currentWork(value);
  expect(work).toMatchObject({
    taskId: "real-task",
    detailState: "not-read",
    complete: false,
  });
  const html = renderToStaticMarkup(
    <CurrentWorkPanel work={work} context={context(value)} />,
  );
  expect(html).toContain("real-task");
  expect(html).toContain("详情尚未读取");
  expect(html).toContain("内存降级快照");
  expect(html).toContain("查看已读取 Task");
});
it("reads arrangements from work_items and keeps multiple adopted plans unresolved", () => {
  const value = snapshot();
  const plan = item("PLAN", "plan");
  plan.metadata.intent_state = "adopted";
  plan.metadata.work_items = ["W20-B", "W06", "W09", "FAR"].map((id) => ({
    id,
    title: id,
    outcome: id,
    scope: id,
    state: "included",
    origin: "initial",
    targets: [{ target: "A", coverage: id }],
  }));
  plan.metadata.work_items[2].depends_on = [
    { item_id: "W20-B", kind: "prerequisite", reason: "explicit prerequisite" },
  ];
  value.product!.items.push(plan);
  const row = binding("plan-binding", "A", "supporting");
  row.planItems = [
    { planId: plan.id, workItemId: "W06", key: "work", state: "resolved" },
  ];
  value.product!.bindings.push(row);
  const summaries = roadmapSummaries(value.product, currentWork(value));
  expect(summaries[0].workItems.map((work) => work.id)).toEqual([
    "W06",
    "W09",
    "FAR",
  ]);
  expect(summaries[0].earlierPrerequisites.map((work) => work.id)).toEqual([
    "W20-B",
  ]);
  expect(summaries[0]).not.toHaveProperty("nextWorkItemId");
  const other = structuredClone(plan);
  other.id = other.key = other.metadata.id = "SECOND";
  value.product!.items.push(other);
  const html = renderToStaticMarkup(
    <FocusResults data={buildOverviewData(value)} context={context(value)} />,
  );
  expect(html).toContain("多份已采用路线图，请选择");
  expect(html).toContain("尚未唯一选定适用路线图");
  expect(html).not.toContain('data-roadmap-plan="PLAN"');
});
it("adds contribution and original owner to graph edges without materializing downstream bindings", () => {
  const value = snapshot([
    binding("a", "A", "direct"),
    binding("b", "B", "supporting"),
  ]);
  const graph = buildProductGraph(value);
  const edges = graph.relations.filter((edge) => edge.kind === "binding");
  expect(edges.map((edge) => edge.label)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("直接实施"),
      expect.stringContaining("间接支撑"),
    ]),
  );
  expect(value.product!.bindings).toHaveLength(2);
});
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("shows applicable scoped outcomes without bindings and excludes stale/conflicting original satisfied reports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tracelens-focus-"));
  roots.push(root);
  await cp(path.resolve("examples/product-scoped"), root, { recursive: true });
  const value = await buildSnapshot(
    {
      id: "fixture",
      name: "fixture",
      root,
      configVersion: 1,
      config: {
        readingMode: "custom",
        autoDiscover: false,
        rules: { management: [], requirements: [], design: [], planning: [] },
        excludes: [],
        product: {
          enabled: true,
          manifestPath: ".workflow-system/PRODUCT.yaml",
        },
      },
    },
    "focus",
  );
  value.product!.bindings = [];
  value.tasks = [];
  const initial = confirmedOutcomes(value.product);
  expect(initial.items.some((outcome) => outcome.reportId === "A-DEMO")).toBe(
    true,
  );
  const report = value.product!.items.find((item) => item.id === "A-DEMO")!;
  const live = value.product!.items.find((item) => item.id === "A-LIVE")!;
  report.metadata.checked_at = "2026-10-14T09:00:00+08:00";
  live.metadata.checked_at = "2026-10-14T08:00:00Z";
  expect(
    confirmedOutcomes(value.product).items.map((outcome) => outcome.reportId),
  ).toEqual(["A-LIVE", "A-DEMO"]);
  report.metadata.checked_at = undefined;
  expect(
    confirmedOutcomes(value.product).items.map((outcome) => outcome.reportId),
  ).toEqual(["A-LIVE", "A-DEMO"]);
  report.metadata.checked_at = "not-a-time";
  expect(
    confirmedOutcomes(value.product).items.map((outcome) => outcome.reportId),
  ).toEqual(["A-LIVE", "A-DEMO"]);

  report.metadata.pending_sources = [
    { kind: "text", text: "counterevidence", label: "new" },
  ];
  expect(
    confirmedOutcomes(value.product).items.some(
      (outcome) => outcome.reportId === report.id,
    ),
  ).toBe(false);
  expect(report.metadata.conclusion).toBe("satisfied");
  report.metadata.pending_sources = [];
  const duplicate = structuredClone(report);
  duplicate.key = "duplicate";
  duplicate.id = duplicate.metadata.id = "DUPLICATE";
  value.product!.items.push(duplicate);
  expect(
    confirmedOutcomes(value.product).items.some((outcome) =>
      [report.id, duplicate.id].includes(outcome.reportId),
    ),
  ).toBe(false);
});
it("degrades an invalid plan to unknown and a raw-document entrance without crashing the overview", () => {
  const value = snapshot();
  const plan = item("BROKEN", "plan");
  plan.usable = false;
  plan.metadata.intent_state = "adopted";
  plan.metadata.work_items = "broken" as unknown as NonNullable<
    typeof plan.metadata.work_items
  >;
  value.product!.items.push(plan);
  expect(roadmapSummaries(value.product, currentWork(value))[0]).toMatchObject({
    status: "unknown",
    readable: false,
    totalWorkItems: null,
    workItems: [],
  });
  const html = renderToStaticMarkup(
    <FocusResults data={buildOverviewData(value)} context={context(value)} />,
  );
  expect(html).toContain("BROKEN");
});
it("does not lose known bindings when current Task is outside the loaded page", () => {
  const value = snapshot([binding("paged", "A", "supporting")]);
  value.runtime!.tasks = [];
  value.runtime!.complete = false;
  const work = currentWork(value);
  expect(work).toMatchObject({
    taskId: "real-task",
    bindingCount: 1,
    activityEvidence: [{ ownerId: "A", contribution: "supporting" }],
  });
  const html = renderToStaticMarkup(
    <CurrentWorkPanel work={work} context={context(value)} />,
  );
  expect(html).not.toContain("未读到需求关联");
  expect(html).toContain("当前 Task 详情尚未读取");
});
it("keeps semantic overview content stable across an unchanged Runtime read epoch", () => {
  const first = snapshot([binding("a", "A", "direct")]);
  const second = structuredClone(first);
  second.id = "new-snapshot";
  second.runtime!.readAt = "2026-10-14T01:00:00Z";
  second.runtime!.queryReadAt = "2026-10-14T01:00:00Z";
  second.runtime!.batchId = "new-batch";
  second.tasks[0].runtimeBatchId = "new-batch";
  expect(buildOverviewData(second)).toEqual(buildOverviewData(first));
  expect(buildOverviewData(second).currentWork).not.toHaveProperty("batchId");
  expect(buildOverviewData(second).currentWork).not.toHaveProperty("readAt");
});
