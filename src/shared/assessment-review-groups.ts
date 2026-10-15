import type {
  AssessmentReviewCategory,
  AssessmentReviewIssue,
} from "./assessment-review.js";
import type { OverviewReviewRequirement } from "./overview-data.js";
import type { ProductSource } from "./product-types.js";

type ReviewRecord = OverviewReviewRequirement["assessmentRecords"][number];
export const assessmentReviewCategoryLabels: Record<
  AssessmentReviewCategory,
  string
> = {
  "scope-change": "职责或验收范围变化",
  counterevidence: "新增反例",
  "delivery-evidence": "交付证据待汇总",
  "source-change": "来源版本或可用性变化",
  "report-conflict": "报告或处置冲突",
  metadata: "报告字段或依据不完整",
  unclassified: "旧材料未分类",
};

export interface AssessmentReviewGroupMember {
  requirement: Pick<
    OverviewReviewRequirement,
    "key" | "id" | "title" | "scope"
  >;
  record: ReviewRecord;
}

export interface AssessmentReviewGroup {
  key: string;
  category: AssessmentReviewCategory;
  label: string;
  source?: ProductSource;
  changeIds: string[];
  members: AssessmentReviewGroupMember[];
}

/** Notes explain evidence, but do not identify its version or location. */
export function reviewSourceIdentity(source: ProductSource): string {
  if (source.kind === "file")
    return JSON.stringify([
      source.kind,
      source.path,
      source.item_id,
      source.section,
      source.lines?.start,
      source.lines?.end,
      source.sha256,
    ]);
  if (source.kind === "uri") return JSON.stringify([source.kind, source.uri]);
  return JSON.stringify([source.kind, source.label, source.text]);
}

/** Explicit report issues take precedence over selection-wide reason codes. */
export function pendingAssessmentRecords(
  item: OverviewReviewRequirement,
): ReviewRecord[] {
  return item.assessmentRecords.filter((record) => {
    if (record.review) return record.review.issues.length > 0;
    return record.selection.reasons.length > 0;
  });
}

/** Only selector-provided identities establish a shared scope revision. */
function scopeChangeGroupKey(
  item: OverviewReviewRequirement,
  record: ReviewRecord,
  issue: AssessmentReviewIssue,
): string | undefined {
  const change = issue.scopeChange;
  const applicability = record.report.metadata.applicability;
  if (
    issue.code !== "scope-definition-changed" ||
    !change ||
    ![
      change.targetKey,
      change.targetId,
      change.goalKey,
      change.goalId,
      change.scopeId,
      change.recordedCoverage,
      change.currentCoverage,
    ].every((value) => typeof value === "string" && value.length > 0) ||
    change.targetKey !== item.key ||
    change.targetId !== item.id ||
    change.targetId !== record.report.metadata.target ||
    change.goalId !== applicability?.goal_id ||
    change.scopeId !== applicability?.scope_id
  )
    return undefined;
  const normalize = (coverage: string) => coverage.replace(/\r\n|\r/g, "\n");
  if (
    typeof applicability?.coverage !== "string" ||
    normalize(change.recordedCoverage) !== normalize(applicability.coverage)
  )
    return undefined;
  return JSON.stringify([
    issue.category || "unclassified",
    issue.code,
    change.targetKey,
    change.targetId,
    change.goalKey,
    change.goalId,
    change.scopeId,
    normalize(change.recordedCoverage),
    normalize(change.currentCoverage),
  ]);
}

function issueGroupKey(
  item: OverviewReviewRequirement,
  record: ReviewRecord,
  issue: AssessmentReviewIssue,
): string {
  const category = issue.category || "unclassified";
  if (issue.change)
    return JSON.stringify([
      category,
      issue.change.kind,
      reviewSourceIdentity(issue.change.source),
    ]);
  const scopeKey = scopeChangeGroupKey(item, record, issue);
  if (scopeKey) return scopeKey;
  if (/^(target|goal)-definition-/.test(issue.code))
    return JSON.stringify([
      category,
      issue.code,
      issue.code.startsWith("goal-")
        ? record.report.metadata.applicability?.goal_id || item.key
        : item.key,
      issue.comparisons,
    ]);
  // Unidentified material cannot safely be shared with another report.
  return JSON.stringify([category, item.key, record.report.key, issue.code]);
}

function sharedChangeSource(source?: ProductSource): ProductSource | undefined {
  if (!source || source.kind === "text") return source;
  const { note: _note, ...version } = source;
  return version;
}

/** Share the change investigation while retaining every report's local decision. */
export function assessmentReviewGroups(
  items: readonly OverviewReviewRequirement[],
): AssessmentReviewGroup[] {
  const groups = new Map<string, AssessmentReviewGroup>();
  for (const item of items) {
    for (const record of pendingAssessmentRecords(item)) {
      const issues = record.review?.issues;
      const entries = issues
        ? issues.map((issue) => ({
            key: issueGroupKey(item, record, issue),
            category: issue.category || ("unclassified" as const),
            issue,
            code: issue.code,
          }))
        : [...new Set(record.selection.reasons)].map((code) => ({
            key: JSON.stringify(["legacy", item.key, record.report.key, code]),
            category: "unclassified" as const,
            issue: undefined,
            code,
          }));
      for (const { key, category, issue, code } of entries) {
        let group = groups.get(key);
        if (!group) {
          group = {
            key,
            category,
            label: assessmentReviewCategoryLabels[category],
            source: sharedChangeSource(issue?.change?.source),
            changeIds: [],
            members: [],
          };
          groups.set(key, group);
        }
        if (issue?.change?.id && !group.changeIds.includes(issue.change.id))
          group.changeIds.push(issue.change.id);
        let member = group.members.find(
          (entry) =>
            entry.requirement.key === item.key &&
            entry.record.report.key === record.report.key,
        );
        if (!member) {
          member = {
            requirement: {
              key: item.key,
              id: item.id,
              title: item.title,
              scope: item.scope,
            },
            record: {
              ...record,
              selection: { ...record.selection, reasons: [] },
              ...(issues ? { review: { issues: [] } } : {}),
            },
          };
          group.members.push(member);
        }
        if (!member.record.selection.reasons.includes(code))
          member.record.selection.reasons.push(code);
        if (
          issue &&
          !member.record.review!.issues.some(
            (previous) => JSON.stringify(previous) === JSON.stringify(issue),
          )
        )
          member.record.review!.issues.push(issue);
      }
    }
  }
  return [...groups.values()];
}
