import type {
  ProductBindingView,
  ProductItem,
  ProductSnapshot,
  ProductWorkItem,
} from "./product-types.js";
import type { RuntimeStep, RuntimeView } from "./runtime-types.js";
import type { Snapshot } from "./types.js";
import {
  contributionDiagnostics,
  contributionLabel,
} from "./product-contribution.js";
import { overviewAssessmentRecords } from "./overview-model.js";

export interface ActivityEvidence {
  bindingKey: string;
  ownerKey: string;
  ownerId: string;
  ownerTitle: string;
  contribution?: "direct" | "supporting";
  role: string;
  coverage: string;
  label: string;
  stepId?: string;
  stepState?: string;
  executionRef?: string;
  issues: string[];
}
export interface CurrentWork {
  taskId: string | null;
  taskKey?: string;
  title?: string;
  lifecycle?: string;
  detailState: "available" | "not-read" | "unavailable";
  source: RuntimeView["source"];
  freshness: RuntimeView["freshness"];
  complete: boolean;
  readAt?: string;
  queryReadAt?: string;
  viewRevision: string | null;
  batchId?: string;
  activityEvidence: ActivityEvidence[];
  bindingCount: number;
  reasons: string[];
}
export interface ConfirmedOutcome {
  requirementKey: string;
  requirementId: string;
  requirementTitle: string;
  reportKey: string;
  reportId: string;
  conclusion: "satisfied" | "partially-satisfied";
  scopeId: string;
  coverage: string;
  goalId: string;
  subject: NonNullable<ProductItem["metadata"]["subject"]>;
  checkedAt?: string;
}
export interface RoadmapSummary {
  planKey: string;
  planId: string;
  title: string;
  intentState?: string;
  status: "current" | "changes-pending" | "reviewed-deferred" | "unknown";
  reasons: string[];
  changeCount: number;
  totalWorkItems: number | null;
  readable: boolean;
  currentWorkItemIds: string[];
  location: "current-task-binding" | "unlocated" | "ambiguous";
  workItems: ProductWorkItem[];
  earlierPrerequisites: ProductWorkItem[];
}
function step(value: unknown): RuntimeStep | undefined {
  if (!value || typeof value !== "object") return;
  const candidate = value as RuntimeStep;
  return typeof candidate.id === "string" && typeof candidate.state === "string"
    ? candidate
    : undefined;
}
/** Only exact same-batch Task/Step facts can describe a recorded binding's activity. */
export function currentWork(snapshot: Snapshot): CurrentWork {
  const runtime = snapshot.runtime;
  const result: CurrentWork = {
    taskId: runtime?.currentTaskId || null,
    detailState: "unavailable",
    source: runtime?.source || "unavailable",
    freshness: runtime?.freshness || "stale-or-unknown",
    complete: runtime?.complete || false,
    readAt: runtime?.source !== "unavailable" ? runtime?.readAt : undefined,
    queryReadAt:
      runtime?.source !== "unavailable" ? runtime?.queryReadAt : undefined,
    viewRevision: runtime?.viewRevision || null,
    batchId: runtime?.source !== "unavailable" ? runtime?.batchId : undefined,
    activityEvidence: [],
    bindingCount: 0,
    reasons: [],
  };
  if (!runtime || runtime.source === "unavailable")
    result.reasons.push("Runtime 来源暂不可用，无法确认当前焦点");
  if (runtime?.freshness !== "queried")
    result.reasons.push("当前性待核对，保留原读取时间与快照事实");
  if (runtime && !runtime.complete)
    result.reasons.push("Task 读取未完整，未读不等于没有工作");
  if (!result.taskId) return result;
  const rows =
    snapshot.product?.bindings.filter(
      (row) =>
        row.binding.state === "active" &&
        row.binding.task.task_id === result.taskId,
    ) || [];
  result.bindingCount = rows.length;
  const matching =
    runtime?.tasks.filter((task) => task.task_id === result.taskId) || [];
  if (matching.length !== 1) {
    result.detailState = "not-read";
    result.reasons.push(
      matching.length > 1 ? "当前 Task 身份冲突" : "已知当前焦点，详情尚未读取",
    );
    result.activityEvidence = rows.slice(0, 12).map((row) => {
      const owner = snapshot.product?.items.find(
        (item) => item.key === row.ownerKey,
      );
      return {
        bindingKey: row.key,
        ownerKey: row.ownerKey,
        ownerId: owner?.id || row.ownerKey,
        ownerTitle: owner?.title || row.ownerKey,
        contribution: row.binding.contribution,
        role: row.binding.role,
        coverage: row.binding.coverage,
        label: "已读取范围关联，当前 Task 详情尚未读取",
        issues: [
          row.match.detail,
          ...(contributionDiagnostics(snapshot.product?.bindings || []).get(
            row.key,
          ) || []),
        ],
      };
    });
    return result;
  }
  const task = matching[0];
  const projected = snapshot.tasks.filter(
    (entry) =>
      entry.realTaskId === task.task_id &&
      entry.runtimeBatchId === runtime?.batchId,
  );
  result.taskKey = projected.length === 1 ? projected[0].id : undefined;
  result.title = typeof task.title === "string" ? task.title : task.task_id;
  result.lifecycle = task.lifecycle;
  result.detailState = "available";
  const issues = contributionDiagnostics(snapshot.product?.bindings || []);
  for (const row of rows.slice(0, 12)) {
    const owner = snapshot.product?.items.find(
      (item) => item.key === row.ownerKey,
    );
    const ref = row.binding.task;
    const candidates =
      task.steps?.filter((entry) => entry.id === ref.step_id) || [];
    const current = step(task.current_step);
    if (!candidates.length && current && current.id === ref.step_id)
      candidates.push(current);
    const exact = candidates.length === 1 ? candidates[0] : undefined;
    const planMatches =
      typeof task.adopted_plan_ref === "string" &&
      ref.plan_ref === task.adopted_plan_ref;
    const executionRef =
      exact && typeof exact.execution_ref === "string" && exact.execution_ref
        ? exact.execution_ref
        : undefined;
    const rowIssues = [...(issues.get(row.key) || [])];
    if (row.match.state !== "matched") rowIssues.push(row.match.detail);
    let label =
      task.lifecycle === "active"
        ? "有关联的活动 Task；具体范围是否开始待核对"
        : "已记录 Task 关联，范围执行待核对";
    if (row.binding.contribution === "supporting")
      label = "相关支撑工作，不推定该需求开始或满足";
    if (
      row.binding.contribution === "direct" &&
      !rowIssues.length &&
      row.binding.origin === "declared" &&
      planMatches &&
      executionRef
    )
      label = `已记录${contributionLabel(row.binding)}步骤执行；不等于需求满足`;
    else if (
      row.binding.contribution === "direct" &&
      !rowIssues.length &&
      row.binding.origin === "declared" &&
      exact?.state === "not-started" &&
      planMatches
    )
      label = `已安排${contributionLabel(row.binding)}任务，对应步骤尚未开始`;
    if (row.binding.origin === "inferred") rowIssues.push("推断关联尚未采纳");
    result.activityEvidence.push({
      bindingKey: row.key,
      ownerKey: row.ownerKey,
      ownerId: owner?.id || row.ownerKey,
      ownerTitle: owner?.title || row.ownerKey,
      contribution: row.binding.contribution,
      role: row.binding.role,
      coverage: row.binding.coverage,
      label,
      stepId: exact?.id,
      stepState: exact?.state,
      executionRef,
      issues: rowIssues,
    });
  }
  return result;
}
/** Recent means checked_at ordering, never inferred completion time or latest-report selection. */
export function confirmedOutcomes(product: ProductSnapshot | undefined): {
  total: number;
  items: ConfirmedOutcome[];
} {
  const outcomes: ConfirmedOutcome[] = [];
  for (const requirement of product?.items || []) {
    if (
      !requirement.usable ||
      !["requirement", "goal"].includes(requirement.type) ||
      requirement.metadata.scope !== "current"
    )
      continue;
    for (const { report, selection } of overviewAssessmentRecords(
      product!,
      requirement,
    )) {
      const m = report.metadata;
      if (
        selection.reasons.length ||
        !["satisfied", "partially-satisfied"].includes(selection.conclusion) ||
        !m.applicability ||
        !m.subject ||
        m.subject.kind === "unknown" ||
        !m.subject.value
      )
        continue;
      outcomes.push({
        requirementKey: requirement.key,
        requirementId: requirement.id,
        requirementTitle: requirement.title,
        reportKey: report.key,
        reportId: report.id,
        conclusion: selection.conclusion as ConfirmedOutcome["conclusion"],
        scopeId: m.applicability.scope_id,
        coverage: m.applicability.coverage,
        goalId: m.applicability.goal_id,
        subject: m.subject,
        checkedAt: m.checked_at,
      });
    }
  }
  const time = (value?: string) => {
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  outcomes.sort((a, b) => {
    const left = time(a.checkedAt),
      right = time(b.checkedAt);
    return (
      (left === right ? 0 : left > right ? -1 : 1) ||
      a.reportKey.localeCompare(b.reportKey)
    );
  });
  return { total: outcomes.length, items: outcomes.slice(0, 6) };
}
function workSummary(work: ProductWorkItem): ProductWorkItem {
  // No sources or complete Product/Task bodies in the overview transport.
  const {
    id,
    title,
    outcome,
    scope,
    targets,
    state,
    origin,
    stage,
    depends_on,
    replaces,
  } = work;
  return {
    id,
    title,
    outcome,
    scope,
    targets,
    state,
    origin,
    stage,
    depends_on,
    replaces,
  };
}
export function roadmapSummaries(
  product: ProductSnapshot | undefined,
  focus: CurrentWork,
): RoadmapSummary[] {
  if (!product) return [];
  const rows: ProductBindingView[] = product.bindings.filter(
    (row) =>
      row.binding.state === "active" &&
      row.binding.origin === "declared" &&
      row.match.state === "matched" &&
      row.binding.task.task_id !== null &&
      row.binding.task.task_id === focus.taskId,
  );
  return product.items
    .filter((plan) => plan.type === "plan")
    .map((plan) => {
      const work =
        plan.usable && Array.isArray(plan.metadata.work_items)
          ? plan.metadata.work_items
          : [];
      const located = [
        ...new Set(
          rows.flatMap((row) =>
            row.planItems
              .filter(
                (ref) => ref.planId === plan.id && ref.state === "resolved",
              )
              .map((ref) => ref.workItemId),
          ),
        ),
      ];
      const current =
        located.length === 1
          ? work.findIndex((item) => item.id === located[0])
          : -1;
      const shown = work.slice(Math.max(0, current), Math.max(0, current) + 3);
      const prerequisites = new Set(
        shown.flatMap((item) =>
          (item.depends_on || [])
            .filter((dependency) => dependency.kind === "prerequisite")
            .map((dependency) => dependency.item_id),
        ),
      );
      const result = product.roadmaps?.find(
        (result) => result.planKey === plan.key,
      );
      return {
        planKey: plan.key,
        planId: plan.id,
        title: plan.title,
        intentState: plan.metadata.intent_state,
        status: plan.usable ? result?.status || "unknown" : "unknown",
        reasons: !plan.usable
          ? ["路线图结构不可用，安排条数未知；原文保留供核对"]
          : result?.reasons || ["路线图核对结果尚不可用"],
        changeCount: result?.changes.length || 0,
        totalWorkItems: plan.usable ? work.length : null,
        readable: plan.usable,
        currentWorkItemIds: located,
        location:
          located.length > 1
            ? "ambiguous"
            : current >= 0
              ? "current-task-binding"
              : "unlocated",
        workItems: shown.map(workSummary),
        earlierPrerequisites: work
          .filter((item) => prerequisites.has(item.id) && !shown.includes(item))
          .map(workSummary),
      };
    });
}
