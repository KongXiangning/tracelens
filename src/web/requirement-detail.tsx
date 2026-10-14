import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, FileText } from "lucide-react";
import type { ProductBindingView } from "../shared/product-types";
import {
  featureExecution,
  featureStateLabels,
  requirementFeatures,
  type FeatureReport,
  type FeatureState,
} from "../shared/requirement-detail";
import { requirementBindings } from "../shared/product-hierarchy";
import {
  goalRequirements,
  productView,
  type Subject,
} from "../shared/product-view";
import { assessmentGoal } from "../shared/product-structure";
import { contributionLabel } from "../shared/product-contribution";
import { Body, type ProductContext } from "./product";
import { Empty, SourceButton } from "./components";
import {
  acceptancePoints,
  businessSummary,
  EvidencePanel,
  itemPath,
  requirementViewSelection,
  ScopedConclusion,
  SubjectPicker,
} from "./product-v3";
import { lifecycleLabels } from "./runtime";
import "./requirement-detail.css";

const filters: { value: "all" | FeatureState; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "completed", label: "已完成执行" },
  { value: "in-progress", label: "进行中" },
  { value: "not-started", label: "未开始" },
  { value: "pending", label: "待核对" },
  { value: "unassociated", label: "待关联" },
  { value: "recorded", label: "有执行记录" },
];
type DetailView = {
  goal: string;
  subject: string;
  scope: Record<string, string>;
  filter: "all" | FeatureState;
  expanded: string[];
};
const detailViews = new Map<string, DetailView>();
const stepLabels: Record<string, string> = {
  executed: "已执行",
  "in-progress": "进行中",
  "not-started": "未开始",
  blocked: "受阻",
  ready: "待执行",
  skipped: "已跳过",
  finished: "已完成",
  closed: "已关闭",
  paused: "已暂停",
};

function StateBadge({ state }: { state: FeatureState }) {
  return (
    <span className="rd-badge" data-state={state}>
      {featureStateLabels[state]}
    </span>
  );
}

function FeatureReports({
  reports,
  context,
}: {
  reports: FeatureReport[];
  context: ProductContext;
}) {
  return reports.map((report) => (
    <section
      className="rd-feature-report"
      key={report.key}
      aria-label={`逐点说明 · ${report.title}`}
    >
      <h4>实施与验证说明 · {report.title}</h4>
      <dl>
        {report.fields.map((field, index) => (
          <div key={index}>
            <dt>{field.label}</dt>
            <dd>{field.text}</dd>
          </div>
        ))}
      </dl>
      <p className="rd-muted">
        原报告记录{report.subject && ` · 对象：${report.subject}`}
        ；当前适用性与需求验收结论请在右侧选择交付记录后核对。
      </p>
      <SourceButton source={report.source} open={context.open} />
    </section>
  ));
}

function groupBoundTasks(
  rows: ProductBindingView[],
  snapshot: ProductContext["snapshot"],
) {
  const groups = new Map<
    string,
    { rows: ProductBindingView[]; taskId?: string }
  >();
  for (const row of rows) {
    const matched =
      row.match.state === "matched" && row.match.taskIds.length === 1;
    const taskId = matched ? row.match.taskIds[0] : undefined;
    const task = snapshot.tasks.find((entry) => entry.id === taskId);
    const key = task
      ? JSON.stringify(["task", task.realTaskId || task.id])
      : JSON.stringify(["binding", row.key]);
    const group = groups.get(key) || {
      rows: [],
      taskId: task?.id,
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

function BoundTasks({
  rows,
  context,
  requirementKey,
}: {
  rows: ProductBindingView[];
  context: ProductContext;
  requirementKey: string;
}) {
  const groups = groupBoundTasks(rows, context.snapshot);
  return (
    <div className="rd-bound-tasks">
      {groups.map(([key, group]) => {
        const task = context.snapshot.tasks.find(
          (entry) => entry.id === group.taskId,
        );
        const runtimeTasks =
          context.snapshot.runtime?.tasks.filter(
            (entry) => entry.task_id === task?.realTaskId,
          ) || [];
        const runtime = runtimeTasks.length === 1 ? runtimeTasks[0] : undefined;
        const current = runtime?.steps?.find(
          (step) => step.id === runtime.current_step_id,
        );
        return (
          <div className="rd-bound-task" key={key}>
            <div className="rd-between">
              {task ? (
                <button
                  className="text-link"
                  onClick={() => context.openTask(task.id, requirementKey)}
                >
                  {task.number || task.realTaskId} · {task.title}{" "}
                  <ArrowUpRight size={13} />
                </button>
              ) : (
                <strong>
                  {group.rows[0].binding.task.label ||
                    group.rows[0].binding.task.task_id ||
                    "Task 身份待核对"}
                </strong>
              )}
              <span className="rd-muted">
                {task?.runtimeLifecycle
                  ? lifecycleLabels[task.runtimeLifecycle]
                  : "待核对"}
              </span>
            </div>
            {group.rows.map((row) => (
              <p key={row.key} className="rd-muted">
                {contributionLabel(row.binding)} ·{" "}
                {row.binding.coverage || "覆盖范围未记录"}
                {row.binding.task.step_id &&
                  ` · Step ${row.binding.task.step_id}`}
                {row.match.state !== "matched" && ` · ${row.match.detail}`}
              </p>
            ))}
            {runtime?.steps && (
              <p className="rd-muted">
                已执行 Step{" "}
                {
                  runtime.steps.filter(
                    (step) =>
                      step.state === "executed" && Boolean(step.execution_ref),
                  ).length
                }{" "}
                / {runtime.steps.length}
                {current &&
                  ` · 当前步骤：${String(current.title || current.id)}（${stepLabels[current.state] || "状态待核对"}）`}
              </p>
            )}
            {task && <SourceButton source={task.source} open={context.open} />}
          </div>
        );
      })}
    </div>
  );
}

export function RequirementDetailPage({
  context,
  selected,
  back,
}: {
  context: ProductContext;
  selected?: string;
  back: () => void;
}) {
  const { snapshot } = context;
  const product = snapshot.product;
  const item = product?.items.find(
    (entry) => entry.key === selected && entry.type === "requirement",
  );
  const cacheKey = JSON.stringify([snapshot.projectId, selected]);
  const [saved] = useState<DetailView>(
    () =>
      detailViews.get(cacheKey) || {
        ...requirementViewSelection(snapshot.projectId),
        filter: "all",
        expanded: [],
      },
  );
  const [goalKey, setGoalKey] = useState(saved.goal);
  const [subjectValue, setSubjectValue] = useState(saved.subject);
  const [scopes, setScopes] = useState(saved.scope);
  const [filter, setFilter] = useState<"all" | FeatureState>(saved.filter);
  const [expanded, setExpanded] = useState(saved.expanded);
  useEffect(() => {
    detailViews.set(cacheKey, {
      goal: goalKey,
      subject: subjectValue,
      scope: scopes,
      filter,
      expanded,
    });
  }, [cacheKey, goalKey, subjectValue, scopes, filter, expanded]);
  function toggleSection(key: string, open: boolean) {
    setExpanded((previous) => {
      if (previous.includes(key) === open) return previous;
      return open
        ? [...previous, key]
        : previous.filter((entry) => entry !== key);
    });
  }
  const features = useMemo(
    () => (item ? requirementFeatures(snapshot, item) : []),
    [snapshot, item],
  );
  if (!product || !item)
    return (
      <Empty
        title="需求未能定位"
        detail="当前快照中没有这个需求，可能已移动或退出读取范围。"
        action={<button onClick={back}>返回原页面</button>}
      />
    );
  const path = itemPath(product, item);
  const model = productView(product);
  const goals = product.items.filter(
    (entry) =>
      entry.usable &&
      entry.type === "goal" &&
      goalRequirements(product, entry.key).some((req) => req.key === item.key),
  );
  const goal =
    goals.find((entry) => entry.key === goalKey) ||
    goals.find((entry) => entry.key === model.rootGoal?.key) ||
    goals[0];
  const evaluationGoal = goal ? assessmentGoal(item, goal) : undefined;
  let subject: Subject | undefined;
  try {
    subject = subjectValue ? (JSON.parse(subjectValue) as Subject) : undefined;
  } catch {
    subject = undefined;
  }
  const scopeKey = JSON.stringify([goal?.id, item.id]);
  const points = acceptancePoints(item);
  const rows = requirementBindings(product, item);
  const taskGroups = groupBoundTasks(rows, snapshot);
  const knownTaskCount = taskGroups.filter(([, group]) => group.taskId).length;
  const pendingTaskCount = taskGroups.length - knownTaskCount;
  const work = featureExecution(snapshot, rows);
  const included = features.filter(
    (feature) => !feature.inclusion || feature.inclusion === "included",
  );
  const completed = included.filter(
    (feature) => feature.state === "completed",
  ).length;
  const executionKnown = included.some(
    (feature) => !["pending", "unassociated"].includes(feature.state),
  );
  const reportedFeatures = features.filter(
    (feature) => feature.reports?.length,
  ).length;
  const percent =
    included.length && executionKnown
      ? Math.round((completed / included.length) * 100)
      : undefined;
  const visible = features.filter(
    (feature) => filter === "all" || feature.state === filter,
  );
  const summary = included.length
    ? filters
        .slice(2)
        .map((option) => ({
          ...option,
          count: included.filter((feature) => feature.state === option.value)
            .length,
        }))
        .filter((option) => option.count)
    : [];
  return (
    <article className="requirement-detail-page" data-requirement-id={item.id}>
      <nav className="rd-breadcrumb" aria-label="需求路径">
        <button onClick={back}>返回原页面</button>
        {path.map((entry) => (
          <span key={entry.key}>
            {" "}
            /{" "}
            {entry.key === item.key ? (
              entry.id
            ) : (
              <button onClick={() => context.openProduct(entry.key)}>
                {entry.title}
              </button>
            )}
          </span>
        ))}
      </nav>
      <button className="text-link rd-back" onClick={back}>
        <ArrowLeft size={15} />
        返回原页面
      </button>
      <header className="rd-header">
        <div>
          <div className="rd-title">
            <h1>{item.title}</h1>
            <StateBadge state={work.state} />
          </div>
          <p className="rd-muted">
            {item.id} ·{" "}
            {(
              {
                current: "当前需求",
                planned: "计划需求",
                candidate: "候选需求",
                retired: "已退出",
              } as Record<string, string>
            )[item.metadata.scope || ""] || "范围未记录"}
          </p>
          <p>{businessSummary(item)}</p>
        </div>
        <button className="secondary" onClick={() => context.open(item.source)}>
          <FileText size={15} />
          查看原文 <ArrowUpRight size={14} />
        </button>
      </header>
      <div className="rd-layout">
        <main className="rd-main">
          <section className="rd-execution" aria-label="执行概况">
            <h2>执行概况</h2>
            <div className="rd-execution-grid">
              <div>
                <strong className="rd-count">
                  {included.length
                    ? `${executionKnown ? completed : "—"} / ${included.length}`
                    : "—"}
                </strong>
                <span>功能点已完成执行</span>
              </div>
              <div>
                <div
                  className="rd-progress"
                  role="progressbar"
                  aria-label="功能点执行进度"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <i style={{ width: `${percent || 0}%` }} />
                </div>
                <p>
                  {percent === undefined
                    ? included.length
                      ? `${included.length} 个功能点 · 逐点执行待核对`
                      : "尚未记录功能拆分"
                    : `${percent}% · ${summary.map((entry) => `${entry.count} ${entry.label}`).join(" · ") || "全部完成执行"}`}
                </p>
                {reportedFeatures > 0 && (
                  <p>{reportedFeatures} 个功能点有逐点实施或验证记录</p>
                )}
              </div>
              <div className="rd-task-count">
                <span>关联 Task</span>
                <strong>{knownTaskCount}</strong>
                <small>
                  {pendingTaskCount > 0 && `${pendingTaskCount} 组关联待核对`}
                </small>
              </div>
            </div>
            <p className="rd-execution-note">
              执行进展与验收结果分别展示；完成执行不代表需求验收通过。
            </p>
          </section>
          <section className="rd-card">
            <div className="rd-between">
              <h2>需求说明</h2>
              <a href="#rd-body" onClick={() => toggleSection("body", true)}>
                查看完整正文 ↗
              </a>
            </div>
            <h3>目标与范围</h3>
            <p>{businessSummary(item)}</p>
            <h3>验收标准</h3>
            {points.length ? (
              <ul className="rd-acceptance">
                {points.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            ) : (
              <p className="rd-muted">
                未提取到单独的验收标准，请查看完整正文。
              </p>
            )}
          </section>
          <section className="rd-card" aria-label="功能点拆分">
            <div className="rd-between">
              <h2>
                功能点拆分 <small>{features.length}</small>
              </h2>
            </div>
            <div className="rd-filters" role="group" aria-label="功能点筛选">
              {filters.map((option) => {
                const count = features.filter(
                  (feature) =>
                    option.value === "all" || feature.state === option.value,
                ).length;
                return (
                  (count > 0 || option.value === "all") && (
                    <button
                      key={option.value}
                      aria-pressed={filter === option.value}
                      onClick={() => setFilter(option.value)}
                    >
                      {option.label} {count}
                    </button>
                  )
                );
              })}
            </div>
            {!features.length && (
              <p className="rd-muted">
                当前需求尚未提取到正文功能清单、子需求或明确指向本需求的规划工作项。需求正文与整体
                Task 关联仍可查看。
              </p>
            )}
            {features.length > 0 && !visible.length && (
              <p className="rd-muted">没有符合筛选的功能点。</p>
            )}
            {visible.map((feature) => (
              <details
                className="rd-feature"
                key={feature.key}
                data-feature-key={feature.key}
                open={expanded.includes(`feature:${feature.key}`)}
                onToggle={(event) =>
                  toggleSection(
                    `feature:${feature.key}`,
                    event.currentTarget.open,
                  )
                }
              >
                <summary className="rd-feature-heading">
                  <span className="rd-feature-index">
                    {String(features.indexOf(feature) + 1).padStart(2, "0")}
                  </span>
                  <span className="rd-feature-copy">
                    <h3>{feature.title}</h3>
                    <small>
                      {feature.kind}
                      {feature.inclusion === "deferred"
                        ? " · 已延期"
                        : feature.inclusion === "withdrawn"
                          ? " · 已撤回"
                          : ""}{" "}
                      · {feature.bindings.length} 条关联
                      {!!feature.reports?.length &&
                        ` · ${feature.reports.length} 份逐点报告`}
                    </small>
                    {!!feature.reports?.length && (
                      <small className="rd-report-summary">
                        原报告：
                        {[
                          ...new Set(
                            feature.reports.flatMap((report) =>
                              report.fields
                                .filter((field) =>
                                  /^(实施状态|实现判断|实施判断)$/.test(
                                    field.label,
                                  ),
                                )
                                .map((field) => field.text),
                            ),
                          ),
                        ].join(" / ") || "有实现与验证记录"}
                      </small>
                    )}
                  </span>
                  <StateBadge state={feature.state} />
                </summary>
                <div className="rd-feature-body">
                  {feature.kind === "子需求" ? (
                    <p className="rd-feature-description">
                      {businessSummary(
                        product.items.find(
                          (entry) => entry.key === feature.productKey,
                        )!,
                      )}
                    </p>
                  ) : feature.description.trim() !== feature.title.trim() ? (
                    <p className="rd-feature-description">
                      {feature.description}
                    </p>
                  ) : !feature.reports?.length ? (
                    <p className="rd-muted">原文未记录更详细的功能说明。</p>
                  ) : null}
                  <FeatureReports
                    reports={feature.reports || []}
                    context={context}
                  />
                  <button
                    className="text-link"
                    onClick={() =>
                      feature.kind === "正文功能点"
                        ? context.open(feature.source)
                        : context.openProduct(feature.productKey)
                    }
                  >
                    {feature.kind === "正文功能点"
                      ? "查看功能点原文"
                      : `查看${feature.kind}`}{" "}
                    ↗
                  </button>
                  <SourceButton source={feature.source} open={context.open} />
                  <BoundTasks
                    rows={feature.bindings}
                    context={context}
                    requirementKey={item.key}
                  />
                  {feature.reasons.map((reason) => (
                    <p className="rd-muted" key={reason}>
                      {reason}
                    </p>
                  ))}
                </div>
              </details>
            ))}
            <p className="rd-muted rd-footnote">
              功能点按需求原文展示，规划工作不重复计数；逐点报告保留实施、验证和缺口，需求级
              Task 不自动算作每个功能点的执行依据。
            </p>
          </section>
          <section className="rd-card" id="rd-body">
            <details
              open={expanded.includes("body")}
              onToggle={(event) =>
                toggleSection("body", event.currentTarget.open)
              }
            >
              <summary className="rd-section-summary">完整需求正文</summary>
              <Body item={item} context={context} />
            </details>
          </section>
          <section className="rd-card" id="rd-evidence">
            <details
              open={expanded.includes("evidence")}
              onToggle={(event) =>
                toggleSection("evidence", event.currentTarget.open)
              }
            >
              <summary className="rd-section-summary">
                来源、验收记录与历史依据
              </summary>
              <EvidencePanel
                item={item}
                goal={goal}
                subject={subject}
                scopeId={scopes[scopeKey]}
                context={context}
                select={context.openProduct}
              />
            </details>
          </section>
        </main>
        <aside className="rd-aside">
          <section className="rd-card rd-assessment">
            <h2>验收结果</h2>
            {goals.length > 1 && (
              <label>
                评估目标
                <select
                  aria-label="详情评估目标"
                  value={goal?.key || ""}
                  onChange={(event) => setGoalKey(event.target.value)}
                >
                  {goals.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <SubjectPicker
              product={product}
              value={subjectValue}
              set={setSubjectValue}
            />
            <ScopedConclusion
              item={item}
              goal={evaluationGoal}
              subject={subject}
              scopeId={scopes[scopeKey]}
              context={context}
              chooseScope={(scope) =>
                setScopes((previous) => ({ ...previous, [scopeKey]: scope }))
              }
            />
          </section>
          <section className="rd-card">
            <h2>需求属性</h2>
            <dl className="rd-properties">
              <dt>所属目标</dt>
              <dd>
                {goals.map((entry) => entry.title).join("、") || "未记录"}
              </dd>
              <dt>所属模块</dt>
              <dd>
                {path
                  .filter((entry) => entry.type === "module")
                  .map((entry) => entry.title)
                  .join(" / ") || "未记录"}
              </dd>
              <dt>上级需求</dt>
              <dd>
                {path
                  .filter(
                    (entry) =>
                      entry.key !== item.key && entry.type === "requirement",
                  )
                  .map((entry) => (
                    <button
                      className="text-link"
                      key={entry.key}
                      onClick={() => context.openProduct(entry.key)}
                    >
                      {entry.title} ↗
                    </button>
                  )) || ""}
                {!path.some(
                  (entry) =>
                    entry.key !== item.key && entry.type === "requirement",
                ) && "无"}
              </dd>
            </dl>
          </section>
          <section className="rd-card" aria-label="关联 Task">
            <div className="rd-between">
              <h2>
                关联 Task <small>{knownTaskCount}</small>
              </h2>
              <small className="rd-muted">按身份去重</small>
            </div>
            <BoundTasks
              rows={rows}
              context={context}
              requirementKey={item.key}
            />
            {!rows.length && <p className="rd-muted">尚未记录 Task 关联。</p>}
          </section>
          <section className="rd-card">
            <h2>来源与依据</h2>
            <p className="rd-source-path">{item.source.path}</p>
            <p className="rd-muted">
              需求定义 · L{item.source.line}–{item.endLine}
            </p>
            <SourceButton source={item.source} open={context.open} />
            <a
              className="rd-evidence-link"
              href="#rd-evidence"
              onClick={() => toggleSection("evidence", true)}
            >
              查看验收与历史依据 ↗
            </a>
            <p className="rd-muted">
              快照时间{" "}
              {new Date(snapshot.completedAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </p>
          </section>
        </aside>
      </div>
      <footer className="rd-muted rd-footer">
        内容来自已读取需求、规划、Task 与验收记录
      </footer>
    </article>
  );
}
