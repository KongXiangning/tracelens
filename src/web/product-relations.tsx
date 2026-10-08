import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react";
import type { Snapshot, SourceRef } from "../shared/types";
import { SourceButton, type OpenSource } from "./components";
import { ProductSources, productLabels } from "./product";

interface BusinessEdge {
  key: string;
  from: string;
  to: string;
  label: string;
  coverage?: string;
  origin?: string;
  state?: string;
  reason?: string;
  source: SourceRef;
  ownerKey: string;
  pointer: string;
}
export function productGraphEdges(snapshot: Snapshot): BusinessEdge[] {
  const p = snapshot.product;
  if (!p) return [];
  const result: BusinessEdge[] = p.relations.map((r) => ({
    key: r.key,
    from: r.ownerKey,
    to: r.targetKey || `unresolved:${r.key}`,
    label: r.declaration.relation,
    origin: r.declaration.origin,
    state: r.declaration.state,
    reason:
      r.declaration.reason ||
      (r.resolution !== "resolved"
        ? `目标 ${r.declaration.target}：${r.resolution}`
        : undefined),
    source: r.source,
    ownerKey: r.ownerKey,
    pointer: `/links/${p.relations.filter((other) => other.ownerKey === r.ownerKey).indexOf(r)}`,
  }));
  for (const item of p.items.filter((i) => i.usable)) {
    for (const [index, t] of (item.metadata!.targets || []).entries()) {
      const target = p.items.find((i) => i.usable && i.id === t.target);
      result.push({
        key: `${item.key}:target:${index}`,
        from: item.key,
        to: target?.key || `unresolved:${item.key}:target:${index}`,
        label: "计划覆盖",
        coverage: t.coverage,
        source: {
          ...item.source,
          line:
            item.metadataLocations[`/targets/${index}`] || item.metadataLine,
        },
        ownerKey: item.key,
        pointer: `/targets/${index}`,
      });
    }
    if (item.type === "assessment") {
      const target = p.items.find(
        (i) => i.usable && i.id === item.metadata!.target,
      );
      result.push({
        key: `${item.key}:assessment`,
        from: item.key,
        to: target?.key || `unresolved:${item.key}:assessment`,
        label: "报告对象",
        source: item.source,
        ownerKey: item.key,
        pointer: "/target_basis",
      });
    }
  }
  for (const work of p.workItems) {
    const plan = p.items.find((i) => i.key === work.planKey)!;
    const workIndex = p.workItems
      .filter((w) => w.planKey === plan.key)
      .indexOf(work);
    result.push({
      key: `${work.key}:membership`,
      from: plan.key,
      to: work.key,
      label: "工作项安排",
      coverage: work.declaration.scope,
      source: work.source,
      ownerKey: plan.key,
      pointer: `/work_items/${workIndex}`,
    });
    for (const [index, t] of work.declaration.targets.entries()) {
      const target = p.items.find((i) => i.usable && i.id === t.target);
      result.push({
        key: `${work.key}:target:${index}`,
        from: work.key,
        to: target?.key || `unresolved:${work.key}:${index}`,
        label: "工作项覆盖",
        coverage: t.coverage,
        source: work.source,
        ownerKey: plan.key,
        pointer: `/work_items/${workIndex}/targets/${index}`,
      });
    }
    for (const [index, d] of (work.declaration.depends_on || []).entries()) {
      const target = p.workItems.filter(
        (w) => w.planKey === work.planKey && w.declaration.id === d.item_id,
      );
      result.push({
        key: `${work.key}:dependency:${index}`,
        from: work.key,
        to:
          target.length === 1
            ? target[0].key
            : `unresolved:${work.key}:dependency:${index}`,
        label: d.kind === "order" ? "顺序安排" : "工程前提",
        reason: d.reason,
        source: work.source,
        ownerKey: plan.key,
        pointer: `/work_items/${workIndex}/depends_on/${index}`,
      });
    }
  }
  for (const binding of p.bindings) {
    const tasks = binding.taskIds.length ? binding.taskIds : [binding.key];
    const pointer = `/task_bindings/${p.bindings.filter((b) => b.ownerKey === binding.ownerKey).indexOf(binding)}`;
    for (const task of tasks) {
      const edge = {
        coverage: binding.declaration.coverage,
        origin: binding.declaration.origin,
        state: binding.declaration.state,
        reason: binding.declaration.reason || binding.detail,
        source: binding.source,
        ownerKey: binding.ownerKey,
        pointer,
      };
      result.push({
        ...edge,
        key: `${binding.key}:${task}`,
        from: binding.ownerKey,
        to: task,
        label: `任务 ${binding.declaration.role}`,
      });
      for (const work of binding.planItems.filter((w) => w.key))
        result.push({
          ...edge,
          key: `${binding.key}:${work.key}:${task}`,
          from: work.key!,
          to: task,
          label: `范围绑定 ${binding.declaration.role}`,
        });
      for (const [index, repair] of binding.repairs.entries()) {
        for (const old of repair.taskIds.length
          ? repair.taskIds
          : [`${binding.key}:repair:${index}`])
          result.push({
            ...edge,
            key: `${binding.key}:repair:${index}:${task}:${old}`,
            from: task,
            to: old,
            label: "修复交付范围",
            coverage: repair.coverage,
            reason: repair.detail,
            pointer: `${pointer}/repairs/${index}`,
          });
      }
    }
  }
  return result;
}
function nodeLabel(snapshot: Snapshot, id: string) {
  const p = snapshot.product!;
  const item = p.items.find((i) => i.key === id);
  if (item)
    return `${item.type ? productLabels[item.type] : "不可用条目"} · ${item.id}\n${item.title}`;
  const work = p.workItems.find((w) => w.key === id);
  if (work)
    return `工作项 · ${p.items.find((i) => i.key === work.planKey)?.id}/${work.declaration.id}\n${work.declaration.title}`;
  const task = snapshot.tasks.find((t) => t.id === id);
  if (task) return `任务文档 · ${task.number || "未记录编号"}\n${task.title}`;
  const binding = p.bindings.find((b) => b.key === id);
  if (binding)
    return `任务引用 · ${binding.declaration.task.task_id || "身份未确认"}\n${binding.declaration.task.label || binding.detail}`;
  const repair = p.bindings
    .flatMap((b) =>
      b.repairs.map((r, index) => ({ key: `${b.key}:repair:${index}`, r })),
    )
    .find((r) => r.key === id);
  return repair
    ? `历史任务引用 · ${repair.r.task.task_id || "身份未知"}`
    : "未定位引用（见完整依据）";
}
export function ProductGraph({
  snapshot,
  focus,
  open,
  openTask,
  openItem,
  highlight,
}: {
  snapshot: Snapshot;
  focus: string;
  open: OpenSource;
  openTask: (id: string) => void;
  openItem: (key: string) => void;
  highlight: (ids: string[]) => void;
}) {
  const allEdges = productGraphEdges(snapshot).filter(
    (e) => (e.from === focus || e.to === focus) && e.state !== "dismissed",
  );
  const neighbors = [
    ...new Set(allEdges.flatMap((e) => [e.from, e.to])),
  ].filter((id) => id !== focus);
  const shown = [focus, ...neighbors.slice(0, 12)];
  const nodes: Node[] = shown.map((id, index) => ({
    id,
    data: { label: nodeLabel(snapshot, id) },
    position:
      index === 0
        ? { x: 330, y: 180 }
        : { x: index <= 6 ? 0 : 660, y: ((index - 1) % 6) * 105 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    className: id === focus ? "focus-node" : "",
    style: { width: 245, whiteSpace: "pre-wrap" },
    ariaLabel: `打开产品关联节点 ${nodeLabel(snapshot, id)}`,
  }));
  const edges: Edge[] = allEdges
    .filter((e) => shown.includes(e.from) && shown.includes(e.to))
    .map((e) => ({
      id: e.key,
      source: e.from,
      target: e.to,
      label: `${e.label}${e.origin === "inferred" ? " · 推断" : ""}`,
      data: { ids: [e.key] },
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: e.origin === "inferred" ? "#a8752f" : "#528b83" },
      labelStyle: { fontSize: 10 },
    }));
  function navigate(id: string) {
    const p = snapshot.product!;
    if (p.items.some((i) => i.key === id)) openItem(id);
    else if (p.workItems.some((w) => w.key === id))
      openItem(p.workItems.find((w) => w.key === id)!.planKey);
    else if (snapshot.tasks.some((t) => t.id === id)) openTask(id);
    else
      highlight(
        allEdges.filter((e) => e.from === id || e.to === id).map((e) => e.key),
      );
  }
  return (
    <div className="graph-container">
      <ReactFlow
        key={`${snapshot.id}:${focus}:product`}
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        fitView
        minZoom={0.3}
        onNodeClick={(_event, node) => navigate(node.id)}
        onEdgeClick={(_event, edge) => highlight([edge.id])}
      >
        <Background color="#d8dfda" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {neighbors.length > 12 && (
        <span className="graph-overflow">
          图显示前 12 个邻居；完整业务依据见下方
        </span>
      )}
    </div>
  );
}
export function ProductEvidence({
  snapshot,
  focus,
  highlight,
  open,
  openTask,
  openItem,
}: {
  snapshot: Snapshot;
  focus: string;
  highlight: string[];
  open: OpenSource;
  openTask: (id: string) => void;
  openItem: (key: string) => void;
}) {
  const edges = productGraphEdges(snapshot).filter(
    (e) => e.from === focus || e.to === focus,
  );
  function navigate(id: string) {
    if (snapshot.tasks.some((t) => t.id === id)) openTask(id);
    else if (snapshot.product!.items.some((i) => i.key === id)) openItem(id);
    else {
      const work = snapshot.product!.workItems.find((w) => w.key === id);
      if (work) openItem(work.planKey);
    }
  }
  return (
    <section>
      <h3>完整业务依据（{edges.length}）</h3>
      <ul className="relation-list">
        {edges.map((e) => (
          <li
            key={e.key}
            className={highlight.includes(e.key) ? "highlight" : ""}
          >
            <div className="product-tags">
              <button className="text-link" onClick={() => navigate(e.from)}>
                {nodeLabel(snapshot, e.from)}
              </button>
              <span>{e.label}</span>
              <button className="text-link" onClick={() => navigate(e.to)}>
                {nodeLabel(snapshot, e.to)}
              </button>
            </div>
            {e.origin && (
              <p>
                {e.origin === "declared" ? "明确声明" : "推断关联"} ·{" "}
                {e.state === "dismissed" ? "已否定关联" : "有效关联"}
              </p>
            )}
            {e.coverage && <p>范围：{e.coverage}</p>}
            {e.reason && <p>依据或定位：{e.reason}</p>}
            <SourceButton source={e.source} open={open} />
            <ProductSources
              sources={snapshot.product!.sources.filter(
                (s) =>
                  s.ownerKey === e.ownerKey &&
                  s.pointer.startsWith(`${e.pointer}/`),
              )}
              open={open}
            />
          </li>
        ))}
      </ul>
      {!edges.length && <p className="muted">未记录该业务关联</p>}
    </section>
  );
}
