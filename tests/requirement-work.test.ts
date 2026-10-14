import { expect, it, vi } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parse, stringify } from "yaml";
import { createApp } from "../src/server/app.js";
import type { RuntimeReader } from "../src/server/runtime-reader.js";
import { readRequirementWork } from "../src/server/requirement-work.js";
import { requirementWork } from "../src/shared/overview-progress.js";
import type {
  ProductBindingView,
  ProductSnapshot,
} from "../src/shared/product-types.js";
import type {
  RuntimeDetail,
  RuntimeTask,
  RuntimeView,
} from "../src/shared/runtime-types.js";
import type { Project, Snapshot } from "../src/shared/types.js";

function binding(key: string, taskId = "bound"): ProductBindingView {
  const task = {
    task_id: taskId,
    plan_ref: "plan",
    step_id: key,
    source: { kind: "text" as const, text: "captured identity", label: "test" },
  };
  return {
    key,
    ownerKey: "requirement",
    planItems: [],
    repairs: [],
    binding: {
      id: key,
      task,
      role: "implementation",
      contribution: "direct",
      coverage: key,
      origin: "declared",
      state: "active",
      reason: "scope mapping",
      sources: [task.source],
    },
    match: {
      task,
      taskIds: [`ui-${taskId}`],
      state: "matched",
      detail: "matched",
    },
  };
}
function product(rows: ProductBindingView[]): ProductSnapshot {
  return {
    items: [
      {
        key: "requirement",
        id: "REQ",
        type: "requirement",
        usable: true,
        metadata: { scope: "current" },
      },
    ],
    bindings: rows,
    relations: [],
  } as unknown as ProductSnapshot;
}
function runtime(): RuntimeView {
  return {
    source: "runtime-query",
    freshness: "queried",
    workflowHome: "docs/workflow",
    viewRevision: "revision",
    readAt: "time",
    complete: true,
    total: 3,
    batchId: "batch",
    currentTaskId: "current",
    diagnostics: [],
    issues: [],
    tasks: [
      { task_id: "bound", lifecycle: "closed", adopted_plan_ref: "plan" },
      {
        task_id: "current",
        lifecycle: "active",
        adopted_plan_ref: "plan",
        current_step_id: "S1",
        current_step: {
          id: "S1",
          state: "executed",
          execution_ref: "current-execution",
        },
      },
      { task_id: "unbound", lifecycle: "closed", adopted_plan_ref: "plan" },
    ],
  };
}
const project = { id: "test", root: "test", configVersion: 1 } as Project;
const detail = (task: RuntimeTask): RuntimeDetail => ({
  status: "available",
  task,
  viewRevision: "revision",
  source: "runtime-query",
});

it("publishes exact execution facts through the saved PRODUCT parser and no-change refresh path", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "tracelens-scope-work-"),
  );
  const root = path.join(directory, "observed");
  await cp(path.resolve("examples/product-contribution"), root, {
    recursive: true,
  });
  const filename = path.join(root, "docs/product/REQUIREMENTS.md");
  const raw = await readFile(filename, "utf8");
  const end = raw.indexOf("\n---", 4);
  const saved = parse(raw.slice(4, end));
  saved.items[0].task_bindings[0].task.plan_ref = "plan";
  saved.items[0].task_bindings[0].task.step_id = "S1";
  const input = `---\n${stringify(saved)}---${raw.slice(end + 4)}`;
  await writeFile(filename, input);
  const app = await createApp({ dataDir: path.join(directory, "registry") });
  try {
    const project = await app.registry.add({
      name: "test",
      root,
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
    });
    const reader = (app.store as unknown as { reader: RuntimeReader }).reader;
    const view = runtime();
    view.tasks = [
      {
        task_id: "TASK-SAMPLE-PARSER",
        lifecycle: "closed",
        adopted_plan_ref: "plan",
        display_id: "TASK-001",
      },
    ];
    view.total = 1;
    view.currentTaskId = null;
    vi.spyOn(reader, "refresh").mockImplementation(async () =>
      structuredClone(view),
    );
    let executed = true;
    const readDetail = vi
      .spyOn(reader, "detail")
      .mockImplementation(async () => ({
        ...detail({
          ...view.tasks[0],
          steps: [
            {
              id: "S1",
              state: executed ? "finished" : "not-started",
              ...(executed ? { execution_ref: "saved-execution" } : {}),
            },
          ],
        }),
        viewRevision: view.viewRevision,
      }));
    const first = (await app.store.refresh(project.id)).snapshot!;
    expect(first.product!.bindings[0].match.state).toBe("matched");
    const overview = app.store.overview(project.id).snapshot!;
    expect(
      overview.overview!.planned.find((item) => item.id === "REQ-INPUT")!.work!
        .recorded,
    ).toBe(true);
    expect(
      overview.overview!.planned.find((item) => item.id === "REQ-TENANT")!.work!
        .recorded,
    ).toBe(false);
    expect(readDetail).toHaveBeenCalledTimes(1);
    view.batchId = "new-batch";
    view.readAt = "new-time";
    const repeated = (await app.store.refresh(project.id)).snapshot!;
    expect(repeated.metrics!.filesRead).toBe(0);
    expect(readDetail).toHaveBeenCalledTimes(1);
    expect(app.store.overview(project.id).snapshot!.revision).toBe(
      overview.revision,
    );
    executed = false;
    view.viewRevision = "changed-revision";
    await app.store.refresh(project.id);
    expect(readDetail).toHaveBeenCalledTimes(2);
    expect(
      app.store
        .overview(project.id)
        .snapshot!.overview!.planned.find((item) => item.id === "REQ-INPUT")!
        .work!.recorded,
    ).toBe(false);
    expect(await readFile(filename, "utf8")).toBe(input);
  } finally {
    await app.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("reads only precise current requirement bindings and deduplicates Task detail queries", async () => {
  const rows = [binding("S1"), binding("S2"), binding("S1", "current")];
  rows[2].key = "current-binding";
  const support = binding("support", "unbound");
  support.binding.contribution = "supporting";
  rows.push(support);
  const view = runtime();
  const reader = {
    detail: vi.fn(async () =>
      detail({
        ...view.tasks[0],
        steps: [
          { id: "S1", state: "finished", execution_ref: "completed-scope" },
          { id: "S2", state: "not-started" },
        ],
      }),
    ),
  };
  const observed = await readRequirementWork(
    project,
    product(rows),
    view,
    reader,
    () => true,
  );
  expect(reader.detail).toHaveBeenCalledTimes(1);
  expect(reader.detail).toHaveBeenCalledWith(project, view, "bound");
  expect(view.tasks[0].steps).toBeUndefined();
  const snapshot = {
    runtime: observed,
    product: product(rows),
    tasks: observed.tasks.map((task) => ({
      id: `ui-${task.task_id}`,
      realTaskId: task.task_id,
      runtimeLifecycle: task.lifecycle,
      runtimeBatchId: "batch",
    })),
  } as Snapshot;
  expect(requirementWork(snapshot, [rows[0]])).toMatchObject({
    recorded: true,
    current: false,
  });
  expect(requirementWork(snapshot, [rows[1]])).toMatchObject({
    recorded: false,
    current: false,
  });
  expect(requirementWork(snapshot, [rows[2]])).toMatchObject({
    recorded: true,
    current: true,
  });
});
it("reuses same-version facts and invalidates them when the Runtime revision changes", async () => {
  const view = runtime();
  const previous = structuredClone(view);
  previous.tasks[0].steps = [
    { id: "S1", state: "finished", execution_ref: "old-execution" },
  ];
  const reader = { detail: vi.fn(async () => detail(previous.tasks[0])) };
  const observed = await readRequirementWork(
    project,
    product([binding("S1")]),
    view,
    reader,
    () => true,
    previous,
  );
  expect(observed.tasks[0].steps).toEqual(previous.tasks[0].steps);
  expect(reader.detail).not.toHaveBeenCalled();
  view.viewRevision = "new-revision";
  const changed = await readRequirementWork(
    project,
    product([binding("S1")]),
    view,
    reader,
    () => true,
    previous,
  );
  expect(reader.detail).toHaveBeenCalledTimes(1);
  expect(changed.tasks[0].steps).toBeUndefined();
  expect(changed.diagnostics.join()).toContain("保留待核对状态");
});
it("does not upgrade stale fallback detail into current query evidence through cache reuse", async () => {
  const view = runtime();
  const previous = structuredClone(view);
  previous.source = "file-snapshot";
  previous.freshness = "stale-or-unknown";
  previous.tasks[0].steps = [
    { id: "S1", state: "finished", execution_ref: "unverified-fallback" },
  ];
  const reader = {
    detail: vi.fn(async () => ({
      status: "unavailable" as const,
      source: "runtime-query" as const,
      viewRevision: "revision",
    })),
  };
  const observed = await readRequirementWork(
    project,
    product([binding("S1")]),
    view,
    reader,
    () => true,
    previous,
  );
  expect(reader.detail).toHaveBeenCalledTimes(1);
  expect(observed.tasks[0].steps).toBeUndefined();
});
it("does not query inferred, unclassified, conflicting, broad or retired scope associations", async () => {
  const broad = binding("broad");
  delete broad.binding.task.step_id;
  const inferred = binding("inferred");
  inferred.binding.origin = "inferred";
  const old = binding("old");
  delete old.binding.contribution;
  const a = binding("conflict");
  const b = structuredClone(a);
  b.key = "other";
  b.binding.contribution = "supporting";
  const p = product([broad, inferred, old, a, b]);
  const reader = { detail: vi.fn(async () => detail(runtime().tasks[0])) };
  await readRequirementWork(project, p, runtime(), reader, () => true);
  expect(reader.detail).not.toHaveBeenCalled();
  p.bindings = [binding("S1")];
  p.items[0].metadata.scope = "retired";
  await readRequirementWork(project, p, runtime(), reader, () => true);
  expect(reader.detail).not.toHaveBeenCalled();
});
it.each(["source", "plan", "identity", "lifecycle"])(
  "rejects detail from another %s without inventing progress",
  async (mismatch) => {
    const view = runtime();
    const result = detail({
      ...view.tasks[0],
      steps: [{ id: "S1", state: "finished", execution_ref: "executed" }],
    });
    if (mismatch === "source") result.source = "file-snapshot";
    if (mismatch === "plan") result.task!.adopted_plan_ref = "another-plan";
    if (mismatch === "identity") result.task!.task_id = "another-task";
    if (mismatch === "lifecycle") result.task!.lifecycle = "active";
    const observed = await readRequirementWork(
      project,
      product([binding("S1")]),
      view,
      { detail: vi.fn(async () => result) },
      () => true,
    );
    expect(observed.tasks[0].steps).toBeUndefined();
  },
);
it("does not query or publish new detail in stale or cancelled contexts", async () => {
  const view = runtime();
  const reader = { detail: vi.fn(async () => detail(view.tasks[0])) };
  await readRequirementWork(
    project,
    product([binding("S1")]),
    view,
    reader,
    () => false,
  );
  expect(reader.detail).not.toHaveBeenCalled();
  view.source = "file-snapshot";
  view.freshness = "stale-or-unknown";
  expect(
    await readRequirementWork(
      project,
      product([binding("S1")]),
      view,
      reader,
      () => true,
    ),
  ).toBe(view);
  expect(reader.detail).not.toHaveBeenCalled();
});
