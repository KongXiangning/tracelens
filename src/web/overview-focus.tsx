import { useState } from "react";
import { Modal } from "./components";
import { isOverviewSnapshot, type OverviewData } from "../shared/overview-data";
import type { CurrentWork, RoadmapSummary } from "../shared/overview-focus";
import {
  contributionLabels,
  workTypeLabels,
  type ContributionSummary,
} from "../shared/product-contribution";
import type { OverviewContext } from "./product";
import { lifecycleLabels } from "./runtime";

export function ContributionCounts({
  summary,
  compact = false,
}: {
  summary?: ContributionSummary;
  compact?: boolean;
}) {
  if (!summary) return null;
  const text = summary.workTypes
    .filter(
      (group) =>
        !compact ||
        group.relations > 0 ||
        ["implementation", "verification", "supporting"].includes(group.type),
    )
    .map(
      (group) =>
        `${workTypeLabels[group.type]} ${group.uniqueTasks}${group.unknownIdentityRelations ? `（身份未知关系 ${group.unknownIdentityRelations}）` : ""}`,
    )
    .join(" · ");
  return (
    <div
      className="contribution-counts"
      data-contribution-summary
      title={`${text}；各类按 Task 身份去重，同一 Task 可承担多类工作；共 ${summary.relations} 条关系，${summary.uniqueTasks} 个唯一 Task 身份`}
    >
      <span>{text}</span>
      {compact && (
        <small className="contribution-identity-count">
          唯一 Task {summary.uniqueTasks}
          {summary.unconfirmedRelations
            ? ` · 身份未知关系 ${summary.unconfirmedRelations}`
            : ""}{" "}
          · 各类可重叠
        </small>
      )}
      {!compact && (
        <>
          <p>
            共 {summary.relations} 条已保存 active 关系，涉及{" "}
            {summary.uniqueTasks} 个已记录 Task 身份，{summary.confirmedTasks}{" "}
            个已匹配；身份未知关系 {summary.unconfirmedRelations} 条
          </p>
          <p>
            各类按 Task 身份去重，同一 Task
            可承担多类工作，分组不可相加；重复关系保留范围与来源。身份未知关系不计作唯一
            Task。工作类型与 Task 生命周期不证明需求已开始、已实现或已满足
          </p>
          {!!summary.inferredRelations && (
            <p>
              其中 {summary.inferredRelations} 条为 inferred
              推断关联，尚未自动采纳
            </p>
          )}
          {!!summary.descendantDirect && (
            <p>
              其中 {summary.descendantDirect} 条直接关系来自组成需求，保留原
              owner；不改作父项自身直接贡献
            </p>
          )}
          <p>
            首次交付基线由用户配合 Agent 在项目中建立；后续由 vNext
            正常工作流维护分类、范围与验收事实。TraceLens
            消费已保存事实，不重新分析全部历史 Task，也不修改被观察项目。
          </p>
        </>
      )}
    </div>
  );
}
export function CurrentWorkPanel({
  work,
  context,
}: {
  work?: CurrentWork;
  context: OverviewContext;
}) {
  const observation = isOverviewSnapshot(context.snapshot)
    ? context.snapshot.runtimeObservation
    : context.snapshot.runtime;
  const readAt = observation?.readAt || work?.readAt;
  return (
    <section
      className="overview-focus-panel overview-current-work"
      aria-label="当前工作"
    >
      <div className="overview-focus-heading">
        <h2>当前工作</h2>
        <small>Runtime 已记录焦点</small>
      </div>
      {work?.taskId ? (
        <>
          {work.taskKey ? (
            <button
              className="text-link overview-focus-title"
              onClick={() => context.openTask(work.taskKey)}
            >
              {work.title || work.taskId} ↗
            </button>
          ) : (
            <>
              <strong className="overview-focus-title">
                {work.title || work.taskId}
              </strong>
              <button className="text-link" onClick={() => context.openTask()}>
                查看已读取 Task 与范围 ↗
              </button>
            </>
          )}
          <p>
            {work.lifecycle
              ? lifecycleLabels[
                  work.lifecycle as keyof typeof lifecycleLabels
                ] || work.lifecycle
              : "详情尚未读取"}{" "}
            · {work.taskId}
          </p>
          {!work.bindingCount && (
            <p>本批未读到需求关联；当前工作仍保留，不推定尚无实现</p>
          )}
          {work.activityEvidence.slice(0, 3).map((evidence) => (
            <article
              key={evidence.bindingKey}
              className="overview-focus-row"
              data-activity-owner={evidence.ownerId}
            >
              <button
                className="text-link"
                onClick={() => context.openProduct(evidence.ownerKey)}
              >
                {evidence.ownerId} · {evidence.ownerTitle}
              </button>
              <span className="requirements-v3-pill">
                {contributionLabels[evidence.contribution || "unclassified"]} ·{" "}
                {evidence.role}
              </span>
              <p>{evidence.coverage}</p>
              <p>{evidence.label}</p>
              {evidence.stepId && (
                <small>
                  步骤 {evidence.stepId} · {evidence.stepState}
                  {evidence.executionRef &&
                    ` · 执行来源 ${evidence.executionRef}`}
                </small>
              )}
              {evidence.issues.map((issue) => (
                <p key={issue} className="requirements-v3-warning">
                  {issue}
                </p>
              ))}
            </article>
          ))}
          {work.bindingCount > Math.min(3, work.activityEvidence.length) && (
            <p>
              另 {work.bindingCount - Math.min(3, work.activityEvidence.length)}{" "}
              条关联可在 Task 详情查看
            </p>
          )}
        </>
      ) : (
        <p>
          {work?.source !== "unavailable" && work?.complete
            ? "本次 Runtime 未登记当前焦点"
            : "当前焦点尚不能确认，已读取任务仍可浏览"}
        </p>
      )}
      <p className="overview-current-source">
        {work?.source === "runtime-query" && work.freshness === "queried"
          ? "本批 Runtime 只读查询"
          : work?.source === "file-snapshot"
            ? "文件降级快照，当前性待核对"
            : work?.source === "memory-snapshot"
              ? "内存降级快照，当前性待核对"
              : "Runtime 当前性待核对"}
        {readAt && ` · 读取 ${readAt}`}
      </p>
      <details className="overview-focus-evidence">
        <summary>来源、时间与局限</summary>
        <p>
          {work?.source || "unavailable"} ·{" "}
          {work?.freshness === "queried" ? "本批只读查询" : "快照或新鲜度未知"}{" "}
          · {work?.complete ? "Task 列表完整" : "Task 列表未完整"}
        </p>
        {readAt && (
          <p>
            读取时间 {readAt}；数据版本 {work?.viewRevision || "未知"}
          </p>
        )}
        {work?.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        <p>
          焦点、关联和执行分别展示。没有精确步骤与采用范围依据时，不把活动分配给每个需求
        </p>
      </details>
    </section>
  );
}
const statusLabels: Record<RoadmapSummary["status"], string> = {
  current: "材料与基线一致",
  "changes-pending": "存在待核对变化",
  "reviewed-deferred": "已核对并明确延期",
  unknown: "当前适用性待核对",
};
export function FocusResults({
  data,
  context,
}: {
  data: OverviewData;
  context: OverviewContext;
}) {
  const plans = data.roadmapSummary || [];
  const [requested, setRequested] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(false);
  const adopted = plans.filter(
    (plan) => plan.readable && plan.intentState === "adopted",
  );
  const selected = plans.find((plan) => plan.planKey === requested);
  return (
    <section className="overview-focus-tools" aria-label="安排与成果">
      {resultsOpen && (
        <Modal title="最近确认的成果" close={() => setResultsOpen(false)}>
          <div className="modal-body overview-focus-panel overview-results-page">
            <div className="overview-focus-heading">
              <small>按核对时间排列</small>
            </div>
            {data.confirmedOutcomes?.items.length ? (
              data.confirmedOutcomes.items.map((outcome) => (
                <article
                  key={`${outcome.requirementKey}:${outcome.reportKey}`}
                  className="overview-focus-row"
                  data-confirmed-outcome={outcome.reportId}
                >
                  <button
                    className="text-link"
                    onClick={() => context.openProduct(outcome.reportKey)}
                  >
                    {outcome.requirementId} ·{" "}
                    {outcome.conclusion === "satisfied"
                      ? "该范围已满足"
                      : "该范围部分满足"}{" "}
                    ↗
                  </button>
                  <p>{outcome.coverage}</p>
                  <small>
                    目标 {outcome.goalId} / 范围 {outcome.scopeId}
                  </small>
                  <p>
                    {outcome.subject.kind} · {outcome.subject.value}
                    {outcome.subject.revision &&
                      ` @ ${outcome.subject.revision}`}
                  </p>
                  <small>
                    核对时间 {outcome.checkedAt || "未知"}；不是功能完成时间
                  </small>
                </article>
              ))
            ) : (
              <p>
                尚无当前适用且范围明确的满足报告；历史结论与待核对材料仍在完整范围中可查
              </p>
            )}
            {(data.confirmedOutcomes?.total || 0) > 6 && (
              <p>
                另有 {data.confirmedOutcomes!.total - 6}{" "}
                项适用成果，见完整范围与报告记录
              </p>
            )}
          </div>
        </Modal>
      )}
      <section className="overview-plan-control" aria-label="近期安排">
        <div className="overview-plan-toolbar">
          <div className="overview-focus-heading">
            <h2>近期安排</h2>
            {selected && (
              <button
                className="text-link"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "收起近期安排" : "展开近期安排"}
              </button>
            )}
          </div>
          <button
            className="secondary overview-results-link"
            onClick={() => setResultsOpen(true)}
          >
            最近确认的成果 · {data.confirmedOutcomes?.total || 0} ↗
          </button>
        </div>
        {plans.length ? (
          <>
            <label>
              阅读路线图
              <select
                aria-label="阅读路线图"
                value={selected?.planKey || ""}
                onChange={(event) => {
                  setRequested(event.target.value);
                  setExpanded(true);
                }}
              >
                <option value="">
                  {adopted.length > 1
                    ? "多份已采用路线图，请选择"
                    : "选择已保存路线图"}
                </option>
                {plans.map((plan) => (
                  <option key={plan.planKey} value={plan.planKey}>
                    {plan.planId} · {plan.title} ·{" "}
                    {plan.intentState || "状态未知"}
                  </option>
                ))}
              </select>
            </label>
            {!selected && <p>选择路线图后展开近期安排；不自动选定全项目计划</p>}
            {selected && expanded && (
              <div data-roadmap-plan={selected.planId}>
                <p
                  className="overview-roadmap-status"
                  data-roadmap-status={selected.status}
                >
                  {statusLabels[selected.status]} ·{" "}
                  {selected.intentState || "状态未知"}
                </p>
                {selected.intentState !== "adopted" && (
                  <p>
                    这是
                    {selected.intentState === "retired" ? "已退役" : "尚未采用"}
                    的保存安排，仅供浏览。
                  </p>
                )}
                {!selected.readable && (
                  <p>结构不可用，工作项数量未知；请查看原文。</p>
                )}
                <p>
                  {selected.location === "current-task-binding"
                    ? "按当前 Task 明确关联的工作项，展示原顺序附近安排"
                    : selected.location === "ambiguous"
                      ? "当前 Task 关联多个工作项，暂不能唯一定位；先浏览已保存安排"
                      : "当前工作项未明确，下一项尚未确定；先浏览已保存安排"}
                </p>
                {selected.workItems.map((work) => (
                  <article
                    key={work.id}
                    className="overview-focus-row"
                    data-roadmap-work={work.id}
                  >
                    <button
                      className="text-link"
                      onClick={() =>
                        context.openProduct(selected.planKey, work.id)
                      }
                    >
                      {work.id} · {work.title} ↗
                    </button>
                    <p>{work.scope || work.outcome}</p>
                    <small>
                      {work.stage && `${work.stage} · `}
                      {work.state === "included"
                        ? "已纳入安排"
                        : work.state === "deferred"
                          ? "明确暂缓"
                          : "已撤回"}
                    </small>
                    {!!work.depends_on?.length && (
                      <p>
                        已声明前置：
                        {work.depends_on
                          .map(
                            (dependency) =>
                              `${dependency.item_id}（${dependency.kind === "prerequisite" ? "前提" : "顺序"}）`,
                          )
                          .join("、")}
                        ；是否满足待核对
                      </p>
                    )}
                  </article>
                ))}
                {!!selected.earlierPrerequisites.length && (
                  <div className="overview-focus-row">
                    <strong>窗口外的明确前提</strong>
                    {selected.earlierPrerequisites.map((work) => (
                      <p key={work.id}>
                        <button
                          className="text-link"
                          onClick={() =>
                            context.openProduct(selected.planKey, work.id)
                          }
                        >
                          {work.id} · {work.title}
                        </button>{" "}
                        · {work.state}，不因排列在前而视为完成
                      </p>
                    ))}
                  </div>
                )}
                <button
                  className="text-link"
                  onClick={() => context.openProduct(selected.planKey)}
                >
                  {selected.totalWorkItems === null
                    ? "查看原文与结构诊断"
                    : `查看全部 ${selected.totalWorkItems} 个工作项与核对依据`}{" "}
                  ↗
                </button>
                <details className="overview-focus-evidence">
                  <summary>核对差异与边界 · {selected.changeCount}</summary>
                  {selected.reasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                  <p>
                    current
                    只表示材料对齐，不表示工作完成或前置已就绪；浏览与刷新不会采用或执行
                    Task
                  </p>
                </details>
              </div>
            )}
          </>
        ) : (
          <p>
            尚未确定近期安排；没有已读取的 Roadmap，需求登记顺序不会代替实施规划
          </p>
        )}
      </section>
    </section>
  );
}
