import {
  ContributionCounts,
  CurrentWorkPanel,
  FocusResults,
} from "./overview-focus";
import {
  contributionDiagnostics,
  contributionClass,
  contributionLabels,
  contributionLabel,
  contributionSummary,
} from "../shared/product-contribution";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  buildOverviewData,
  isOverviewSnapshot,
  requirementDescription,
  type OverviewRequirement,
} from "../shared/overview-data";
import { LazyDetails, PagedItems } from "./lazy-details";
import {
  defaultOverviewFilters,
  matchesOverviewFilters,
  overviewConclusionOptions,
  overviewFiltersActive,
  overviewReportVerdict,
  overviewRequirementSignals,
  type ConclusionFilter,
  type OverviewFilters,
} from "./overview-card-state";
import { OverviewFilterBar } from "./overview-filters";
import { navigationScrollContainer } from "./navigation-scroll";
import { hasRequirementWork } from "../shared/overview-progress";
import { useTemporaryNodePositions } from "./temporary-node-positions";
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  useNodesInitialized,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProductBindingView, ProductItem } from "../shared/product-types";
import type { Task } from "../shared/types";
import {
  conclusionLabels,
  goalRequirements,
  productView,
  reportedSubjects,
  selectAssessment,
  type Subject,
} from "../shared/product-view";
import { AssessmentOverview } from "./assessment-overview";
import {
  requirementBindings,
  requirementHierarchy,
} from "../shared/product-hierarchy";
import { assessmentGoal, productStructure } from "../shared/product-structure";
import { buildProductGraph, ProductRelationPanel } from "./product-graph";
import {
  ProductDetail,
  Body as ProductBody,
  ProductStatusPanel,
  ProductEvidence,
  type ProductContext,
  type OverviewContext,
} from "./product";
import { Modal, SourceButton } from "./components";
import { lifecycleLabels } from "./runtime";

type ViewState = {
  goal: string;
  subject: string;
  filter: string;
  query: string;
  scope: Record<string, string>;
  dependencies: boolean;
  expanded: string[];
  panel: "" | "candidates" | "unlinked" | "status";
  candidateAll: boolean;
  candidateFocus: string;
  unlinkedQuery: string;
  navigationOpen: boolean;
  tab: "overview" | "tasks" | "evidence" | "body";
  taskFilter: "all" | "active" | "closed";
  scroll: number;
};
const stored = new Map<string, ViewState>();
const initial = (): ViewState => ({
  goal: "",
  subject: "",
  filter: "all",
  query: "",
  scope: {},
  dependencies: false,
  expanded: [],
  panel: "",
  candidateAll: false,
  candidateFocus: "",
  unlinkedQuery: "",
  navigationOpen: false,
  tab: "overview",
  taskFilter: "all",
  scroll: 0,
});
function SubjectPicker({
  product,
  value,
  set,
}: {
  product: NonNullable<ProductContext["snapshot"]["product"]>;
  value: string;
  set: (v: string) => void;
}) {
  return (
    <label className="requirements-v3-delivery-picker">
      <span>交付记录</span>
      <select
        aria-label="被评估对象"
        value={value}
        onChange={(e) => set(e.target.value)}
      >
        <option value="">仅浏览需求</option>
        {reportedSubjects(product).map((s, i) => (
          <option key={i} value={JSON.stringify(s)}>
            {s.kind} · {s.value} {s.revision && `@${s.revision}`}{" "}
            {s.limitations && `（${s.limitations}）`}
          </option>
        ))}
      </select>
    </label>
  );
}

function SelectedRequirementFocus({ selected }: { selected?: string }) {
  const ready = useNodesInitialized();
  const { fitView, getNode } = useReactFlow();
  useEffect(() => {
    if (!ready || !selected || !getNode(selected)) return;
    void fitView({
      nodes: [{ id: selected }],
      padding: 0.6,
      maxZoom: 1.15,
      duration: 180,
    });
  }, [ready, selected, fitView, getNode]);
  return null;
}

export function RequirementsV3({
  selected,
  select,
  configure,
  ...context
}: ProductContext & {
  selected?: string;
  select: (key: string) => void;
  configure: () => void;
}) {
  const product = context.snapshot.product;
  const [state, setState] = useState<ViewState>(() => ({
    ...initial(),
    ...(stored.get(context.snapshot.projectId) || {}),
  }));
  const current = useRef(state);
  current.current = state;
  const update = (value: Partial<ViewState>) =>
    setState((previous) => ({ ...previous, ...value }));

  useEffect(() => {
    stored.set(context.snapshot.projectId, state);
  }, [state, context.snapshot.projectId]);
  useEffect(() => {
    if (!selected || !product) return;
    const target = product.items.find((entry) => entry.key === selected);
    if (target?.type !== "requirement") return;
    const model = productView(product);
    const currentGoal = state.goal || model.rootGoal?.key;
    if (
      goalRequirements(product, currentGoal).some(
        (entry) => entry.key === selected,
      )
    )
      return;
    const goal = product.items.find(
      (entry) =>
        entry.usable &&
        entry.type === "goal" &&
        goalRequirements(product, entry.key).some(
          (requirement) => requirement.key === selected,
        ),
    );
    if (goal) setState((previous) => ({ ...previous, goal: goal.key }));
  }, [selected, product, state.goal]);
  useEffect(() => {
    const container = navigationScrollContainer();
    if (container) container.scrollTop = current.current.scroll;
    return () => {
      stored.set(context.snapshot.projectId, {
        ...current.current,
        scroll: container?.scrollTop || 0,
      });
    };
  }, [context.snapshot.projectId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected) select("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, select]);

  if (!product?.items.length)
    return (
      <ProductStatusPanel
        product={product}
        navigation={context.snapshot.navigation}
        open={context.open}
        configure={configure}
      />
    );

  const model = productView(product);
  const goal =
    product.items.find((item) => item.key === state.goal && item.usable) ||
    (!state.goal ? model.rootGoal : undefined);
  let subject: Subject | undefined;
  if (state.subject) {
    try {
      subject = JSON.parse(state.subject) as Subject;
    } catch {
      subject = undefined;
    }
  }
  const item = product.items.find((entry) => entry.key === selected);
  const scopeKey = (target: ProductItem) =>
    JSON.stringify([target.type === "goal" ? target.id : goal?.id, target.id]);
  const scopeFor = (target: ProductItem) => state.scope[scopeKey(target)];
  const chooseScope = (target: ProductItem, scope: string) =>
    update({ scope: { ...state.scope, [scopeKey(target)]: scope } });
  const reqs = goalRequirements(product, goal?.key).filter(
    (entry) => entry.metadata.scope === "current",
  );
  const activeFilter = subject ? state.filter : "all";
  const matches = reqs.filter((entry) => {
    const matchesText = `${entry.id} ${entry.title} ${entry.body}`
      .toLowerCase()
      .includes(state.query.trim().toLowerCase());
    if (!matchesText) return false;
    if (activeFilter === "all") return true;
    const selection = selectionFor(
      product,
      entry,
      goal || undefined,
      subject,
      scopeFor(entry),
    );
    const conclusion = selection?.conclusion;
    return activeFilter === "gaps"
      ? ["not-satisfied", "partially-satisfied"].includes(conclusion || "")
      : conclusion === "undetermined";
  });
  const filtered = Boolean(state.query.trim()) || activeFilter !== "all";
  const reveal = new Set(filtered ? matches.map((entry) => entry.key) : []);
  if (item && reqs.some((entry) => entry.key === item.key))
    reveal.add(item.key);
  const expanded = new Set(state.expanded || []);
  const hierarchy = requirementHierarchy(
    product,
    reqs,
    expanded,
    reveal,
    filtered,
  );
  const keys = new Set(hierarchy.visible.map((entry) => entry.key));
  if (goal) keys.add(goal.key);
  if (model.rootGoal) keys.add(model.rootGoal.key);
  // Keep only ancestors needed for the currently visible branch. A shared
  // requirement remains one identity even when it has more than one parent.
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of model.relations) {
      if (
        keys.has(relation.ownerKey) &&
        relation.targetKey &&
        ["part_of", "supports"].includes(relation.link.relation) &&
        !keys.has(relation.targetKey)
      ) {
        keys.add(relation.targetKey);
        changed = true;
      }
    }
  }
  const selectedDependencies =
    state.dependencies && item
      ? model.relations.filter(
          (relation) =>
            relation.link.relation === "depends_on" &&
            (relation.ownerKey === item.key || relation.targetKey === item.key),
        )
      : [];
  selectedDependencies.forEach((relation) => {
    keys.add(relation.ownerKey);
    if (relation.targetKey) keys.add(relation.targetKey);
  });
  const visible = [
    ...product.items.filter(
      (entry) => entry.usable && entry.type === "goal" && keys.has(entry.key),
    ),
    ...model.registered,
    ...model.unordered,
    ...product.items.filter((entry) => entry.usable && entry.type === "module"),
  ].filter(
    (entry, index, array) =>
      keys.has(entry.key) &&
      array.findIndex((candidate) => candidate.key === entry.key) === index,
  );
  const structure = model.relations.filter(
    (relation) =>
      relation.targetKey &&
      keys.has(relation.ownerKey) &&
      keys.has(relation.targetKey) &&
      ["part_of", "supports"].includes(relation.link.relation),
  );
  const depth = new Map(
    visible.map((entry) => [entry.key, entry.type === "goal" ? 0 : 1]),
  );
  for (let pass = 0; pass < visible.length; pass++) {
    let moved = false;
    for (const relation of structure) {
      const value = Math.min(
        visible.length,
        (depth.get(relation.targetKey!) || 0) + 1,
      );
      if ((depth.get(relation.ownerKey) || 0) < value) {
        depth.set(relation.ownerKey, value);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const positions = new Map<number, number>();
  const nodes: Node[] = visible.map((entry) => {
    const level = depth.get(entry.key) || 0;
    const column = positions.get(level) || 0;
    positions.set(level, column + 1);
    const evaluationGoal = assessmentGoal(entry, goal || undefined);
    const selection = subject
      ? selectionFor(
          product,
          entry,
          goal || undefined,
          subject,
          scopeFor(entry),
        )
      : undefined;
    const childCount = directChildren(product, entry).length;
    const status =
      entry.type === "module"
        ? "分类节点 · 仅用于归类"
        : !subject
          ? childCount
            ? `${childCount} 项直接子需求`
            : "查看具体要求"
          : selection?.reasons.length
            ? "待核对"
            : selection
              ? conclusionLabels[selection.conclusion]
              : childCount
                ? `${childCount} 项直接子需求`
                : "查看具体要求";
    const conclusion = selection?.conclusion;
    const isSelected = entry.key === selected;
    return {
      id: entry.key,
      className: `requirements-v3-node${entry.type === "goal" ? " is-goal" : ""}${isSelected ? " is-selected" : ""}`,
      position: { x: column * 285, y: level * 185 },
      data: {
        label: (
          <div>
            <button
              className="goal-graph-node"
              data-node-id={entry.id}
              data-node-conclusion={
                entry.type === "module" ? undefined : conclusion
              }
              data-node-goal={evaluationGoal?.id}
              data-node-scope={selection?.scopeId}
              onClick={() => selectItem(entry.key)}
            >
              <small>
                {entry.type === "goal"
                  ? "目标"
                  : entry.type === "module"
                    ? "模块 / 分类"
                    : "需求"}{" "}
                · {entry.id}
                {!matches.includes(entry) && entry.type === "requirement"
                  ? " · 上下文"
                  : ""}
              </small>
              <strong>{entry.title}</strong>
              <span>{status}</span>
            </button>
            {!!childCount && (
              <button
                className="goal-graph-expand nodrag"
                aria-label={`${expanded.has(entry.key) ? "收起" : "展开"}子需求 · ${entry.id}`}
                aria-expanded={expanded.has(entry.key)}
                onClick={() =>
                  update({
                    expanded: expanded.has(entry.key)
                      ? state.expanded.filter((key) => key !== entry.key)
                      : [...state.expanded, entry.key],
                  })
                }
              >
                {expanded.has(entry.key) ? "收起" : "展开"}已登记子要求 ·{" "}
                {childCount}
              </button>
            )}
          </div>
        ),
      },
      style: {
        width: 255,
        padding: 0,
      },
    };
  });
  const edges: Edge[] = [...structure, ...selectedDependencies].map(
    (relation) => ({
      id: relation.key,
      source: relation.targetKey!,
      target: relation.ownerKey,
      label:
        relation.link.relation === "part_of"
          ? "组成 / 细化"
          : relation.link.relation === "supports"
            ? "支撑"
            : "依赖",
      style:
        relation.link.relation === "depends_on"
          ? { strokeDasharray: "5 4", stroke: "var(--overview-amber)" }
          : undefined,
    }),
  );
  const draggable = useTemporaryNodePositions(
    nodes,
    `${context.snapshot.id}:${goal?.key || "all"}`,
  );
  const explanation = productStructure(product, goal?.key, item?.key);
  const candidates = state.candidateAll
    ? explanation.candidates
    : explanation.relatedCandidates;
  const candidateFocus = candidates.some(
    (relation) => relation.ownerKey === state.candidateFocus,
  )
    ? state.candidateFocus
    : candidates[0]?.ownerKey;
  const candidateGraph =
    state.panel === "candidates"
      ? buildProductGraph(context.snapshot)
      : undefined;
  if (candidateGraph) {
    const candidateKeys = new Set(
      candidates.map((relation) => `link:${relation.key}`),
    );
    candidateGraph.relations = candidateGraph.relations.filter((relation) =>
      candidateKeys.has(relation.id),
    );
  }
  const selectItem = (key: string) => {
    if (key && key !== selected) update({ tab: "overview", taskFilter: "all" });
    select(key);
  };
  const runtimeLabel = context.snapshot.runtime
    ? context.snapshot.runtime.source === "file-snapshot"
      ? "Task 使用文件快照"
      : context.snapshot.runtime.source === "runtime-query"
        ? "Task 使用 Runtime 查询"
        : "Task 状态待核对"
    : "Task 状态待核对";
  const structureIssueCount =
    explanation.relatedCandidates.length + explanation.currentUnlinked.length;
  return (
    <div className="product-page requirements-v3-page">
      <div className="requirements-v3-page-head">
        <div>
          <h2>
            目标与需求
            <span className="requirements-v3-visually-hidden">图</span>
            <span className="requirements-v3-visually-hidden">
              目标与需求图
            </span>
          </h2>
          <p>看清业务结构，逐层查看具体要求与已有成果。</p>
        </div>
        <div className="requirements-v3-structure-actions">
          <button
            className="text-link requirements-v3-structure-link"
            onClick={() =>
              update({
                panel:
                  state.panel === "candidates" || state.panel === "unlinked"
                    ? ""
                    : "candidates",
              })
            }
          >
            候选与未连入事项
            {structureIssueCount ? ` · ${structureIssueCount}` : ""} ↗
          </button>
          <button
            className="text-link requirements-v3-aux-trigger"
            aria-expanded={state.panel === "candidates"}
            onClick={() =>
              update({
                panel: state.panel === "candidates" ? "" : "candidates",
              })
            }
          >
            查看候选关系
          </button>
          <button
            className="text-link requirements-v3-aux-trigger"
            aria-expanded={state.panel === "unlinked"}
            onClick={() =>
              update({ panel: state.panel === "unlinked" ? "" : "unlinked" })
            }
          >
            查看未连入需求
          </button>
        </div>
      </div>
      {selected && !item && (
        <p className="requirements-v3-alert" role="status">
          所选条目已退出本次范围；请在当前图或历史入口重新选择。
        </p>
      )}
      <div className="requirements-v3-toolbar">
        <label>
          所选目标
          <select
            aria-label="所选目标"
            value={goal?.key || ""}
            onChange={(event) => update({ goal: event.target.value })}
          >
            {!model.rootGoal && <option value="">总目标未明确</option>}
            {product.items
              .filter((entry) => entry.usable && entry.type === "goal")
              .map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.key === model.rootGoal?.key
                    ? "项目总目标"
                    : `${entry.id} · ${entry.title}`}
                </option>
              ))}
          </select>
        </label>
        <label className="requirements-v3-search-field">
          <span className="requirements-v3-visually-hidden">
            搜索需求或功能
          </span>
          <input
            aria-label="搜索需求图"
            placeholder="搜索需求或功能…"
            value={state.query}
            onChange={(event) => update({ query: event.target.value })}
          />
        </label>
        <div
          className="requirements-v3-filter-group"
          role="group"
          aria-label="结论筛选"
        >
          {(
            [
              ["all", "全部"],
              ["gaps", "已确认缺口"],
              ["unknown", "待核对"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={
                (activeFilter === value ? "active " : "") +
                (!subject && value !== "all" ? "requires-delivery" : "")
              }
              aria-label={
                value === "all"
                  ? "全部"
                  : value === "gaps"
                    ? "未满足与部分满足"
                    : "尚未判定"
              }
              onClick={() => {
                if (value !== "all" && !subject) return;
                update({ filter: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="requirements-v3-filter-select">
          结论筛选
          <select
            aria-label="结论筛选"
            value={activeFilter}
            onChange={(event) => {
              const value = event.target.value;
              if (value !== "all" && !subject) return;
              update({ filter: value });
            }}
          >
            <option value="all">全部</option>
            <option value="gaps">未满足与部分满足</option>
            <option value="unknown">尚未判定</option>
          </select>
        </label>
        <SubjectPicker
          product={product}
          value={state.subject}
          set={(value) =>
            update({ subject: value, filter: value ? state.filter : "all" })
          }
        />
        <button
          className={`requirements-v3-read-state ${state.panel === "status" ? "active" : ""}`}
          aria-expanded={state.panel === "status"}
          onClick={() =>
            update({ panel: state.panel === "status" ? "" : "status" })
          }
        >
          <span className="requirements-v3-status-dot" /> {runtimeLabel} ·
          查看读取状态
        </button>
      </div>
      {subject && (
        <p className="requirements-v3-version-note">
          当前查看：{subjectText(subject)}。结果仅针对所选对象、目标与范围。
        </p>
      )}
      {model.rootReason && (
        <p className="requirements-v3-alert" role="status">
          {model.rootReason} · 可读目标与需求继续保留。
        </p>
      )}
      {state.panel === "status" && (
        <section className="requirements-v3-status-panel" aria-label="读取状态">
          <ProductStatusPanel
            product={product}
            navigation={context.snapshot.navigation}
            open={context.open}
            configure={configure}
          />
          <ul>
            {model.diagnostics.map((diagnostic) => (
              <li key={diagnostic}>{diagnostic}</li>
            ))}
          </ul>
        </section>
      )}
      {state.panel === "candidates" && (
        <section
          className="product-structure-panel requirements-v3-aux-panel"
          aria-label="候选结构关系"
        >
          <h3>已记录候选结构关系 · {candidates.length} 条</h3>
          <label>
            <input
              type="checkbox"
              checked={state.candidateAll}
              onChange={(event) =>
                update({ candidateAll: event.target.checked })
              }
            />{" "}
            查看本次已读取内容中的全部候选
          </label>
          <p className="muted">
            候选不进入正式图、Task 汇集或达成结论；已否定关系保留为依据。
          </p>
          {!candidates.length && (
            <p>本次范围未记录相关候选；可切换全部候选或查看条目来源。</p>
          )}
          <ul className="product-structure-list">
            {candidates.map((relation) => (
              <li key={relation.key}>
                <button
                  className="text-link"
                  onClick={() => update({ candidateFocus: relation.ownerKey })}
                >
                  {
                    product.items.find(
                      (entry) => entry.key === relation.ownerKey,
                    )?.id
                  }{" "}
                  → {relation.link.target} · {relation.link.relation}
                </button>
                {relation.resolution !== "resolved" &&
                  ` · 引用 / 方向 / 身份异常（${relation.resolution}），仅查看依据`}
              </li>
            ))}
          </ul>
          {candidateGraph && candidateFocus && (
            <ProductRelationPanel
              snapshot={context.snapshot}
              model={candidateGraph}
              focus={candidateFocus}
              open={context.open}
              openTask={context.openTask}
              openProduct={selectItem}
              hideUnresolved
            />
          )}
        </section>
      )}
      {state.panel === "unlinked" && (
        <section
          className="product-structure-panel requirements-v3-aux-panel"
          aria-label="未连入需求"
        >
          <h3>
            未在所选目标声明路径中的可读需求 · {explanation.unlinked.length} 项
          </h3>
          <p className="muted">
            没有声明路径不表示未实现；其他目标、非当前范围和结构未决分别保留。
          </p>
          <input
            aria-label="搜索未连入需求"
            placeholder="搜索 ID、标题或正文"
            value={state.unlinkedQuery}
            onChange={(event) => update({ unlinkedQuery: event.target.value })}
          />
          <ul className="product-structure-list">
            {explanation.unlinked
              .filter(({ item: entry }) =>
                `${entry.id} ${entry.title} ${entry.body}`
                  .toLowerCase()
                  .includes(state.unlinkedQuery.toLowerCase()),
              )
              .map(({ item: entry, reasons, otherGoals }) => (
                <li key={entry.key} data-unlinked-id={entry.id}>
                  <button
                    className="text-link"
                    onClick={() => selectItem(entry.key)}
                  >
                    {entry.id} · {entry.title}
                  </button>
                  <p>{reasons.join("；")}</p>
                  {otherGoals.map((otherGoal) => (
                    <button
                      key={otherGoal.key}
                      className="text-link"
                      onClick={() => update({ goal: otherGoal.key })}
                    >
                      查看目标 · {otherGoal.id}
                    </button>
                  ))}
                  <SourceButton source={entry.source} open={context.open} />
                </li>
              ))}
          </ul>
        </section>
      )}
      <div className={`requirements-v3-stage ${item ? "has-inspector" : ""}`}>
        <section className="requirements-v3-canvas-card">
          <div className="requirements-v3-canvas-head">
            <span>
              <strong>当前结构</strong> · 实线表示已声明关系
            </span>
            <span className="requirements-v3-meta">
              层级展开不改变文档登记顺序
            </span>
          </div>
          <div className="goal-requirement-graph requirements-v3-graph">
            <ReactFlow
              nodes={draggable.nodes}
              onNodesChange={draggable.onNodesChange}
              edges={edges}
              nodesDraggable
              nodeDragThreshold={4}
              nodeClickDistance={4}
              nodesConnectable={false}
              edgesReconnectable={false}
              fitView
              minZoom={0.25}
            >
              <SelectedRequirementFocus selected={selected} />
              <Background color="var(--overview-rule)" gap={19} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="requirements-v3-canvas-footer">
            <span>
              显示 {hierarchy.visible.length} 项需求 · 仅统计当前可见层级
            </span>
            <span>拖动节点临时调整 · 拖动画布 · 点击节点查看详情</span>
          </div>
        </section>
        {item && (
          <RequirementsInspector
            item={item}
            goal={goal || undefined}
            subject={subject}
            scopeId={scopeFor(item)}
            context={context}
            select={selectItem}
            chooseScope={(scope) => chooseScope(item, scope)}
            scopeFor={scopeFor}
            tab={state.tab || "overview"}
            setTab={(tab) => update({ tab })}
            taskFilter={state.taskFilter || "all"}
            setTaskFilter={(taskFilter) => update({ taskFilter })}
          />
        )}
      </div>
      <p className="requirements-v3-graph-summary">
        所选目标声明路径内 {reqs.length} 个当前需求；筛选命中 {matches.length}{" "}
        个；展开与筛选保留必要祖先。
      </p>
      <details
        className="requirements-v3-navigation"
        open={state.navigationOpen}
        onToggle={(event) => {
          if (event.currentTarget.open !== state.navigationOpen)
            update({ navigationOpen: event.currentTarget.open });
        }}
      >
        <summary>搜索与条目导航（含历史/旧格式）</summary>
        <div className="requirements-v3-navigation-list">
          {product.items.map((entry) => (
            <button
              key={entry.key}
              className="text-link"
              onClick={() => selectItem(entry.key)}
            >
              {entry.id} · {entry.title}
              {entry.metadata.scope === "retired" ? " · 历史" : ""}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
function OriginalAssessment({ report }: { report: ProductItem }) {
  const raw = report.rawMetadata;
  const metadata =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : report.metadata;
  const originalConclusion = metadata.conclusion;
  const conclusion =
    typeof originalConclusion === "string"
      ? Object.hasOwn(conclusionLabels, originalConclusion)
        ? conclusionLabels[originalConclusion as keyof typeof conclusionLabels]
        : `${originalConclusion}（无法识别）`
      : "未提供结论或字段类型异常";
  const checkedAt =
    typeof metadata.checked_at === "string"
      ? metadata.checked_at
      : "未提供检查时间或字段类型异常";
  return (
    <p>
      原报告：{conclusion} · {checkedAt}
      {!report.usable && "（字段异常，保留原字段供核对）"}
    </p>
  );
}

type ReadingSection = { heading: string; text: string; lines: string[] };

function readingSections(item: ProductItem): ReadingSection[] {
  const body = item.body
    .replace(
      /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---[ \t]*(?=\r\n|\n|\r|$)/,
      "",
    )
    .replace(/\r\n|\r/g, "\n");
  const sections: ReadingSection[] = [];
  let current: ReadingSection | undefined;
  const push = () => {
    if (!current) return;
    current.text = current.lines.join("\n").trim();
    sections.push(current);
  };
  for (const line of body.split("\n")) {
    const match = line.match(/^#{2,6}\s+(.+?)\s*$/);
    if (match) {
      push();
      current = { heading: match[1], text: "", lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  push();
  return sections;
}

function plainMarkdown(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[`*_>#]/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionText(item: ProductItem, pattern: RegExp) {
  return (
    readingSections(item).find((section) => pattern.test(section.heading))
      ?.text || ""
  );
}

function compactReadingText(text: string, limit = 190) {
  const value = plainMarkdown(text);
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit).trim()}…` : value;
}

function businessSummary(item: ProductItem) {
  const text = sectionText(
    item,
    item.type === "goal"
      ? /目标说明|目标内容|项目定位/i
      : item.type === "module"
        ? /业务能力|模块说明|分类/i
        : /需求内容|业务能力|功能说明|能力说明/i,
  );
  return compactReadingText(text || item.body) || "完整业务范围见原文";
}

function boundarySummary(item: ProductItem) {
  const text = sectionText(item, /范围|边界|约束|限制|取舍/i);
  return (
    compactReadingText(text, 260) ||
    "未在当前条目中提取到单独的范围边界；请查看原文。"
  );
}

function acceptancePoints(item: ProductItem) {
  const section = readingSections(item).find((entry) =>
    /验收|具体要求|行为条件|业务规则/i.test(entry.heading),
  );
  if (!section) return [];
  const points = section.lines
    .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line))
    .map((line) =>
      compactReadingText(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""), 220),
    )
    .filter(Boolean);
  return points.length
    ? points
    : [compactReadingText(section.text, 260)].filter(Boolean);
}

function reportExcerpt(report: ProductItem) {
  return readingSections(report)
    .filter((section) =>
      /覆盖范围|交付与验证依据|剩余与待核对/i.test(section.heading),
    )
    .map((section) => ({
      heading: section.heading,
      text: compactReadingText(section.text, 280),
    }))
    .filter((section) => section.text);
}

const assessmentReasonLabels: Record<string, string> = {
  "scope-unavailable": "所选目标下尚未记录本需求的评估范围。",
  "scope-selection-required":
    "本需求声明了多个评估范围，请在当前条目内选择一个。",
  "scope-not-current": "所选范围已不在当前需求声明中；历史材料仍可查看。",
  "subject-selection-required": "尚未选择交付记录；仍可继续浏览需求定义。",
  "no-applicable-report": "这份交付记录与范围下暂无适用报告。",
  conflict: "存在未核对的报告或定位冲突，暂不选择单一结论。",
  "metadata-incomplete": "报告字段不完整，保留原记录供核对。",
  "scope-definition-changed":
    "报告记录的范围定义与当前声明不同，需要按当前要求核对。",
  "definition-algorithm-changed": "需求定义算法发生变化，需要按当前要求核对。",
  "definition-changed": "需求定义已变化，历史成果不能直接作为当前结论。",
  "goal-definition-changed": "目标定义已变化，历史成果不能直接作为当前结论。",
  "target-definition-unverified": "需求定义依据尚未完成来源核对。",
  "goal-definition-unverified": "目标定义依据尚未完成来源核对。",
  "pending-evidence": "有新材料待对账；原报告结论与限制同时保留。",
  "multiple-reports": "存在多份未替代报告，暂不自动挑选其中一份。",
};

function assessmentReason(reason: string) {
  return assessmentReasonLabels[reason] || reason;
}

function conclusionClass(conclusion: keyof typeof conclusionLabels) {
  return {
    satisfied: "requirements-v3-ok",
    "partially-satisfied": "requirements-v3-gap",
    "not-satisfied": "requirements-v3-bad",
    undetermined: "requirements-v3-unknown",
  }[conclusion];
}

function subjectText(subject?: Subject) {
  if (!subject) return "仅浏览需求";
  const kind =
    (
      {
        "working-copy": "工作副本",
        commit: "提交",
        release: "发布版本",
      } as Record<string, string>
    )[subject.kind] || subject.kind;
  return `${kind} · ${subject.value || "未记录"}${subject.revision ? ` @${subject.revision}` : ""}`;
}

function directChildren(
  product: NonNullable<ProductContext["snapshot"]["product"]>,
  item: ProductItem,
) {
  const model = productView(product);
  const keys = new Set(
    model.relations
      .filter(
        (relation) =>
          relation.targetKey === item.key &&
          relation.link.relation === "part_of" &&
          relation.link.state === "active" &&
          relation.resolution === "resolved",
      )
      .map((relation) => relation.ownerKey),
  );
  return product.items.filter(
    (candidate) => candidate.usable && keys.has(candidate.key),
  );
}

function itemPath(
  product: NonNullable<ProductContext["snapshot"]["product"]>,
  item: ProductItem,
) {
  const model = productView(product);
  const path = [item];
  const seen = new Set([item.key]);
  let current = item;
  while (path.length < 8) {
    const relation = model.relations.find(
      (entry) =>
        entry.ownerKey === current.key &&
        entry.targetKey &&
        entry.link.relation === "part_of" &&
        !seen.has(entry.targetKey),
    );
    if (!relation?.targetKey) break;
    const parent = product.items.find(
      (candidate) => candidate.key === relation.targetKey,
    );
    if (!parent) break;
    seen.add(parent.key);
    path.push(parent);
    current = parent;
  }
  return path.reverse();
}

function selectionFor(
  product: NonNullable<ProductContext["snapshot"]["product"]>,
  item: ProductItem,
  goal: ProductItem | undefined,
  subject: Subject | undefined,
  scopeId?: string,
) {
  if (!goal || !["goal", "requirement"].includes(item.type)) return undefined;
  const evaluationGoal = assessmentGoal(item, goal);
  return evaluationGoal
    ? selectAssessment(product, item.id, evaluationGoal.id, subject, scopeId)
    : undefined;
}

export function ScopedConclusion({
  item,
  goal,
  subject,
  scopeId,
  context,
  chooseScope,
}: {
  item: ProductItem;
  goal?: ProductItem;
  subject?: Subject;
  scopeId?: string;
  context: ProductContext;
  chooseScope?: (s: string) => void;
}) {
  if (!goal)
    return (
      <section className="scoped-conclusion" data-conclusion="undetermined">
        <h3>尚未选择评估目标</h3>
        <p>仍可浏览当前需求；选择目标和交付记录后再查看范围化结果。</p>
      </section>
    );
  const selection = selectAssessment(
    context.snapshot.product!,
    item.id,
    goal.id,
    subject,
    scopeId,
  );
  const scopes =
    goal.metadata.assessment_scopes?.filter((s) => s.target === item.id) || [];
  const statusTitle = subject
    ? selection.reasons.length
      ? selection.conclusion === "undetermined"
        ? "尚未判定"
        : "结果待核对"
      : conclusionLabels[selection.conclusion]
    : "尚未选择交付记录";
  return (
    <section
      className="scoped-conclusion"
      data-conclusion={selection.conclusion}
    >
      <div className="requirements-v3-section-heading">
        <h3>{statusTitle}</h3>
        {selection.reports.length > 0 && (
          <span
            className={`requirements-v3-pill ${conclusionClass(selection.conclusion)}`}
          >
            {conclusionLabels[selection.conclusion]}
          </span>
        )}
      </div>
      <p className="requirements-v3-meta">
        目标：{goal.id} · 范围：{selection.scopeId || "未选择"} · 对象：
        {subjectText(subject)}
      </p>
      {scopes.length > 1 && chooseScope && (
        <label className="requirements-v3-inline-field">
          适用范围
          <select
            aria-label="适用范围"
            value={scopeId || ""}
            onChange={(e) => chooseScope(e.target.value)}
          >
            <option value="">请选择当前声明范围</option>
            {scopes.map((s) => (
              <option key={s.scope_id} value={s.scope_id}>
                {s.scope_id} · {s.coverage}
              </option>
            ))}
          </select>
        </label>
      )}
      {scopes.find((s) => s.scope_id === selection.scopeId)?.coverage && (
        <p className="requirements-v3-meta">
          {scopes.find((s) => s.scope_id === selection.scopeId)!.coverage}
        </p>
      )}
      {selection.reasons.length > 0 && (
        <div className="requirements-v3-reason-list">
          {selection.reasons.map((reason) => (
            <p key={reason}>{assessmentReason(reason)}</p>
          ))}
        </div>
      )}
      {selection.reasons.length > 0 && (
        <details className="requirements-v3-fold">
          <summary>技术诊断与原始状态码</summary>
          <code>{selection.reasons.join("、")}</code>
        </details>
      )}
      {selection.reports.map((report) => (
        <div
          key={report.key}
          className="requirements-v3-report-excerpt"
          data-report-excerpts={report.id}
        >
          <div className="requirements-v3-section-heading">
            <strong>当前适用报告</strong>
            <span className="requirements-v3-pill">{report.id}</span>
          </div>
          {reportExcerpt(report).map((excerpt) => (
            <p key={excerpt.heading}>
              <span className="requirements-v3-report-label">
                {excerpt.heading}
              </span>
              {excerpt.text}
            </p>
          ))}
          {!reportExcerpt(report).length && (
            <p className="requirements-v3-meta">
              原文片段未能提取，保留报告原文供核对。
            </p>
          )}
          <button
            className="text-link"
            onClick={() => context.openProduct(report.key)}
          >
            查看结论依据 · {report.id}
          </button>
          <OriginalAssessment report={report} />
          <SourceButton source={report.source} open={context.open} />
        </div>
      ))}
      {!!selection.historical.length && (
        <details className="requirements-v3-fold">
          <summary>
            历史记录 · {selection.historical.length}（本次尚不能采用）
          </summary>
          {selection.historical.map((i) => (
            <div key={i.key} className="requirements-v3-history-row">
              <button
                className="text-link"
                onClick={() => context.openProduct(i.key)}
              >
                {i.id} · {i.title}
              </button>
              <OriginalAssessment report={i} />
            </div>
          ))}
        </details>
      )}
      {!subject && (
        <p className="requirements-v3-meta">
          选择“交付记录”后，当前条目的范围化报告会在这里显示；不会自动采用最新报告。
        </p>
      )}
    </section>
  );
}
const storedOverviewFilters = new Map<string, OverviewFilters>();
export const OverviewV3 = memo(
  function OverviewV3({
    context,
    requirements,
  }: {
    context: OverviewContext;
    requirements: () => void;
    planning?: () => void;
  }) {
    const [assessmentKey, setAssessmentKey] = useState<string>();
    const data = isOverviewSnapshot(context.snapshot)
      ? context.snapshot.overview!
      : buildOverviewData(context.snapshot);
    const { planned, unordered, rootGoal } = data;
    const [filters, setFilters] = useState<OverviewFilters>(
      () =>
        storedOverviewFilters.get(context.snapshot.projectId) ||
        defaultOverviewFilters(),
    );
    useEffect(() => {
      storedOverviewFilters.set(context.snapshot.projectId, filters);
    }, [context.snapshot.projectId, filters]);
    const signals = useMemo(
      () =>
        new Map(
          [...data.planned, ...data.unordered]
            .filter(hasRequirementWork)
            .map((item) => [item.key, overviewRequirementSignals(item)]),
        ),
      [data],
    );
    const roadmap = planned.map((item, index) => ({ item, index })).reverse();
    const visibleRoadmap = roadmap.filter(
      ({ item }) =>
        hasRequirementWork(item) &&
        matchesOverviewFilters(signals.get(item.key)!, filters),
    );
    const visibleUnordered = unordered
      .map((item, index) => ({ item, index }))
      .reverse()
      .filter(
        ({ item }) =>
          hasRequirementWork(item) &&
          matchesOverviewFilters(signals.get(item.key)!, filters),
      );
    const filtersActive = overviewFiltersActive(filters);
    const hiddenCount = planned.length + unordered.length - signals.size;
    const conclusionCounts = Object.fromEntries(
      overviewConclusionOptions.map((option) => [
        option.value,
        [...signals.values()].filter((value) =>
          value.conclusions.includes(option.value),
        ).length,
      ]),
    ) as Record<ConclusionFilter, number>;
    const assessmentItem = [...planned, ...unordered].find(
      (item) => item.key === assessmentKey,
    );
    const totalTaskCount = data.taskCount;
    const openFirstTask = (item: OverviewRequirement) => {
      context.openTask(item.firstTask, item.key);
    };

    const card = (item: OverviewRequirement, index: number) => {
      const { taskState, assessmentRecords, dependencies, childCount } = item;
      const total = taskState.total + taskState.unconfirmed;
      const { verdicts, conclusions, review } = signals.get(item.key)!;
      const lifecycleStates = taskState.states.filter(
        (state) => state.label !== "身份未确认",
      );
      const taskSummary = lifecycleStates
        .map((state) => `${state.label} ${state.count}`)
        .join("，");
      const progressTag = item.work?.current ? "正在进行" : "已进行";
      return (
        <article
          className="overview-route-card"
          key={item.key}
          data-overview-card={item.id}
          data-review={review || undefined}
        >
          <div
            className="overview-card-verdict-strip"
            role="img"
            aria-label={`当前适用的范围结论：${verdicts.map((verdict) => verdict.label).join("、") || "无验收记录"}${review ? "；待核对" : ""}`}
          >
            {conclusions.map((conclusion) => (
              <span key={conclusion} data-conclusion={conclusion} />
            ))}
          </div>
          <div className="overview-card-heading">
            <span
              className="overview-route-pin"
              aria-label={`需求序号 ${index + 1}`}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="overview-route-code" title={item.id}>
              {item.id}
            </span>
            <span
              className="overview-progress-tag"
              title="按直接关联范围的步骤执行事实展示；验收结论单独核对"
            >
              {progressTag}
            </span>
            {review && (
              <span
                className="overview-review-marker"
                title="验收适用性待核对，原报告结论保留"
              >
                <i aria-hidden="true">!</i>待核对
              </span>
            )}
          </div>
          <div className="overview-route-body">
            <div className="overview-card-intro">
              <h3>
                <button
                  onClick={() => context.openProduct(item.key)}
                  title={item.title}
                >
                  {item.title}
                </button>
              </h3>
              <p
                className="overview-route-description"
                title={item.description}
              >
                {item.description}
              </p>
            </div>
            <div
              className="overview-requirement-assessments"
              aria-label="需求验收结果"
            >
              <div className="overview-card-section-heading">
                <span>
                  范围验收 <small>当前适用结论</small>
                </span>
                {assessmentRecords.length > 0 && (
                  <button
                    onClick={() => setAssessmentKey(item.key)}
                    aria-label={`查看验收记录 · ${item.id}`}
                  >
                    {assessmentRecords.length} 份记录 ↗
                  </button>
                )}
              </div>
              {assessmentRecords.length ? (
                <div
                  className="overview-verdicts"
                  data-single={assessmentRecords.length === 1}
                >
                  {verdicts.slice(0, 3).map((verdict) => (
                    <span
                      key={`${verdict.conclusion}:${verdict.review}`}
                      className="requirements-v3-pill overview-verdict-pill"
                      data-conclusion={verdict.conclusion}
                      title={`${verdict.label}${verdict.review ? " · 待核对" : " · 本次范围"}`}
                    >
                      <i aria-hidden="true">{verdict.symbol}</i>
                      {verdict.label}
                      {assessmentRecords.length > 1 && ` ${verdict.count}`}
                      {assessmentRecords.length === 1 &&
                        (verdict.review ? " · 待核对" : " · 本次范围")}
                    </span>
                  ))}
                  {verdicts.length > 3 && (
                    <button onClick={() => setAssessmentKey(item.key)}>
                      另 {verdicts.length - 3} 种结果 ↗
                    </button>
                  )}
                </div>
              ) : (
                <span className="overview-assessment-empty">
                  暂无范围验收记录
                </span>
              )}
            </div>
            <div
              className="overview-task-summary"
              aria-label={`共 ${taskState.total} 个唯一 Task 身份${taskSummary ? `，${taskSummary}` : ""}`}
            >
              <div className="overview-card-section-heading">
                <span>
                  工作类型 <small>按 Task 身份</small>
                </span>
              </div>
              <ContributionCounts summary={item.contributionSummary} compact />
              <div className="overview-card-section-heading overview-lifecycle-heading">
                <span>Task 生命周期</span>
                <strong>{taskState.total}</strong>
              </div>
              <div className="overview-task-bar" aria-hidden="true">
                {lifecycleStates.map((state) => (
                  <span
                    key={state.label}
                    data-tone={state.tone}
                    style={{
                      width: `${(state.count / taskState.total) * 100}%`,
                    }}
                  />
                ))}
              </div>
              {taskState.total ? (
                <div className="overview-task-states" title={taskSummary}>
                  {lifecycleStates.slice(0, 3).map((state) => (
                    <span key={state.label}>
                      <i data-tone={state.tone} />
                      <span>{state.label}</span>
                      <b>{state.count}</b>
                    </span>
                  ))}
                  {lifecycleStates.length > 3 && (
                    <button onClick={() => context.openProduct(item.key)}>
                      另 {lifecycleStates.length - 3} 种状态 ↗
                    </button>
                  )}
                </div>
              ) : (
                <p className="overview-task-empty">
                  {total
                    ? "Task 身份待确认，生命周期待核对"
                    : "尚未记录 Task 关联"}
                </p>
              )}
            </div>
            <div className="overview-route-predecessor">
              <span>前置需求</span>
              <strong title={dependencies.join(" / ")}>
                {dependencies.length ? `${dependencies.length} 项` : "无"}
              </strong>
              {taskState.associationPending > 0 && (
                <button
                  className="overview-association-note text-link"
                  aria-label={`查看待核对关联 · ${item.id}`}
                  onClick={() => context.openTask(undefined, item.key, true)}
                >
                  关联待核对 · {taskState.associationPending} ↗
                </button>
              )}
            </div>
            <div className="overview-card-actions">
              <button onClick={() => context.openProduct(item.key)}>
                查看需求 <span aria-hidden="true">↗</span>
              </button>
              <div>
                {total > 0 && (
                  <button onClick={() => openFirstTask(item)}>Task ↗</button>
                )}
                {childCount > 0 && (
                  <button
                    aria-label={`展开子需求 · ${item.id}`}
                    onClick={() => context.openProduct(item.key)}
                  >
                    子需求 {childCount} ↗
                  </button>
                )}
              </div>
            </div>
          </div>
        </article>
      );
    };
    return (
      <div className="overview-dashboard">
        <section className="overview-hero" aria-label="核心目标及当前工作">
          <div className="overview-hero-section overview-hero-goal">
            <div className="overview-eyebrow">01 / CURRENT PROJECT GOAL</div>
            <h1>
              {rootGoal?.title || data.project?.title || "项目目标待确认"}
            </h1>
            <p>从已读取目标出发，分别查看活动、成果与安排</p>
            {rootGoal ? (
              <button
                className="overview-hero-link"
                onClick={() => context.openProduct(rootGoal.key)}
              >
                查看目标演变 <span aria-hidden="true">↗</span>
              </button>
            ) : (
              <button className="overview-hero-link" onClick={requirements}>
                查看需求视图 <span aria-hidden="true">↗</span>
              </button>
            )}
          </div>
          <CurrentWorkPanel work={data.currentWork} context={context} />
        </section>
        <FocusResults data={data} context={context} />
        <section className="overview-route-heading" aria-label="完整范围标题">
          <div>
            <h2 aria-label="当前进度">
              当前进度
              <span className="overview-semantic-label">需求全景</span>
            </h2>
            <p>
              显示已进行及正在进行的需求，按登记序号倒序排列；以直接范围的步骤执行记录为依据。
            </p>
          </div>
          <div className="overview-route-count">
            有进展需求 <b>{String(signals.size).padStart(2, "0")}</b>
            <span>/</span>
            已登记需求{" "}
            <b>{String(planned.length + unordered.length).padStart(2, "0")}</b>
            <span>/</span>
            关联 Task <b>{String(totalTaskCount).padStart(2, "0")}</b>
          </div>
        </section>
        <OverviewFilterBar
          filters={filters}
          change={setFilters}
          counts={conclusionCounts}
          reviewCount={
            [...signals.values()].filter((value) => value.review).length
          }
          shown={visibleRoadmap.length + visibleUnordered.length}
          total={signals.size}
        />
        <p className="overview-progress-note">
          已隐藏 {hiddenCount} 项尚未开始或范围执行依据待核对的需求。有 Task
          关联、Task 已关闭或已有路线图安排，均不作为已进行的依据。
          <button className="text-link" onClick={requirements}>
            查看全部需求 ↗
          </button>
        </p>
        <section className="overview-route-grid" aria-label="完整需求范围">
          {visibleRoadmap.length ? (
            visibleRoadmap.map(({ item, index }) => card(item, index))
          ) : !visibleUnordered.length && filtersActive ? (
            <div className="overview-empty overview-filter-empty">
              <p>有进展的需求中没有匹配项。</p>
              <button onClick={() => setFilters(defaultOverviewFilters())}>
                清除筛选
              </button>
            </div>
          ) : !visibleUnordered.length ? (
            <div className="overview-empty">
              尚未读到需求范围的直接执行记录。未开始或依据待核对的需求暂不展示，可在需求视图查看全部范围。
            </div>
          ) : null}
        </section>
        {visibleUnordered.length > 0 && (
          <section
            className="overview-unordered-details"
            aria-label="未指定顺序的有进展需求"
          >
            <h3>未指定顺序 · 有进展 {visibleUnordered.length} 项</h3>
            <div className="overview-unordered-grid">
              {visibleUnordered.map(({ item, index }) =>
                card(item, planned.length + index),
              )}
            </div>
          </section>
        )}
        <footer className="overview-bottom-note">
          <span>
            <b>阅读方式</b>　目标 → 需求 → Task → Step
          </span>
          <span>工作类型与 Task 生命周期不推导需求已开始、已实现或已满足</span>
          <span>TraceLens 仅读取与展示，不决定需求顺序</span>
        </footer>
        <AssessmentOverview
          groups={data.assessmentGroups}
          openProduct={context.openProduct}
        />
        {assessmentItem && (
          <Modal title="验收记录" close={() => setAssessmentKey(undefined)}>
            <div className="modal-body overview-assessment-dialog">
              <h3>{assessmentItem.title}</h3>
              <p>每份结论保留其目标、范围和交付对象。</p>
              {assessmentItem.assessmentRecords.map((record) => {
                const { report, selection } = record;
                const verdict = overviewReportVerdict(record);
                return (
                  <section
                    key={report.key}
                    data-overview-assessment={report.id}
                  >
                    <div className="overview-card-section-heading">
                      <span
                        className="requirements-v3-pill overview-verdict-pill"
                        data-conclusion={verdict.conclusion}
                      >
                        <i aria-hidden="true">{verdict.symbol}</i>
                        {verdict.label}
                        {verdict.review ? " · 待核对" : " · 本次范围"}
                      </span>
                      <span>{report.metadata.checked_at?.split("T")[0]}</span>
                    </div>
                    {selection.reasons.length > 0 && (
                      <p>适用性待核对，详情见报告依据。</p>
                    )}
                    <p>{report.metadata.applicability?.coverage}</p>
                    <dl>
                      <dt>目标 / 范围</dt>
                      <dd>
                        {report.metadata.applicability?.goal_id} /{" "}
                        {report.metadata.applicability?.scope_id}
                      </dd>
                      <dt>交付对象</dt>
                      <dd>
                        {report.metadata.subject?.kind} ·{" "}
                        {report.metadata.subject?.value}
                        {report.metadata.subject?.revision &&
                          ` @ ${report.metadata.subject.revision}`}
                      </dd>
                    </dl>
                    <button
                      className="overview-assessment-link"
                      onClick={() => {
                        setAssessmentKey(undefined);
                        context.openProduct(report.key);
                      }}
                    >
                      查看报告与依据 <span aria-hidden="true">↗</span>
                    </button>
                  </section>
                );
              })}
            </div>
          </Modal>
        )}
        {!!data.tasks.length && (
          <LazyDetails
            className="overview-task-index"
            label="关联 Task 索引"
            summary="关联 Task"
          >
            {() => (
              <PagedItems items={data.tasks}>
                {(tasks) => (
                  <div>
                    {tasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => context.openTask(task.id)}
                      >
                        {task.number
                          ? `${task.number} ${task.title}`
                          : task.title}
                      </button>
                    ))}
                  </div>
                )}
              </PagedItems>
            )}
          </LazyDetails>
        )}
      </div>
    );
  },
  (previous, next) => {
    const before = isOverviewSnapshot(previous.context.snapshot)
      ? previous.context.snapshot.overview
      : buildOverviewData(previous.context.snapshot);
    const after = isOverviewSnapshot(next.context.snapshot)
      ? next.context.snapshot.overview
      : buildOverviewData(next.context.snapshot);
    const beforeObservation = isOverviewSnapshot(previous.context.snapshot)
      ? previous.context.snapshot.runtimeObservation
      : undefined;
    const afterObservation = isOverviewSnapshot(next.context.snapshot)
      ? next.context.snapshot.runtimeObservation
      : undefined;
    return (
      before === after &&
      beforeObservation?.readAt === afterObservation?.readAt &&
      beforeObservation?.queryReadAt === afterObservation?.queryReadAt &&
      previous.context.open === next.context.open &&
      previous.context.openProduct === next.context.openProduct &&
      previous.context.openTask === next.context.openTask &&
      previous.requirements === next.requirements
    );
  },
);

type ProductData = NonNullable<ProductContext["snapshot"]["product"]>;

function bindingsForItem(product: ProductData, item: ProductItem) {
  if (item.type === "requirement") return requirementBindings(product, item);
  const owners = new Set([item.key]);
  if (item.type === "goal") {
    for (const child of goalRequirements(product, item.key))
      owners.add(child.key);
  }
  const seen = new Set<string>();
  return product.bindings.filter((binding) => {
    if (!owners.has(binding.ownerKey) || binding.binding.state !== "active")
      return false;
    if (seen.has(binding.key)) return false;
    seen.add(binding.key);
    return true;
  });
}

type RequirementTaskRow = {
  key: string;
  task?: Task;
  bindings: ProductBindingView[];
  label: string;
};

function taskRowsForSnapshot(
  snapshot: ProductContext["snapshot"],
  item: ProductItem,
): RequirementTaskRow[] {
  const product = snapshot.product!;
  const rows = new Map<string, RequirementTaskRow>();
  for (const binding of bindingsForItem(product, item)) {
    const taskIds = binding.match.taskIds;
    if (!taskIds.length) {
      const key = `binding:${binding.key}`;
      rows.set(key, {
        key,
        bindings: [binding],
        label:
          binding.match.task.label ||
          binding.match.task.task_id ||
          "身份未确认的 Task",
      });
      continue;
    }
    for (const taskId of taskIds) {
      const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
      const key = task
        ? `task:${task.realTaskId || task.id}`
        : `binding:${binding.key}:${taskId}`;
      const row = rows.get(key);
      if (row) {
        if (!row.bindings.some((entry) => entry.key === binding.key))
          row.bindings.push(binding);
      } else {
        rows.set(key, {
          key,
          task,
          bindings: [binding],
          label:
            task?.title ||
            task?.number ||
            binding.match.task.label ||
            binding.match.task.task_id ||
            "身份未确认的 Task",
        });
      }
    }
  }
  return [...rows.values()];
}

function taskLifecycle(row: RequirementTaskRow) {
  if (row.task?.runtimeLifecycle)
    return lifecycleLabels[row.task.runtimeLifecycle];
  return row.task ? "状态待核对" : "身份待核对";
}

function taskMatchesFilter(
  row: RequirementTaskRow,
  filter: ViewState["taskFilter"],
) {
  if (filter === "all") return true;
  return filter === "active"
    ? row.task?.runtimeLifecycle === "active"
    : row.task?.runtimeLifecycle === "closed";
}

function productItemTitle(product: ProductData, key: string) {
  return product.items.find((item) => item.key === key)?.title || "";
}

function TaskReadingPanel({
  item,
  context,
  filter,
  setFilter,
}: {
  item: ProductItem;
  context: ProductContext;
  filter: ViewState["taskFilter"];
  setFilter: (filter: ViewState["taskFilter"]) => void;
}) {
  const rows = taskRowsForSnapshot(context.snapshot, item);
  const contributionRows = requirementBindings(context.snapshot.product!, item);
  const contributionIssues = contributionDiagnostics(
    context.snapshot.product!.bindings,
  );
  const visible = rows.filter((row) => taskMatchesFilter(row, filter));
  const runtime = context.snapshot.runtime;
  const sourceText = runtime
    ? runtime.source === "file-snapshot"
      ? "Task 使用文件快照"
      : runtime.source === "runtime-query"
        ? "Task 使用 Runtime 只读查询"
        : "Task 来源暂不可用"
    : "Task 来源与新鲜度待核对";
  return (
    <div className="requirements-v3-panel-content">
      <section className="requirements-v3-section">
        <div className="requirements-v3-section-heading">
          <h3>承接这部分要求的工作</h3>
          <span className="requirements-v3-meta">{rows.length} 组工作记录</span>
        </div>
        <p className="requirements-v3-note">
          {sourceText}
          。关联有效与任务正在进行是两件事；未关联也不表示这部分功能尚未实现。
        </p>
        <ContributionCounts
          summary={contributionSummary(contributionRows, item.key)}
        />
        <div
          className="requirements-v3-segmented"
          role="group"
          aria-label="Task 筛选"
        >
          {(
            [
              ["all", `全部 ${rows.length}`],
              ["active", "进行中"],
              ["closed", "已关闭"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : undefined}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {visible.length ? (
          <div className="requirements-v3-task-list">
            {visible.map((row) => {
              const owners = [
                ...new Set(
                  row.bindings
                    .map((binding) =>
                      productItemTitle(
                        context.snapshot.product!,
                        binding.ownerKey,
                      ),
                    )
                    .filter(Boolean),
                ),
              ];
              return (
                <article className="requirements-v3-task-row" key={row.key}>
                  <div className="requirements-v3-section-heading">
                    {row.task ? (
                      <button
                        className="text-link"
                        onClick={() => context.openTask(row.task!.id, item.key)}
                      >
                        {row.label}
                      </button>
                    ) : (
                      <strong>{row.label}</strong>
                    )}
                    <span className="requirements-v3-pill requirements-v3-task-status">
                      {taskLifecycle(row)}
                    </span>
                  </div>
                  <small className="requirements-v3-meta">
                    {row.task?.number ||
                      row.task?.realTaskId ||
                      "显示身份待核对"}
                    {owners.length ? ` · 来自 ${owners.join("、")}` : ""}
                  </small>
                  <p>
                    覆盖：
                    {[
                      ...new Set(
                        row.bindings
                          .map((binding) => binding.binding.coverage)
                          .filter(Boolean),
                      ),
                    ].join("；") ||
                      row.bindings[0]?.match.detail ||
                      "覆盖范围待核对"}
                  </p>
                  {row.task && (
                    <SourceButton
                      source={row.task.source}
                      open={context.open}
                    />
                  )}
                  <details className="requirements-v3-fold">
                    <summary>关联范围与来源 · {row.bindings.length}</summary>
                    {row.bindings.map((binding) => (
                      <div
                        key={binding.key}
                        className="requirements-v3-binding-detail"
                      >
                        <p>
                          {productItemTitle(
                            context.snapshot.product!,
                            binding.ownerKey,
                          ) || binding.ownerKey}
                          ：{binding.binding.coverage}
                        </p>
                        <p>
                          <strong>
                            {contributionClass(binding, contributionIssues) ===
                            "conflict"
                              ? contributionLabels.conflict
                              : contributionLabel(binding.binding)}
                          </strong>{" "}
                          · 已保存 {binding.binding.role} +{" "}
                          {binding.binding.contribution || "未分类"} ·{" "}
                          {binding.binding.origin}
                        </p>
                        {binding.binding.reason && (
                          <p>理由：{binding.binding.reason}</p>
                        )}
                        {contributionIssues.get(binding.key)?.map((issue) => (
                          <p key={issue} className="requirements-v3-warning">
                            {issue}
                          </p>
                        ))}
                        <p className="requirements-v3-meta">
                          {binding.match.detail}
                        </p>
                        <ProductEvidence
                          sources={[
                            binding.binding.task.source,
                            ...(binding.binding.sources || []),
                          ]}
                          product={context.snapshot.product!}
                          ownerKey={binding.ownerKey}
                          open={context.open}
                        />
                        <SourceButton
                          source={
                            context.snapshot.product!.items.find(
                              (candidate) => candidate.key === binding.ownerKey,
                            )?.source ||
                            row.task?.source ||
                            item.source
                          }
                          open={context.open}
                        />
                      </div>
                    ))}
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="requirements-v3-empty">
            <strong>{rows.length ? "该筛选下没有 Task" : "未关联 Task"}</strong>
            <p>不能据此判断这部分功能尚未实现。</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ChildConclusion({
  item,
  goal,
  subject,
  scopeId,
  product,
}: {
  item: ProductItem;
  goal?: ProductItem;
  subject?: Subject;
  scopeId?: string;
  product: ProductData;
}) {
  const selection = selectionFor(product, item, goal, subject, scopeId);
  if (!subject || !selection) return null;
  const label = selection.reasons.length
    ? "待核对"
    : conclusionLabels[selection.conclusion];
  return (
    <span
      className={`requirements-v3-pill ${conclusionClass(selection.conclusion)}`}
    >
      {label}
    </span>
  );
}

function BrowseOnlyNotice() {
  return (
    <section className="requirements-v3-browse-note">
      <strong>尚未选择交付记录</strong>
      <p>
        当前仍可浏览需求结构、行为和范围边界。选择一个已有交付记录后，才显示本对象下的范围化结果。
      </p>
    </section>
  );
}

function RequirementOverviewPanel({
  item,
  goal,
  subject,
  scopeId,
  context,
  select,
  chooseScope,
  scopeFor,
  openTab,
}: {
  item: ProductItem;
  goal?: ProductItem;
  subject?: Subject;
  scopeId?: string;
  context: ProductContext;
  select: (key: string) => void;
  chooseScope: (scope: string) => void;
  scopeFor: (target: ProductItem) => string | undefined;
  openTab: (tab: ViewState["tab"]) => void;
}) {
  const product = context.snapshot.product!;
  const children = directChildren(product, item);
  const points = acceptancePoints(item);
  const isAssessable = ["goal", "requirement"].includes(item.type);
  const taskSummary = contributionSummary(
    requirementBindings(product, item),
    item.key,
  );
  return (
    <div className="requirements-v3-panel-content">
      {isAssessable ? (
        subject ? (
          <ScopedConclusion
            item={item}
            goal={item.type === "goal" ? item : goal}
            subject={subject}
            scopeId={scopeId}
            chooseScope={chooseScope}
            context={context}
          />
        ) : (
          <BrowseOnlyNotice />
        )
      ) : (
        <section className="requirements-v3-section">
          <div className="requirements-v3-section-heading">
            <h3>分类节点</h3>
            <span className="requirements-v3-pill">不计算达成</span>
          </div>
          <p>
            该节点用于组织业务归属，不调用需求满足选择，也不为分类计算达成率。
          </p>
        </section>
      )}
      {children.length ? (
        <section className="requirements-v3-section">
          <div className="requirements-v3-section-heading">
            <h3>包含的{item.type === "goal" ? "需求" : "能力"}</h3>
            <span className="requirements-v3-meta">
              {children.length} 项直接子需求
            </span>
          </div>
          <div className="requirements-v3-child-list">
            {children.map((child) => (
              <button
                key={child.key}
                className="requirements-v3-child-row"
                onClick={() => select(child.key)}
              >
                <span className="requirements-v3-child-copy">
                  <strong>{child.title}</strong>
                  <small>{businessSummary(child)}</small>
                </span>
                <span className="requirements-v3-child-meta">
                  <ChildConclusion
                    item={child}
                    goal={goal}
                    subject={subject}
                    scopeId={scopeFor(child)}
                    product={product}
                  />
                  <span aria-hidden="true">›</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="requirements-v3-section">
          <div className="requirements-v3-section-heading">
            <h3>具体要求</h3>
            <span className="requirements-v3-meta">末级条目</span>
          </div>
          {points.length ? (
            <ul className="requirements-v3-points">
              {points.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          ) : (
            <p className="requirements-v3-meta">
              具体要求未能从当前章节单独提取，请在依据中查看完整原文。
            </p>
          )}
        </section>
      )}
      <section className="requirements-v3-section requirements-v3-boundary">
        <div className="requirements-v3-section-heading">
          <h3>范围与重要边界</h3>
        </div>
        <p>{boundarySummary(item)}</p>
      </section>
      <div className="requirements-v3-tab-cta">
        <span>
          关联 {taskSummary.uniqueTasks} 个唯一 Task 身份
          {taskSummary.unconfirmedRelations
            ? ` · 身份未知关系 ${taskSummary.unconfirmedRelations}`
            : ""}
        </span>
        <button className="text-link" onClick={() => openTab("tasks")}>
          查看 Task →
        </button>
      </div>
    </div>
  );
}

function EvidencePanel({
  item,
  goal,
  subject,
  scopeId,
  context,
  select,
}: {
  item: ProductItem;
  goal?: ProductItem;
  subject?: Subject;
  scopeId?: string;
  context: ProductContext;
  select: (key: string) => void;
}) {
  const product = context.snapshot.product!;
  const selection = selectionFor(product, item, goal, subject, scopeId);
  const relations = product.relations.filter(
    (relation) =>
      relation.ownerKey === item.key || relation.targetKey === item.key,
  );
  const history = product.items.filter(
    (candidate) =>
      candidate.type === "change" &&
      candidate.metadata.deltas?.some((delta) => delta.target === item.id),
  );
  const reportCards = selection?.reports || [];
  return (
    <div className="requirements-v3-panel-content">
      <section className="requirements-v3-section">
        <div className="requirements-v3-section-heading">
          <h3>当前需求定义</h3>
          <span className="requirements-v3-pill">原文</span>
        </div>
        <div className="requirements-v3-source-card">
          <strong>{item.title}</strong>
          <p>{businessSummary(item)}</p>
          <p className="requirements-v3-meta">
            {item.source.path} · 第 {item.source.line} 行起
          </p>
          <SourceButton source={item.source} open={context.open} />
        </div>
      </section>
      <section className="requirements-v3-section">
        <div className="requirements-v3-section-heading">
          <h3>与本需求明确相关的交付记录</h3>
          <span className="requirements-v3-meta">
            {reportCards.length} 份当前报告
          </span>
        </div>
        {!subject ? (
          <div className="requirements-v3-legacy-note">
            尚未选择交付记录。明确指向本需求的历史材料仍可通过原文与报告入口查看，但不会自动套用为当前结论。
          </div>
        ) : selection?.reasons.length && !reportCards.length ? (
          <div className="requirements-v3-legacy-note">
            {selection.reasons.map((reason) => (
              <p key={reason}>{assessmentReason(reason)}</p>
            ))}
          </div>
        ) : reportCards.length ? (
          <div className="requirements-v3-report-list">
            {reportCards.map((report) => (
              <article className="requirements-v3-source-card" key={report.key}>
                <div className="requirements-v3-section-heading">
                  <button
                    className="text-link"
                    onClick={() => select(report.key)}
                  >
                    {report.title}
                  </button>
                  <span className="requirements-v3-pill">
                    {
                      conclusionLabels[
                        report.metadata.conclusion || "undetermined"
                      ]
                    }
                  </span>
                </div>
                <p>{subjectText(report.metadata.subject)}</p>
                {reportExcerpt(report).map((excerpt) => (
                  <p key={excerpt.heading}>
                    <span className="requirements-v3-report-label">
                      {excerpt.heading}
                    </span>
                    {excerpt.text}
                  </p>
                ))}
                <SourceButton source={report.source} open={context.open} />
              </article>
            ))}
          </div>
        ) : (
          <p className="requirements-v3-meta">
            当前对象和范围下暂无适用报告；这不等于没有任何历史成果。
          </p>
        )}
        {!!selection?.historical.length && (
          <details className="requirements-v3-fold">
            <summary>
              历史记录 · {selection.historical.length}（本次尚不能采用）
            </summary>
            {selection.historical.map((report) => (
              <div key={report.key} className="requirements-v3-history-row">
                <button
                  className="text-link"
                  onClick={() => select(report.key)}
                >
                  {report.id} · {report.title}
                </button>
                <OriginalAssessment report={report} />
              </div>
            ))}
          </details>
        )}
        {!!selection?.reasons.length && reportCards.length > 0 && (
          <div className="requirements-v3-reason-list">
            {selection.reasons.map((reason) => (
              <p key={reason}>{assessmentReason(reason)}</p>
            ))}
          </div>
        )}
      </section>
      <section className="requirements-v3-section">
        <div className="requirements-v3-section-heading">
          <h3>结构关系</h3>
          <button
            className="text-link"
            onClick={() => context.relations(item.key)}
          >
            查看局部关系图 →
          </button>
        </div>
        <p>
          当前条目有 {relations.length}{" "}
          条已读取关系。关系来源、方向和未决状态仅作为依据，不参与 Task
          汇集或达成推导。
        </p>
        {relations.some(
          (relation) =>
            relation.resolution !== "resolved" ||
            relation.link.state !== "active",
        ) && (
          <p className="requirements-v3-warning">
            存在需要核对的关系来源或方向；请打开局部关系图查看具体记录。
          </p>
        )}
      </section>
      <section className="requirements-v3-section">
        <div className="requirements-v3-section-heading">
          <h3>历史变更</h3>
          <span className="requirements-v3-meta">{history.length} 条记录</span>
        </div>
        {history.length ? (
          <div className="requirements-v3-history-list">
            {history.map((entry) => (
              <button
                key={entry.key}
                className="text-link"
                onClick={() => select(entry.key)}
              >
                {entry.id} · {entry.title}
              </button>
            ))}
          </div>
        ) : (
          <p className="requirements-v3-meta">
            没有读取到直接指向本条目的变化记录。
          </p>
        )}
      </section>
    </div>
  );
}

function OtherItemOverview({
  item,
  context,
}: {
  item: ProductItem;
  context: ProductContext;
}) {
  return (
    <div className="requirements-v3-panel-content">
      <section className="requirements-v3-section">
        <div className="requirements-v3-section-heading">
          <h3>资料记录</h3>
          {!item.usable && (
            <span className="requirements-v3-pill requirements-v3-gap">
              结构不可用 · 原文保留
            </span>
          )}
        </div>
        <p>{businessSummary(item)}</p>
        <p className="requirements-v3-meta">
          这是可核对的资料条目，不自动改变当前需求的结论。
        </p>
        <SourceButton source={item.source} open={context.open} />
      </section>
    </div>
  );
}

function RequirementsInspector({
  item,
  goal,
  subject,
  scopeId,
  context,
  select,
  chooseScope,
  scopeFor,
  tab,
  setTab,
  taskFilter,
  setTaskFilter,
}: {
  item: ProductItem;
  goal?: ProductItem;
  subject?: Subject;
  scopeId?: string;
  context: ProductContext;
  select: (key: string) => void;
  chooseScope: (scope: string) => void;
  scopeFor: (target: ProductItem) => string | undefined;
  tab: ViewState["tab"];
  setTab: (tab: ViewState["tab"]) => void;
  taskFilter: ViewState["taskFilter"];
  setTaskFilter: (filter: ViewState["taskFilter"]) => void;
}) {
  const product = context.snapshot.product!;
  const path = itemPath(product, item);
  const labels = [
    ["overview", "概况"],
    ["body", "完整正文"],
    ["tasks", "Task"],
    ["evidence", "依据"],
  ] as const;
  const isBusiness = ["goal", "requirement", "module"].includes(item.type);
  return (
    <aside
      className="requirements-v3-inspector"
      data-product-id={item.id}
      aria-label="所选需求详情"
    >
      <header className="requirements-v3-inspector-head">
        <div className="requirements-v3-between">
          <nav className="requirements-v3-path" aria-label="当前需求路径">
            {path.slice(0, -1).map((ancestor) => (
              <span key={ancestor.key}>
                <button
                  className="text-link"
                  onClick={() => select(ancestor.key)}
                >
                  {ancestor.title}
                </button>
                <span aria-hidden="true">›</span>
              </span>
            ))}
            <span>
              {item.type === "goal"
                ? "目标"
                : item.type === "module"
                  ? "分类"
                  : "需求"}
            </span>
          </nav>
          <button
            className="requirements-v3-close"
            aria-label="关闭详情"
            onClick={() => select("")}
          >
            ×
          </button>
        </div>
        <h2>{item.title}</h2>
        <div className="requirements-v3-id-line">
          {item.id} · {item.metadata.scope || "当前范围"}
          {!item.usable && " · 原文保留"}
        </div>
        <p className="requirements-v3-description">{businessSummary(item)}</p>
      </header>
      <div
        className="requirements-v3-tabs"
        role="tablist"
        aria-label="需求详情分类"
      >
        {labels.map(([value, label], index) => {
          const active = tab === value;
          return (
            <button
              key={value}
              role="tab"
              aria-selected={active}
              aria-controls="requirements-v3-panel"
              className={active ? "active" : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? labels.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          labels.length) %
                        labels.length;
                setTab(labels[next][0]);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div
        id="requirements-v3-panel"
        className="requirements-v3-panel"
        role="tabpanel"
      >
        {tab === "overview" && isBusiness && (
          <RequirementOverviewPanel
            item={item}
            goal={goal}
            subject={subject}
            scopeId={scopeId}
            context={context}
            select={select}
            chooseScope={chooseScope}
            scopeFor={scopeFor}
            openTab={setTab}
          />
        )}
        {tab === "overview" && !isBusiness && (
          <OtherItemOverview item={item} context={context} />
        )}
        {tab === "body" && (
          <div className="requirements-v3-panel-content">
            <ProductBody item={item} context={context} />
          </div>
        )}
        {tab === "tasks" && (
          <TaskReadingPanel
            item={item}
            context={context}
            filter={taskFilter}
            setFilter={setTaskFilter}
          />
        )}
        {tab === "evidence" && (
          <EvidencePanel
            item={item}
            goal={goal}
            subject={subject}
            scopeId={scopeId}
            context={context}
            select={select}
          />
        )}
        <details className="requirements-v3-advanced-detail">
          <summary>完整原文、关系与原始字段</summary>
          <ProductDetail item={item} context={context} />
        </details>
      </div>
      <footer className="requirements-v3-inspector-footer">
        <span>内容来自已读取需求、Task 与报告记录</span>
        <span className="requirements-v3-footer-actions">
          <button className="text-link" onClick={() => select("")}>
            返回需求图
          </button>
          <button
            className="text-link"
            onClick={() => context.open(item.source)}
          >
            查看完整原文 ↗
          </button>
        </span>
      </footer>
    </aside>
  );
}
