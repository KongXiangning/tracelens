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
import type { Snapshot } from "./types.js";
import { requirementWork, type RequirementWork } from "./overview-progress.js";
import type {
  ProductItem,
  ProductMetadata,
  ProductSnapshot,
} from "./product-types.js";
import { productView } from "./product-view.js";
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
  metadata: Pick<
    ProductMetadata,
    "conclusion" | "applicability" | "subject" | "checked_at"
  >;
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
  }[];
}
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
function reportSummary(report: ProductItem): OverviewReport {
  const { conclusion, applicability, subject, checked_at } = report.metadata;
  return {
    key: report.key,
    id: report.id,
    title: report.title,
    usable: report.usable,
    metadata: { conclusion, applicability, subject, checked_at },
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
  function requirement(item: ProductItem): OverviewRequirement {
    const rows = bindings.get(item.key)!;
    return {
      ...itemSummary(item),
      description: requirementDescription(item),
      work: requirementWork(snapshot, rows, contributionIssues),
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
      assessmentRecords: overviewAssessmentRecords(product!, item).map(
        ({ report, selection }) => ({
          report: reportSummary(report),
          selection: {
            conclusion: selection.conclusion,
            reasons: selection.reasons,
          },
        }),
      ),
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
