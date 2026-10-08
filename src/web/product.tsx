import { useEffect, useState } from "react";
import { Network, ArrowRight, Search } from "lucide-react";
import type { Snapshot, SourceRef } from "../shared/types";
import {
  productTypes,
  type ProductBinding,
  type ProductItem,
  type ProductSourceCheck,
  type ProductType,
  type ProductView,
} from "../shared/product-types";
import { Empty, SourceButton, Status, type OpenSource } from "./components";
import { SnapshotMarkdown } from "./reader";

export const productLabels: Record<ProductType, string> = {
  project: "项目",
  goal: "目标",
  module: "模块",
  requirement: "需求",
  design: "设计",
  plan: "计划",
  change: "变化",
  assessment: "交付报告",
  discussion: "讨论",
};
export const scopeLabels = {
  current: "当前范围",
  planned: "后续范围",
  candidate: "候选",
  retired: "退出范围",
};
const intentLabels = { proposed: "提案", adopted: "已采用", retired: "已退出" };
const relationLabels: Record<string, string> = {
  supports: "支持",
  part_of: "归属",
  addresses: "方案对应",
  depends_on: "依赖",
  replaces: "替代",
  derived_from: "演进自",
  discusses: "讨论相关",
  references: "参考",
};
const roleLabels = {
  implementation: "实施",
  repair: "修复",
  verification: "验证",
  exploration: "探索",
  reference: "参考",
};
const readLabels: Record<ProductSourceCheck["readState"], string> = {
  read: "已读取",
  "not-read": "未读取",
  excluded: "被排除",
  outside: "范围外",
  unavailable: "不可用",
  unsupported: "不支持类型",
  unsafe: "不安全路径",
  external: "URI 未获取",
  text: "文字依据",
};
const digestLabels = {
  "same-bytes": "字节相同",
  changed: "字节已变化",
  unavailable: "摘要不可核对",
  unknown: "字节版本未知",
};
const implementationLabels = {
  unknown: "实施未知",
  "none-reported": "报告未实施",
  "partial-reported": "报告部分实施",
  "delivered-reported": "报告已交付",
};
const verificationLabels = {
  unknown: "验证未知",
  "not-run-reported": "报告未运行",
  "failure-reported": "报告失败",
  "pass-reported": "报告通过",
  "mixed-reported": "报告混合结果",
};
function itemSource(item: ProductItem, pointer: string): SourceRef {
  return {
    ...item.source,
    line: item.metadataLocations[pointer] || item.metadataLine,
  };
}
export function ProductStatus({
  product,
  open,
  configure,
}: {
  product?: ProductView;
  open: OpenSource;
  configure?: () => void;
}) {
  const status = product?.status || "disabled";
  const labels = {
    disabled: "PRODUCT 标准读取未启用",
    missing: "未发现 PRODUCT 入口",
    excluded: "PRODUCT 入口被排除",
    unavailable: "PRODUCT 入口不可用",
    unsupported: "PRODUCT 版本不支持",
    partial: "PRODUCT 部分可用",
    available: "PRODUCT 当前入口可用",
  };
  return (
    <div className="product-status">
      <div>
        <strong>{labels[status]}</strong>
        {product?.manifest && (
          <span>
            {" "}
            · {product.manifest.project_id} · {product.manifest.schema}
          </span>
        )}
      </div>
      {product?.manifest?.maintenance === "paused" && (
        <p>维护已暂停，仍可只读浏览；暂停不表示项目结束。</p>
      )}
      {status === "disabled" && (
        <p>旧项目读取范围保持已登记设置。启用后保存配置并手动刷新。</p>
      )}
      {product?.manifestSource && (
        <SourceButton source={product.manifestSource} open={open} />
      )}
      {configure &&
        [
          "disabled",
          "missing",
          "excluded",
          "unavailable",
          "unsupported",
        ].includes(status) && (
          <button className="secondary" onClick={configure}>
            配置 PRODUCT 读取
          </button>
        )}
      {product?.manifest && (
        <details>
          <summary>PRODUCT 范围与诊断</summary>
          <p>
            托管字节覆盖：
            {product.coverage.complete
              ? "选定登记范围已读完"
              : "本次覆盖不完整"}
            ；可用 {product.items.filter((i) => i.usable).length} 条、结构不可用{" "}
            {product.items.filter((i) => !i.usable).length}{" "}
            条。字节覆盖、结构、业务盘点与交付分别解释。
          </p>
          <pre>{product.coverage.paths.join("\n")}</pre>
          {product.coverage.omitted.map((o, i) => (
            <p key={i}>
              {o.path}：{o.reason}
            </p>
          ))}
          {product.coverage.excluded.length > 0 && (
            <p>排除：{product.coverage.excluded.join("、")}</p>
          )}
          <ProductDiagnostics product={product} open={open} />
        </details>
      )}
      {product && !product.manifest && product.diagnostics.length > 0 && (
        <ProductDiagnostics product={product} open={open} />
      )}
    </div>
  );
}
export function ProductDiagnostics({
  product,
  open,
  item,
}: {
  product: ProductView;
  open: OpenSource;
  item?: ProductItem;
}) {
  const diagnostics = product.diagnostics.filter(
    (d) =>
      !item ||
      d.itemId === item.id ||
      (d.path === item.source.path && !d.itemId),
  );
  return (
    <ul className="warning-list">
      {diagnostics.map((d, i) => {
        const original =
          product.items.find((it) => it.source.path === d.path)?.source ||
          product.sources.find((s) => s.target?.path === d.path)?.target ||
          (product.manifestSource?.path === d.path
            ? product.manifestSource
            : null);
        return (
          <li key={i}>
            <span>{d.message}</span>
            {original ? (
              <SourceButton
                source={{ ...original, line: d.line || original.line }}
                open={open}
              />
            ) : (
              <code>
                {d.path}
                {d.line ? `:${d.line}` : ""}
              </code>
            )}
          </li>
        );
      })}
    </ul>
  );
}
export function ProductSources({
  sources,
  open,
}: {
  sources: ProductSourceCheck[];
  open: OpenSource;
}) {
  if (!sources.length) return <p className="muted">未记录来源</p>;
  return (
    <ul className="product-sources">
      {sources.map((s) => (
        <li key={s.key}>
          <div>
            <span className="tiny-label">{s.role}</span>{" "}
            <span>{readLabels[s.readState]}</span>
            {s.ref.kind === "file" && (
              <span>
                {" "}
                · {s.locationState === "located" ? "已定位" : "未定位"} ·{" "}
                {digestLabels[s.digestState]}
              </span>
            )}
          </div>
          {s.ref.kind === "file" ? (
            <code>
              {s.ref.path}
              {s.ref.item_id ? ` · [${s.ref.item_id}]` : ""}
              {s.ref.section ? ` / ${s.ref.section}` : ""}
              {s.ref.lines ? `:${s.ref.lines.start}–${s.ref.lines.end}` : ""}
            </code>
          ) : s.ref.kind === "text" ? (
            <p>
              {s.ref.label}：{s.ref.text}
            </p>
          ) : /^(https?:|mailto:)/i.test(s.ref.uri) ? (
            <a href={s.ref.uri} target="_blank" rel="noreferrer noopener">
              {s.ref.uri}
            </a>
          ) : (
            <code>{s.ref.uri}</code>
          )}
          {s.ref.kind !== "text" && s.ref.note && <p>{s.ref.note}</p>}
          {s.detail && <p className="muted">{s.detail}</p>}
          {s.target && <SourceButton source={s.target} open={open} />}
          {s.ref.kind === "file" && s.ref.sha256 && (
            <details>
              <summary>文件字节摘要</summary>
              <p>声明 SHA-256：{s.ref.sha256}</p>
              <p>本快照 SHA-256：{s.actualDigest || "未读取"}</p>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
export function BindingList({
  bindings,
  snapshot,
  open,
  openTask,
  openItem,
}: {
  bindings: ProductBinding[];
  snapshot: Snapshot;
  open: OpenSource;
  openTask: (id: string) => void;
  openItem: (key: string) => void;
}) {
  const product = snapshot.product!;
  if (!bindings.length)
    return <p className="muted">未记录该任务关联；不据此判断未实现。</p>;
  return (
    <div className="product-bindings">
      {bindings.map((b) => (
        <div className="binding-card" key={b.key}>
          <div className="product-tags">
            <strong>
              {b.declaration.id} · {roleLabels[b.declaration.role]}
            </strong>
            <span>
              {b.declaration.origin === "declared" ? "明确声明" : "推断关联"}
            </span>
            <span>
              {b.declaration.state === "dismissed" ? "已否定关联" : "有效关联"}
            </span>
          </div>
          <p>{b.declaration.coverage}</p>
          <p>
            <code>task_id: {b.declaration.task.task_id || "未确认"}</code>
            {b.declaration.task.label && ` · ${b.declaration.task.label}`}
          </p>
          <p className="muted">{b.detail}</p>
          {b.declaration.reason && <p>理由：{b.declaration.reason}</p>}
          {b.declaration.task.plan_ref && (
            <p>
              Runtime plan_ref：<code>{b.declaration.task.plan_ref}</code>
            </p>
          )}
          {b.declaration.task.step_id && (
            <p>原任务内步骤：{b.declaration.task.step_id}（属于同一任务）</p>
          )}
          {b.taskIds.map((id) => {
            const task = snapshot.tasks.find((t) => t.id === id);
            return (
              task && (
                <div className="bound-task" key={id}>
                  <button className="text-link" onClick={() => openTask(id)}>
                    {task.number || "未记录显示编号"} · {task.title}
                    <ArrowRight size={13} />
                  </button>
                  {task.statuses.length ? (
                    task.statuses.map((s, i) => (
                      <span key={i}>
                        <Status text={s.text} />
                        <SourceButton source={s.source} open={open} />
                      </span>
                    ))
                  ) : (
                    <span>任务状态未记录</span>
                  )}
                </div>
              )
            );
          })}
          {b.planItems.map((p, i) => {
            const work = product.workItems.find((w) => w.key === p.key);
            return (
              <p key={i}>
                计划工作项：
                {work ? (
                  <button
                    className="text-link"
                    onClick={() => openItem(work.planKey)}
                  >
                    {p.ref.plan_id}/{p.ref.work_item_id} ·{" "}
                    {work.declaration.title}
                  </button>
                ) : (
                  <span>
                    {p.ref.plan_id}/{p.ref.work_item_id} · {p.resolution}
                  </span>
                )}
              </p>
            );
          })}
          {b.repairs.map((r, i) => (
            <div key={i} className="repair-scope">
              <strong>修复的历史交付范围</strong>
              <p>{r.coverage}</p>
              <code>task_id: {r.task.task_id || "未确认"}</code>
              <p className="muted">{r.detail}</p>
              {r.taskIds.map((id) => (
                <button
                  key={id}
                  className="text-link"
                  onClick={() => openTask(id)}
                >
                  查看历史任务{" "}
                  {snapshot.tasks.find((t) => t.id === id)?.title || id}
                </button>
              ))}
              <p className="muted">
                该关联不确认缺陷引入者，不重开原任务；修复任务关闭不生成新通过报告。
              </p>
            </div>
          ))}
          <ProductSources
            sources={product.sources.filter(
              (s) =>
                s.ownerKey === b.ownerKey &&
                s.pointer.startsWith(
                  `/task_bindings/${product.bindings.filter((other) => other.ownerKey === b.ownerKey).indexOf(b)}/`,
                ),
            )}
            open={open}
          />
          <SourceButton source={b.source} open={open} />
        </div>
      ))}
    </div>
  );
}
export function ProductRelations({
  snapshot,
  focus,
  open,
  openItem,
  showAll = false,
  highlight = [],
}: {
  snapshot: Snapshot;
  focus: string;
  open: OpenSource;
  openItem: (key: string) => void;
  showAll?: boolean;
  highlight?: string[];
}) {
  const [dismissed, setDismissed] = useState(showAll);
  const p = snapshot.product!;
  const adjacent = p.relations.filter(
    (r) => r.ownerKey === focus || r.targetKey === focus,
  );
  const count = adjacent.filter(
    (r) => r.declaration.state === "dismissed",
  ).length;
  return (
    <>
      {count > 0 && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={dismissed}
            onChange={(e) => setDismissed(e.target.checked)}
          />
          查看已否定关联（{count}）
        </label>
      )}
      {!adjacent.length && <p className="muted">未记录该关联</p>}
      <ul className="relation-list">
        {adjacent
          .filter((r) => dismissed || r.declaration.state !== "dismissed")
          .map((r) => {
            const owner = p.items.find((i) => i.key === r.ownerKey)!;
            const target = p.items.find((i) => i.key === r.targetKey);
            return (
              <li
                key={r.key}
                className={highlight.includes(r.key) ? "highlight" : ""}
              >
                <div className="product-tags">
                  <button
                    className="text-link"
                    onClick={() => openItem(owner.key)}
                  >
                    {owner.title}
                  </button>
                  <span>
                    {relationLabels[r.declaration.relation] ||
                      r.declaration.relation}
                  </span>
                  {target ? (
                    <button
                      className="text-link"
                      onClick={() => openItem(target.key)}
                    >
                      {target.title}
                    </button>
                  ) : (
                    <span>
                      {r.declaration.target} · {r.resolution}
                    </span>
                  )}
                </div>
                <p>
                  {r.declaration.origin === "declared"
                    ? "明确声明"
                    : "推断关联"}{" "}
                  ·{" "}
                  {r.declaration.state === "dismissed"
                    ? "已否定关联"
                    : "有效关联"}{" "}
                  ·{" "}
                  {r.resolution === "resolved"
                    ? "目标已定位"
                    : "目标未可靠定位"}
                </p>
                {r.declaration.reason && <p>理由：{r.declaration.reason}</p>}
                <SourceButton source={r.source} open={open} />
                <ProductSources
                  sources={p.sources.filter(
                    (s) =>
                      s.ownerKey === owner.key &&
                      s.pointer.startsWith(
                        `/links/${p.relations.filter((other) => other.ownerKey === owner.key).indexOf(r)}/`,
                      ),
                  )}
                  open={open}
                />
              </li>
            );
          })}
      </ul>
    </>
  );
}
function AssessmentPanel({
  item,
  snapshot,
  open,
  openItem,
}: {
  item: ProductItem;
  snapshot: Snapshot;
  open: OpenSource;
  openItem: (key: string) => void;
}) {
  const p = snapshot.product!;
  const selected = p.assessments.find((a) => a.requirementKey === item.key);
  if (!selected || selected.selection !== "resolved")
    return (
      <section className="assessment-panel">
        <h3>已报告交付范围</h3>
        <p>
          交付未知 ·{" "}
          {selected?.selection === "target-mismatch"
            ? "所选报告属于其他需求"
            : selected?.selectedId
              ? `所选报告 ${selected.selectedId} 不可可靠使用（${selected.selection}）`
              : "未明确选择 assessment"}
          。不自动选择最新报告。
        </p>
      </section>
    );
  const report = p.items.find((i) => i.key === selected.assessmentKey)!;
  const m = report.metadata!;
  return (
    <section className="assessment-panel">
      <h3>已报告交付范围</h3>
      <button className="text-link" onClick={() => openItem(report.key)}>
        {report.id} · {report.title}
        <ArrowRight size={14} />
      </button>
      <p>
        {implementationLabels[m.implementation!]} ·{" "}
        {verificationLabels[m.verification!]}
      </p>
      <p>
        对象：{m.subject?.kind} · {m.subject?.value || "版本未知"}
        ；报告核对时间：{m.checked_at}
      </p>
      <p>
        需求定义对齐：
        {
          { same: "摘要相同", changed: "定义已变化", unknown: "未知" }[
            selected.definitionAlignment
          ]
        }
        ；历史需求原件：
        {
          {
            available: "已取得可解析来源",
            unavailable: "不可核验",
            unknown: "可核验性未知",
          }[selected.historicalState]
        }
        。
      </p>
      <p className="muted">
        历史定义版本核验：
        {
          {
            same: "与报告摘要一致",
            changed: "与报告摘要不同",
            unknown: "未知",
          }[selected.historicalDefinitionAlignment]
        }
        。摘要对齐和原文字节相同均不证明当前代码仍适用。报告仅覆盖下列原范围。
      </p>
      <div className="markdown">
        <SnapshotMarkdown
          raw={report.body}
          snapshot={snapshot}
          documentId={report.source.documentId}
          startLine={report.source.line}
          open={open}
        />
      </div>
      {(m.pending_sources || []).length > 0 && (
        <div className="banner">
          <strong>新材料待对账（{m.pending_sources!.length}）</strong>
          <span>旧范围通过报告继续保留，当前完整交付仍未知。</span>
        </div>
      )}
      <ProductSources
        sources={p.sources.filter((s) => s.ownerKey === report.key)}
        open={open}
      />
      <details>
        <summary>需求定义摘要（与文件 SHA-256、Git SHA 分开）</summary>
        <p>报告声明：{m.target_definition_sha256 || "未记录"}</p>
        <p>当前定义：{selected.currentDefinitionSha256}</p>
        <p>
          历史原件定义：
          {selected.historicalDefinitionSha256 || "未取得可计算的定义"}
        </p>
      </details>
      <SourceButton source={report.source} open={open} />
    </section>
  );
}
export function ProductItemDetail({
  item,
  snapshot,
  open,
  openTask,
  openItem,
  relations,
}: {
  item: ProductItem;
  snapshot: Snapshot;
  open: OpenSource;
  openTask: (id: string) => void;
  openItem: (key: string) => void;
  relations: (key: string) => void;
}) {
  const p = snapshot.product!;
  const m = item.metadata;
  return (
    <article className="product-detail">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">
            {item.type ? productLabels[item.type] : "不可用条目"} · {item.id}
          </span>
          <h2>{item.title}</h2>
          <div className="product-tags">
            {m?.scope && <span>{scopeLabels[m.scope]}</span>}
            {m?.intent_state && <span>{intentLabels[m.intent_state]}</span>}
            {!item.usable && (
              <span className="status amber">结构不可用，保留原文</span>
            )}
          </div>
        </div>
        <button className="secondary" onClick={() => relations(item.key)}>
          <Network size={16} />
          关联
        </button>
      </div>
      <SourceButton source={item.source} open={open} />
      <button className="text-link" onClick={() => open(itemSource(item, ""))}>
        查看元数据来源 · 第 {item.metadataLine} 行
      </button>
      <div className="markdown product-body">
        <SnapshotMarkdown
          raw={item.body}
          snapshot={snapshot}
          documentId={item.source.documentId}
          startLine={item.source.line}
          open={open}
        />
      </div>
      {m?.inventory && (
        <section>
          <h3>业务盘点</h3>
          <p>
            {m.inventory.state === "reconciled" ? "所列来源已对账" : "部分盘点"}{" "}
            · 已核对 {m.inventory.checked_sources.length} 项、未核对{" "}
            {m.inventory.unreviewed_sources.length} 项；不代表范围外没有需求。
          </p>
          {m.inventory.note && <p>{m.inventory.note}</p>}
        </section>
      )}
      {item.type === "requirement" && item.usable && (
        <AssessmentPanel
          item={item}
          snapshot={snapshot}
          open={open}
          openItem={openItem}
        />
      )}
      {m && ["goal", "requirement"].includes(item.type!) && (
        <section>
          <h3>范围化任务关联</h3>
          <BindingList
            bindings={p.bindings.filter((b) => b.ownerKey === item.key)}
            snapshot={snapshot}
            open={open}
            openTask={openTask}
            openItem={openItem}
          />
        </section>
      )}
      {m?.deltas && (
        <section>
          <h3>变化范围与依据</h3>
          <p>
            {m.recorded_at} · {m.basis?.kind} · {m.basis?.text}
          </p>
          {m.deltas.map((d, i) => (
            <div key={i}>
              <p>
                {d.target}：{d.before ?? "此前不存在或旧意不可得"} →{" "}
                {d.after ?? "已删除或新意不可得"}
              </p>
              {d.note && <p>{d.note}</p>}
            </div>
          ))}
          <p className="muted">记录变化不证明所有正文已同步。</p>
        </section>
      )}
      {item.type === "assessment" && m && (
        <section>
          <h3>范围化报告声明</h3>
          <p>
            目标：{m.target} · 对象：{m.subject?.kind} /{" "}
            {m.subject?.value || "未知"} · {m.checked_at}
          </p>
          <p>
            {implementationLabels[m.implementation!]} ·{" "}
            {verificationLabels[m.verification!]}
          </p>
          <p>
            定义摘要：{m.target_definition_sha256 || "未知"}；待核对材料：
            {m.pending_sources?.length || 0}
          </p>
          <p className="muted">
            只有 requirement.assessment_id
            明确选中的报告进入需求交付面板；不按时间自动采用。
          </p>
        </section>
      )}
      {item.type === "discussion" && m && (
        <section>
          <h3>讨论资料</h3>
          <p>
            {m.submitted_at} · {m.origin?.channel} ·{" "}
            {m.origin?.locator || "来源位置未记录"} ·{" "}
            {m.record_state === "archived" ? "已归档" : "活跃资料"}
          </p>
          <p className="muted">讨论相关性不表示观点已采纳。</p>
        </section>
      )}
      {m && (
        <section>
          <h3>明确关系与依据</h3>
          <ProductRelations
            snapshot={snapshot}
            focus={item.key}
            open={open}
            openItem={openItem}
          />
        </section>
      )}
      <section>
        <h3>来源内容核对</h3>
        <ProductSources
          sources={p.sources.filter((s) => s.ownerKey === item.key)}
          open={open}
        />
      </section>
      <details>
        <summary>完整元数据</summary>
        <pre>{JSON.stringify(item.rawMetadata, null, 2)}</pre>
      </details>
      <details open={!item.usable}>
        <summary>条目诊断</summary>
        <ProductDiagnostics product={p} item={item} open={open} />
      </details>
    </article>
  );
}
interface ProductPageProps {
  snapshot: Snapshot;
  selected?: string;
  select: (key: string) => void;
  open: OpenSource;
  openTask: (id: string) => void;
  openItem: (key: string) => void;
  relations: (key: string) => void;
  configure: () => void;
}
export function RequirementsPage({
  snapshot,
  selected,
  select,
  open,
  openTask,
  openItem,
  relations,
  configure,
}: ProductPageProps) {
  const [type, setType] = useState("requirement");
  const [scope, setScope] = useState("all");
  const [query, setQuery] = useState("");
  const p = snapshot.product;
  useEffect(() => {
    if (selected) {
      setType("all");
      setScope("all");
      setQuery("");
    }
  }, [selected]);
  const filtered = (p?.items || []).filter(
    (i) =>
      (type === "all" || i.type === type) &&
      (scope === "all" || i.metadata?.scope === scope) &&
      `${i.id} ${i.title} ${i.source.path}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const item = selected
    ? p?.items.find((i) => i.key === selected)
    : filtered[0];
  return (
    <div className="browser-page product-page">
      <aside className="browser-list">
        <div className="list-header">
          <h2>需求与产品条目</h2>
          <p className="muted">
            本次全范围需求{" "}
            {(p?.items || []).filter((i) => i.type === "requirement").length} 条
            · 当前筛选 {filtered.length} 条
          </p>
          <div className="search">
            <Search size={15} />
            <input
              aria-label="搜索产品条目"
              value={query}
              placeholder="ID、标题或路径"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label>
            类型
            <select
              aria-label="产品条目类型"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="all">全部类型</option>
              {productTypes.map((t) => (
                <option value={t} key={t}>
                  {productLabels[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            范围
            <select
              aria-label="需求范围"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">四种范围全部</option>
              {Object.entries(scopeLabels).map(([s, label]) => (
                <option value={s} key={s}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="list-items">
          {filtered.map((i) => (
            <button
              key={i.key}
              className={`document-item ${item?.key === i.key ? "selected" : ""}`}
              onClick={() => select(i.key)}
            >
              <small>
                {i.id} · {i.type && productLabels[i.type]}
              </small>
              <strong>{i.title}</strong>
              <small>
                {i.metadata?.scope
                  ? scopeLabels[i.metadata.scope]
                  : i.metadata?.intent_state
                    ? intentLabels[i.metadata.intent_state]
                    : !i.usable
                      ? "结构不可用"
                      : ""}
              </small>
            </button>
          ))}
          {!filtered.length && <p className="list-empty">当前筛选没有条目</p>}
        </div>
      </aside>
      <div className="browser-detail">
        <ProductStatus product={p} open={open} configure={configure} />
        {p?.items.some(
          (i) => i.usable && ["goal", "module"].includes(i.type!),
        ) && (
          <details className="product-organization">
            <summary>目标与模块组织（允许多重归属）</summary>
            {p.items
              .filter((i) => i.usable && ["goal", "module"].includes(i.type!))
              .map((i) => (
                <div key={i.key}>
                  <button className="text-link" onClick={() => openItem(i.key)}>
                    {productLabels[i.type!]} · {i.id} · {i.title}
                  </button>
                  <p>
                    {p.relations
                      .filter(
                        (r) =>
                          (r.ownerKey === i.key || r.targetKey === i.key) &&
                          r.declaration.state === "active",
                      )
                      .map(
                        (r) =>
                          `${p.items.find((owner) => owner.key === r.ownerKey)?.id} ${relationLabels[r.declaration.relation] || r.declaration.relation} ${r.declaration.target}`,
                      )
                      .join("；") || "未记录该关联"}
                  </p>
                </div>
              ))}
          </details>
        )}
        {item ? (
          <ProductItemDetail
            item={item}
            snapshot={snapshot}
            open={open}
            openTask={openTask}
            openItem={openItem}
            relations={relations}
          />
        ) : (
          <Empty
            title={selected ? "所选条目已退出本次范围" : "暂无可浏览条目"}
            detail={
              selected
                ? "刷新后该身份不可用；请从本次列表重新选择。"
                : "入口状态与诊断见上方；有效空范围不表示业务或交付完成。"
            }
          />
        )}
      </div>
    </div>
  );
}
export function PlanningPage({
  snapshot,
  selected,
  select,
  open,
  openTask,
  openItem,
  relations,
  configure,
}: ProductPageProps) {
  const p = snapshot.product;
  const plans = (p?.items || []).filter((i) => i.usable && i.type === "plan");
  const plan = selected
    ? plans.find((i) => i.key === selected)
    : plans.length === 1
      ? plans[0]
      : null;
  return (
    <div className="planning-page">
      <div className="page-title">
        <h2>总体规划</h2>
        <select
          aria-label="选择产品计划"
          value={plan?.key || ""}
          onChange={(e) => select(e.target.value)}
        >
          <option value="">
            {plans.length ? "明确选择一个计划" : "未记录产品计划"}
          </option>
          {plans.map((i) => (
            <option key={i.key} value={i.key}>
              {i.id} · {i.title} · {intentLabels[i.metadata!.intent_state!]}
            </option>
          ))}
        </select>
      </div>
      <ProductStatus product={p} open={open} configure={configure} />
      {selected && !plan && (
        <div className="banner">所选计划已退出本次范围，请重新选择。</div>
      )}
      {plan && p ? (
        <>
          <p className="muted">
            只展示 {plan.id} 的明确安排，不宣称覆盖全项目。stage
            是分组；工作项顺序不证明串行或并行。
          </p>
          <section>
            <h3>计划覆盖</h3>
            {plan.metadata!.targets!.map((t, i) => (
              <p key={i}>
                {t.target}：{t.coverage}
              </p>
            ))}
          </section>
          <div className="work-items">
            {p.workItems
              .filter((w) => w.planKey === plan.key)
              .map((w, i, list) => (
                <section className="work-card" key={w.key}>
                  {(i === 0 ||
                    list[i - 1].declaration.stage !== w.declaration.stage) && (
                    <h3 className="work-stage">
                      {w.declaration.stage || "未记录阶段"}
                    </h3>
                  )}
                  <h4>
                    {i + 1}. {w.declaration.id} · {w.declaration.title}
                  </h4>
                  <div className="product-tags">
                    <span>
                      {
                        {
                          included: "纳入安排",
                          deferred: "延期",
                          withdrawn: "撤回",
                        }[w.declaration.state]
                      }
                    </span>
                    <span>
                      {
                        {
                          initial: "原定",
                          added: "新增",
                          unknown: "原定情况未知",
                        }[w.declaration.origin]
                      }
                    </span>
                  </div>
                  <p>预期结果：{w.declaration.outcome}</p>
                  <p>覆盖与边界：{w.declaration.scope}</p>
                  {w.declaration.targets.map((t, j) => {
                    const target = p.items.find(
                      (item) => item.usable && item.id === t.target,
                    );
                    return (
                      <p key={j}>
                        {target ? (
                          <button
                            className="text-link"
                            onClick={() => openItem(target.key)}
                          >
                            {target.id} · {target.title}
                          </button>
                        ) : (
                          t.target
                        )}
                        ：{t.coverage}
                      </p>
                    );
                  })}
                  {(w.declaration.depends_on || []).map((d, j) => (
                    <p key={j}>
                      明确{d.kind === "order" ? "顺序安排" : "工程前提"}：
                      {d.item_id} · {d.reason}
                    </p>
                  ))}
                  {!w.declaration.depends_on?.length && (
                    <p className="muted">
                      未记录显式依赖；不据此判断可以并行。
                    </p>
                  )}
                  {w.declaration.replaces?.length && (
                    <p>替代工作项：{w.declaration.replaces.join("、")}</p>
                  )}
                  <SourceButton source={w.source} open={open} />
                  <ProductSources
                    sources={p.sources.filter(
                      (s) =>
                        s.ownerKey === plan.key &&
                        s.pointer.startsWith(`/work_items/${i}/`),
                    )}
                    open={open}
                  />
                  <h4>关联任务与文档状态</h4>
                  {w.bindingKeys.length ? (
                    <BindingList
                      bindings={p.bindings.filter((b) =>
                        w.bindingKeys.includes(b.key),
                      )}
                      snapshot={snapshot}
                      open={open}
                      openTask={openTask}
                      openItem={openItem}
                    />
                  ) : (
                    <p className="muted">
                      未记录任务绑定；工作项继续保留，不创建任务身份。
                    </p>
                  )}
                  <p className="muted">
                    交付是否覆盖本工作项仍须打开对应需求的范围化报告核对，任务关闭不代表工作项完成。
                  </p>
                </section>
              ))}
          </div>
          <ProductItemDetail
            item={plan}
            snapshot={snapshot}
            open={open}
            openTask={openTask}
            openItem={openItem}
            relations={relations}
          />
        </>
      ) : (
        <>
          <p className="muted">
            {plans.length > 1
              ? "多个计划保持独立范围和采用状态，请先明确选择。"
              : "未记录产品计划；下列已知业务范围与任务关联仍可浏览。project 正文中的选取信息保留原文，不生成待办顺序。"}
          </p>
          <div className="known-scope">
            {(p?.items || [])
              .filter(
                (i) =>
                  i.usable &&
                  ["project", "goal", "module", "requirement"].includes(
                    i.type!,
                  ),
              )
              .map((i) => (
                <div key={i.key}>
                  <button className="text-link" onClick={() => openItem(i.key)}>
                    {i.id} · {i.title}
                  </button>
                  <span>
                    {i.metadata?.scope && scopeLabels[i.metadata.scope]}
                  </span>
                  <p>
                    {p?.bindings.filter((b) => b.ownerKey === i.key).length ||
                      0}{" "}
                    条明确范围绑定
                  </p>
                </div>
              ))}
          </div>
          {plans.length === 0 &&
            p?.items
              .filter((i) => i.usable && i.type === "project")
              .map((i) => (
                <section className="product-detail" key={i.key}>
                  <h3>项目原文中的选取与未决信息</h3>
                  <SourceButton source={i.source} open={open} />
                  <div className="markdown">
                    <SnapshotMarkdown
                      raw={i.body}
                      snapshot={snapshot}
                      documentId={i.source.documentId}
                      startLine={i.source.line}
                      open={open}
                    />
                  </div>
                </section>
              ))}
        </>
      )}
    </div>
  );
}
export function ProductOverview({
  snapshot,
  open,
  openItem,
  configure,
}: {
  snapshot: Snapshot;
  open: OpenSource;
  openItem: (key: string) => void;
  configure: () => void;
}) {
  const p = snapshot.product;
  return (
    <section className="product-overview">
      <h3>标准产品范围、安排与报告</h3>
      <ProductStatus product={p} open={open} configure={configure} />
      {p?.manifest && (
        <>
          <div className="overview-columns">
            <section>
              <h4>业务范围与未来安排</h4>
              {p.items
                .filter(
                  (i) =>
                    i.usable && ["project", "goal", "plan"].includes(i.type!),
                )
                .map((i) => (
                  <p key={i.key}>
                    <button
                      className="text-link"
                      onClick={() => openItem(i.key)}
                    >
                      {i.title}
                    </button>
                    {i.metadata?.intent_state &&
                      ` · ${intentLabels[i.metadata.intent_state]}`}
                  </p>
                ))}
              {Object.entries(scopeLabels).map(([scope, label]) => (
                <p key={scope}>
                  {label}需求：
                  {
                    p.items.filter(
                      (i) =>
                        i.usable &&
                        i.type === "requirement" &&
                        i.metadata?.scope === scope,
                    ).length
                  }
                </p>
              ))}
            </section>
            <section>
              <h4>已选择的范围化报告</h4>
              {p.assessments.map((a) => {
                const req = p.items.find((i) => i.key === a.requirementKey)!;
                const report =
                  a.selection === "resolved" &&
                  p.items.find((i) => i.key === a.assessmentKey);
                return (
                  <div key={a.requirementKey}>
                    <button
                      className="text-link"
                      onClick={() => openItem(req.key)}
                    >
                      {req.title}
                    </button>
                    <p>
                      {report
                        ? `${implementationLabels[report.metadata!.implementation!]} · ${verificationLabels[report.metadata!.verification!]}`
                        : "交付未知：报告未明确选择或无效"}
                    </p>
                    {report && (
                      <p>
                        对象 {report.metadata!.subject?.kind} /{" "}
                        {report.metadata!.subject?.value || "未知"} · 定义
                        {a.definitionAlignment === "same"
                          ? "摘要相同"
                          : a.definitionAlignment === "changed"
                            ? "已变化"
                            : "对齐未知"}{" "}
                        · {report.metadata!.pending_sources?.length || 0}{" "}
                        项待对账
                      </p>
                    )}
                  </div>
                );
              })}
            </section>
          </div>
          <p className="muted">
            当前工作与任务状态见下方文档声明。业务范围、计划安排、当前工作和交付报告不合成项目完成率。
          </p>
        </>
      )}
    </section>
  );
}
export function TaskProducts({
  snapshot,
  taskId,
  open,
  openTask,
  openItem,
}: {
  snapshot: Snapshot;
  taskId: string;
  open: OpenSource;
  openTask: (id: string) => void;
  openItem: (key: string) => void;
}) {
  const p = snapshot.product;
  if (!p?.manifest) return null;
  const bindings = p.bindings.filter((b) => b.taskIds.includes(taskId));
  const repairs = p.bindings.filter((b) =>
    b.repairs.some((r) => r.taskIds.includes(taskId)),
  );
  return (
    <section>
      <h3>关联目标、需求与修复范围</h3>
      {bindings.map((b) => {
        const owner = p.items.find((i) => i.key === b.ownerKey)!;
        return (
          <div key={b.key}>
            <button className="text-link" onClick={() => openItem(owner.key)}>
              {owner.id} · {owner.title}
            </button>
            <BindingList
              bindings={[b]}
              snapshot={snapshot}
              open={open}
              openTask={openTask}
              openItem={openItem}
            />
          </div>
        );
      })}
      {!bindings.length && <p className="muted">未记录该业务关联</p>}
      {repairs.map((b) => (
        <div key={b.key}>
          <p>
            后加修复：{b.declaration.id} · {b.declaration.coverage}
          </p>
          <BindingList
            bindings={[b]}
            snapshot={snapshot}
            open={open}
            openTask={openTask}
            openItem={openItem}
          />
        </div>
      ))}
    </section>
  );
}
