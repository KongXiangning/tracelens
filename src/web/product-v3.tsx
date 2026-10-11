import { useEffect, useRef, useState } from "react";
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
  const [goalKey, setGoalKey] = useState("");
  const [subjectValue, setSubjectValue] = useState("");
  const [expanded, setExpanded] = useState(false);
  const subject = subjectValue
    ? (JSON.parse(subjectValue) as Subject)
    : undefined;
  const goal = product.items.find((i) => i.key === goalKey && i.usable);
  const requirementsInGoal = new Set(
    goalRequirements(product, goalKey || undefined).map((i) => i.key),
  );
  const registered = model.registered.filter(
    (i) => i.metadata.scope === "current" && requirementsInGoal.has(i.key),
  );
  const unordered = model.unordered.filter(
    (i) => i.metadata.scope === "current" && requirementsInGoal.has(i.key),
  );
  const shown = expanded ? registered : registered.slice(0, 6);
  const card = (item: ProductItem) => {
    const bindings = product.bindings.filter(
      (b) => b.ownerKey === item.key && b.binding.state === "active",
    );
    const tasks = overviewTaskStates(context.snapshot, bindings);
    const conclusion = goal
      ? selectAssessment(product, item.id, goal.id, subject)
      : undefined;
    return (
      <article
        className="overview-road-card"
        key={item.key}
        data-overview-card={item.id}
      >
        <span className="overview-road-id">{item.id}</span>
        <h3>{item.title}</h3>
        <p>
          {item.body
            .split("### 需求内容")[1]
            ?.split("###")[0]
            ?.trim()
            .slice(0, 200) || "完整范围见需求详情"}
        </p>
        <p>
          {context.snapshot.runtime?.source === "unavailable"
            ? "任务数据暂不可用"
            : tasks.total
              ? `关联 ${tasks.total} 个 Task`
              : "未关联 Task"}
        </p>
        <div className="overview-state-list">
          {tasks.states.map((s) => (
            <span className={`overview-state ${s.tone}`} key={s.label}>
              {s.label} {s.count}
            </span>
          ))}
        </div>
        {conclusion && (
          <p>
            {conclusionLabels[conclusion.conclusion]} · {goal?.id} /{" "}
            {conclusion.scopeId || "范围未知"} / {subject?.value || "对象未选"}
          </p>
        )}
        <button
          className="text-link"
          onClick={() => context.openProduct(item.key)}
        >
          查看需求详情
        </button>
      </article>
    );
  };
  return (
    <div className="overview-dashboard">
      <section className="overview-goal-panel">
        <h2>项目总目标</h2>
        {model.rootGoal ? (
          <>
            <h3>{model.rootGoal.title}</h3>
            <SourceButton source={model.rootGoal.source} open={context.open} />
            <button
              className="text-link"
              onClick={() => context.openProduct(model.rootGoal!.key)}
            >
              查看总目标与演变
            </button>
          </>
        ) : (
          <p>
            {model.project?.title || "项目定位未明确"} · {model.rootReason}
            ；不猜选总目标
          </p>
        )}
        <p>整体结果使用独立报告；当前展示不按 Task 或子项数量汇总。</p>
        {model.rootGoal && (
          <ul className="overview-goal-children">
            {model.relations
              .filter(
                (r) =>
                  r.targetKey === model.rootGoal!.key &&
                  r.link.relation === "part_of",
              )
              .map((r) => product.items.find((i) => i.key === r.ownerKey))
              .filter((i) => i?.type === "goal")
              .map((i) => (
                <li key={i!.key}>
                  <button
                    className="text-link"
                    onClick={() => context.openProduct(i!.key)}
                  >
                    {i!.metadata.goal_kind === "stage" ? "阶段" : "子目标"} ·{" "}
                    {i!.title}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
      <section className="overview-roadmap">
        <h2>需求全景</h2>
        <div className="product-filters">
          <label>
            目标筛选
            <select
              aria-label="概览目标筛选"
              value={goalKey}
              onChange={(e) => setGoalKey(e.target.value)}
            >
              <option value="">全项目当前需求</option>
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
            value={subjectValue}
            set={setSubjectValue}
          />
        </div>
        <p>项目当前登记顺序 · {registered.length} 项；目标筛选保留相对位置。</p>
        <div className="overview-road-grid">{shown.map(card)}</div>
        {registered.length > 6 && (
          <button className="text-link" onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起" : "展开全部已登记需求"}
          </button>
        )}
        <details open={unordered.length > 0}>
          <summary>未指定顺序 · {unordered.length} 项（ID 定位排序）</summary>
          <div className="overview-road-grid">{unordered.map(card)}</div>
        </details>
        <button className="secondary" onClick={requirements}>
          查看目标需求图
        </button>
        {!!model.diagnostics.length && (
          <details>
            <summary>结构与顺序诊断</summary>
            <ul>
              {model.diagnostics.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
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
        .includes(state.query.toLowerCase()) &&
      (state.filter === "all" ||
        (state.filter === "gaps"
          ? ["not-satisfied", "partially-satisfied"].includes(conclusion)
          : conclusion === "undetermined"))
    );
  });
  const keys = new Set(matches.map((i) => i.key));
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
    const conclusion = selectAssessment(
      product,
      i.id,
      goal?.id || "",
      subject,
      state.scope[scopeKey(i)],
    );
    return {
      id: i.key,
      position: { x: column * 285, y: d * 145 },
      data: {
        label: (
          <button
            className="goal-graph-node"
            data-node-id={i.id}
            onClick={() => select(i.key)}
          >
            <small>
              {i.type === "goal" ? "目标" : "需求"} · {i.id}
              {!matches.includes(i) && i.type === "requirement"
                ? " · 上下文"
                : ""}
            </small>
            <strong>{i.title}</strong>
            <span>{conclusionLabels[conclusion.conclusion]}</span>
          </button>
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
        {matches.length} 个当前需求；图中保留必要祖先；未指定顺序入口使用 ID
        定位顺序。
      </p>
      <details>
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
