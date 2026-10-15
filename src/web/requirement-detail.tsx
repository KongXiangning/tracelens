import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, FileText } from "lucide-react";
import type { ProductBindingView, ProductItem } from "../shared/product-types";
import {
  featureExecution,
  featureStateLabels,
  featureAssessmentView,
  featureImplementationLabels,
  featureReportContext,
  featureDefinition,
  assessmentNarrative,
  featureReportDetail,
  requirementFeatures,
  type FeatureReport,
  type FeatureState,
  type FeatureImplementation,
  type RequirementFeature,
} from "../shared/requirement-detail";
import { requirementBindings } from "../shared/product-hierarchy";
import {
  goalRequirements,
  productView,
  selectAssessment,
  conclusionLabels,
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
import { requirementProgress } from "../shared/overview-progress";
import { ProgressResult } from "./progress-result";

const filters: { value: "all" | FeatureImplementation; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "implemented", label: "已实现" },
  { value: "partial", label: "部分实现" },
  { value: "not-implemented", label: "未实现" },
  { value: "unable-to-assess", label: "无法评估" },
  { value: "failed", label: "评估未通过" },
  { value: "recorded", label: "已评估" },
  { value: "conflict", label: "逐点记录冲突" },
  { value: "unassessed", label: "未逐点列出" },
];
type DetailView = {
  goal: string;
  subject: string;
  scope: Record<string, string>;
  filter: "all" | FeatureImplementation;
  report?: string;
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
  return reports.map((report) => {
    const detail = featureReportDetail(report);
    const isEvidence = (label: string) =>
      /来源|文件|路径|证据定位|材料定位/.test(label);
    const facts = [
      ["评估结论", detail.judgment],
      ["已查实现", detail.implementation],
      ["剩余与边界", detail.remaining],
      ["验证依据", detail.verification],
      ["实现、验证与边界", detail.evidence],
      ...detail.otherFields
        .filter((field) => !isEvidence(field.label))
        .map((field) => [field.label, field.text]),
    ].filter(([, text]) => text);
    return (
      <section
        className="rd-feature-report"
        key={report.key}
        aria-label={`逐点说明 · ${report.title}`}
      >
        <dl>
          {facts.map(([label, text], index) => (
            <div key={index}>
              <dt>{label}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        {detail.otherFields.some((field) => isEvidence(field.label)) && (
          <details className="result-evidence">
            <summary>关联材料</summary>
            {detail.otherFields
              .filter((field) => isEvidence(field.label))
              .map((field, index) => (
                <p key={index}>{field.text}</p>
              ))}
          </details>
        )}
        <details className="rd-original-report">
          <summary>查看原始评估</summary>
          <h4>{report.title}</h4>
          <dl>
            {report.fields.map((field, index) => (
              <div key={index}>
                <dt>{field.label}</dt>
                <dd>{field.text}</dd>
              </div>
            ))}
          </dl>
          <p className="rd-muted">
            {report.reportId} · 范围：{report.scopeId || "未声明"} ·{" "}
            {report.checkedAt || "时间未记录"}
          </p>
          <p className="rd-muted">对象：{reportObjectText(report.subject)}</p>
          {report.subject?.limitations && (
            <p className="rd-muted">{report.subject.limitations}</p>
          )}
          <SourceButton source={report.source} open={context.open} />
        </details>
      </section>
    );
  });
}

function excerpt(text: string, limit = 140) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

function reportObjectText(subject?: Subject) {
  if (!subject) return "未记录";
  return `${subject.kind} · ${subject.value || "未记录"}${subject.revision ? ` @ ${subject.revision}` : ""}`;
}

function pointSummary(
  detail: ReturnType<typeof featureReportDetail> | undefined,
  state: FeatureImplementation,
  hasReport: boolean,
) {
  if (state === "conflict") return "本报告有多条同编号记录，请核对原文。";
  if (!detail)
    return hasReport
      ? "本报告未给出此点的逐点结论。"
      : "实现与验证按评估报告查看。";
  const parts: string[] = [];
  if (detail.judgment && detail.judgment !== featureImplementationLabels[state])
    parts.push(detail.judgment);
  const explanation =
    detail.remaining ||
    detail.evidence ||
    detail.implementation ||
    detail.otherFields.map((field) => field.text).join("；");
  if (explanation) parts.push(explanation);
  return excerpt(parts.join("；")) || "报告已有逐点记录，未单列实现判断。";
}

function pointTitle(
  feature: RequirementFeature,
  report: FeatureReport | undefined,
  items: ProductItem[],
): string {
  const obligation = report?.pointText?.match(/具体义务：([^：]+)：/)?.[1];
  if (obligation) return obligation;
  const target = feature.title.match(/^已移至独立要求 (REQ-[^；\s]+)/)?.[1];
  return items.find((item) => item.id === target)?.title || feature.title;
}

function assessmentResultLabel(report: ProductItem): string {
  const conclusion = report.metadata.conclusion;
  if (conclusion === "undetermined") return "已评估 · 无法判定是否满足";
  if (conclusion) return `已评估 · ${conclusionLabels[conclusion]}`;
  return "整体结果未单列 · 具体评估见下方说明";
}

function ReportBasis({
  report,
  context,
}: {
  report: ProductItem;
  context: ProductContext;
}) {
  return (
    <>
      <dl className="rd-properties">
        <dt>原始报告</dt>
        <dd>{report.id}</dd>
        <dt>评估时间</dt>
        <dd>{report.metadata.checked_at || "未记录"}</dd>
        <dt>评估范围</dt>
        <dd>{report.metadata.applicability?.coverage || "未声明范围"}</dd>
        <dt>评估对象</dt>
        <dd>{reportObjectText(report.metadata.subject)}</dd>
        {report.metadata.subject?.limitations && (
          <>
            <dt>对象限制</dt>
            <dd>{report.metadata.subject.limitations}</dd>
          </>
        )}
      </dl>
      {featureReportContext(report).map((section) => (
        <div key={section.title} className="rd-report-context">
          <h4>{section.title}</h4>
          <p>{section.text}</p>
        </div>
      ))}
      <button
        className="text-link"
        onClick={() => context.openProduct(report.key)}
      >
        查看完整评估与补充记录 ↗
      </button>
      <SourceButton source={report.source} open={context.open} />
    </>
  );
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
                {contributionLabel(row.binding)} · 覆盖范围：{" "}
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
  const [filter, setFilter] = useState<"all" | FeatureImplementation>(
    saved.filter,
  );
  const [inspectedReport, setInspectedReport] = useState(saved.report);
  const [expanded, setExpanded] = useState(saved.expanded);
  useEffect(() => {
    detailViews.set(cacheKey, {
      goal: goalKey,
      subject: subjectValue,
      scope: scopes,
      filter,
      report: inspectedReport,
      expanded,
    });
  }, [
    cacheKey,
    goalKey,
    subjectValue,
    scopes,
    filter,
    expanded,
    inspectedReport,
  ]);
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
  const selection =
    evaluationGoal && (evaluationGoal.version || 0) >= 3
      ? selectAssessment(
          product,
          item.id,
          evaluationGoal.id,
          subject,
          scopes[scopeKey],
        )
      : undefined;
  const reportOptions = product.items.filter(
    (report) =>
      report.usable &&
      report.type === "assessment" &&
      report.metadata.target === item.id,
  );
  const inspectedReportKey = reportOptions.some(
    (report) => report.key === inspectedReport,
  )
    ? inspectedReport
    : undefined;
  // Default to a recent record for reading, without adopting its object for acceptance.
  let previewReportKey = inspectedReportKey;
  if (!previewReportKey && !subject && !selection?.reports.length) {
    const scopedReports = reportOptions.filter(
      (report) =>
        report.metadata.applicability?.goal_id === evaluationGoal?.id &&
        report.metadata.applicability?.scope_id === selection?.scopeId,
    );
    const locatedReports = reportOptions.filter(
      (report) => report.metadata.applicability && report.metadata.subject,
    );
    let candidates = locatedReports.length ? locatedReports : reportOptions;
    if (scopedReports.length) candidates = scopedReports;
    // Pick a reading default only. Applicability is checked separately below.
    previewReportKey = [...candidates].sort(
      (a, b) =>
        (Date.parse(b.metadata.checked_at || "") || 0) -
          (Date.parse(a.metadata.checked_at || "") || 0) ||
        a.id.localeCompare(b.id),
    )[0]?.key;
  }
  const featureView = featureAssessmentView(
    features,
    selection,
    previewReportKey,
  );
  const activeReport = product.items.find(
    (report) => report.key === featureView.reportKey,
  );
  const reportSelection =
    activeReport?.metadata.applicability && activeReport.metadata.subject
      ? selectAssessment(
          product,
          item.id,
          activeReport.metadata.applicability.goal_id,
          activeReport.metadata.subject,
          activeReport.metadata.applicability.scope_id,
        )
      : undefined;
  const reportIssues = (reportSelection?.reviewIssues || [])
    .filter((entry) => entry.reportKey === activeReport?.key)
    .map((entry) => entry.issue);
  const reportNarrative = activeReport ? assessmentNarrative(activeReport) : [];
  let missingLabel = "未评估";
  if (activeReport) missingLabel = "未逐点列出";
  else if (reportOptions.length) missingLabel = "未选择评估";
  const visible = featureView.points.filter(
    (point) => filter === "all" || point.state === filter,
  );
  const verificationText =
    activeReport &&
    (typeof activeReport.metadata.extensions?.verification_interpretation ===
    "string"
      ? activeReport.metadata.extensions.verification_interpretation
      : featureReportContext(activeReport).find(
          (section) => section.title === "交付与验证依据",
        )?.text);
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
          <section className="rd-card" aria-label="进展核对结果">
            <h2>进展核对结果</h2>
            <ProgressResult
              work={requirementProgress(snapshot, item, rows)}
              open={context.open}
            />
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
          <section
            className="rd-card rd-functional-points"
            aria-label="功能点拆分"
          >
            <div className="rd-between">
              <h2>
                功能点拆分 <small>{features.length}</small>
              </h2>
              {activeReport && (
                <span
                  className="rd-report-applicability"
                  data-applicable={Boolean(
                    reportSelection?.assessment &&
                    !reportSelection.reasons.length,
                  )}
                >
                  {assessmentResultLabel(activeReport)}
                </span>
              )}
            </div>
            <div className="rd-feature-context">
              <span>
                {activeReport
                  ? `评估记录 · ${activeReport.metadata.checked_at?.slice(0, 10) || "时间未记录"} · 结论限于报告范围`
                  : "尚未选择逐点评估"}
              </span>
              <details className="rd-report-basis">
                <summary>评估依据与报告选择</summary>
                {reportOptions.length > 0 && (
                  <label className="rd-report-picker">
                    逐点评估报告
                    <select
                      aria-label="功能点评估报告"
                      value={inspectedReportKey || ""}
                      onChange={(event) => {
                        setInspectedReport(event.target.value || undefined);
                        setFilter("all");
                      }}
                    >
                      <option value="">跟随所选验收范围与交付记录</option>
                      {reportOptions.map((report) => (
                        <option key={report.key} value={report.key}>
                          {report.id} ·{" "}
                          {report.metadata.applicability?.scope_id ||
                            "原报告记录"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {activeReport ? (
                  <ReportBasis report={activeReport} context={context} />
                ) : (
                  <p className="rd-muted">
                    选择验收目标、范围和交付记录，或打开一份逐点评估报告查看原记录。其他对象的报告不会自动作为当前结论。
                  </p>
                )}
              </details>
            </div>
            {reportNarrative.map((section) => (
              <div className="rd-result-narrative" key={section.title}>
                <h3>{section.title}</h3>
                <p>{section.text}</p>
              </div>
            ))}
            {!reportNarrative.length && verificationText && (
              <p className="rd-result-narrative">{verificationText}</p>
            )}
            {activeReport &&
              !reportNarrative.length &&
              activeReport.metadata.conclusion === "undetermined" && (
                <p>
                  报告明确未能判定是否满足，但未单列原因说明。可展开原始评估查看已有材料。
                </p>
              )}
            {reportIssues.length > 0 && (
              <details className="rd-result-applicability">
                <summary>
                  这份评估用于当前需求时的限制（{reportIssues.length}）
                </summary>
                {reportIssues.map((issue, index) => (
                  <div key={index}>
                    <p>{issue.detail}</p>
                    <p>{issue.action}</p>
                  </div>
                ))}
              </details>
            )}
            {activeReport &&
              !featureView.points.some((point) => point.report) && (
                <p className="rd-feature-notice">
                  所选报告没有逐点表格，不能将整项或子范围的结论扩展到全部功能点。其他逐点记录可在“评估依据与报告选择”中查看。
                </p>
              )}
            <div className="rd-filters" role="group" aria-label="功能点筛选">
              {filters.map((option) => {
                const count = featureView.points.filter(
                  (point) =>
                    option.value === "all" || point.state === option.value,
                ).length;
                return (
                  (count > 0 || option.value === "all") && (
                    <button
                      key={option.value}
                      aria-pressed={filter === option.value}
                      onClick={() => setFilter(option.value)}
                    >
                      {option.value === "unassessed"
                        ? missingLabel
                        : option.label}{" "}
                      {count}
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
            {visible.map(({ feature, report, detail, state, otherReports }) => (
              <details
                className="rd-feature"
                key={feature.key}
                data-feature-key={feature.key}
                data-feature-id={feature.id}
                data-implementation={state}
                data-report-id={report?.reportId}
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
                    {feature.id ||
                      String(features.indexOf(feature) + 1).padStart(2, "0")}
                  </span>
                  <span className="rd-feature-copy">
                    <h3>{pointTitle(feature, report, product.items)}</h3>
                    <small className="rd-report-summary">
                      {pointSummary(detail, state, Boolean(activeReport))}
                    </small>
                    {feature.inclusion && feature.inclusion !== "included" && (
                      <small>
                        {feature.inclusion === "deferred" ? "已延期" : "已撤回"}
                      </small>
                    )}
                  </span>
                  <span className="rd-badge" data-implementation={state}>
                    {state === "unassessed"
                      ? missingLabel
                      : featureImplementationLabels[state]}
                  </span>
                </summary>
                <p className="rd-feature-description">
                  {featureDefinition(snapshot, item, feature)}
                </p>
                <section className="rd-feature-assessment">
                  <div className="rd-feature-body">
                    <h4>评估说明</h4>
                    <FeatureReports
                      reports={report ? [report] : []}
                      context={context}
                    />
                    {otherReports.length > 0 && (
                      <details className="rd-other-reports">
                        <summary>其他逐点记录 · {otherReports.length}</summary>
                        <p className="rd-muted">
                          以下记录未作为上方所选评估的逐点结论；原对象、范围与验证限制保留。
                        </p>
                        {otherReports.map((other) => (
                          <details key={other.key}>
                            <summary>
                              {other.reportId} · {other.title}
                            </summary>
                            <FeatureReports
                              reports={[other]}
                              context={context}
                            />
                          </details>
                        ))}
                      </details>
                    )}
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
                  </div>
                </section>
              </details>
            ))}
            <p className="rd-muted rd-footnote">
              每项保留报告中的实现、验证、剩余与未知。仅有事实说明时显示“已评估”，具体判断见文字说明。
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
                  onChange={(event) => {
                    setGoalKey(event.target.value);
                    setInspectedReport(undefined);
                    setFilter("all");
                  }}
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
              set={(value) => {
                setSubjectValue(value);
                setInspectedReport(undefined);
                setFilter("all");
              }}
            />
            <ScopedConclusion
              item={item}
              goal={evaluationGoal}
              subject={subject}
              scopeId={scopes[scopeKey]}
              context={context}
              chooseScope={(scope) => {
                setScopes((previous) => ({ ...previous, [scopeKey]: scope }));
                setInspectedReport(undefined);
                setFilter("all");
              }}
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
            <details
              className="rd-task-records"
              open={expanded.includes("tasks")}
              onToggle={(event) =>
                toggleSection("tasks", event.currentTarget.open)
              }
            >
              <summary className="rd-between">
                <h2>
                  关联 Task <small>{knownTaskCount}</small>
                </h2>
                <small className="rd-muted">需求级 · 按身份去重</small>
              </summary>
              {rows.length > 0 && (
                <p className="rd-task-execution">
                  Task 执行记录：
                  <StateBadge state={work.state} />
                  {pendingTaskCount > 0 &&
                    ` · ${pendingTaskCount} 组关联待核对`}
                </p>
              )}
              <BoundTasks
                rows={rows}
                context={context}
                requirementKey={item.key}
              />
              {!rows.length && <p className="rd-muted">尚未记录 Task 关联。</p>}
            </details>
          </section>
          <section className="rd-card">
            <details className="result-evidence">
              <summary>来源与依据</summary>
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
            </details>
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
