import { useState } from "react";
import {
  ArrowRight,
  FileText,
  GitBranch,
  History,
  Info,
  Link2,
  ListTodo,
  Network,
  ShieldCheck,
  Target,
} from "lucide-react";
import type { ProductContext } from "./product";
import type { ProductItem } from "../shared/product-types";
import { SourceButton } from "./components";
import { productLabels } from "./product-labels";
import {
  overviewCards,
  overviewTaskStates,
  type OverviewCard,
} from "../shared/overview-model";
import { SnapshotMarkdown } from "./reader";

function capturedMarkdown(item: ProductItem, context: ProductContext) {
  const document = context.snapshot.documents.find(
    (entry) =>
      entry.id === item.source.documentId &&
      entry.digest === item.source.digest &&
      entry.path === item.source.path,
  );
  const text =
    document?.raw.replace(
      /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)(?:[\s\S]*?(?:\r\n|\n|\r))?---[ \t]*(?=\r\n|\n|\r|$)/,
      (frontmatter) => frontmatter.replace(/[^\r\n]/g, " "),
    ) ?? item.body;
  return { document, text };
}

function RoadmapCard({
  card,
  context,
}: {
  card: OverviewCard;
  context: ProductContext;
}) {
  const summary = overviewTaskStates(context.snapshot, card.bindings);
  let taskLabel = "尚未记录 Task 关联";
  if (summary.total) taskLabel = `关联 ${summary.total} 个 Task`;
  else if (summary.unconfirmed) taskLabel = "尚无已确认任务身份";
  const open = () => context.openProduct(card.owner.key, card.workId);
  const captured = capturedMarkdown(card.owner, context);
  const section = captured.document?.headings.find(
    (heading) =>
      heading.title === "需求内容" &&
      heading.line > card.owner.source.line &&
      heading.line <= card.owner.endLine,
  );
  const sectionEnd =
    section &&
    (captured.document!.headings.find(
      (heading) =>
        heading.line > section.line && heading.depth <= section.depth,
    )?.line ?? card.owner.endLine + 1) - 1;
  return (
    <article className="overview-road-card" data-overview-card={card.id}>
      {card.followsPrevious && (
        <ArrowRight
          className="overview-road-arrow"
          size={21}
          aria-label="与前一工作项有明确依赖"
        />
      )}
      <div className="overview-road-title">
        <span className="overview-road-id" title={card.id}>
          {card.id}
        </span>
        <h3 title={card.title}>{card.title}</h3>
      </div>
      <div className="overview-road-description">
        {card.owner.type === "requirement" && section ? (
          <SnapshotMarkdown
            text={captured.text}
            documentId={card.owner.source.documentId}
            path={card.owner.source.path}
            lineRange={{ start: section.line + 1, end: sectionEnd! }}
            snapshot={context.snapshot}
            open={context.open}
          />
        ) : (
          <p>{card.description}</p>
        )}
      </div>
      {card.state && (
        <span className="overview-scope">
          {productLabels[card.state] || card.state}
          {card.stage && ` · ${card.stage}`}
        </span>
      )}
      <div className="overview-road-relations">
        <p>
          <Link2 size={17} />
          <span>
            前置：
            {card.dependencies.length
              ? card.dependencies
                  .map(
                    (dependency) =>
                      `${dependency.label}${dependency.inferred ? "（推断）" : ""}`,
                  )
                  .join("、")
              : "未声明依赖"}
          </span>
        </p>
        <p>
          <ListTodo size={17} />
          <span>
            {taskLabel}
            {summary.unconfirmed > 0 && (
              <small className="overview-unconfirmed">
                另有 {summary.unconfirmed} 条绑定身份未确认
              </small>
            )}
          </span>
        </p>
      </div>
      <div className="overview-task-distribution">
        <p>
          Task 状态分布 <small>文档声明</small>
        </p>
        <div className="overview-state-list">
          {summary.states.map((state) => (
            <span key={state.label} className={`overview-state ${state.tone}`}>
              <i />
              {state.label} {state.count}
            </span>
          ))}
          {!summary.total && !summary.unconfirmed && (
            <span className="overview-state slate">无关联任务，不推导进度</span>
          )}
        </div>
      </div>
      <div className="overview-card-footer">
        <SourceButton source={card.owner.source} open={context.open} />
        <button className="overview-detail-link" onClick={open}>
          查看详情 <ArrowRight size={18} />
        </button>
      </div>
    </article>
  );
}

export function OverviewDashboard({
  context,
  requirements,
  planning,
}: {
  context: ProductContext;
  requirements: () => void;
  planning: () => void;
}) {
  const product = context.snapshot.product!;
  const goals = product.items.filter(
    (item) => item.usable && item.type === "goal",
  );
  const plans = product.items.filter(
    (item) => item.usable && item.type === "plan",
  );
  const [goalKey, setGoalKey] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [expanded, setExpanded] = useState(false);
  const goal = goalKey
    ? goals.find((item) => item.key === goalKey)
    : goals.find((item) => item.metadata.scope === "current") || goals[0];
  let plan;
  if (planKey) plan = plans.find((item) => item.key === planKey);
  else if (plans.length === 1) plan = plans[0];
  const goalMarkdown = goal && capturedMarkdown(goal, context);
  const cards = overviewCards(product, plan);
  const changes = product.items.filter(
    (item) =>
      item.usable &&
      item.type === "change" &&
      item.metadata.deltas?.some((delta) => delta.target === goal?.id),
  );
  const visible = expanded ? cards : cards.slice(0, 4);
  return (
    <div className="overview-dashboard">
      <div className="overview-dashboard-heading">
        <div>
          <h2>项目需求总览</h2>
          <p>从项目文档中看清目标、需求、Task 与状态</p>
        </div>
        <button className="secondary" onClick={requirements}>
          查看全部需求 <ArrowRight size={16} />
        </button>
      </div>
      <div className="overview-dashboard-main">
        <section className="overview-goal-panel">
          <h2>
            <Target size={26} />
            {goal?.metadata.scope === "current" ? "当前核心目标" : "已登记目标"}
          </h2>
          {goals.length > 1 && (
            <label className="overview-select">
              查看目标
              <select
                aria-label="概览目标"
                value={goal?.key || ""}
                onChange={(event) => setGoalKey(event.target.value)}
              >
                <option value="" disabled>
                  所选目标已退出本次范围
                </option>
                {goals.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title} ·{" "}
                    {productLabels[item.metadata.scope || ""] || "范围未记录"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {goal ? (
            <>
              <h3>{goal.title}</h3>
              <span className="overview-scope">
                {productLabels[goal.metadata.scope || ""] || "范围未记录"}
              </span>
              <div className="overview-goal-body">
                <SnapshotMarkdown
                  text={goalMarkdown!.text}
                  documentId={goal.source.documentId}
                  path={goal.source.path}
                  startLine={goalMarkdown?.document ? 1 : goal.source.line}
                  lineRange={
                    goalMarkdown?.document
                      ? { start: goal.source.line, end: goal.endLine }
                      : undefined
                  }
                  snapshot={context.snapshot}
                  open={context.open}
                />
              </div>
              <SourceButton source={goal.source} open={context.open} />
              <button
                className="overview-detail-link"
                onClick={() => context.openProduct(goal.key)}
              >
                查看目标详情 <ArrowRight size={18} />
              </button>
            </>
          ) : (
            <p className="overview-empty">
              {goalKey
                ? "所选目标已退出本次读取范围。"
                : "vNext 尚未登记标准目标。可在项目中讨论并整理后刷新。"}
            </p>
          )}
          <details className="overview-goal-history">
            <summary>
              <History size={17} />
              查看目标演变 · {changes.length}
            </summary>
            {changes.length ? (
              changes.map((item) => (
                <button
                  key={item.key}
                  className="text-link"
                  onClick={() => context.openProduct(item.key)}
                >
                  {item.title}
                  <ArrowRight size={14} />
                </button>
              ))
            ) : (
              <p>尚未记录与此目标明确关联的变化条目，不从修改时间推断演变。</p>
            )}
          </details>
        </section>
        <section className="overview-roadmap">
          <div className="overview-roadmap-heading">
            <h2>
              <GitBranch size={26} />
              需求路线图
            </h2>
            <span>
              <Info size={15} />
              {plan ? "顺序来自文档中的计划原数组" : "尚未选定实施顺序"}
            </span>
          </div>
          {plans.length > 1 && (
            <label className="overview-plan-select">
              项目计划
              <select
                aria-label="概览项目计划"
                value={plan?.key || ""}
                onChange={(event) => {
                  setPlanKey(event.target.value);
                  setExpanded(false);
                }}
              >
                <option value="">
                  {planKey
                    ? "所选计划已退出范围 · 重新选择"
                    : "选择要查看的计划"}
                </option>
                {plans.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title} ·{" "}
                    {item.metadata.intent_state === "retired"
                      ? "已退出"
                      : productLabels[item.metadata.intent_state || ""]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="overview-roadmap-caption">
            {plan ? (
              <>
                <button
                  className="text-link"
                  onClick={() => context.openProduct(plan.key)}
                >
                  {plan.title}
                  <ArrowRight size={14} />
                </button>
                <span>工作项保留全部安排状态；阅读顺序不代表依赖。</span>
              </>
            ) : (
              <>
                <strong>已登记需求 · {cards.length}</strong>
                <span>
                  {plans.length
                    ? "选择计划后查看工作项顺序；当前保留全部已知需求范围。"
                    : "未记录项目计划；以下是文档登记顺序，不代表实施排序。"}
                </span>
              </>
            )}
          </div>
          <div
            className="overview-road-grid"
            data-columns={Math.min(4, visible.length)}
          >
            {visible.map((card) => (
              <RoadmapCard key={card.key} card={card} context={context} />
            ))}
          </div>
          {!cards.length && (
            <p className="overview-empty">
              {plan
                ? "该计划尚未记录工作项，完整实施策略仍可在详情阅读。"
                : "尚未登记标准需求条目，项目完整正文仍可阅读。"}
            </p>
          )}
          <div className="overview-roadmap-actions">
            <button className="text-link" onClick={requirements}>
              查看全部需求
              <ArrowRight size={15} />
            </button>
            {cards.length > 4 && (
              <button
                className="text-link"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "收起路线图" : `展开其余 ${cards.length - 4} 项`}
                <ArrowRight size={15} />
              </button>
            )}
            <button className="text-link" onClick={planning}>
              查看完整规划
              <ArrowRight size={15} />
            </button>
          </div>
        </section>
      </div>
      <section className="overview-principles">
        <h2>
          <Info size={25} />
          界面原则 / 状态说明
        </h2>
        <div className="overview-principle-grid">
          <article>
            <FileText size={29} />
            <div>
              <h3>展示文档中已确定的结构</h3>
              <p>保留明确、推断与否定关系；不生成实施顺序</p>
            </div>
          </article>
          <article>
            <Target size={29} />
            <div>
              <h3>需求不直接判定完成</h3>
              <p>任务处置、范围交付与需求验证分别查看</p>
            </div>
          </article>
          <article>
            <Network size={29} />
            <div>
              <h3>一个需求可关联多个 Task</h3>
              <p>按明确绑定的对象与覆盖范围追踪</p>
            </div>
          </article>
          <article>
            <ShieldCheck size={29} />
            <div>
              <h3>状态依据可追溯</h3>
              <p>来自本次文档快照；未知和冲突保持可见</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
