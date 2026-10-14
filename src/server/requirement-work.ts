import { contributionDiagnostics } from "../shared/product-contribution.js";
import { boundWorkStep, isWorkBinding } from "../shared/overview-progress.js";
import { requirementBindings } from "../shared/product-hierarchy.js";
import type { ProductSnapshot } from "../shared/product-types.js";
import type { RuntimeView } from "../shared/runtime-types.js";
import type { Project } from "../shared/types.js";
import { runtimeBudgets, type RuntimeReader } from "./runtime-reader.js";

/** Read existing execution facts only for precise bindings in the loaded Task page. */
export async function readRequirementWork(
  project: Project,
  product: ProductSnapshot,
  runtime: RuntimeView,
  reader: Pick<RuntimeReader, "detail">,
  isCurrent: () => boolean,
  previous?: RuntimeView,
): Promise<RuntimeView> {
  if (runtime.source !== "runtime-query" || runtime.freshness !== "queried")
    return runtime;
  const issues = contributionDiagnostics(product.bindings);
  const rows = product.items
    .filter(
      (item) =>
        item.usable &&
        item.type === "requirement" &&
        item.metadata.scope === "current",
    )
    .flatMap((item) => requirementBindings(product, item))
    .filter((row) => isWorkBinding(row, issues));
  if (!rows.length) return runtime;
  const tasks = runtime.tasks.map((task) => {
    if (
      task.steps ||
      !runtime.viewRevision ||
      previous?.source !== "runtime-query" ||
      previous.freshness !== "queried" ||
      previous?.viewRevision !== runtime.viewRevision ||
      previous.workflowHome !== runtime.workflowHome
    )
      return task;
    const cached = previous.tasks.filter(
      (entry) => entry.task_id === task.task_id,
    );
    return cached.length === 1 &&
      cached[0].steps &&
      cached[0].adopted_plan_ref === task.adopted_plan_ref &&
      cached[0].lifecycle === task.lifecycle
      ? { ...task, steps: cached[0].steps }
      : task;
  });
  const candidates = tasks.filter(
    (task) =>
      !task.steps &&
      !["draft", "ambiguous"].includes(task.lifecycle) &&
      rows.some(
        (row) =>
          row.binding.task.task_id === task.task_id &&
          row.binding.task.plan_ref === task.adopted_plan_ref &&
          !boundWorkStep(row, task),
      ),
  );
  const deadline = Date.now() + runtimeBudgets.batchMs;
  const diagnostics: string[] = [];
  let next = 0;
  // RuntimeReader enforces its own query concurrency and expected view revision.
  async function readNext(): Promise<void> {
    while (next < candidates.length && isCurrent() && Date.now() < deadline) {
      const task = candidates[next++];
      const detail = await reader.detail(project, runtime, task.task_id);
      if (!isCurrent()) return;
      if (
        detail.status === "available" &&
        detail.task?.task_id === task.task_id &&
        detail.viewRevision === runtime.viewRevision &&
        detail.source === runtime.source &&
        detail.task.adopted_plan_ref === task.adopted_plan_ref &&
        detail.task.lifecycle === task.lifecycle
      ) {
        tasks[tasks.indexOf(task)] = { ...task, ...detail.task };
      } else
        diagnostics.push(
          `${task.task_id}：范围执行事实未能在本批版本核对，保留待核对状态`,
        );
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(runtimeBudgets.concurrency, candidates.length) },
      readNext,
    ),
  );
  if (next < candidates.length)
    diagnostics.push(
      `范围执行读取预算已用尽，${candidates.length - next} 个已绑定 Task 保留待核对状态`,
    );
  return {
    ...runtime,
    tasks,
    diagnostics: [...runtime.diagnostics, ...diagnostics],
  };
}
