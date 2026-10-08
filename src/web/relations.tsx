import { useMemo, useState } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Empty, type OpenSource } from "./components";
import { documentSource, RelationList, relationLabels } from "./pages";
import type { Snapshot } from "../shared/types";
import { buildProductGraph, ProductRelationPanel } from "./product-graph";

export function RelationGraph({
  snapshot,
  focus,
  open,
  openTask,
  highlight,
}: {
  snapshot: Snapshot;
  focus: string;
  open: OpenSource;
  openTask: (id: string) => void;
  highlight: (ids: string[]) => void;
}) {
  const documentTask = snapshot.tasks.find(
    (t) => t.source.documentId === focus,
  );
  const adjacent = snapshot.relations
    .filter(
      (r) => r.from === focus || r.to === focus || r.from === documentTask?.id,
    )
    .map((r) => (r.from === documentTask?.id ? { ...r, from: focus } : r));
  const incoming = [
    ...new Set(
      adjacent
        .filter((r) => r.to === focus && r.from !== focus)
        .map((r) => r.from),
    ),
  ];
  const outgoing = [
    ...new Set(
      adjacent
        .filter((r) => r.from === focus && r.to !== focus)
        .map((r) => r.to || `unresolved:${r.id}`),
    ),
  ];
  const all = new Set([
    focus,
    ...incoming.slice(0, 6),
    ...outgoing.slice(0, 6),
  ]);
  function label(id: string) {
    const task = snapshot.tasks.find((t) => t.id === id);
    if (task)
      return (
        <>
          <span className="graph-type">
            任务 · {task.number || "未记录编号"}
          </span>
          <strong>{task.title}</strong>
        </>
      );
    const doc = snapshot.documents.find((d) => d.id === id);
    if (doc)
      return (
        <>
          <span className="graph-type">文档</span>
          <strong>{doc.title}</strong>
          <small>{doc.path}</small>
        </>
      );
    const relation = adjacent.find((r) => `unresolved:${r.id}` === id);
    return (
      <>
        <span className="graph-type unresolved">
          {relation ? relationLabels[relation.state] : "未定位"}
        </span>
        <strong>{relation?.targetPath || relation?.label}</strong>
      </>
    );
  }
  const maxRows = Math.max(
    Math.min(incoming.length, 6),
    Math.min(outgoing.length, 6),
    1,
  );
  const nodes: Node[] = [...all].map((id) => {
    let x = 340;
    let y = (maxRows - 1) * 60;
    if (incoming.includes(id)) {
      x = 0;
      y = incoming.indexOf(id) * 120;
    } else if (outgoing.includes(id)) {
      x = 680;
      y = outgoing.indexOf(id) * 120;
    }
    return {
      id,
      data: { label: label(id) },
      position: { x, y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      className: id === focus ? "focus-node" : "",
      style: { width: 240 },
      ariaLabel: `打开关联节点 ${snapshot.tasks.find((t) => t.id === id)?.title || snapshot.documents.find((d) => d.id === id)?.title || id}`,
    };
  });
  const groups = new Map<string, typeof adjacent>();
  for (const relation of adjacent) {
    const target = relation.to || `unresolved:${relation.id}`;
    if (!all.has(relation.from) || !all.has(target)) continue;
    const key = JSON.stringify([relation.from, target, relation.type]);
    groups.set(key, [...(groups.get(key) || []), relation]);
  }
  const edges: Edge[] = [...groups.values()].map((group) => {
    const relation = group[0];
    return {
      id: relation.id,
      source: relation.from,
      target: relation.to || `unresolved:${relation.id}`,
      label: `${relation.type === "mention" ? "提及" : "引用"}${group.length > 1 ? ` ×${group.length}` : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { ids: group.map((r) => r.id) },
      style: {
        stroke: group.every((r) => r.state === "resolved")
          ? "#528b83"
          : "#a8752f",
      },
      labelStyle: { fill: "#5b6360", fontSize: 11 },
    };
  });
  return (
    <div className="graph-container">
      <ReactFlow
        key={`${snapshot.id}:${focus}`}
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.3}
        maxZoom={1.5}
        onNodeClick={(_event, node) => {
          if (snapshot.tasks.some((t) => t.id === node.id)) {
            openTask(node.id);
            return;
          }
          const source = documentSource(
            snapshot,
            node.id,
            adjacent.find((r) => r.to === node.id)?.targetLine || 1,
          );
          if (source) open(source);
          else {
            const ref = adjacent.find((r) => `unresolved:${r.id}` === node.id);
            if (ref) highlight([ref.id]);
          }
        }}
        onEdgeClick={(_event, edge) =>
          highlight((edge.data?.ids as string[]) || [edge.id])
        }
      >
        <Background color="#d8dfda" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {(incoming.length > 6 || outgoing.length > 6) && (
        <span className="graph-overflow">
          图中仅显示每侧前 6 个节点，完整引用见下方
        </span>
      )}
    </div>
  );
}
export function RelationsPage({
  snapshot,
  selected,
  selectedRealTaskId,
  select,
  open,
  openTask,
  openProduct,
}: {
  snapshot: Snapshot;
  selected?: string;
  selectedRealTaskId?: string | null;
  select: (id: string) => void;
  open: OpenSource;
  openTask: (id: string) => void;
  openProduct: (key: string, workItemId?: string) => void;
}) {
  const [highlight, setHighlight] = useState<string[]>([]);
  const productGraph = useMemo(() => buildProductGraph(snapshot), [snapshot]);
  const productNodes = [...productGraph.nodes.values()].filter(
    (node) => node.kind === "product",
  );
  const workNodes = [...productGraph.nodes.values()].filter(
    (node) => node.kind === "work",
  );
  const ids = [
    ...snapshot.tasks.map((t) => t.id),
    ...snapshot.documents.map((d) => d.id),
    ...productNodes.map((node) => node.id),
    ...workNodes.map((node) => node.id),
  ];
  // An explicit selection removed by refresh must stay unavailable, never jump to another item.
  const focus = selected ?? ids[0];
  const focusTask = snapshot.tasks.find((task) => task.id === focus);
  const identityChanged = Boolean(
    focusTask &&
    selectedRealTaskId !== undefined &&
    (focusTask.realTaskId ?? null) !== selectedRealTaskId,
  );
  const available = Boolean(focus && ids.includes(focus) && !identityChanged);
  const legacyFocus =
    snapshot.tasks.some((task) => task.id === focus) ||
    snapshot.documents.some((doc) => doc.id === focus);
  const adjacent = snapshot.relations.filter(
    (r) => r.from === focus || r.to === focus,
  );
  const originDocument = focusTask?.source.documentId;
  // Document references in task files are attached to the task, with the document as their source.
  const documentTask = snapshot.tasks.find(
    (t) => t.source.documentId === focus,
  );
  const related = documentTask
    ? snapshot.relations.filter(
        (r) => r.from === documentTask.id || r.to === focus || r.from === focus,
      )
    : adjacent;
  return (
    <div className="relations-page">
      <div className="page-title">
        <h2>局部关联</h2>
        <select
          aria-label="关联中心"
          value={identityChanged ? "" : focus || ""}
          onChange={(e) => {
            select(e.target.value);
            setHighlight([]);
          }}
        >
          {identityChanged ? (
            <option value="" disabled>
              所选任务身份已变化，请重新选择
            </option>
          ) : focus && !available ? (
            <option value={focus}>所选关联中心已不在本次快照中</option>
          ) : null}
          {productNodes.length > 0 && (
            <optgroup label="产品条目">
              {productNodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {node.detail} · {node.title}
                </option>
              ))}
            </optgroup>
          )}
          {workNodes.length > 0 && (
            <optgroup label="计划工作项">
              {workNodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {node.detail} · {node.title}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="任务">
            {snapshot.tasks.map((t) => (
              <option value={t.id} key={t.id}>
                {t.number || "未记录编号"} · {t.title}
              </option>
            ))}
          </optgroup>
          <optgroup label="文档">
            {snapshot.documents.map((d) => (
              <option value={d.id} key={d.id}>
                {d.title} · {d.path}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {focus && available ? (
        <>
          <div className="relation-focus">
            <span className="muted">中心</span>
            <strong>
              {focusTask?.title ||
                snapshot.documents.find((d) => d.id === focus)?.title ||
                productGraph.nodes.get(focus)?.title}
            </strong>
            {originDocument && (
              <button
                className="text-link"
                onClick={() => {
                  const source = documentSource(snapshot, originDocument);
                  if (source) open(source);
                }}
              >
                查看任务原文
              </button>
            )}
          </div>
          {productGraph.nodes.has(focus) && (
            <ProductRelationPanel
              key={`${snapshot.id}:${focus}`}
              snapshot={snapshot}
              model={productGraph}
              focus={focus}
              open={open}
              openTask={openTask}
              openProduct={openProduct}
            />
          )}
          {legacyFocus && (
            <>
              <RelationGraph
                snapshot={snapshot}
                focus={focus}
                open={open}
                openTask={openTask}
                highlight={(ids) => {
                  setHighlight(ids);
                  document
                    .getElementById("relation-evidence")
                    ?.scrollIntoView({ block: "start", behavior: "smooth" });
                }}
              />
              <section id="relation-evidence">
                <h3>
                  引用依据 <small>{related.length}</small>
                </h3>
                <RelationList
                  snapshot={snapshot}
                  relations={related}
                  open={open}
                  openTask={openTask}
                  highlight={highlight}
                />
              </section>
            </>
          )}
        </>
      ) : (
        <Empty
          title={
            identityChanged
              ? "所选关联中心的任务真实身份已变化"
              : selected
                ? "所选关联中心已不可用"
                : "暂无可展示的关联节点"
          }
          detail={
            identityChanged
              ? "同一来源文件已声明另一真实任务身份，未将旧选择关联到新任务。请在关联中心明确重新选择。"
              : selected
                ? "该条目已删除、退出本次读取范围，或身份无法再定位。请明确选择其他关联中心。"
                : "确认范围并读取文档后查看。"
          }
        />
      )}
    </div>
  );
}
