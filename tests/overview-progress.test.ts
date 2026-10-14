import { expect, it } from "vitest";
import {
  progressWindow,
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
      tasks: [{ task_id: "task", lifecycle: "closed" }],
    },
  } as unknown as Snapshot;
}
const requirements = () =>
  Array.from(
    { length: 24 },
    (_, index) =>
      ({ key: `R${index + 1}`, id: `R${index + 1}` }) as OverviewRequirement,
  );

it("focuses near 08 without treating supporting or unclassified completed tasks as progress", () => {
  const direct = binding("direct");
  const work = requirementWork(snapshot(direct), [direct]);
  expect(work).toMatchObject({ recorded: true, current: false });
  for (const contribution of ["supporting", undefined] as const) {
    const row = binding(contribution);
    expect(requirementWork(snapshot(row), [row]).recorded).toBe(false);
  }
  const items = requirements();
  items[7].work = work;
  const focus = progressWindow(items);
  expect(focus.anchor?.id).toBe("R8");
  expect([...focus.keys]).toEqual(["R6", "R7", "R8", "R9", "R10"]);
  expect(focus.keys.has("R11")).toBe(false);
  expect(focus).not.toHaveProperty("completed");
});
it("prefers current direct work over a higher numbered historical task and supports a persisted reading anchor", () => {
  const items = requirements();
  items[7].work = { current: true, recorded: false, latestTask: "TASK-8" };
  items[19].work = { current: false, recorded: true, latestTask: "TASK-100" };
  expect(progressWindow(items).anchor?.id).toBe("R8");
  expect(progressWindow(items, "R12")).toMatchObject({
    basis: "selected",
    anchor: { id: "R12" },
  });
  expect(progressWindow(items, "removed").anchor?.id).toBe("R8");
});
it("uses explicit nearby roadmap targets rather than inventing consecutive execution order", () => {
  const items = requirements();
  items[7].work = { current: true, recorded: false, latestTask: "TASK-8" };
  const focus = progressWindow(items, undefined, {
    planId: "PLAN",
    targets: ["R8", "R13", "R16"],
  });
  expect([...focus.next]).toEqual(["R13", "R16"]);
  expect(focus.keys.has("R9")).toBe(false);
  expect(focus.planId).toBe("PLAN");
});
it("keeps drafts, inferred and conflicting classifications out of automatic work evidence", () => {
  const row = binding("direct");
  const value = snapshot(row);
  value.tasks[0].runtimeLifecycle = "draft";
  expect(requirementWork(value, [row]).recorded).toBe(false);
  value.tasks[0].runtimeLifecycle = "closed";
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
