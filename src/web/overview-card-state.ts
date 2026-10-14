import type { OverviewRequirement } from "../shared/overview-data";
import { conclusionLabels } from "../shared/product-view";

type Conclusion = keyof typeof conclusionLabels;
export type ConclusionFilter = Conclusion | "unreported";
export const overviewConclusionOptions: {
  value: ConclusionFilter;
  label: string;
  symbol: string;
}[] = [
  { value: "satisfied", label: "已满足", symbol: "✓" },
  { value: "partially-satisfied", label: "部分满足", symbol: "◐" },
  { value: "not-satisfied", label: "未满足", symbol: "×" },
  { value: "undetermined", label: "尚未判定", symbol: "?" },
  { value: "unreported", label: "无验收记录", symbol: "—" },
];
export const overviewTaskOptions = [
  { value: "all", label: "全部 Task 情况" },
  { value: "associated", label: "有 Task 关联" },
  { value: "unassociated", label: "无 Task 关联" },
  { value: "association-pending", label: "Task 关联待核对" },
  { value: "active", label: "有进行中的 Task" },
  { value: "completed", label: "有已完成的 Task" },
  { value: "closed", label: "有已关闭的 Task" },
  { value: "status-pending", label: "Task 状态待核对" },
] as const;
export type TaskFilter = (typeof overviewTaskOptions)[number]["value"];
export interface OverviewFilters {
  conclusions: ConclusionFilter[];
  reviewOnly: boolean;
  task: TaskFilter;
}
export function defaultOverviewFilters(): OverviewFilters {
  return { conclusions: [], reviewOnly: false, task: "all" };
}
export function overviewFiltersActive(filters: OverviewFilters): boolean {
  return Boolean(
    filters.conclusions.length || filters.reviewOnly || filters.task !== "all",
  );
}
export interface OverviewVerdict {
  conclusion: Conclusion;
  label: string;
  symbol: string;
  count: number;
  review: boolean;
}
export function overviewReportVerdict({
  report,
  selection,
}: OverviewRequirement["assessmentRecords"][number]): OverviewVerdict {
  const review = selection.reasons.length > 0;
  const conclusion = review
    ? report.metadata.conclusion || "undetermined"
    : selection.conclusion;
  return {
    conclusion,
    label: review
      ? `原报告：${conclusionLabels[conclusion]}`
      : conclusionLabels[conclusion],
    symbol: overviewConclusionOptions.find(
      (option) => option.value === conclusion,
    )!.symbol,
    review,
    count: 1,
  };
}
/** Report verdicts and applicability review remain independent signals. */
export function overviewRequirementSignals(item: OverviewRequirement) {
  const verdicts = new Map<string, OverviewVerdict>();
  for (const record of item.assessmentRecords) {
    const original = overviewReportVerdict(record);
    const verdict: OverviewVerdict = original.review
      ? {
          ...original,
          conclusion: "undetermined",
          label: "适用性待核对",
          symbol: "?",
        }
      : original;
    const key = `${verdict.conclusion}:${verdict.review}`;
    const previous = verdicts.get(key);
    verdicts.set(key, {
      ...verdict,
      count: (previous?.count || 0) + 1,
    });
  }
  const verdictList = [...verdicts.values()];
  const conclusions: ConclusionFilter[] = [
    ...new Set(verdictList.map((verdict) => verdict.conclusion)),
  ];
  if (!conclusions.length) conclusions.push("unreported");
  const { taskState } = item;
  const taskKinds: TaskFilter[] = ["all"];
  taskKinds.push(
    taskState.total + taskState.unconfirmed > 0 ? "associated" : "unassociated",
  );
  if (taskState.associationPending > 0) taskKinds.push("association-pending");
  for (const [label, kind] of [
    ["进行中", "active"],
    ["已完成", "completed"],
    ["已关闭", "closed"],
  ] as const) {
    if (
      taskState.states.some((state) => state.label === label && state.count > 0)
    )
      taskKinds.push(kind);
  }
  if (
    taskState.states.some(
      (state) =>
        state.count > 0 &&
        ["状态待核对", "身份未确认", "状态冲突"].includes(state.label),
    )
  )
    taskKinds.push("status-pending");
  return {
    verdicts: verdictList,
    conclusions,
    review: verdictList.some((verdict) => verdict.review),
    taskKinds,
  };
}
export type OverviewSignals = ReturnType<typeof overviewRequirementSignals>;
export function matchesOverviewFilters(
  signals: OverviewSignals,
  filters: OverviewFilters,
): boolean {
  return (
    (!filters.conclusions.length ||
      filters.conclusions.some((conclusion) =>
        signals.conclusions.includes(conclusion),
      )) &&
    (!filters.reviewOnly || signals.review) &&
    signals.taskKinds.includes(filters.task)
  );
}
