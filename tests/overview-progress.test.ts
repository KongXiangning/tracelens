import { expect, it } from "vitest";
import {
  hasRequirementWork,
  requirementWork,
} from "../src/shared/overview-progress";
import type { OverviewRequirement } from "../src/shared/overview-data";
import type { ProductBindingView } from "../src/shared/product-types";
import type { Snapshot } from "../src/shared/types";

function binding(contribution?: "direct" | "supporting"): ProductBindingView {
  return {
    key: "binding",
    ownerKey: "R08",
    binding: {
      id: "binding",
      task: {
        task_id: "task",
        source: { kind: "text", label: "测试依据", text: "identity" },
        plan_ref: "plan",
        step_id: "S1",
      },
      contribution,
      role: "implementation",
      coverage: "specific scope",
      origin: "declared",
      state: "active",
      reason: "implements scope",
      sources: [{ kind: "text", label: "测试依据", text: "scope evidence" }],
    },
    match: {
      state: "matched",
      taskIds: ["ui"],
      task: {
        task_id: "task",
        source: { kind: "text", label: "测试依据", text: "identity" },
      },
      detail: "matched",
    },
    planItems: [],
    repairs: [],
  };
}
function snapshot(row: ProductBindingView): Snapshot {
  return {
    tasks: [
      {
        id: "ui",
        realTaskId: "task",
        number: "TASK-08",
        runtimeLifecycle: "closed",
        runtimeBatchId: "batch",
      },
    ],
    product: { bindings: [row] },
    runtime: {
      source: "runtime-query",
      freshness: "queried",
      currentTaskId: null,
      batchId: "batch",
      tasks: [
        {
          task_id: "task",
          lifecycle: "closed",
          adopted_plan_ref: "plan",
          steps: [{ id: "S1", state: "finished", execution_ref: "executed" }],
        },
      ],
    },
  } as unknown as Snapshot;
}
const requirements = () =>
  Array.from(
    { length: 24 },
    (_, index) =>
      ({ key: `R${index + 1}`, id: `R${index + 1}` }) as OverviewRequirement,
  );

it("shows all actual work including older requirements and hides supporting/unclassified associations", () => {
  const direct = binding("direct");
  const work = requirementWork(snapshot(direct), [direct]);
  expect(work).toMatchObject({ recorded: true, current: false });
  for (const contribution of ["supporting", undefined] as const) {
    const row = binding(contribution);
    expect(requirementWork(snapshot(row), [row]).recorded).toBe(false);
  }
  const items = requirements();
  items[7].work = work;
  items[0].work = work;
  expect(items.filter(hasRequirementWork).map((item) => item.id)).toEqual([
    "R1",
    "R8",
  ]);
  expect(work).not.toHaveProperty("completed");
});
it("does not hide older execution records or include neighbouring/scheduled requirements", () => {
  const items = requirements();
  items[7].work = { current: true, recorded: false, latestTask: "TASK-8" };
  items[19].work = { current: false, recorded: true, latestTask: "TASK-100" };
  expect(items.filter(hasRequirementWork).map((item) => item.id)).toEqual([
    "R8",
    "R20",
  ]);
});
it("hides every card without actual scope evidence instead of previewing the first few", () => {
  expect(requirements().filter(hasRequirementWork)).toEqual([]);
});
it("separates explicit not-started steps from unknown or unadopted evidence", () => {
  const row = binding("direct");
  const value = snapshot(row);
  value.runtime!.tasks[0].steps = [{ id: "S1", state: "not-started" }];
  expect(requirementWork(value, [row])).toMatchObject({
    recorded: false,
    pending: false,
    notStarted: true,
  });
  delete row.binding.task.step_id;
  expect(requirementWork(value, [row])).toMatchObject({
    recorded: false,
    pending: true,
    notStarted: false,
  });
  row.binding.origin = "inferred";
  expect(requirementWork(value, [row]).reasons!.join()).toContain(
    "推断关联尚未采纳",
  );
});
it("keeps drafts, inferred and conflicting classifications out of automatic work evidence", () => {
  const row = binding("direct");
  const value = snapshot(row);
  value.tasks[0].runtimeLifecycle = "draft";
  value.runtime!.tasks[0].lifecycle = "draft";
  expect(requirementWork(value, [row]).recorded).toBe(false);
  value.tasks[0].runtimeLifecycle = "closed";
  value.runtime!.tasks[0].lifecycle = "closed";
  row.binding.origin = "inferred";
  expect(requirementWork(value, [row]).recorded).toBe(false);
  row.binding.origin = "declared";
  value.product!.bindings.push({
    ...row,
    key: "conflicting",
    binding: { ...row.binding, contribution: "supporting" },
  });
  expect(requirementWork(value, [row]).recorded).toBe(false);
});
it("requires precise adopted step scope and does not treat closure or association as execution", () => {
  const row = binding("direct");
  const value = snapshot(row);
  value.runtime!.tasks[0].steps = [{ id: "S1", state: "not-started" }];
  expect(requirementWork(value, [row])).toMatchObject({
    current: false,
    recorded: false,
  });
  value.runtime!.tasks[0].steps![0].state = "finished";
  expect(requirementWork(value, [row]).recorded).toBe(false);
  value.runtime!.tasks[0].steps![0].execution_ref = "executed";
  row.binding.task.step_id = undefined;
  expect(requirementWork(value, [row]).recorded).toBe(false);
  row.binding.task.step_id = "S1";
  row.binding.task.plan_ref = "another-plan";
  expect(requirementWork(value, [row]).recorded).toBe(false);
});
it("only marks the fresh active Task's exact current executed scope as ongoing", () => {
  const row = binding("direct");
  const value = snapshot(row);
  value.tasks[0].runtimeLifecycle = "active";
  value.runtime!.tasks[0].lifecycle = "active";
  value.runtime!.currentTaskId = "task";
  value.runtime!.tasks[0].current_step_id = "S1";
  value.runtime!.tasks[0].steps = [{ id: "S1", state: "not-started" }];
  expect(requirementWork(value, [row])).toMatchObject({
    current: false,
    recorded: false,
  });
  value.runtime!.tasks[0].steps![0] = {
    id: "S1",
    state: "in-progress",
    disposition_ref: "started",
  };
  expect(requirementWork(value, [row])).toMatchObject({
    current: true,
    recorded: true,
  });
  value.runtime!.tasks[0].current_step_id = "S2";
  expect(requirementWork(value, [row])).toMatchObject({
    current: false,
    recorded: true,
  });
  value.runtime!.tasks[0].current_step_id = "S1";
  value.runtime!.freshness = "stale-or-unknown";
  expect(requirementWork(value, [row])).toMatchObject({
    current: false,
    recorded: true,
  });
});
it("consumes summary current_step evidence but never borrows it for another scope", () => {
  const row = binding("direct");
  const value = snapshot(row);
  delete value.runtime!.tasks[0].steps;
  value.runtime!.tasks[0].current_step = {
    id: "S1",
    state: "executed",
    execution_ref: "failed-execution",
    execution_result: "failed",
  };
  expect(requirementWork(value, [row]).recorded).toBe(true);
  row.binding.task.step_id = "S2";
  expect(requirementWork(value, [row]).recorded).toBe(false);
});
it("retains executed duplicate bindings and direct work roles, excluding ambiguous and inferred facts", () => {
  const row = binding("direct");
  const value = snapshot(row);
  const duplicate = structuredClone(row);
  duplicate.key = "duplicate";
  value.product!.bindings.push(duplicate);
  expect(requirementWork(value, [row, duplicate]).recorded).toBe(true);
  for (const role of [
    "implementation",
    "verification",
    "repair",
    "exploration",
  ]) {
    row.binding.role = role;
    expect(requirementWork(value, [row]).recorded).toBe(true);
  }
  value.runtime!.tasks[0].steps![0].state = "ambiguous";
  expect(requirementWork(value, [row]).recorded).toBe(false);
});
it("does not assign another step's execution to an unstarted bound scope", () => {
  const row = binding("direct");
  row.binding.task.step_id = "S2";
  row.binding.task.plan_ref = "plan";
  const value = snapshot(row);
  value.runtime!.tasks[0].adopted_plan_ref = "plan";
  value.runtime!.tasks[0].steps = [
    { id: "S1", state: "finished", execution_ref: "executed" },
    { id: "S2", state: "not-started" },
  ];
  expect(requirementWork(value, [row]).recorded).toBe(false);
});
