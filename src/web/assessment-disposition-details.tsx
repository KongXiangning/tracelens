import type { ReactNode } from "react";
import type {
  EvidenceDispositionView,
  ProductSource,
} from "../shared/product-types";

const dispositionLabels: Record<
  EvidenceDispositionView["disposition"],
  string
> = {
  "no-impact": "范围不受影响",
  "evidence-incorporated": "证据已纳入报告",
  deferred: "暂缓处理",
};
const reuseLabels: Record<EvidenceDispositionView["reuse_status"], string> = {
  reused: "已复用",
  deferred: "仍待处理",
  "not-reusable": "不可复用，仍待核对",
  conflict: "处置冲突，仍待核对",
};
const changeLabels: Record<EvidenceDispositionView["kind"], string> = {
  "scope-change": "职责或验收范围变化",
  counterevidence: "新反例",
  "delivery-evidence": "交付证据",
  "source-change": "来源版本或可用性变化",
};
const reasonLabels: Record<string, string> = {
  "basis-changed": "范围、交付对象或报告依据已变化",
  "source-unverified": "处置来源或支持依据尚未核验",
  "evidence-not-incorporated": "对应证据尚未纳入报告",
  "conflicting-dispositions": "同一来源存在不同处置",
};

export function DispositionDetails({
  disposition,
  snapshotAt,
  renderSource,
}: {
  disposition: EvidenceDispositionView;
  snapshotAt?: string | null;
  renderSource: (reference: ProductSource, label: string) => ReactNode;
}) {
  const { basis } = disposition;
  return (
    <article data-evidence-disposition={disposition.reuse_status}>
      <h5>
        {reuseLabels[disposition.reuse_status]} · {disposition.change_id}
      </h5>
      <p>
        {dispositionLabels[disposition.disposition]}：{disposition.reason}
      </p>
      <dl className="product-fields">
        <dt>变更原因</dt>
        <dd>{changeLabels[disposition.kind]}</dd>
        <dt>处置时间</dt>
        <dd>{disposition.checked_at}</dd>
        <dt>需求 / 目标 / 范围</dt>
        <dd>
          {basis.target} / {basis.goal_id} / {basis.scope_id}
        </dd>
        <dt>覆盖范围</dt>
        <dd>{basis.coverage}</dd>
        <dt>交付对象</dt>
        <dd>
          {basis.subject.kind} · {basis.subject.value}
          {basis.subject.revision && ` @ ${basis.subject.revision}`}
          {basis.subject.limitations && ` · ${basis.subject.limitations}`}
        </dd>
      </dl>
      {disposition.reuse_status === "reused" ? (
        <p className="muted">
          本次快照{snapshotAt ? `（${snapshotAt}）` : ""}
          的适用依据与来源仍满足复用条件，沿用上述局部处置；原报告结论与检查时间保留。
        </p>
      ) : (
        <p className="warning-text">
          {disposition.reuse_reasons.length
            ? disposition.reuse_reasons
                .map((reason) => reasonLabels[reason] || reason)
                .join("；")
            : "此项尚未完成处置，仍保留待处理材料。"}
        </p>
      )}
      {renderSource(disposition.source, "处置来源")}
      {disposition.sources?.map((source, index) => (
        <div key={index}>{renderSource(source, "处置支持依据")}</div>
      ))}
    </article>
  );
}
