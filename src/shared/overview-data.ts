import {
  contributionSummary,
  contributionDiagnostics,
  type ContributionSummary,
} from "./product-contribution.js";
import {
  currentWork,
  confirmedOutcomes,
  roadmapSummaries,
} from "./overview-focus.js";
import type { Snapshot, SourceRef } from "./types.js";
import type { AssessmentReviewIssue } from "./assessment-review.js";
import { pendingAssessmentRecords } from "./assessment-review-export.js";
import {
  requirementProgress,
  type RequirementWork,
} from "./overview-progress.js";
import type {
  ProductItem,
  ProductMetadata,
  ProductSnapshot,
} from "./product-types.js";
import { productView } from "./product-view.js";
import { assessmentNarrative } from "./requirement-detail.js";
import { requirementBindings } from "./product-hierarchy.js";
import {
  assessmentGroups,
  overviewAssessmentRecords,
  overviewTaskStates,
} from "./overview-model.js";

type Item = Pick<ProductItem, "key" | "id" | "title" | "type">;
export type OverviewReport = Pick<
  ProductItem,
  "key" | "id" | "title" | "usable"
> & {
  source?: SourceRef;
  narrative?: { title: string; text: string }[];
  metadata: Pick<ProductMetadata, "conclusion" | "checked_at" | "target"> & {
    applicability?: Partial<NonNullable<ProductMetadata["applicability"]>>;
    subject?: Partial<NonNullable<ProductMetadata["subject"]>>;
  };
};
export interface OverviewRequirement extends Item {
  work?: RequirementWork;
  description: string;
  contributionSummary?: ContributionSummary;
  taskState: ReturnType<typeof overviewTaskStates>;
  firstTask?: string;
  dependencies: string[];
  childCount: number;
  assessmentRecords: {
    report: OverviewReport;
    selection: {
      conclusion: NonNullable<ProductMetadata["conclusion"]>;
      reasons: string[];
    };
    review?: { issues: AssessmentReviewIssue[] };
  }[];
}
export type OverviewReviewRequirement = Pick<
  OverviewRequirement,
  "key" | "id" | "title" | "assessmentRecords"
> & { scope?: ProductMetadata["scope"] };
export type OverviewAssessmentGroup = Omit<
  ReturnType<typeof assessmentGroups>[number],
  "reports"
> & { reports: OverviewReport[] };
export interface OverviewData {
  ready: boolean;
  productStatus: ProductSnapshot["status"];
  manifestSource?: ProductSnapshot["manifestSource"];
  project?: Item;
  rootGoal?: Item;
  /** Compatibility wire name: registered display order, never a Roadmap. */
  planned: OverviewRequirement[];
  currentWork?: ReturnType<typeof currentWork>;
  confirmedOutcomes?: ReturnType<typeof confirmedOutcomes>;
  roadmapSummary?: ReturnType<typeof roadmapSummaries>;
  contributionSummary?: ContributionSummary;
  unordered: OverviewRequirement[];
  /** All project requirements with review work, independently of card visibility. */
  reviewRequirements?: OverviewReviewRequirement[];
  taskCount: number;
  tasks: Pick<
    Snapshot["tasks"][number],
    "id" | "realTaskId" | "number" | "title"
  >[];
  itemTypes: Record<string, ProductItem["type"]>;
  assessmentGroups: OverviewAssessmentGroup[];
  counts: { documents: number; warnings: number; tasks: number };
}
export type OverviewSnapshot = Pick<
  Snapshot,
  | "id"
  | "projectId"
  | "configVersion"
  | "startedAt"
  | "completedAt"
  | "outcome"
  | "phase"
> & {
  revision: string;
  /** Observation timing is transported outside the stable semantic revision. */
  runtimeObservation?: { readAt: string; queryReadAt?: string };
  overview?: OverviewData;
};
export function isOverviewSnapshot(
  snapshot: Snapshot | OverviewSnapshot,
): snapshot is OverviewSnapshot {
  return "revision" in snapshot;
}
function itemSummary(item: ProductItem): Item {
  return { key: item.key, id: item.id, title: item.title, type: item.type };
}
function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function metadataText(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}
/** Invalid reports retain valid original identity fields, never unchecked objects. */
function reportMetadata(report: ProductItem): OverviewReport["metadata"] {
  const metadata = metadataRecord(report.rawMetadata ?? report.metadata);
  const rawApplicability = metadataRecord(metadata.applicability);
  const rawSubject = metadataRecord(metadata.subject);
  const applicability = {
    goal_id: metadataText(rawApplicability.goal_id),
    scope_id: metadataText(rawApplicability.scope_id),
    coverage: metadataText(rawApplicability.coverage),
  };
  const subject = {
    kind:
      typeof rawSubject.kind === "string" &&
      ["working-copy", "commit", "release", "unknown"].includes(rawSubject.kind)
        ? rawSubject.kind
        : undefined,
    value: rawSubject.value === null ? null : metadataText(rawSubject.value),
    revision: metadataText(rawSubject.revision),
    limitations: metadataText(rawSubject.limitations),
  };
  const conclusion = [
    "satisfied",
    "partially-satisfied",
    "not-satisfied",
    "undetermined",
  ].includes(metadata.conclusion as string)
    ? (metadata.conclusion as ProductMetadata["conclusion"])
    : undefined;
  const checkedAt = metadataText(metadata.checked_at);
  return {
    target: metadataText(metadata.target),
    conclusion,
    applicability: Object.values(applicability).some(
      (value) => value !== undefined,
    )
      ? applicability
      : undefined,
    subject: Object.values(subject).some((value) => value !== undefined)
      ? subject
      : undefined,
    checked_at:
      checkedAt &&
      /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(checkedAt) &&
      Number.isFinite(Date.parse(checkedAt))
        ? checkedAt
        : undefined,
  };
}
function reportSummary(report: ProductItem): OverviewReport {
  return {
    key: report.key,
    id: report.id,
    title: report.title,
    usable: report.usable,
    source: report.source,
    narrative: assessmentNarrative(report),
    metadata: reportMetadata(report),
  };
}
export function requirementDescription(item: ProductItem): string {
  const body = item.body.replace(/\r\n|\r/g, "\n");
  const section = body.split(/^###\s+需求内容\s*$/m)[1] || body;
  const text = section
    .split(/^###\s+/m)[0]
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[`*_>#]/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) return "完整需求范围见原文";
  const firstSentence = text.split(/[。；;.!！?？]/)[0]?.trim() || text;
  const compact = firstSentence.slice(0, 44).trim();
  return compact + (compact.length < firstSentence.length ? "…" : "");
}
const cache = new WeakMap<Snapshot, OverviewData>();
/** The same selectors as detail views run once per snapshot, before transport. */
export function buildOverviewData(snapshot: Snapshot): OverviewData {
  const cached = cache.get(snapshot);
  if (cached) return cached;
  const product = snapshot.product;
  const model = product && productView(product);
  const planned =
    model?.registered.filter((item) => item.metadata.scope === "current") || [];
  const unordered =
    model?.unordered.filter((item) => item.metadata.scope === "current") || [];
  const bindings = new Map(
    [...planned, ...unordered].map((item) => [
      item.key,
      requirementBindings(product!, item),
    ]),
  );
  const contributionIssues = contributionDiagnostics(product?.bindings || []);
  const assessmentRecords = new Map<
    string,
    OverviewRequirement["assessmentRecords"]
  >();
  function requirementAssessments(item: ProductItem) {
    let records = assessmentRecords.get(item.key);
    if (!records) {
      records = overviewAssessmentRecords(product!, item).map(
        ({ report, selection }) => ({
          report: reportSummary(report),
          selection: {
            conclusion: selection.conclusion,
            reasons: selection.reasons,
          },
          ...(selection.reasons.length
            ? {
                review: {
                  issues: (selection.reviewIssues || [])
                    .filter((entry) => entry.reportKey === report.key)
                    .map((entry) => entry.issue),
                },
              }
            : {}),
        }),
      );
      assessmentRecords.set(item.key, records);
    }
    return records;
  }
  function requirement(item: ProductItem): OverviewRequirement {
    const rows = bindings.get(item.key)!;
    return {
      ...itemSummary(item),
      description: requirementDescription(item),
      work: requirementProgress(snapshot, item, rows, contributionIssues),
      contributionSummary: contributionSummary(rows, item.key),
      taskState: overviewTaskStates(snapshot, rows),
      firstTask: rows
        .flatMap((row) => row.match.taskIds)
        .find((id) => snapshot.tasks.some((task) => task.id === id)),
      dependencies: [
        ...new Set(
          product!.relations
            .filter(
              (r) =>
                r.ownerKey === item.key &&
                r.link.relation === "depends_on" &&
                r.link.state === "active" &&
                r.resolution === "resolved",
            )
            .map((r) => r.link.target),
        ),
      ],
      childCount: product!.relations.filter(
        (r) =>
          r.targetKey === item.key &&
          r.link.relation === "part_of" &&
          r.link.state === "active" &&
          r.resolution === "resolved",
      ).length,
      assessmentRecords: requirementAssessments(item),
    };
  }
  const focus = currentWork(snapshot);
  // A new read epoch must not invalidate identical requirement/Task facts.
  // Actual timing travels in the OverviewSnapshot envelope; batch identity is
  // enforced while deriving activity, never used as a content change counter.
  const {
    readAt: _readAt,
    queryReadAt: _queryReadAt,
    batchId: _batchId,
    ...stableFocus
  } = focus;
  const data: OverviewData = {
    currentWork: stableFocus,
    confirmedOutcomes: confirmedOutcomes(product),
    roadmapSummary: roadmapSummaries(product, focus),
    contributionSummary: contributionSummary(product?.bindings || []),
    ready: Boolean(
      product?.manifest &&
      ["ready", "partial", "empty"].includes(product.status),
    ),
    productStatus: product?.status || "disabled",
    manifestSource: product?.manifestSource,
    project: model?.project ? itemSummary(model.project) : undefined,
    rootGoal: model?.rootGoal ? itemSummary(model.rootGoal) : undefined,
    planned: planned.map(requirement),
    unordered: unordered.map(requirement),
    reviewRequirements: (product?.items || [])
      .filter((item) => item.usable && item.type === "requirement")
      .map((item): OverviewReviewRequirement => {
        const summary = {
          key: item.key,
          id: item.id,
          title: item.title,
          scope: item.metadata.scope,
          assessmentRecords: requirementAssessments(item),
        };
        return {
          ...summary,
          assessmentRecords: pendingAssessmentRecords(summary),
        };
      })
      .filter((item) => item.assessmentRecords.length > 0),
    taskCount: overviewTaskStates(snapshot, [
      ...new Map(
        [...planned, ...unordered]
          .flatMap((item) => bindings.get(item.key)!)
          .map((row) => [row.key, row]),
      ).values(),
    ]).total,
    tasks: snapshot.tasks.map(({ id, realTaskId, number, title }) => ({
      id,
      realTaskId,
      number,
      title,
    })),
    itemTypes: Object.fromEntries(
      (product?.items || []).map((item) => [item.key, item.type]),
    ),
    assessmentGroups: product
      ? assessmentGroups(product).map((group) => ({
          ...group,
          reports: group.reports.map(reportSummary),
        }))
      : [],
    counts: {
      documents: snapshot.documents.length,
      warnings: snapshot.warnings.length,
      tasks: snapshot.tasks.length,
    },
  };
  cache.set(snapshot, data);
  return data;
}
