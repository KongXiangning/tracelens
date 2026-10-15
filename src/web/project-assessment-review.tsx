import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import type {
  OverviewReviewRequirement,
  OverviewSnapshot,
} from "../shared/overview-data";
import {
  assessmentReviewSummary,
  projectAssessmentReviewText,
} from "../shared/assessment-review-export";
import { assessmentReviewGroups } from "../shared/assessment-review-groups";
import { conclusionLabels } from "../shared/product-view";
import { reviewSourceText } from "./assessment-review-dialog";
import { Modal, SourceButton } from "./components";
import type { OverviewContext } from "./product";

interface ProjectAssessmentReviewProps {
  requirements: readonly OverviewReviewRequirement[];
  snapshot: Pick<OverviewSnapshot, "id" | "projectId" | "completedAt">;
  projectTitle?: string;
  context?: OverviewContext;
}

export function ProjectAssessmentReview({
  requirements,
  snapshot,
  projectTitle,
  context,
}: ProjectAssessmentReviewProps) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackText, setFallbackText] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const summary = assessmentReviewSummary(requirements);
  const groups = assessmentReviewGroups(requirements);
  const empty = summary.requirements === 0;
  const counts = `${summary.changes} 项变更 · 影响 ${summary.requirements} 项需求、${summary.reports} 份报告`;

  function closeFallback(): void {
    setFallbackOpen(false);
    requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  }

  async function copy(): Promise<void> {
    setCopying(true);
    const text = projectAssessmentReviewText(
      requirements,
      snapshot,
      projectTitle,
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
      setFallbackText(text);
      setFallbackOpen(true);
    } finally {
      setCopying(false);
    }
  }

  return (
    <section className="overview-review-export" aria-label="项目待核对信息">
      <div>
        <strong>项目验收待处理变更</strong>
        <p>{empty ? "当前项目没有验收待核对项" : counts}</p>
        <p>按同一变更汇总实际受影响范围；已处理且适用条件未变的处置可复用。</p>
      </div>
      {!empty && (
        <details className="project-assessment-review-groups">
          <summary>按变更查看原因与受影响范围</summary>
          {groups.map((group) => (
            <section
              className="assessment-review-change"
              key={group.key}
              data-review-category={group.category}
            >
              <h4>{group.label}</h4>
              {group.source && <p>{reviewSourceText(group.source)}</p>}
              {!!group.changeIds.length && (
                <p>变更标识：{group.changeIds.join("、")}</p>
              )}
              <ul>
                {group.members.map(({ requirement, record }) => (
                  <li key={`${requirement.key}:${record.report.key}`}>
                    <strong>
                      {requirement.id} · {record.report.id}
                    </strong>
                    <span>
                      {record.report.metadata.applicability?.coverage ||
                        "范围未记录"}
                    </span>
                    <span>
                      原报告结论：
                      {record.report.metadata.conclusion
                        ? conclusionLabels[record.report.metadata.conclusion]
                        : "未记录或字段异常"}
                      ；目标 / 范围：
                      {record.report.metadata.applicability?.goal_id ||
                        "未记录"}{" "}
                      /{" "}
                      {record.report.metadata.applicability?.scope_id ||
                        "未记录"}
                    </span>
                    <span>
                      {record.review?.issues
                        .map((issue) => issue.title)
                        .join("、") || record.selection.reasons.join("、")}
                    </span>
                    {context && (
                      <div className="assessment-review-report-links">
                        <button
                          className="text-link"
                          onClick={() => context.openProduct(record.report.key)}
                        >
                          查看报告与依据 ↗
                        </button>
                        {record.report.source && (
                          <SourceButton
                            source={record.report.source}
                            open={context.open}
                          />
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      )}
      <div className="overview-review-export-action">
        <button
          ref={trigger}
          type="button"
          className="secondary"
          disabled={empty || copying}
          onClick={() => void copy()}
        >
          <Copy size={15} aria-hidden="true" />
          复制全部待核对信息
        </button>
        {copied && !fallbackOpen && (
          <span role="status">已复制全部待核对信息</span>
        )}
      </div>
      {fallbackOpen && (
        <Modal title="全部待核对信息" close={closeFallback}>
          <div className="modal-body project-assessment-review-dialog">
            <p>
              {projectTitle || "当前项目"} · {counts}
            </p>
            <p>
              同一变更只调查一次，分别保留受影响报告的原结论、范围、来源依据与局部处置。
            </p>
            {!copied && (
              <p role="alert">
                剪贴板不可用，请选择下方全部待核对信息复制，或重试。
              </p>
            )}
            <textarea
              aria-label="全部待核对信息"
              readOnly
              rows={16}
              value={fallbackText}
            />
            {copied && <p role="status">已复制全部待核对信息</p>}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="primary"
              disabled={copying}
              onClick={() => void copy()}
            >
              复制全部待核对信息
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
