import type { ProductBindingView } from "./product-types.js";
import type { Snapshot } from "./types.js";
import { contributionDiagnostics } from "./product-contribution.js";
import type { OverviewRequirement } from "./overview-data.js";

export interface RequirementWork {
  current: boolean;
  recorded: boolean;
  latestTask: string;
}

/** Reading priority only: direct work records never become requirement verdicts. */
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
    if (
      binding.state !== "active" ||
      binding.origin !== "declared" ||
      binding.contribution !== "direct" ||
      !["implementation", "repair"].includes(binding.role) ||
      row.match.state !== "matched" ||
      issues.has(row.key)
    )
      continue;
    const tasks = snapshot.tasks.filter(
      (task) =>
        row.match.taskIds.includes(task.id) &&
        task.realTaskId === binding.task.task_id &&
        task.runtimeLifecycle &&
        task.runtimeLifecycle !== "ambiguous",
    );
    if (tasks.length !== 1) continue;
    const task = tasks[0];
    const current =
      snapshot.runtime?.source === "runtime-query" &&
      snapshot.runtime.freshness === "queried" &&
      task.realTaskId === snapshot.runtime.currentTaskId &&
      task.runtimeBatchId === snapshot.runtime.batchId;
    result.current ||= current;
    // Drafts and queued steps have no execution evidence. A closed Task is a work
    // record, not proof that its entire requirement was delivered.
    const runtime = snapshot.runtime?.tasks.filter(
      (entry) => entry.task_id === task.realTaskId,
    );
    const steps = runtime?.length === 1 ? runtime[0].steps || [] : [];
    const relevantSteps = binding.task.step_id
      ? steps.filter(
          (step) =>
            step.id === binding.task.step_id &&
            runtime?.[0].adopted_plan_ref === binding.task.plan_ref,
        )
      : steps;
    const recorded =
      (!binding.task.step_id && task.runtimeLifecycle === "closed") ||
      relevantSteps.some(
        (step) =>
          typeof step.execution_ref === "string" && Boolean(step.execution_ref),
      );
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

export function progressWindow(
  items: OverviewRequirement[],
  requested?: string,
  schedule?: { planId: string; targets: string[] },
) {
  let anchor = items.findIndex((item) => item.key === requested);
  let basis: "selected" | "current" | "recorded" | "schedule" | "unlocated" =
    anchor >= 0 ? "selected" : "unlocated";
  if (anchor < 0) {
    const current = items.filter((item) => item.work?.current);
    const recorded = items.filter((item) => item.work?.recorded);
    const candidates = current.length ? current : recorded;
    const latest = [...candidates].sort((a, b) =>
      (b.work?.latestTask || "").localeCompare(
        a.work?.latestTask || "",
        undefined,
        { numeric: true },
      ),
    )[0];
    if (latest) {
      anchor = items.indexOf(latest);
      basis = current.length ? "current" : "recorded";
    }
  }
  const scheduled = requested
    ? []
    : items.filter((item) => schedule?.targets.includes(item.id));
  if (anchor < 0 && scheduled.length) {
    anchor = items.indexOf(scheduled[0]);
    basis = "schedule";
  }
  const keys = new Set<string>();
  const next = new Set<string>();
  const start = anchor < 0 ? 0 : Math.max(0, anchor - 2);
  const end = anchor < 0 ? 4 : anchor + (scheduled.length ? 1 : 3);
  items.slice(start, end).forEach((item, offset) => {
    keys.add(item.key);
    if (anchor >= 0 && start + offset > anchor) next.add(item.key);
  });
  scheduled.forEach((item) => {
    keys.add(item.key);
    if (item.key !== items[anchor]?.key) next.add(item.key);
  });
  items
    .filter((item) => item.work?.current)
    .forEach((item) => keys.add(item.key));
  return {
    keys,
    next,
    anchor: items[anchor],
    basis,
    planId: scheduled.length ? schedule?.planId : undefined,
  };
}
