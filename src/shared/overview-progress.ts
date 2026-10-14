import type { ProductBindingView } from "./product-types.js";
import type { HistoricalWorkEvidence, Snapshot } from "./types.js";
import type { RuntimeStep, RuntimeTask } from "./runtime-types.js";
import { contributionDiagnostics } from "./product-contribution.js";
import type { OverviewRequirement } from "./overview-data.js";

export interface RequirementWork {
  current: boolean;
  recorded: boolean;
  latestTask: string;
  pending?: boolean;
  notStarted?: boolean;
  reasons?: string[];
  historical?: HistoricalWorkEvidence[];
}
export function isDirectWorkBinding(
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
    !issues.get(row.key)?.some((issue) => !issue.includes("重复关联"))
  );
}
export function isWorkBinding(
  row: ProductBindingView,
  issues: Map<string, string[]>,
): boolean {
  return (
    isDirectWorkBinding(row, issues) &&
    Boolean(row.binding.task.plan_ref && row.binding.task.step_id)
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
    pending: false,
    notStarted: false,
    reasons: [],
    historical: [],
  };
  const active = [
    ...new Map(
      rows
        .filter((row) => row.binding.state === "active")
        .map((row) => [row.key, row]),
    ).values(),
  ];
  const pending = (reason: string) => {
    result.pending = true;
    if (!result.reasons!.includes(reason)) result.reasons!.push(reason);
  };
  let unstarted = 0;
  if (!active.length) pending("尚无已保存的直接范围执行依据，进展无法确认");
  for (const row of active) {
    const binding = row.binding;
    if (binding.contribution === "supporting" || binding.role === "reference")
      continue;
    if (!isDirectWorkBinding(row, issues)) {
      if (binding.origin === "inferred")
        pending("推断关联尚未采纳，进展待核对");
      else pending("关联分类、身份或范围依据不足，不能确认工作进展");
      continue;
    }
    const historical = snapshot.historicalWork?.find(
      (entry) =>
        entry.bindingKey === row.key && entry.taskId === binding.task.task_id,
    );
    if (historical) {
      result.recorded = true;
      result.historical!.push(historical);
      continue;
    }
    if (!isWorkBinding(row, issues)) {
      pending("历史或 Task 级关联缺少可核对的范围执行记录");
      continue;
    }
    const tasks = snapshot.tasks.filter(
      (task) =>
        row.match.taskIds.includes(task.id) &&
        task.realTaskId === binding.task.task_id &&
        task.runtimeLifecycle &&
        task.runtimeLifecycle !== "ambiguous",
    );
    if (tasks.length !== 1) {
      pending("Task 执行事实尚未读取或身份未唯一确认");
      continue;
    }
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
    ) {
      pending("范围采用版本或 Task 执行事实待核对");
      continue;
    }
    const step = boundWorkStep(row, runtime[0]);
    if (!step) {
      pending("尚未读取对应步骤，不能认定未开始");
      continue;
    }
    if (["ambiguous", "legacy-state"].includes(step.state)) {
      pending("步骤状态存在歧义或仅有旧状态摘要");
      continue;
    }
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
    if (!recorded) {
      if (step.state === "not-started") unstarted++;
      else pending("步骤尚无可核对的执行或开始记录");
    }
    if (
      (current || recorded) &&
      (task.number || "").localeCompare(result.latestTask, undefined, {
        numeric: true,
      }) > 0
    )
      result.latestTask = task.number || "";
  }
  if (!result.recorded && !result.current && !result.pending && !unstarted)
    pending("尚无已保存的直接范围执行依据，进展无法确认");
  result.notStarted =
    !result.recorded && !result.current && !result.pending && unstarted > 0;
  return result;
}

export function requirementProgressPending(item: OverviewRequirement): boolean {
  if (item.work?.pending !== undefined) return item.work.pending;
  return !hasRequirementWork(item) && !item.work?.notStarted;
}

export function hasRequirementWork(item: OverviewRequirement): boolean {
  return Boolean(item.work?.recorded || item.work?.current);
}
