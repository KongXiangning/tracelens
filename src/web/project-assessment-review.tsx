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
import { Modal } from "./components";

interface ProjectAssessmentReviewProps {
  requirements: readonly OverviewReviewRequirement[];
  snapshot: Pick<OverviewSnapshot, "id" | "projectId" | "completedAt">;
  projectTitle?: string;
}

export function ProjectAssessmentReview({
  requirements,
  snapshot,
  projectTitle,
}: ProjectAssessmentReviewProps) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackText, setFallbackText] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const summary = assessmentReviewSummary(requirements);
  const empty = summary.requirements === 0;
  const counts = `${summary.requirements} 项需求 · ${summary.reports} 份报告 · ${summary.issues} 条原因`;

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
        <strong>项目验收待核对</strong>
        <p>{empty ? "当前项目没有验收待核对项" : counts}</p>
        <p>汇总当前项目全部需求，不受显示范围和筛选条件影响。</p>
      </div>
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
            <p>包含当前项目全部需求的验收待核对报告、来源依据和核对建议。</p>
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
