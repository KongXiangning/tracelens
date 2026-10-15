import type { RequirementWork } from "../shared/overview-progress";
import { requirementProgressLabel } from "../shared/overview-progress";
import type { SourceRef } from "../shared/types";
import { SourceButton } from "./components";

export function ProgressResult({
  work,
  open,
}: {
  work?: RequirementWork;
  open: (source: SourceRef) => void;
}) {
  return (
    <div className="progress-result">
      <p className="progress-result-status">{requirementProgressLabel(work)}</p>
      {work?.reviews?.length ? (
        work.reviews.map((review) => (
          <section key={review.reportKey}>
            <h3>{review.outcome}</h3>
            <p>{review.explanation}</p>
            {review.coverage && (
              <p className="progress-result-scope">
                核对范围：{review.coverage}
              </p>
            )}
            {review.applicabilityIssues.length > 0 && (
              <div>
                <p>核对结果已保存；用于当前定义时还有以下限制：</p>
                {review.applicabilityIssues.map((issue, index) => (
                  <p key={index}>{issue}</p>
                ))}
              </div>
            )}
            <details className="result-evidence">
              <summary>时间与来源依据</summary>
              <p>核对时间：{review.checkedAt || "未记录"}</p>
              {review.subject && <p>核对对象：{review.subject}</p>}
              {review.limitations && <p>{review.limitations}</p>}
              <SourceButton source={review.source} open={open} />
            </details>
          </section>
        ))
      ) : (
        <>
          {(work?.reasons || []).map((reason, index) => (
            <p key={index}>{reason}</p>
          ))}
          {work?.recorded && (
            <p>已读取直接范围的执行记录；具体工作和结果见关联 Task。</p>
          )}
          {work?.notStarted && <p>关联范围的步骤明确记录为未开始。</p>}
        </>
      )}
      {(work?.historical || []).map((entry, index) => (
        <section key={index}>
          <p>{entry.summary}</p>
          <details className="result-evidence">
            <summary>历史工作依据</summary>
            <SourceButton source={entry.source} open={open} />
          </details>
        </section>
      ))}
    </div>
  );
}
