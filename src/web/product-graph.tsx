import { useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { Snapshot, SourceRef } from "../shared/types";
import type {
  ProductItem,
  ProductSource,
  ProductTaskMatch,
  ProductType,
} from "../shared/product-types";
import { SourceButton, type OpenSource } from "./components";

const typeLabels: Record<ProductType | "unknown", string> = {
  project: "项目",
  goal: "目标",
  module: "模块",
  requirement: "需求",
  design: "设计",
  plan: "计划",
  change: "变化",
  assessment: "交付报告",
  discussion: "讨论",
  unknown: "未知类型",
};
const linkLabels: Record<string, string> = {
  part_of: "业务归属",
  supports: "支持目标",
  addresses: "方案覆盖",
  depends_on: "业务 / 方案依赖",
  replaces: "替代",
  derived_from: "演进来源",
  discusses: "相关讨论",
  references: "普通参考",
};
const resolutionLabels: Record<string, string> = {
  resolved: "已定位",
  missing: "本次当前条目中未定位",
  ambiguous: "身份有歧义",
  "invalid-direction": "关系方向不符合契约",
  matched: "真实任务身份匹配",
  "identity-unknown": "任务身份未确认",
  unresolved: "任务未匹配",
  conflict: "任务身份冲突",
};
const readLabels: Record<string, string> = {
  read: "已读取",
  "not-read": "未读取",
  excluded: "已排除",
  unavailable: "不可用",
  outside: "范围外",
  unsupported: "不支持的来源类型",
  external: "外部来源，未读取",
  text: "文字来源",
  located: "已定位",
  unlocated: "未定位",
  ambiguous: "定位有歧义",
  "not-applicable": "不适用",
  "same-bytes": "字节相同",
  changed: "字节已变化",
  unknown: "未知",
};

export function productWorkItemKey(planKey: string, workItemId: string) {
  return `${planKey}:work:${encodeURIComponent(workItemId)}`;
}

export interface ProductGraphNode {
  id: string;
  kind: "product" | "work" | "task" | "reference";
  title: string;
  detail: string;
  itemKey?: string;
  workItemId?: string;
  taskId?: string;
  source?: SourceRef;
}
export interface ProductGraphRelation {
  id: string;
  from: string;
  to: string;
  ownerKey: string;
  kind:
    | "link"
    | "plan-target"
    | "plan-work"
    | "work-target"
    | "dependency"
    | "work-replaces"
    | "binding"
    | "work-binding"
    | "repair";
  label: string;
  coverage?: string;
  origin?: string;
  state?: string;
  resolution?: string;
  reason?: string;
  source: SourceRef;
  sources: ProductSource[];
  raw: unknown;
}
export interface ProductGraphModel {
  nodes: Map<string, ProductGraphNode>;
  relations: ProductGraphRelation[];
}

/** Every declared record produces its own edge. Evidence/state/coverage are never coalesced. */
export function buildProductGraph(snapshot: Snapshot): ProductGraphModel {
  const nodes = new Map<string, ProductGraphNode>();
  const relations: ProductGraphRelation[] = [];
  const product = snapshot.product;
  if (!product) return { nodes, relations };
  const itemsByKey = new Map(product.items.map((item) => [item.key, item]));
  const workCounts = new Map<string, Map<string, number>>();
  for (const item of product.items) {
    const counts = new Map<string, number>();
    if (item.usable && item.type === "plan") {
      for (const work of item.metadata.work_items || [])
        counts.set(work.id, (counts.get(work.id) || 0) + 1);
    }
    workCounts.set(item.key, counts);
  }
  const workNodeKey = (planKey: string, workId: string, index: number) =>
    (workCounts.get(planKey)?.get(workId) || 0) > 1
      ? `${productWorkItemKey(planKey, workId)}:duplicate:${index}`
      : productWorkItemKey(planKey, workId);
  const metadataSource = (item: ProductItem) => ({
    ...item.source,
    line: item.metadataLine,
    section: null,
  });
  for (const item of product.items) {
    nodes.set(item.key, {
      id: item.key,
      kind: "product",
      title: item.title,
      detail: `${typeLabels[item.type]} · ${item.id}${item.usable ? "" : " · 结构不可用，查看诊断与原文"}`,
      itemKey: item.key,
      source: item.source,
    });
    if (!item.usable || item.type !== "plan") continue;
    for (const [index, work] of (item.metadata.work_items || []).entries()) {
      const ambiguous = (workCounts.get(item.key)?.get(work.id) || 0) > 1;
      const id = workNodeKey(item.key, work.id, index);
      nodes.set(id, {
        id,
        kind: "work",
        title: work.title,
        detail: `工作项 · ${item.id} / ${work.id} · ${work.state} · ${work.origin}${ambiguous ? " · 身份有歧义" : ""}`,
        itemKey: item.key,
        workItemId: ambiguous ? undefined : work.id,
        source: metadataSource(item),
      });
    }
  }

  function unresolved(
    id: string,
    title: string,
    detail: string,
    source?: SourceRef,
  ) {
    nodes.set(id, { id, kind: "reference", title, detail, source });
    return id;
  }
  function productTarget(
    target: string,
    recordId: string,
    types?: ProductType[],
  ) {
    const candidates = product!.items.filter((item) => item.id === target);
    if (
      candidates.length === 1 &&
      candidates[0].usable &&
      (!types || types.some((type) => type === candidates[0].type))
    ) {
      return { id: candidates[0].key, resolution: "resolved" };
    }
    const resolution =
      candidates.length > 1
        ? "ambiguous"
        : candidates.length === 1 && candidates[0].usable
          ? "invalid-direction"
          : "missing";
    return {
      id: unresolved(
        `product-reference:${recordId}`,
        target,
        resolutionLabels[resolution],
      ),
      resolution,
    };
  }
  function taskTargets(match: ProductTaskMatch, recordId: string): string[] {
    const actual =
      match.state === "matched"
        ? match.taskIds
            .map((id) => snapshot.tasks.find((task) => task.id === id))
            .filter((task) => task !== undefined)
        : [];
    if (actual.length) {
      return actual.map((task) => {
        nodes.set(task.id, {
          id: task.id,
          kind: "task",
          title: task.title,
          detail: `任务 · ${task.number || "未记录编号"} · ${task.realTaskId || "未记录真实 ID"}`,
          taskId: task.id,
          source: task.source,
        });
        return task.id;
      });
    }
    const check = product!.sources.find(
      (source) => source.id === match.sourceCheckId,
    );
    return [
      unresolved(
        `task-reference:${recordId}`,
        match.task.label || match.task.task_id || "未确认身份的任务来源",
        `${resolutionLabels[match.state]} · ${match.detail}`,
        check?.source || undefined,
      ),
    ];
  }
  function add(
    owner: ProductItem,
    relation: Omit<ProductGraphRelation, "ownerKey" | "source">,
  ) {
    relations.push({
      ...relation,
      ownerKey: owner.key,
      source: metadataSource(owner),
    });
  }

  for (const relation of product.relations) {
    const owner = itemsByKey.get(relation.ownerKey);
    if (!owner || !owner.usable) continue;
    const target =
      relation.targetKey && nodes.has(relation.targetKey)
        ? relation.targetKey
        : unresolved(
            `product-reference:${relation.key}`,
            relation.link.target,
            resolutionLabels[relation.resolution],
          );
    add(owner, {
      id: `link:${relation.key}`,
      from: owner.key,
      to: target,
      kind: "link",
      label: `${linkLabels[relation.link.relation] || relation.link.relation} (${relation.link.relation})`,
      origin: relation.link.origin,
      state: relation.link.state,
      resolution: relation.resolution,
      reason: relation.link.reason,
      sources: relation.link.sources || [],
      raw: relation.link,
    });
  }

  for (const plan of product.items.filter(
    (item) => item.usable && item.type === "plan",
  )) {
    for (const [index, target] of (plan.metadata.targets || []).entries()) {
      const id = `${plan.key}:target:${index}`;
      const resolved = productTarget(target.target, id, [
        "goal",
        "requirement",
      ]);
      add(plan, {
        id,
        from: plan.key,
        to: resolved.id,
        kind: "plan-target",
        label: "计划覆盖范围",
        coverage: target.coverage,
        resolution: resolved.resolution,
        sources: plan.metadata.sources || [],
        raw: target,
      });
    }
    for (const [workIndex, work] of (
      plan.metadata.work_items || []
    ).entries()) {
      const workKey = workNodeKey(plan.key, work.id, workIndex);
      add(plan, {
        id: `${workKey}:member`,
        from: plan.key,
        to: workKey,
        kind: "plan-work",
        label: "计划工作项",
        state: work.state,
        origin: work.origin,
        sources: work.sources || [],
        raw: work,
      });
      for (const [index, target] of work.targets.entries()) {
        const id = `${workKey}:target:${index}`;
        const resolved = productTarget(target.target, id, [
          "goal",
          "requirement",
        ]);
        add(plan, {
          id,
          from: workKey,
          to: resolved.id,
          kind: "work-target",
          label: "工作项覆盖范围",
          coverage: target.coverage,
          state: work.state,
          origin: work.origin,
          resolution: resolved.resolution,
          sources: work.sources || [],
          raw: target,
        });
      }
      for (const [index, dependency] of (work.depends_on || []).entries()) {
        const id = `${workKey}:dependency:${index}`;
        const targetKey = productWorkItemKey(plan.key, dependency.item_id);
        const resolved = nodes.has(targetKey);
        const resolution =
          (workCounts.get(plan.key)?.get(dependency.item_id) || 0) > 1
            ? "ambiguous"
            : "missing";
        add(plan, {
          id,
          from: workKey,
          to: resolved
            ? targetKey
            : unresolved(
                `work-reference:${id}`,
                `${plan.id} / ${dependency.item_id}`,
                resolution === "ambiguous"
                  ? "本计划同名工作项身份有歧义"
                  : "本计划中未定位工作项",
              ),
          kind: "dependency",
          label:
            dependency.kind === "prerequisite"
              ? "前提依赖 (prerequisite)"
              : "先后依赖 (order)",
          state: work.state,
          reason: dependency.reason,
          resolution: resolved ? "resolved" : resolution,
          sources: work.sources || [],
          raw: dependency,
        });
      }
      for (const [index, replaced] of (work.replaces || []).entries()) {
        const id = `${workKey}:replaces:${index}`;
        const targetKey = productWorkItemKey(plan.key, replaced);
        const resolved = nodes.has(targetKey);
        const resolution =
          (workCounts.get(plan.key)?.get(replaced) || 0) > 1
            ? "ambiguous"
            : "missing";
        add(plan, {
          id,
          from: workKey,
          to: resolved
            ? targetKey
            : unresolved(
                `work-reference:${id}`,
                `${plan.id} / ${replaced}`,
                resolution === "ambiguous"
                  ? "本计划同名工作项身份有歧义"
                  : "本计划中未定位工作项",
              ),
          kind: "work-replaces",
          label: "替代工作项",
          state: work.state,
          resolution: resolved ? "resolved" : resolution,
          sources: work.sources || [],
          raw: { replaces: replaced },
        });
      }
    }
  }

  for (const view of product.bindings) {
    const owner = itemsByKey.get(view.ownerKey);
    if (!owner || !owner.usable) continue;
    const binding = view.binding;
    const tasks = taskTargets(view.match, view.key);
    for (const [index, task] of tasks.entries()) {
      add(owner, {
        id: `${view.key}:task:${index}`,
        from: owner.key,
        to: task,
        kind: "binding",
        label: `任务范围关联 · ${binding.role}`,
        coverage: binding.coverage,
        origin: binding.origin,
        state: binding.state,
        resolution: view.match.state,
        reason: [binding.reason, view.match.detail].filter(Boolean).join(" · "),
        sources: [binding.task.source, ...(binding.sources || [])],
        raw: binding,
      });
      for (const [workIndex, work] of view.planItems.entries()) {
        const id = `${view.key}:work:${workIndex}:task:${index}`;
        const workKey =
          work.key && nodes.has(work.key)
            ? work.key
            : unresolved(
                `work-reference:${id}`,
                `${work.planId} / ${work.workItemId}`,
                resolutionLabels[work.state],
              );
        add(owner, {
          id,
          from: workKey,
          to: task,
          kind: "work-binding",
          label: `工作项任务关联 · ${binding.role}`,
          coverage: binding.coverage,
          origin: binding.origin,
          state: binding.state,
          resolution: work.state === "resolved" ? view.match.state : work.state,
          reason: binding.reason,
          sources: [binding.task.source, ...(binding.sources || [])],
          raw: {
            binding_id: binding.id,
            plan_item: work,
            task: binding.task,
            coverage: binding.coverage,
          },
        });
      }
      for (const [repairIndex, repair] of view.repairs.entries()) {
        const targets = taskTargets(
          repair.match,
          `${view.key}:repair:${repairIndex}`,
        );
        for (const [targetIndex, target] of targets.entries()) {
          add(owner, {
            id: `${view.key}:repair:${repairIndex}:${index}:${targetIndex}`,
            from: task,
            to: target,
            kind: "repair",
            label: "修复所指交付范围",
            coverage: repair.coverage,
            origin: binding.origin,
            state: binding.state,
            resolution: repair.match.state,
            reason: [
              binding.reason,
              repair.match.detail,
              "修复关系不证明被指向的任务引入缺陷，也不改变任务或交付报告状态",
            ]
              .filter(Boolean)
              .join(" · "),
            sources: [repair.task.source, ...repair.sources],
            raw: repair,
          });
        }
      }
    }
  }
  return { nodes, relations };
}

export function productRelationsForFocus(
  model: ProductGraphModel,
  focus: string,
) {
  return model.relations.filter(
    (relation) =>
      relation.from === focus ||
      relation.to === focus ||
      relation.ownerKey === focus,
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function SourceEvidence({
  reference,
  ownerKey,
  snapshot,
  open,
}: {
  reference: ProductSource;
  ownerKey: string;
  snapshot: Snapshot;
  open: OpenSource;
}) {
  const checks =
    snapshot.product?.sources.filter(
      (check) =>
        check.ownerKey === ownerKey &&
        canonical(check.reference) === canonical(reference),
    ) || [];
  if (reference.kind === "text")
    return (
      <div className="product-graph-source">
        <strong>{reference.label}</strong>
        <p>{reference.text}</p>
      </div>
    );
  if (reference.kind === "uri") {
    let safe = false;
    try {
      safe = ["https:", "http:"].includes(new URL(reference.uri).protocol);
    } catch {
      /* Keep unsupported URI visible as text. */
    }
    return (
      <div className="product-graph-source">
        {safe ? (
          <a href={reference.uri} target="_blank" rel="noopener noreferrer">
            {reference.uri}
          </a>
        ) : (
          <span>{reference.uri}</span>
        )}
        <span className="muted">
          {" "}
          · 外部来源，未自动读取{safe ? "" : "；不支持打开此 URI 协议"}
        </span>
        {reference.note && <p>{reference.note}</p>}
      </div>
    );
  }
  return (
    <div className="product-graph-source">
      <div className="relation-path">
        {reference.path}
        {reference.item_id ? ` · ${reference.item_id}` : ""}
        {reference.section ? ` · ${reference.section}` : ""}
        {reference.lines
          ? ` · 行 ${reference.lines.start}–${reference.lines.end}`
          : ""}
      </div>
      {reference.note && <p>{reference.note}</p>}
      {!checks.length && (
        <p className="muted">
          未读取或未收录来源核对结果；打开页面不会另行读盘
        </p>
      )}
      {checks.map((check) => (
        <div key={check.id}>
          <p className="muted">
            {readLabels[check.readState]} · {readLabels[check.locationState]} ·
            字节核对：{readLabels[check.byteState]} · {check.detail}
          </p>
          {check.source && <SourceButton source={check.source} open={open} />}
        </div>
      ))}
    </div>
  );
}

const edgeColors: Record<ProductGraphRelation["kind"], string> = {
  link: "#528b83",
  "plan-target": "#7163b3",
  "plan-work": "#8795a4",
  "work-target": "#487ab1",
  dependency: "#af812e",
  "work-replaces": "#a06d52",
  binding: "#4b8862",
  "work-binding": "#387e8a",
  repair: "#ac6178",
};

export function ProductRelationPanel({
  snapshot,
  model,
  focus,
  open,
  openTask,
  openProduct,
}: {
  snapshot: Snapshot;
  model: ProductGraphModel;
  focus: string;
  open: OpenSource;
  openTask: (id: string) => void;
  openProduct: (key: string, workItemId?: string) => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [highlight, setHighlight] = useState<string>();
  const related = productRelationsForFocus(model, focus);
  const visible = related.filter(
    (relation) => showDismissed || relation.state !== "dismissed",
  );
  const dismissedCount = related.filter(
    (relation) => relation.state === "dismissed",
  ).length;
  const neighborIds = [
    ...new Set(visible.flatMap((relation) => [relation.from, relation.to])),
  ].filter((id) => id !== focus);
  const included = new Set([focus, ...neighborIds.slice(0, 12)]);
  const graphRelations = visible.filter(
    (relation) => included.has(relation.from) && included.has(relation.to),
  );
  function navigate(id: string) {
    const node = model.nodes.get(id);
    if (node?.itemKey) openProduct(node.itemKey, node.workItemId);
    else if (node?.taskId) openTask(node.taskId);
    else if (node?.source) open(node.source);
    else {
      const evidence = related.find(
        (relation) => relation.from === id || relation.to === id,
      );
      if (evidence) selectEvidence(evidence.id);
    }
  }
  function selectEvidence(id: string) {
    setHighlight(id);
    document
      .getElementById(`product-evidence:${id}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const nodes: Node[] = [...included].flatMap((id) => {
    const node = model.nodes.get(id);
    if (!node) return [];
    const index = neighborIds.indexOf(id);
    return [
      {
        id,
        data: {
          label: (
            <>
              <span
                className={`graph-type ${node.kind === "reference" ? "unresolved" : ""}`}
              >
                {node.detail}
              </span>
              <strong>{node.title}</strong>
            </>
          ),
        },
        position:
          id === focus
            ? {
                x: 350,
                y: Math.min(5, Math.floor(neighborIds.length / 2)) * 70,
              }
            : { x: index % 2 ? 700 : 0, y: Math.floor(index / 2) * 140 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: id === focus ? "focus-node" : "",
        style: { width: 250 },
        ariaLabel: `打开${node.detail} ${node.title}`,
      },
    ];
  });
  const edges: Edge[] = graphRelations.map((relation, index) => ({
    id: relation.id,
    source: relation.from,
    target: relation.to,
    label: relation.label,
    type: "smoothstep",
    pathOptions: { offset: 20 + (index % 5) * 12 },
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke:
        relation.state === "dismissed" ? "#9c9c9c" : edgeColors[relation.kind],
      strokeDasharray:
        relation.origin === "inferred"
          ? "5 4"
          : relation.state === "dismissed"
            ? "2 5"
            : undefined,
      opacity: relation.state === "dismissed" ? 0.6 : 1,
    },
    labelStyle: { fill: "#59635d", fontSize: 10 },
  }));
  return (
    <section className="product-relations" aria-label="产品语义关联">
      <div className="relation-main">
        <h3>
          产品语义关联 <small>{related.length}</small>
        </h3>
        {dismissedCount > 0 && (
          <label className="product-graph-dismissed">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(event) => setShowDismissed(event.target.checked)}
            />{" "}
            图中显示已否定关联（{dismissedCount}）
          </label>
        )}
      </div>
      <p className="muted">
        箭头按声明方向；虚线表示推断。任务关联、依赖和修复不代表完成、实时执行或缺陷归因。每条范围及依据分别保留
      </p>
      <div className="graph-container product-graph-container">
        <ReactFlow
          key={`${snapshot.id}:${focus}:${showDismissed}`}
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.25}
          maxZoom={1.5}
          onNodeClick={(_event, node) => navigate(node.id)}
          onEdgeClick={(_event, edge) => selectEvidence(edge.id)}
        >
          <Background color="#d8dfda" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {(neighborIds.length > 12 ||
          graphRelations.length < visible.length) && (
          <span className="graph-overflow">
            局部图仅显示前 12 个相邻节点；完整 {related.length} 条依据见下方
          </span>
        )}
      </div>
      <section
        id="product-relation-evidence"
        className="product-graph-evidence"
      >
        <h3>
          完整产品关联依据 <small>{related.length}</small>
        </h3>
        {!related.length && (
          <p className="muted missing">未记录该产品关联；这不表示尚未实施</p>
        )}
        <ul className="relation-list">
          {related.map((relation) => (
            <li
              key={relation.id}
              id={`product-evidence:${relation.id}`}
              className={highlight === relation.id ? "highlight" : ""}
              data-product-relation-kind={relation.kind}
            >
              <div className="relation-main">
                <button
                  className="text-link"
                  onClick={() => navigate(relation.from)}
                >
                  {model.nodes.get(relation.from)?.title || relation.from}
                </button>
                <strong>→ {relation.label} →</strong>
                <button
                  className="text-link"
                  onClick={() => navigate(relation.to)}
                >
                  {model.nodes.get(relation.to)?.title || relation.to}
                </button>
              </div>
              <p>
                {relation.origin === "declared"
                  ? "明确声明"
                  : relation.origin === "inferred"
                    ? "推断关联"
                    : relation.origin
                      ? `工作项来源：${relation.origin}`
                      : "结构字段明确记录"}
                {relation.state
                  ? ` · ${relation.state === "dismissed" ? "已否定关联" : relation.state === "active" ? "active（声明状态）" : relation.state}`
                  : ""}
                {relation.resolution
                  ? ` · ${resolutionLabels[relation.resolution] || relation.resolution}`
                  : ""}
              </p>
              {relation.coverage && (
                <p>
                  <strong>覆盖范围：</strong>
                  {relation.coverage}
                </p>
              )}
              {relation.reason && (
                <p>
                  <strong>理由 / 核对：</strong>
                  {relation.reason}
                </p>
              )}
              <div className="relation-main">
                <span>声明原文</span>
                <SourceButton source={relation.source} open={open} />
              </div>
              {relation.sources.map((reference, index) => (
                <SourceEvidence
                  key={index}
                  reference={reference}
                  ownerKey={relation.ownerKey}
                  snapshot={snapshot}
                  open={open}
                />
              ))}
              <details>
                <summary>完整声明字段与来源</summary>
                <pre>{JSON.stringify(relation.raw, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
