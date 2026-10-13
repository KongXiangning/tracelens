import type {
  ProductBinding,
  ProductBindingView,
  ProductSource,
} from "./product-types.js";

export type ContributionClass =
  "direct" | "supporting" | "unclassified" | "conflict";
export const contributionLabels: Record<ContributionClass, string> = {
  direct: "直接贡献",
  supporting: "间接支撑",
  unclassified: "旧分类待核对",
  conflict: "贡献分类冲突",
};
const roles: Record<string, string> = {
  implementation: "实施",
  repair: "修复",
  verification: "验证",
  exploration: "探索",
  reference: "参考",
};
export function contributionLabel(binding: ProductBinding): string {
  if (binding.contribution === "direct")
    return `直接${roles[binding.role] || "贡献"}`;
  return contributionLabels[binding.contribution || "unclassified"];
}
const normalizedCoverage = (value: string) => value.replace(/\s+/g, " ").trim();
function sourceIdentity(source: ProductSource): unknown {
  if (source.kind === "file")
    return [
      "file",
      source.path,
      source.item_id ?? null,
      source.section ?? null,
      source.lines?.start ?? null,
      source.lines?.end ?? null,
    ];
  if (source.kind === "text")
    return ["text", source.text.replace(/\r\n|\r/g, "\n").trim()];
  return ["uri", source.uri];
}
/** Contribution never participates in identity: conflicting classifications stay visible. */
export function contributionDiagnostics(
  rows: ProductBindingView[],
): Map<string, string[]> {
  const issues = new Map<string, string[]>();
  const groups = new Map<string, ProductBindingView[]>();
  const add = (row: ProductBindingView, message: string) =>
    issues.set(row.key, [...(issues.get(row.key) || []), message]);
  for (const row of rows) {
    if (row.binding.state !== "active") continue;
    if (
      row.binding.contribution &&
      (!row.binding.reason?.trim() || !row.binding.sources?.length)
    )
      add(row, "记录的分类缺少理由或来源，当前适用性待核对");
    if (
      row.binding.role === "reference" &&
      row.binding.contribution === "direct"
    )
      add(row, "reference + direct 语义不清，保留原值待核对");
    const task = row.binding.task;
    const identity =
      task.task_id === null
        ? [null, sourceIdentity(task.source)]
        : task.task_id;
    const key = JSON.stringify([
      row.ownerKey,
      identity,
      row.binding.role,
      normalizedCoverage(row.binding.coverage),
    ]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const classes = new Set(
      group.map((row) => row.binding.contribution).filter(Boolean),
    );
    for (const row of group)
      add(
        row,
        classes.size > 1
          ? "相同 owner、Task、role 与覆盖范围存在冲突贡献分类；不择取直接或最新记录"
          : "相同 owner、Task、role 与覆盖范围存在重复关联；关系保留，Task 按身份去重",
      );
  }
  return issues;
}
export interface ContributionSummary {
  relations: number;
  direct: number;
  supporting: number;
  unclassified: number;
  conflict: number;
  uniqueTasks: number;
  confirmedTasks: number;
  unconfirmedRelations: number;
  overlappingTasks: number;
  ownDirect: number;
  descendantDirect: number;
  issueCount: number;
  inferredRelations: number;
  owners: {
    ownerKey: string;
    relations: number;
    direct: number;
    supporting: number;
    unclassified: number;
    conflict: number;
  }[];
}
/** Counts saved relationship rows, never started/completed requirements. */
export function contributionSummary(
  rows: ProductBindingView[],
  ownerKey?: string,
): ContributionSummary {
  const active = [
    ...new Map(
      rows
        .filter((row) => row.binding.state === "active")
        .map((row) => [row.key, row]),
    ).values(),
  ];
  const issues = contributionDiagnostics(active);
  const tasks = new Map<string, Set<ContributionClass>>();
  const confirmed = new Set<string>();
  const owners = new Map<string, ContributionSummary["owners"][number]>();
  const result: ContributionSummary = {
    relations: active.length,
    direct: 0,
    supporting: 0,
    unclassified: 0,
    conflict: 0,
    uniqueTasks: 0,
    confirmedTasks: 0,
    unconfirmedRelations: 0,
    overlappingTasks: 0,
    ownDirect: 0,
    descendantDirect: 0,
    issueCount: issues.size,
    inferredRelations: active.filter((row) => row.binding.origin === "inferred")
      .length,
    owners: [],
  };
  for (const row of active) {
    const invalid = issues
      .get(row.key)
      ?.some(
        (issue) =>
          issue.includes("冲突贡献分类") ||
          issue.includes("reference + direct"),
      );
    const classification: ContributionClass = invalid
      ? "conflict"
      : row.binding.contribution || "unclassified";
    result[classification]++;
    if (classification === "direct") {
      if (!ownerKey || row.ownerKey === ownerKey) result.ownDirect++;
      else result.descendantDirect++;
    }
    const owner = owners.get(row.ownerKey) || {
      ownerKey: row.ownerKey,
      relations: 0,
      direct: 0,
      supporting: 0,
      unclassified: 0,
      conflict: 0,
    };
    owner.relations++;
    owner[classification]++;
    owners.set(row.ownerKey, owner);
    const id = row.binding.task.task_id;
    if (id === null) result.unconfirmedRelations++;
    else {
      const classes = tasks.get(id) || new Set<ContributionClass>();
      classes.add(classification);
      tasks.set(id, classes);
      if (row.match.state === "matched") confirmed.add(id);
    }
  }
  result.uniqueTasks = tasks.size;
  result.confirmedTasks = confirmed.size;
  result.overlappingTasks = [...tasks.values()].filter(
    (classes) => classes.size > 1,
  ).length;
  result.owners = [...owners.values()];
  return result;
}
