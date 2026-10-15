import { useState } from "react";
import type { AssessmentReviewIssue } from "../shared/assessment-review";
import type { OverviewRequirement } from "../shared/overview-data";
import type { ProductSource } from "../shared/product-types";
import type { OverviewContext } from "./product";
import { conclusionLabels } from "../shared/product-view";
import {
  assessmentReviewText,
  pendingAssessmentRecords,
} from "../shared/assessment-review-export";
import { Modal, SourceButton } from "./components";

export { assessmentReviewText } from "../shared/assessment-review-export";

export function reviewSourceText(reference: ProductSource): string {
  if (reference.kind === "text") {
    return `${reference.label}：${reference.text}`;
  }
  if (reference.kind === "uri") return reference.uri;
  const parts = [reference.path];
  if (reference.item_id) parts.push(`条目 ${reference.item_id}`);
  if (reference.section) parts.push(`章节 ${reference.section}`);
  if (reference.lines) {
    parts.push(`第 ${reference.lines.start}–${reference.lines.end} 行`);
  }
  if (reference.sha256) parts.push(`原文件 SHA-256 ${reference.sha256}`);
  if (reference.note) parts.push(reference.note);
  return parts.join(" · ");
}

function ReviewIssue({
  issue,
  context,
  close,
}: {
  issue: AssessmentReviewIssue;
  context: OverviewContext;
  close: () => void;
}) {
  return (
    <article
      className="assessment-review-issue"
      data-review-reason={issue.code}
    >
      <h5>{issue.title}</h5>
      <p>{issue.detail}</p>
      <p className="assessment-review-action">
        <strong>处理说明：</strong>
        {issue.action}
      </p>
      <details className="result-evidence">
        <summary>来源与技术核对明细</summary>
        {!!issue.comparisons?.length && (
          <dl className="assessment-review-comparisons">
            {issue.comparisons.map((comparison, index) => (
              <div key={`${comparison.label}:${index}`}>
                <dt>{comparison.label}</dt>
                <dd>
                  <span>报告记录</span>
                  <code>{comparison.recorded}</code>
                </dd>
                <dd>
                  <span>当前读取</span>
                  <code>{comparison.current}</code>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {!!issue.sources?.length && (
          <div className="assessment-review-sources">
            <strong>来源依据</strong>
            {issue.sources.map((entry, index) => (
              <div key={`${entry.label}:${index}`}>
                <span>{entry.label}</span>
                {entry.reference && <p>{reviewSourceText(entry.reference)}</p>}
                {entry.status && <p>{entry.status}</p>}
                {entry.source && (
                  <SourceButton
                    source={entry.source}
                    open={(source) => {
                      close();
                      context.open(source);
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </details>
    </article>
  );
}

export function AssessmentReviewDialog({
  item,
  context,
  close,
}: {
  item: OverviewRequirement;
  context: OverviewContext;
  close: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [textOpen, setTextOpen] = useState(false);
  const records = pendingAssessmentRecords(item);
  const text = assessmentReviewText(item, context.snapshot);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopied(false);
      setTextOpen(true);
      setCopyError("剪贴板不可用，请选择已展开的核对信息复制。");
    }
  }

  return (
    <Modal title="待核对原因" close={close}>
      <div className="modal-body assessment-review-dialog">
        <header>
          <h3>
            {item.id} · {item.title}
          </h3>
          <p>
            以下 {records.length}{" "}
            份报告存在待核对项。每项列出触发依据与需要确认的内容。
          </p>
          <p className="assessment-review-snapshot">
            读取完成：{context.snapshot.completedAt || "未记录"}
          </p>
        </header>
        <div className="assessment-review-copy">
          <button type="button" className="primary" onClick={() => void copy()}>
            复制核对信息
          </button>
          {copied && <span role="status">已复制核对信息</span>}
          <span>发送到对应项目的 agent 对话中核对处理。</span>
        </div>
        <details
          className="assessment-review-text"
          open={textOpen}
          onToggle={(event) => setTextOpen(event.currentTarget.open)}
        >
          <summary>查看可发送给 agent 的核对信息</summary>
          <textarea aria-label="待核对信息" readOnly rows={12} value={text} />
        </details>
        {copyError && <p role="alert">{copyError}</p>}
        {records.map((record) => {
          const { report, review } = record;
          const { applicability, subject, conclusion, checked_at } =
            report.metadata;
          return (
            <section
              className="assessment-review-report"
              key={report.key}
              data-review-report={report.id}
            >
              <h4>
                {report.id} · {report.title}
              </h4>
              <dl className="assessment-review-context">
                <dt>原报告结论</dt>
                <dd>
                  {conclusion
                    ? conclusionLabels[conclusion]
                    : "未记录或字段异常"}{" "}
                  · {checked_at || "时间未记录"}
                </dd>
                <dt>目标 / 范围</dt>
                <dd>
                  {applicability?.goal_id || "未记录"} /{" "}
                  {applicability?.scope_id || "未记录"}
                </dd>
                <dt>覆盖范围</dt>
                <dd>{applicability?.coverage || "未记录"}</dd>
                <dt>交付对象</dt>
                <dd>
                  {subject?.kind || "未记录"} · {subject?.value || "未记录"}
                  {subject?.revision && ` @ ${subject.revision}`}
                </dd>
                {subject?.limitations && (
                  <>
                    <dt>对象限制</dt>
                    <dd>{subject.limitations}</dd>
                  </>
                )}
              </dl>
              <div className="assessment-review-report-links">
                <button
                  className="text-link"
                  onClick={() => {
                    close();
                    context.openProduct(report.key);
                  }}
                >
                  查看报告与依据 ↗
                </button>
                {report.source && (
                  <SourceButton
                    source={report.source}
                    open={(source) => {
                      close();
                      context.open(source);
                    }}
                  />
                )}
              </div>
              {review ? (
                review.issues.map((issue, index) => (
                  <ReviewIssue
                    key={`${issue.code}:${index}`}
                    issue={issue}
                    context={context}
                    close={close}
                  />
                ))
              ) : (
                <p>
                  本次记录未包含判定明细，请刷新项目后查看。已记录状态：
                  {record.selection.reasons.join("、")}。
                </p>
              )}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
