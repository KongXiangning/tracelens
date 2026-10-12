import { useEffect, useRef, useState, type CSSProperties } from "react";
import { navigationScrollContainer } from "./navigation-scroll";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProductItem } from "../shared/product-types";
import {
  conclusionLabels,
  goalRequirements,
  productView,
  reportedSubjects,
  selectAssessment,
  type Subject,
} from "../shared/product-view";
import { overviewTaskStates } from "../shared/overview-model";
import { requirementHierarchy } from "../shared/product-hierarchy";
import { assessmentGoal, productStructure } from "../shared/product-structure";
import { buildProductGraph, ProductRelationPanel } from "./product-graph";
import {
  ProductDetail,
  ProductStatusPanel,
  type ProductContext,
} from "./product";
import { SourceButton } from "./components";

type ViewState = {
  goal: string;
  subject: string;
  filter: string;
  query: string;
  scope: Record<string, string>;
  dependencies: boolean;
  expanded: string[];
  panel: "" | "candidates" | "unlinked";
  candidateAll: boolean;
  candidateFocus: string;
  unlinkedQuery: string;
  navigationOpen: boolean;
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
    <label>
      被评估对象
      <select
        aria-label="被评估对象"
        value={value}
        onChange={(e) => set(e.target.value)}
      >
        <option value="">明确选择已报告对象</option>
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

function requirementDescription(item: ProductItem) {
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
  if (!goal) return <p>尚未判定 · 未明确所选目标</p>;
  const selection = selectAssessment(
    context.snapshot.product!,
    item.id,
    goal.id,
    subject,
    scopeId,
  );
  const scopes =
    goal.metadata.assessment_scopes?.filter((s) => s.target === item.id) || [];
  return (
    <section
      className="scoped-conclusion"
      data-conclusion={selection.conclusion}
    >
      <h3>{conclusionLabels[selection.conclusion]}</h3>
      <p>
        目标：{goal.id} · 范围：{selection.scopeId || "未选择"} · 对象：
        {subject
          ? `${subject.kind} ${subject.value} ${subject.revision || "（未固定版本）"}`
          : "未选择"}
      </p>
      {scopes.length > 1 && chooseScope && (
        <label>
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
        <p>{scopes.find((s) => s.scope_id === selection.scopeId)!.coverage}</p>
      )}
      {selection.reasons.length > 0 && (
        <p className="muted">待核对：{selection.reasons.join("、")}</p>
      )}
      {selection.reports.map((report) => (
        <div key={report.key}>
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
      {!!selection.pending.length && (
        <details>
          <summary>
            未明确定位的历史/不完整报告 · {selection.pending.length}
          </summary>
          {selection.pending.map((i) => (
            <button
              className="text-link"
              key={i.key}
              onClick={() => context.openProduct(i.key)}
            >
              {i.id}
            </button>
          ))}
        </details>
      )}
      {!!selection.historical.length && (
        <details>
          <summary>已替代报告 · {selection.historical.length}</summary>
          {selection.historical.map((i) => (
            <button
              className="text-link"
              key={i.key}
              onClick={() => context.openProduct(i.key)}
            >
              {i.id}
            </button>
          ))}
        </details>
      )}
    </section>
  );
}
export function OverviewV3({
  context,
  requirements,
}: {
  context: ProductContext;
  requirements: () => void;
  planning?: () => void;
}) {
  const product = context.snapshot.product!,
    model = productView(product);
  const planned = model.registered.filter(
    (item) => item.metadata.scope === "current",
  );
  const roadmap = [...planned].reverse();
  const unordered = model.unordered.filter(
    (item) => item.metadata.scope === "current",
  );
  const activeBindings = product.bindings.filter(
    (view) => view.binding.state === "active",
  );
  const plannedBindings = activeBindings.filter((view) =>
    planned.some((item) => item.key === view.ownerKey),
  );
  const totalTaskCount = overviewTaskStates(
    context.snapshot,
    plannedBindings,
  ).total;
  const rootGoal = model.rootGoal;

  const openFirstTask = (item: ProductItem) => {
    const taskId = activeBindings
      .filter((view) => view.ownerKey === item.key)
      .flatMap((view) => view.match.taskIds)
      .find((id) => context.snapshot.tasks.some((task) => task.id === id));
    if (taskId) context.openTask(taskId);
    else context.openProduct(item.key);
  };

  const card = (item: ProductItem, index: number) => {
    const bindings = activeBindings.filter(
      (view) => view.ownerKey === item.key,
    );
    const taskState = overviewTaskStates(context.snapshot, bindings);
    const counts = { completed: 0, active: 0, pending: 0 };
    for (const state of taskState.states) {
      if (["已完成", "已关闭", "已归档", "已跳过"].includes(state.label))
        counts.completed += state.count;
      else if (
        ["进行中", "受阻"].includes(state.label) ||
        state.tone === "orange"
      )
        counts.active += state.count;
      else counts.pending += state.count;
    }
    const total = taskState.total + taskState.unconfirmed;
    const counted = counts.completed + counts.active + counts.pending;
    if (total > counted) counts.pending += total - counted;
    const dependencies = product.relations
      .filter(
        (relation) =>
          relation.ownerKey === item.key &&
          relation.link.relation === "depends_on" &&
          relation.link.state === "active" &&
          relation.resolution === "resolved",
      )
      .map((relation) => relation.link.target)
      .filter((value, position, values) => values.indexOf(value) === position);
    const percentages = total
      ? {
          completed: (counts.completed / total) * 100,
          active: (counts.active / total) * 100,
        }
      : { completed: 0, active: 0 };
    const donutStyle = {
      "--complete": `${percentages.completed}%`,
      "--active": `${percentages.active}%`,
    } as CSSProperties;

    return (
      <article
        className="overview-route-card"
        key={item.key}
        data-overview-card={item.id}
      >
        <div className="overview-route-pin" aria-hidden="true">
          <span>{String(index + 1).padStart(2, "0")}</span>
        </div>
        <div className="overview-route-body">
          <div className="overview-route-code">{item.id} / REQUIREMENT</div>
          <h3>{item.title}</h3>
          <p className="overview-route-description">
            {requirementDescription(item)}
          </p>
          <div className="overview-route-predecessor">
            <span>前置需求</span>
            <strong>
              {dependencies.length ? dependencies.join(" / ") : "—"}
            </strong>
          </div>
          <div className="overview-task-total">
            <span>关联 TASK</span>
            <strong>{String(total).padStart(2, "0")}</strong>
          </div>
          <div className="overview-task-breakdown">
            <div
              className="overview-donut"
              style={donutStyle}
              aria-label={`共 ${total} 个 Task，已完成 ${counts.completed} 个，进行中 ${counts.active} 个，待开始 ${counts.pending} 个`}
            >
              <div className="overview-donut-inner">
                <strong>{total}</strong>
                <small>TASKS</small>
              </div>
            </div>
            <div className="overview-task-counts">
              <div>
                <i className="complete" />
                <span>已完成</span>
                <b>{counts.completed}</b>
              </div>
              <div>
                <i className="active" />
                <span>进行中</span>
                <b>{counts.active}</b>
              </div>
              <div>
                <i className="pending" />
                <span>待开始</span>
                <b>{counts.pending}</b>
              </div>
            </div>
          </div>
          <button
            className="overview-route-link"
            onClick={() => openFirstTask(item)}
          >
            <span>查看关联 Task</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </article>
    );
  };
  return (
    <div className="overview-dashboard">
      <section className="overview-hero" aria-label="核心目标及规划范围">
        <div className="overview-hero-section overview-hero-goal">
          <div className="overview-eyebrow">01 / CURRENT PROJECT GOAL</div>
          <h1>{rootGoal?.title || model.project?.title || "项目目标待确认"}</h1>
          <p>基于已确认的项目目标与需求规划展示</p>
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
        <div className="overview-hero-section overview-hero-unplanned">
          <h2>仍有 {unordered.length} 个需求尚未规划</h2>
          <p>
            已识别的需求方向尚未纳入正式需求拆分与实现顺序，不代表现有需求尚未完成。
          </p>
          {unordered.length ? (
            <ul>
              {unordered.slice(0, 3).map((item) => (
                <li key={item.key}>
                  <button onClick={() => context.openProduct(item.key)}>
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="overview-hero-empty">当前没有待规划需求</div>
          )}
          <button className="overview-hero-outline" onClick={requirements}>
            查看待规划需求 <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className="overview-hero-section overview-hero-planned">
          <h2>已规划的需求</h2>
          {planned.length ? (
            <ul>
              {planned.slice(0, 4).map((item) => (
                <li key={item.key}>
                  <span aria-hidden="true">✓</span>
                  <button onClick={() => context.openProduct(item.key)}>
                    {item.title}
                  </button>
                </li>
              ))}
              {planned.length > 4 && (
                <li className="overview-hero-more">
                  + {planned.length - 4} 个需求已列入路线图
                </li>
              )}
            </ul>
          ) : (
            <p className="overview-hero-empty">尚未登记规划顺序</p>
          )}
          <div className="overview-hero-foot">
            待规划需求 <b>{String(unordered.length).padStart(2, "0")}</b>
          </div>
        </div>
      </section>
      <section className="overview-route-heading" aria-label="需求路线图标题">
        <div>
          <h2>
            需求路线图
            <span className="overview-semantic-label">需求全景</span>
          </h2>
          <p>按项目文档确定的规划顺序 · 非执行工作流</p>
        </div>
        <div className="overview-route-count">
          已规划需求 <b>{String(planned.length).padStart(2, "0")}</b>
          <span>/</span>
          关联 Task <b>{String(totalTaskCount).padStart(2, "0")}</b>
        </div>
      </section>
      <section className="overview-route-grid" aria-label="需求路线图">
        {roadmap.length ? (
          roadmap.map((item, index) => card(item, planned.length - index - 1))
        ) : (
          <div className="overview-empty">
            当前项目没有已登记的需求顺序，请先在项目文档中声明
            requirement_order。
          </div>
        )}
      </section>
      <details className="overview-unordered-details">
        <summary>未指定顺序 · {unordered.length} 项（ID 定位排序）</summary>
        {unordered.length ? (
          <div className="overview-unordered-grid">
            {unordered.map((item, index) => card(item, roadmap.length + index))}
          </div>
        ) : (
          <p>当前没有未指定顺序的需求。</p>
        )}
      </details>
      <footer className="overview-bottom-note">
        <span>
          <b>阅读方式</b>　目标 → 需求 → Task → Step
        </span>
        <span>需求不直接判定完成；颜色仅代表关联 Task 状态</span>
        <span>TraceLens 仅读取与展示，不决定需求顺序</span>
      </footer>
      {!!context.snapshot.tasks.length && (
        <section className="overview-task-index" aria-label="关联 Task 索引">
          <h2>关联 Task</h2>
          <div>
            {context.snapshot.tasks.map((task) => (
              <button key={task.id} onClick={() => context.openTask(task.id)}>
                {task.number ? `${task.number} ${task.title}` : task.title}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
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
  const [state, setState] = useState<ViewState>(
    () => stored.get(context.snapshot.projectId) || initial(),
  );
  const current = useRef(state);
  current.current = state;
  const update = (value: Partial<ViewState>) =>
    setState((s) => ({ ...s, ...value }));
  useEffect(() => {
    stored.set(context.snapshot.projectId, state);
  }, [state, context.snapshot.projectId]);
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
    product.items.find((i) => i.key === state.goal && i.usable) ||
    (!state.goal ? model.rootGoal : undefined);
  const subject = state.subject
    ? (JSON.parse(state.subject) as Subject)
    : undefined;
  const item = product.items.find((i) => i.key === selected);
  const scopeKey = (target: ProductItem) =>
    JSON.stringify([target.type === "goal" ? target.id : goal?.id, target.id]);
  const reqs = goalRequirements(product, goal?.key).filter(
    (i) => i.metadata.scope === "current",
  );
  const matches = reqs.filter((i) => {
    const conclusion = selectAssessment(
      product,
      i.id,
      goal?.id || "",
      subject,
      state.scope[scopeKey(i)],
    ).conclusion;
    return (
      `${i.id} ${i.title} ${i.body}`
        .toLowerCase()
        .includes(state.query.trim().toLowerCase()) &&
      (state.filter === "all" ||
        (state.filter === "gaps"
          ? ["not-satisfied", "partially-satisfied"].includes(conclusion)
          : conclusion === "undetermined"))
    );
  });
  const filtered = Boolean(state.query.trim()) || state.filter !== "all";
  const reveal = new Set(filtered ? matches.map((i) => i.key) : []);
  if (item && reqs.some((i) => i.key === item.key)) reveal.add(item.key);
  const hierarchy = requirementHierarchy(
    product,
    reqs,
    new Set(state.expanded),
    reveal,
    filtered,
  );
  const keys = new Set(hierarchy.visible.map((i) => i.key));
  if (goal) keys.add(goal.key);
  if (model.rootGoal) keys.add(model.rootGoal.key);
  // Add only necessary ancestors. No duplicate requirement identity in a multi-parent graph.
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of model.relations)
      if (
        keys.has(r.ownerKey) &&
        r.targetKey &&
        ["part_of", "supports"].includes(r.link.relation) &&
        !keys.has(r.targetKey)
      ) {
        keys.add(r.targetKey);
        changed = true;
      }
  }
  const selectedDependencies =
    state.dependencies && item
      ? model.relations.filter(
          (r) =>
            r.link.relation === "depends_on" &&
            (r.ownerKey === item.key || r.targetKey === item.key),
        )
      : [];
  selectedDependencies.forEach((r) => {
    keys.add(r.ownerKey);
    if (r.targetKey) keys.add(r.targetKey);
  });
  const visible = [
    ...product.items.filter(
      (i) => i.usable && i.type === "goal" && keys.has(i.key),
    ),
    ...model.registered,
    ...model.unordered,
    ...product.items.filter((i) => i.usable && i.type === "module"),
  ].filter(
    (i, index, array) =>
      keys.has(i.key) && array.findIndex((x) => x.key === i.key) === index,
  );
  const structure = model.relations.filter(
    (r) =>
      r.targetKey &&
      keys.has(r.ownerKey) &&
      keys.has(r.targetKey) &&
      ["part_of", "supports"].includes(r.link.relation),
  );
  const depth = new Map(visible.map((i) => [i.key, i.type === "goal" ? 0 : 1]));
  for (let pass = 0; pass < visible.length; pass++) {
    let moved = false;
    for (const r of structure) {
      const value = Math.min(
        visible.length,
        (depth.get(r.targetKey!) || 0) + 1,
      );
      if ((depth.get(r.ownerKey) || 0) < value) {
        depth.set(r.ownerKey, value);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const positions = new Map<number, number>();
  const nodes: Node[] = visible.map((i) => {
    const d = depth.get(i.key) || 0,
      column = positions.get(d) || 0;
    positions.set(d, column + 1);
    const evaluationGoal = assessmentGoal(i, goal || undefined);
    const conclusion = evaluationGoal
      ? selectAssessment(
          product,
          i.id,
          evaluationGoal.id,
          subject,
          state.scope[scopeKey(i)],
        )
      : undefined;
    const childCount = hierarchy.children.get(i.key)?.length || 0;
    const expanded = state.expanded.includes(i.key);
    return {
      id: i.key,
      position: { x: column * 285, y: d * 185 },
      data: {
        label: (
          <div>
            <button
              className="goal-graph-node"
              data-node-id={i.id}
              data-node-conclusion={
                i.type === "module"
                  ? undefined
                  : conclusion?.conclusion || "undetermined"
              }
              data-node-goal={evaluationGoal?.id}
              data-node-scope={conclusion?.scopeId}
              onClick={() => select(i.key)}
            >
              <small>
                {i.type === "goal"
                  ? "目标"
                  : i.type === "module"
                    ? "模块 / 分类"
                    : "需求"}{" "}
                · {i.id}
                {!matches.includes(i) && i.type === "requirement"
                  ? " · 上下文"
                  : ""}
              </small>
              <strong>{i.title}</strong>
              <span>
                {i.type === "module"
                  ? "分类节点 · 不评估达成"
                  : conclusion
                    ? conclusionLabels[conclusion.conclusion]
                    : "尚未判定 · 未明确所选目标"}
              </span>
            </button>
            {!!childCount && (
              <button
                className="goal-graph-expand nodrag"
                aria-label={`${expanded ? "收起" : "展开"}子需求 · ${i.id}`}
                aria-expanded={expanded}
                onClick={() =>
                  update({
                    expanded: expanded
                      ? state.expanded.filter((key) => key !== i.key)
                      : [...state.expanded, i.key],
                  })
                }
              >
                {expanded ? "收起" : "展开"}已登记子要求 · {childCount}
              </button>
            )}
          </div>
        ),
      },
      style: {
        width: 255,
        border: i.key === selected ? "2px solid #d18449" : "1px solid #bbb",
        padding: 0,
      },
    };
  });
  const edges: Edge[] = [...structure, ...selectedDependencies].map((r) => ({
    id: r.key,
    source: r.targetKey!,
    target: r.ownerKey,
    label:
      r.link.relation === "part_of"
        ? "组成 / 细化"
        : r.link.relation === "supports"
          ? "支撑"
          : "依赖",
    style:
      r.link.relation === "depends_on"
        ? { strokeDasharray: "5 4", stroke: "#d18449" }
        : undefined,
  }));
  const history = item
    ? product.items.filter(
        (i) =>
          i.type === "change" &&
          i.metadata.deltas?.some((d) => d.target === item.id),
      )
    : [];
  const explanation = productStructure(product, goal?.key, item?.key);
  const candidates = state.candidateAll
    ? explanation.candidates
    : explanation.relatedCandidates;
  const candidateFocus = candidates.some(
    (r) => r.ownerKey === state.candidateFocus,
  )
    ? state.candidateFocus
    : candidates[0]?.ownerKey;
  const candidateGraph =
    state.panel === "candidates"
      ? buildProductGraph(context.snapshot)
      : undefined;
  if (candidateGraph) {
    const candidateKeys = new Set(candidates.map((r) => `link:${r.key}`));
    candidateGraph.relations = candidateGraph.relations.filter((r) =>
      candidateKeys.has(r.id),
    );
  }
  return (
    <div className="product-page">
      <h2>目标与需求图</h2>
      {selected && !item && (
        <p role="status">
          所选条目已退出本次范围；请在当前图或历史入口重新选择。
        </p>
      )}
      <div className="product-filters">
        <label>
          所选目标
          <select
            aria-label="所选目标"
            value={goal?.key || ""}
            onChange={(e) => update({ goal: e.target.value })}
          >
            <option value="">
              {model.rootGoal ? "项目总目标" : "总目标未明确"}
            </option>
            {product.items
              .filter((i) => i.usable && i.type === "goal")
              .map((i) => (
                <option key={i.key} value={i.key}>
                  {i.id} · {i.title}
                </option>
              ))}
          </select>
        </label>
        <SubjectPicker
          product={product}
          value={state.subject}
          set={(s) => update({ subject: s })}
        />
        <label>
          结论筛选
          <select
            aria-label="结论筛选"
            value={state.filter}
            onChange={(e) => update({ filter: e.target.value })}
          >
            <option value="all">全部</option>
            <option value="gaps">未满足与部分满足</option>
            <option value="unknown">尚未判定</option>
          </select>
        </label>
        <input
          aria-label="搜索需求图"
          placeholder="定位需求"
          value={state.query}
          onChange={(e) => update({ query: e.target.value })}
        />
      </div>
      {model.rootReason && (
        <p role="status">{model.rootReason} · 可读目标与需求继续保留</p>
      )}
      <section className="product-structure-note" aria-label="当前结构说明">
        {(explanation.currentUnlinked.length > 0 ||
          explanation.relatedCandidates.length > 0 ||
          explanation.incomplete) && (
          <p>
            本次已读取内容{explanation.incomplete ? "（存在未读范围）" : ""}：
            {goal
              ? `${explanation.currentUnlinked.length} 个当前需求未通过声明路径连入 ${goal.id}`
              : "未明确所选目标，暂不判定目标归属"}
            ； 当前目标 / 选定条目相关候选结构关系{" "}
            {explanation.relatedCandidates.length} 条。
          </p>
        )}
        <div className="product-inline">
          <button
            className="secondary"
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
            className="secondary"
            aria-expanded={state.panel === "unlinked"}
            onClick={() =>
              update({ panel: state.panel === "unlinked" ? "" : "unlinked" })
            }
          >
            查看未连入需求
          </button>
        </div>
      </section>
      {state.panel === "candidates" && (
        <section className="product-structure-panel" aria-label="候选结构关系">
          <h3>已记录候选结构关系 · {candidates.length} 条</h3>
          <label>
            <input
              type="checkbox"
              checked={state.candidateAll}
              onChange={(e) => update({ candidateAll: e.target.checked })}
            />{" "}
            查看本次已读取内容中的全部候选
          </label>
          <p className="muted">
            默认列出当前目标或选定条目相关候选；候选不进入正式图、Task
            汇集或达成结论。已否定关系保留在条目关联历史。
          </p>
          {!candidates.length && (
            <p>本次范围未记录相关候选；可切换全部候选或查看条目来源。</p>
          )}
          <ul className="product-structure-list">
            {candidates.map((r) => (
              <li key={r.key}>
                <button
                  className="text-link"
                  onClick={() => update({ candidateFocus: r.ownerKey })}
                >
                  {product.items.find((i) => i.key === r.ownerKey)?.id} →{" "}
                  {r.link.target} · {r.link.relation}
                </button>
                {r.resolution !== "resolved" && (
                  <span>
                    {" "}
                    · 引用 / 方向 / 身份异常（{r.resolution}），仅查看依据
                  </span>
                )}
              </li>
            ))}
          </ul>
          {candidateGraph && candidateFocus && (
            <ProductRelationPanel
              key={candidateFocus}
              snapshot={context.snapshot}
              model={candidateGraph}
              focus={candidateFocus}
              open={context.open}
              openTask={context.openTask}
              openProduct={select}
              hideUnresolved
            />
          )}
        </section>
      )}
      {state.panel === "unlinked" && (
        <section className="product-structure-panel" aria-label="未连入需求">
          <h3>
            未在所选目标声明路径中的可读需求 · {explanation.unlinked.length} 项
          </h3>
          <p className="muted">
            仅针对本次已读取内容；没有声明路径不表示未实现。其他目标、非当前范围与结构未决分别保留。
          </p>
          <input
            aria-label="搜索未连入需求"
            placeholder="搜索 ID、标题或正文"
            value={state.unlinkedQuery}
            onChange={(e) => update({ unlinkedQuery: e.target.value })}
          />
          <ul className="product-structure-list">
            {explanation.unlinked
              .filter(({ item: i }) =>
                `${i.id} ${i.title} ${i.body}`
                  .toLowerCase()
                  .includes(state.unlinkedQuery.toLowerCase()),
              )
              .map(({ item: i, reasons, otherGoals }) => (
                <li key={i.key} data-unlinked-id={i.id}>
                  <button className="text-link" onClick={() => select(i.key)}>
                    {i.id} · {i.title}
                  </button>
                  <p>{reasons.join("；")}</p>
                  {otherGoals.map((g) => (
                    <button
                      key={g.key}
                      className="text-link"
                      onClick={() => update({ goal: g.key })}
                    >
                      查看目标 · {g.id}
                    </button>
                  ))}
                  <SourceButton source={i.source} open={context.open} />
                </li>
              ))}
          </ul>
        </section>
      )}
      <div className="goal-requirement-graph" style={{ height: 510 }}>
        <ReactFlow
          key={`${context.snapshot.id}:${state.goal}:${state.filter}:${state.query}:${state.subject}`}
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          fitView
          minZoom={0.25}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p>
        所选目标声明路径内 {reqs.length} 个当前需求；筛选命中 {matches.length}{" "}
        个，当前显示 {hierarchy.visible.length}{" "}
        个；展开与筛选保留必要祖先；未指定顺序入口使用 ID 定位顺序。
      </p>
      <details
        open={state.navigationOpen}
        onToggle={(event) => {
          if (event.currentTarget.open !== state.navigationOpen)
            update({ navigationOpen: event.currentTarget.open });
        }}
      >
        <summary>搜索与条目导航（含历史/旧格式）</summary>
        {product.items.map((i) => (
          <button
            key={i.key}
            className="text-link"
            onClick={() => select(i.key)}
          >
            {i.id} · {i.title}
            {i.metadata.scope === "retired" && " · 历史"}
          </button>
        ))}
      </details>
      {item && (
        <section className="product-selected-detail">
          <button className="secondary" onClick={() => select("")}>
            返回需求图
          </button>
          <label>
            <input
              type="checkbox"
              checked={state.dependencies}
              onChange={(e) => update({ dependencies: e.target.checked })}
            />
            展开所选需求局部依赖
          </label>
          {["requirement", "goal"].includes(item.type) && (
            <ScopedConclusion
              item={item}
              goal={item.type === "goal" ? item : goal || undefined}
              subject={subject}
              scopeId={state.scope[scopeKey(item)]}
              chooseScope={(s) =>
                update({ scope: { ...state.scope, [scopeKey(item)]: s } })
              }
              context={context}
            />
          )}
          <ProductDetail item={item} context={context} />
          <details>
            <summary>演变历史 · {history.length}</summary>
            {history.map((h) => (
              <button
                key={h.key}
                className="text-link"
                onClick={() => select(h.key)}
              >
                {h.id} · {h.title}
              </button>
            ))}
            {product.relations
              .filter(
                (r) =>
                  ["replaces", "derived_from"].includes(r.link.relation) &&
                  (r.ownerKey === item.key || r.targetKey === item.key),
              )
              .map((r) => (
                <p key={r.key}>
                  {r.link.relation} · {r.link.target}{" "}
                  <SourceButton source={item.source} open={context.open} />
                </p>
              ))}
          </details>
        </section>
      )}
      <details>
        <summary>读取与结构诊断</summary>
        <ProductStatusPanel
          product={product}
          navigation={context.snapshot.navigation}
          open={context.open}
          configure={configure}
        />
        <ul>
          {model.diagnostics.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
