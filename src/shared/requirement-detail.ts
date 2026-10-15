import type { ProductBindingView, ProductItem } from "./product-types.js";
import type { Snapshot, SourceRef } from "./types.js";
import {
  requirementBindings,
  requirementHierarchy,
} from "./product-hierarchy.js";
import {
  boundWorkStep,
  isWorkBinding,
  requirementWork,
} from "./overview-progress.js";
import { contributionDiagnostics } from "./product-contribution.js";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import type { RootContent } from "mdast";
import type { AssessmentSelection } from "./product-view.js";

export type FeatureState =
  | "completed"
  | "in-progress"
  | "not-started"
  | "recorded"
  | "pending"
  | "unassociated";
export const featureStateLabels: Record<FeatureState, string> = {
  completed: "已完成执行",
  "in-progress": "进行中",
  "not-started": "未开始",
  recorded: "有执行记录",
  pending: "待核对",
  unassociated: "待关联",
};
export interface RequirementFeature {
  id?: string;
  key: string;
  title: string;
  description: string;
  source: SourceRef;
  productKey: string;
  kind: "子需求" | "规划工作项" | "正文功能点";
  inclusion?: string;
  bindings: ProductBindingView[];
  state: FeatureState;
  reasons: string[];
  reports?: FeatureReport[];
}

export interface FeatureReport {
  key: string;
  reportKey: string;
  reportId: string;
  title: string;
  source: SourceRef;
  subject?: ProductItem["metadata"]["subject"];
  pointText?: string;
  scopeId?: string;
  checkedAt?: string;
  fields: { label: string; text: string }[];
}

/** Inline the definition explicitly referenced by a point, retaining its boundaries. */
export function featureDefinition(
  snapshot: Snapshot,
  owner: ProductItem,
  feature: RequirementFeature,
): string {
  const items = snapshot.product?.items || [];
  const referencedId = /(?:已移至独立要求|复用)\s+(REQ-[^\s；：，。]+)/.exec(
    feature.description,
  )?.[1];
  const targets = items.filter(
    (item) =>
      item.usable &&
      item.type === "requirement" &&
      (feature.kind === "子需求"
        ? item.key === feature.productKey
        : item.id === referencedId),
  );
  if (targets.length !== 1) return feature.description;
  const nodes = markdown.parse(targets[0].body).children;
  const originalPoint = feature.id?.match(/^F(\d+)$/)?.[1];
  const marker = originalPoint
    ? `原${owner.id}功能${originalPoint}：`
    : undefined;
  return (
    nodes
      .flatMap((node) => {
        if (node.type === "heading" && node.depth <= 2) return [];
        if (node.type === "html") return [];
        if (node.type === "list") {
          const matching = marker
            ? node.children.filter((child) =>
                toString(child).trim().startsWith(marker),
              )
            : [];
          return [
            (matching.length ? matching : node.children)
              .map((child) => {
                const text = toString(child).trim();
                return marker && text.startsWith(marker)
                  ? text.slice(marker.length)
                  : text;
              })
              .join("\n"),
          ];
        }
        return [toString(node).trim()];
      })
      .filter(Boolean)
      .join("\n\n") || feature.description
  );
}

export type FeatureImplementation =
  | "implemented"
  | "partial"
  | "not-implemented"
  | "unable-to-assess"
  | "failed"
  | "recorded"
  | "conflict"
  | "unassessed";
export const featureImplementationLabels: Record<
  FeatureImplementation,
  string
> = {
  implemented: "已实现",
  partial: "部分实现",
  "not-implemented": "未实现",
  "unable-to-assess": "无法评估",
  failed: "评估未通过",
  recorded: "已评估",
  conflict: "逐点记录冲突",
  unassessed: "未逐点列出",
};

/** Only a dedicated judgment column can supply an implementation category. */
export function featureReportDetail(report: FeatureReport) {
  const used = new Set<string>();
  const read = (labels: string[]) =>
    report.fields
      .filter((field) => labels.includes(field.label))
      .map((field) => {
        used.add(field.label);
        return field.text;
      })
      .join("\n");
  const judgment = read([
    "实施状态",
    "实现状态",
    "实现判断",
    "实施判断",
    "核对结果",
    "评估结论",
    "评估结果",
  ]);
  const implementation = read([
    "已查事实",
    "实现现状",
    "实际实现",
    "已实现",
    "实现与已知成果",
  ]);
  const verification = read([
    "验证状态",
    "验证依据",
    "验证结果",
    "既有验证及边界",
  ]);
  const remaining = read([
    "具体缺口",
    "具体剩余",
    "明确剩余",
    "剩余、发现与边界",
    "剩余与边界",
    "剩余范围",
    "完整范围剩余与限制",
    "剩余",
    "剩余与待核对",
    "不通过原因",
    "无法评估原因",
    "原因",
  ]);
  const evidence = read([
    "实际实现与验证",
    "实现和验证",
    "实现与验证",
    "具体依据与边界",
    "具体依据",
    "已实施及验证依据",
  ]);
  let state: FeatureImplementation = "recorded";
  const positive = /已(?:实现|实施|完成)|(?:结构|接口)实现/.test(judgment);
  const negative = /未(?:实现|实施|完成|闭合|交付)/.test(judgment);
  if (
    /^(?:无法评估|无法判定|无法判断|不能评估|证据不足|无法确认)/.test(judgment)
  )
    state = "unable-to-assess";
  else if (/^(?:评估未通过|未通过|不通过|不满足|未满足)/.test(judgment))
    state = "failed";
  else if (/^部分(?:实现|实施|完成)/.test(judgment) || (positive && negative))
    state = "partial";
  else if (/^(?:未实现|未实施|未开始|尚未实现)$/.test(judgment))
    state = "not-implemented";
  else if (/已(?:实现|实施|完成)$/.test(judgment) && !/^基础/.test(judgment))
    state = "implemented";
  const otherFields = report.fields.filter((field) => !used.has(field.label));
  return {
    state,
    judgment,
    implementation,
    verification,
    remaining,
    evidence,
    otherFields,
  };
}

/** Scope/object selection is independent of Task execution and report timestamps. */
export function featureAssessmentView(
  features: RequirementFeature[],
  selection?: AssessmentSelection,
  inspectedReportKey?: string,
) {
  const allReports = features.flatMap((feature) => feature.reports || []);
  const selected =
    selection?.reports.length === 1 ? selection.reports[0] : undefined;
  const keys = [...new Set(allReports.map((report) => report.reportKey))];
  const reportKey =
    inspectedReportKey ||
    selected?.key ||
    (!selection && keys.length === 1 ? keys[0] : undefined);
  const applicable = Boolean(
    selected?.key === reportKey &&
    selection?.assessment &&
    !selection.reasons.length,
  );
  const points = features.map((feature) => {
    const reports = (feature.reports || []).filter(
      (report) => report.reportKey === reportKey,
    );
    const report = reports.length === 1 ? reports[0] : undefined;
    const detail = report ? featureReportDetail(report) : undefined;
    const state: FeatureImplementation =
      reports.length > 1 ? "conflict" : detail?.state || "unassessed";
    return {
      feature,
      report,
      detail,
      state,
      otherReports: (feature.reports || []).filter((row) => row !== report),
    };
  });
  return { reportKey, applicable, points };
}

/** Preserve prose and supplementary tables without reclassifying them as points. */
export function featureReportContext(report: ProductItem) {
  let heading = "";
  const sections = new Map<string, string[]>();
  for (const node of markdown.parse(report.body).children) {
    if (node.type === "heading") {
      heading = toString(node).trim();
      continue;
    }
    if (!["paragraph", "list"].includes(node.type) || !heading) continue;
    const text =
      node.type === "list"
        ? node.children.map((child) => toString(child).trim()).join("\n")
        : toString(node).trim();
    sections.set(heading, [...(sections.get(heading) || []), text]);
  }
  return [...sections].map(([title, paragraphs]) => ({
    title,
    text: paragraphs.join("\n"),
  }));
}

export function assessmentNarrative(report: ProductItem) {
  return featureReportContext(report).filter((section) =>
    /^(?:评估结论|评估结果|交付与验证依据|剩余与待核对|无法评估原因|不通过原因)$/.test(
      section.title,
    ),
  );
}

const markdown = unified().use(remarkParse).use(remarkGfm);
const featureHeading =
  /^(?:功能点(?:与输入输出|清单|拆分)?|功能拆分|功能清单)$/;

function nodeSource(item: ProductItem, node: RootContent): SourceRef {
  return {
    ...item.source,
    line: item.source.line + (node.position?.start.line || 1) - 1,
  };
}

/** A report row is a quoted record, not a selected acceptance conclusion. */
export function featureReportRows(
  report: ProductItem,
  requirementId: string,
  points: { id: string; title: string }[] = [],
): Map<string, FeatureReport[]> {
  const result = new Map<string, FeatureReport[]>();
  if (
    !report.usable ||
    report.type !== "assessment" ||
    report.metadata.target !== requirementId
  )
    return result;
  for (const table of markdown.parse(report.body).children) {
    if (table.type !== "table") continue;
    const headers =
      table.children[0]?.children.map((cell) => toString(cell).trim()) || [];
    const featureColumn = headers.findIndex((header) =>
      ["功能点", "原功能点", "功能点编号", "功能义务"].includes(header),
    );
    if (featureColumn < 0) continue;
    for (const row of table.children.slice(1)) {
      const cells = row.children.map((cell) => toString(cell).trim());
      const match = /^(?:(.+)\/)?(F[1-9]\d*)(?=\s|[：:、.]|$)/.exec(
        cells[featureColumn] || "",
      );
      if (match?.[1] && match[1] !== requirementId) continue;
      const title = cells[featureColumn] || "";
      const originalNumbers = [
        ...new Set(
          [...title.matchAll(/原功能\s*(\d+)/g)].map((m) => `F${m[1]}`),
        ),
      ];
      const exactPoints = points.filter(
        (point) => title === point.title || title.startsWith(`${point.title} `),
      );
      const pointId =
        match?.[2] ||
        (originalNumbers.length === 1 ? originalNumbers[0] : undefined) ||
        (exactPoints.length === 1 ? exactPoints[0].id : undefined);
      if (!pointId) continue;
      const record: FeatureReport = {
        key: JSON.stringify([report.key, row.position?.start.line]),
        reportKey: report.key,
        reportId: report.id,
        title: report.title,
        pointText: title,
        source: nodeSource(report, row),
        subject: report.metadata.subject,
        scopeId: report.metadata.applicability?.scope_id,
        checkedAt: report.metadata.checked_at,
        fields: headers.flatMap((label, index) =>
          index !== featureColumn && cells[index]
            ? [{ label, text: cells[index] }]
            : [],
        ),
      };
      result.set(pointId, [...(result.get(pointId) || []), record]);
    }
  }
  return result;
}

/** Read only explicitly labelled functional lists, preserving original item order. */
function bodyFeatures(
  snapshot: Snapshot,
  item: ProductItem,
  bindings: ProductBindingView[],
): RequirementFeature[] {
  const nodes = markdown.parse(item.body).children;
  const points: {
    node: RootContent;
    title: string;
    description: string;
    id?: string;
  }[] = [];
  for (const [index, heading] of nodes.entries()) {
    if (
      heading.type !== "heading" ||
      !featureHeading.test(toString(heading).trim())
    )
      continue;
    for (const node of nodes.slice(index + 1)) {
      if (node.type === "heading" && node.depth <= heading.depth) break;
      if (node.type !== "list") continue;
      for (const entry of node.children) {
        const text = toString(entry).trim();
        if (!text) continue;
        const marker = /^(F[1-9]\d*)[：:、.\s]+/.exec(text);
        const title = toString(entry.children[0] || entry)
          .trim()
          .replace(/^(?:F[1-9]\d*)[：:、.\s]+/, "");
        points.push({ node: entry, title, description: text, id: marker?.[1] });
      }
    }
  }
  const reports = snapshot
    .product!.items.filter(
      (report) =>
        report.type === "assessment" && report.metadata.target === item.id,
    )
    .map((report) =>
      featureReportRows(
        report,
        item.id,
        points.map((point, index) => ({
          id: point.id || `F${index + 1}`,
          title: point.title,
        })),
      ),
    );
  return points.map((point, index) => {
    const id = point.id || `F${index + 1}`;
    const reference = `${item.id}/${id}`;
    const exact = bindings.filter((row) =>
      row.binding.coverage
        .split(/[\s，,；;、()（）]+/)
        .some((token) => token === reference),
    );
    return {
      id,
      key: JSON.stringify([item.key, "body", point.node.position?.start.line]),
      title: point.title,
      description: point.description,
      source: nodeSource(item, point.node),
      productKey: item.key,
      kind: "正文功能点",
      bindings: exact,
      ...featureExecution(snapshot, exact),
      reports: reports.flatMap((rows) => rows.get(id) || []),
    };
  });
}

/** Completion is exact implementation execution, never a Task lifecycle verdict. */
export function featureExecution(
  snapshot: Snapshot,
  rows: ProductBindingView[],
): { state: FeatureState; reasons: string[] } {
  if (!rows.length)
    return { state: "unassociated", reasons: ["尚未记录功能点与 Task 的关联"] };
  const issues = contributionDiagnostics(snapshot.product?.bindings || rows);
  const work = requirementWork(snapshot, rows, issues);
  const direct = rows.filter(
    (row) =>
      row.binding.contribution !== "supporting" &&
      row.binding.role !== "reference",
  );
  const completed =
    !work.pending &&
    direct.length > 0 &&
    direct.every((row) => {
      if (
        !isWorkBinding(row, issues) ||
        !["implementation", "repair"].includes(row.binding.role)
      )
        return false;
      const tasks =
        snapshot.runtime?.tasks.filter(
          (task) => task.task_id === row.binding.task.task_id,
        ) || [];
      const step =
        tasks.length === 1 ? boundWorkStep(row, tasks[0]) : undefined;
      return (
        step?.state === "executed" &&
        typeof step.execution_ref === "string" &&
        Boolean(step.execution_ref.trim())
      );
    });
  // Stale projections retain their records but cannot assert current completion.
  const fresh =
    snapshot.runtime?.source === "runtime-query" &&
    snapshot.runtime.freshness === "queried";
  let state: FeatureState = "pending";
  if (completed && fresh) state = "completed";
  else if (work.current) state = "in-progress";
  else if (work.notStarted && fresh) state = "not-started";
  else if (work.recorded) state = "recorded";
  return {
    state,
    reasons: [
      ...(work.reasons || []),
      ...(!fresh ? ["执行数据新鲜度待核对"] : []),
    ],
  };
}

/** Preserve separately recorded body points, composition and planned work. */
export function requirementFeatures(
  snapshot: Snapshot,
  item: ProductItem,
): RequirementFeature[] {
  const product = snapshot.product;
  if (!product || !item.usable) return [];
  const graph = requirementHierarchy(product, product.items, new Set());
  const children = new Set(graph.children.get(item.key) || []);
  const features: RequirementFeature[] = product.items
    .filter((child) => children.has(child.key))
    .map((child) => {
      const bindings = requirementBindings(product, child);
      return {
        key: child.key,
        title: child.title,
        description: child.body,
        source: child.source,
        productKey: child.key,
        kind: "子需求",
        bindings,
        ...featureExecution(snapshot, bindings),
      };
    });
  const ownerBindings = requirementBindings(product, item);
  const declaredPoints = bodyFeatures(
    snapshot,
    item,
    product.bindings.filter(
      (row) => row.ownerKey === item.key && row.binding.state === "active",
    ),
  );
  // Body points are the requirement's functional inventory. Plan work is a
  // separate execution breakdown and must not inflate that inventory's count.
  if (declaredPoints.length) return declaredPoints;
  for (const plan of product.items.filter(
    (entry) => entry.usable && entry.type === "plan",
  )) {
    for (const [index, work] of (plan.metadata.work_items || []).entries()) {
      if (!work.targets.some((target) => target.target === item.id)) continue;
      // Duplicate IDs cannot support a precise work-item association.
      const unique =
        product.items.filter((entry) => entry.usable && entry.id === plan.id)
          .length === 1 &&
        plan.metadata.work_items!.filter((entry) => entry.id === work.id)
          .length === 1 &&
        product.items.filter((entry) => entry.usable && entry.id === item.id)
          .length === 1;
      const bindings = unique
        ? ownerBindings.filter((row) =>
            row.planItems.some(
              (ref) =>
                ref.state === "resolved" &&
                ref.key === `${plan.key}:work:${encodeURIComponent(work.id)}` &&
                ref.planId === plan.id &&
                ref.workItemId === work.id,
            ),
          )
        : [];
      features.push({
        key: JSON.stringify([plan.key, work.id, index]),
        title: work.title,
        description: [work.outcome, work.scope].filter(Boolean).join("\n"),
        source: plan.source,
        productKey: plan.key,
        kind: "规划工作项",
        inclusion: work.state,
        bindings,
        ...featureExecution(snapshot, bindings),
      });
    }
  }
  return features;
}
