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
  title: string;
  source: SourceRef;
  subject?: string;
  fields: { label: string; text: string }[];
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
    const featureColumn = headers.findIndex((header) => header === "功能点");
    if (featureColumn < 0) continue;
    for (const row of table.children.slice(1)) {
      const cells = row.children.map((cell) => toString(cell).trim());
      const match = /^(?:(.+)\/)?(F[1-9]\d*)(?=\s|[：:、.]|$)/.exec(
        cells[featureColumn] || "",
      );
      if (!match || (match[1] && match[1] !== requirementId)) continue;
      const record: FeatureReport = {
        key: JSON.stringify([report.key, row.position?.start.line]),
        title: report.title,
        source: nodeSource(report, row),
        subject: report.metadata.subject?.value || undefined,
        fields: headers.flatMap((label, index) =>
          index !== featureColumn && cells[index]
            ? [{ label, text: cells[index] }]
            : [],
        ),
      };
      result.set(match[2], [...(result.get(match[2]) || []), record]);
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
    .map((report) => featureReportRows(report, item.id));
  return points.map((point, index) => {
    const id = point.id || `F${index + 1}`;
    const reference = `${item.id}/${id}`;
    const exact = bindings.filter((row) =>
      row.binding.coverage
        .split(/[\s，,；;、()（）]+/)
        .some((token) => token === reference),
    );
    return {
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
