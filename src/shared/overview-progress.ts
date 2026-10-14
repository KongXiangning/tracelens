import type { ProductBindingView } from "./product-types.js";
import type { Snapshot } from "./types.js";
import type { RuntimeStep, RuntimeTask } from "./runtime-types.js";
import { contributionDiagnostics } from "./product-contribution.js";
import type { OverviewRequirement } from "./overview-data.js";

export interface RequirementWork {
  current: boolean;
  recorded: boolean;
  latestTask: string;
}
export function isWorkBinding(
  row: ProductBindingView,
  issues: Map<string, string[]>,
): boolean {
  const binding = row.binding;
  return (
    binding.state === "active" &&
    binding.origin === "declared" &&
    binding.contribution === "direct" &&
    ["implementation", "repair", "verification", "exploration"].includes(
      binding.role,
    ) &&
    row.match.state === "matched" &&
    binding.task.task_id !== null &&
    Boolean(binding.task.plan_ref && binding.task.step_id) &&
    !issues.get(row.key)?.some((issue) => !issue.includes("重复关联"))
  );
}
export function boundWorkStep(
  row: ProductBindingView,
  task: RuntimeTask,
): RuntimeStep | undefined {
  if (
    task.task_id !== row.binding.task.task_id ||
    task.adopted_plan_ref !== row.binding.task.plan_ref
  )
    return;
  let steps = task.steps;
  if (!steps && task.current_step && typeof task.current_step === "object") {
    const current = task.current_step as RuntimeStep;
    if (typeof current.id === "string" && typeof current.state === "string")
      steps = [current];
  }
  const matches =
    steps?.filter((step) => step.id === row.binding.task.step_id) || [];
  return matches.length === 1 ? matches[0] : undefined;
}

/** Exact saved scope execution, never Task association/lifecycle or requirement verdicts. */
export function requirementWork(
  snapshot: Snapshot,
  rows: ProductBindingView[],
  issues = contributionDiagnostics(snapshot.product?.bindings || rows),
): RequirementWork {
  const result: RequirementWork = {
    current: false,
    recorded: false,
    latestTask: "",
  };
  for (const row of rows) {
    const binding = row.binding;
    if (!isWorkBinding(row, issues)) continue;
    const tasks = snapshot.tasks.filter(
      (task) =>
        row.match.taskIds.includes(task.id) &&
        task.realTaskId === binding.task.task_id &&
        task.runtimeLifecycle &&
        task.runtimeLifecycle !== "ambiguous",
    );
    if (tasks.length !== 1) continue;
    const task = tasks[0];
    const runtime = snapshot.runtime?.tasks.filter(
      (entry) => entry.task_id === task.realTaskId,
    );
    if (
      runtime?.length !== 1 ||
      runtime[0].adopted_plan_ref !== binding.task.plan_ref ||
      runtime[0].lifecycle === "draft" ||
      runtime[0].lifecycle === "ambiguous" ||
      runtime[0].lifecycle !== task.runtimeLifecycle
    )
      continue;
    const step = boundWorkStep(row, runtime[0]);
    if (!step) continue;
    if (["ambiguous", "legacy-state"].includes(step.state)) continue;
    const recorded =
      (typeof step.execution_ref === "string" &&
        Boolean(step.execution_ref.trim())) ||
      (step.state === "in-progress" &&
        typeof step.disposition_ref === "string" &&
        Boolean(step.disposition_ref.trim()));
    const current =
      recorded &&
      snapshot.runtime?.source === "runtime-query" &&
      snapshot.runtime.freshness === "queried" &&
      task.realTaskId === snapshot.runtime.currentTaskId &&
      task.runtimeBatchId === snapshot.runtime.batchId &&
      task.runtimeLifecycle === "active" &&
      runtime[0].lifecycle === "active" &&
      runtime[0].current_step_id === step.id &&
      ["in-progress", "executed"].includes(step.state);
    result.current ||= current;
    result.recorded ||= recorded;
    if (
      (current || recorded) &&
      (task.number || "").localeCompare(result.latestTask, undefined, {
        numeric: true,
      }) > 0
    )
      result.latestTask = task.number || "";
  }
  return result;
}

export function hasRequirementWork(item: OverviewRequirement): boolean {
  return Boolean(item.work?.recorded || item.work?.current);
}
