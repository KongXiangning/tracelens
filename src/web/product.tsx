import { CurrentWorkPanel } from "./overview-focus";
import {
  contributionLabel,
  contributionDiagnostics,
} from "../shared/product-contribution";
import { useEffect, useRef, useState } from "react";
import {
  buildOverviewData,
  isOverviewSnapshot,
  type OverviewSnapshot,
} from "../shared/overview-data";
import { LazyDetails, PagedItems } from "./lazy-details";
import { OverviewDetails } from "./overview-details";
import { ArrowRight, FileText, Network, Search, Settings2 } from "lucide-react";
import type { NavigationReport, Snapshot, Task } from "../shared/types";
import type {
  ProductAssessmentView,
  ProductBindingView,
  ProductItem,
  ProductSnapshot,
  ProductSource,
  ProductSourceCheck,
  ProductTaskMatch,
  ProductWorkItem,
} from "../shared/product-types";
import { Empty, SourceButton, Status, type OpenSource } from "./components";
import { SnapshotMarkdown } from "./reader";
import { OrganizationPromptButton } from "./navigation-audit";
import {
  productDiagnosticArea,
  productStructureIssue,
} from "../shared/product-health";
import { scopeGroups } from "../shared/product-scope";
import { OverviewDashboard } from "./overview-dashboard";
import { ProjectRecords } from "./pages";
import { lifecycleLabels } from "./runtime";
import { requirementBindings } from "../shared/product-hierarchy";

import {
  productLabels,
  productStatusLabels,
  productStatusDetails,
  productTypeLabels,
} from "./product-labels";

const label = (value?: string | null) =>
  value ? productLabels[value] || value : "未记录";
const intentLabel = (value?: string | null) =>
  value === "retired" ? "已退出" : label(value);
const list = <T,>(value: T[] | undefined | null): T[] =>
  Array.isArray(value) ? value : [];
function reportLabel(
  value: string | undefined,
  field: "implementation" | "verification",
) {
  if (value && value !== "unknown") return label(value);
  return field === "implementation" ? "实施情况待核对" : "验证结果待核对";
}
const reportSubject = (item: ProductItem) => {
  const subject = item.metadata.subject;
  if (!subject || subject.kind === "unknown")
    return "尚未记录报告对应的版本或构建";
  return `${({ commit: "提交", release: "发布版本", "working-copy": "工作副本" } as Record<string, string>)[subject.kind] || subject.kind}：${subject.value || "未记录"}`;
};
export type OverviewContext = Omit<ProductContext, "snapshot"> & {
  snapshot: Snapshot | OverviewSnapshot;
};

export type OpenProduct = (key: string, workItemId?: string) => void;
export type ProductContext = {
  snapshot: Snapshot;
  open: OpenSource;
  openProduct: OpenProduct;
  openTask: (
    id?: string,
    requirementKey?: string,
    reviewAssociations?: boolean,
  ) => void;
  relations: (key: string) => void;
};

function Tag({
  value,
  intent = false,
}: {
  value?: string | null;
  intent?: boolean;
}) {
  return (
    <span
      className={`status ${value === "dismissed" || value === "inferred" ? "amber" : "neutral"}`}
    >
      {intent ? intentLabel(value) : label(value)}
    </span>
  );
}
function ItemLink({
  id,
  product,
  openProduct,
}: {
  id: string;
  product: ProductSnapshot;
  openProduct: OpenProduct;
}) {
  const matches = product.items.filter((item) => item.id === id && item.usable);
  return matches.length === 1 ? (
    <button className="text-link" onClick={() => openProduct(matches[0].key)}>
      {id} · {matches[0].title}
      <ArrowRight size={13} />
    </button>
  ) : (
    <span>
      {id}{" "}
      <span className="muted">
        {matches.length > 1 ? "（身份有歧义）" : "（未定位）"}
      </span>
    </span>
  );
}

export function ProductStatusPanel({
  product,
  navigation,
  open,
  configure,
}: {
  product?: ProductSnapshot;
  navigation?: NavigationReport;
  open: OpenSource;
  configure?: () => void;
}) {
  const status = product?.status || "disabled";
  const coverageRead = Boolean(
    product?.manifest && ["ready", "partial", "empty"].includes(status),
  );
  const coverageLabel =
    status === "disabled"
      ? "未启用"
      : !coverageRead
        ? "未核对"
        : product?.coverage.complete
          ? "完整"
          : "存在未读范围";
  return (
    <section
      className={`product-status product-state-${status}`}
      aria-label="PRODUCT 读取状态"
    >
      <div className="section-heading">
        <h3>{productStatusLabels[status]}</h3>
        {configure && (
          <button className="text-link" onClick={configure}>
            <Settings2 size={14} />
            查看项目设置
          </button>
        )}
      </div>
      <p className="muted">
        {productStatusDetails[status]}
        {coverageRead &&
          ` 已读取 ${product?.coverage.paths.length} 份托管文档，${product?.items.filter((item) => item.usable).length} 个可用条目。`}
      </p>
      <p className="muted">本次托管范围字节读取：{coverageLabel}</p>
      {product && status !== "ready" && (
        <OrganizationPromptButton
          report={
            navigation || {
              enabled: true,
              profileUsed: false,
              entries: [],
              incomplete: false,
              gaps: [],
            }
          }
          product={product}
          projectName={product.manifest?.project_id || "当前项目"}
          root={product.workingCopy}
        />
      )}
      {product && (
        <>
          <div className="product-inline">
            <code>{product.manifestPath}</code>
            {product.manifestSource && (
              <SourceButton source={product.manifestSource} open={open} />
            )}
          </div>
          {product.manifest?.maintenance === "paused" && (
            <p className="banner">
              维护已暂停，当前材料仍可阅读；这不表示项目结束。
            </p>
          )}
          <LazyDetails
            className="product-coverage"
            summary={
              <>
                读取范围与结构诊断 ·{" "}
                {product.diagnostics.filter(productStructureIssue).length} 项
              </>
            }
          >
            {() => (
              <>
                {product.manifest && (
                  <dl className="product-fields">
                    <dt>标准项目身份</dt>
                    <dd>{product.manifest.project_id}</dd>
                    <dt>工作副本</dt>
                    <dd>
                      <code>{product.workingCopy}</code>
                    </dd>
                    <dt>格式版本</dt>
                    <dd>{product.manifest.schema}</dd>
                    <dt>当前定义范围</dt>
                    <dd>
                      <pre>{product.manifest.managed_paths.join("\n")}</pre>
                    </dd>
                    <dt>来源许可范围</dt>
                    <dd>
                      <pre>
                        {product.manifest.source_paths.join("\n") || "无"}
                      </pre>
                      <small>仅按直接明确引用读取，不递归遍历来源目录。</small>
                    </dd>
                    <dt>capture_paths</dt>
                    <dd>
                      <pre>
                        {product.manifest.capture_paths?.join("\n") || "未记录"}
                      </pre>
                      <small>不是读写或遍历授权。</small>
                    </dd>
                  </dl>
                )}
                <p>
                  本次托管范围字节读取：
                  {coverageLabel} · 可用条目{" "}
                  {product.items.filter((item) => item.usable).length} ·
                  不可用条目{" "}
                  {product.items.filter((item) => !item.usable).length}
                </p>
                <p className="muted">
                  字节完整、结构可用、业务盘点和交付结论互不替代。
                </p>
                <PagedItems
                  items={[
                    ...product.coverage.paths.map((path) => ({
                      path,
                      label: "已读取",
                      reason: "",
                    })),
                    ...product.coverage.omitted.map((entry) => ({
                      ...entry,
                      label: "未读取",
                    })),
                    ...product.coverage.excluded.map((entry) => ({
                      ...entry,
                      label: "已排除",
                    })),
                  ]}
                >
                  {(entries) => (
                    <ul className="product-evidence-list">
                      {entries.map((entry, i) => (
                        <li key={i}>
                          <strong>{entry.label}：</strong>
                          <code>{entry.path}</code>
                          {entry.reason && ` · ${entry.reason}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </PagedItems>
                <ProductDiagnostics
                  diagnostics={product.diagnostics.filter(
                    (entry) => productDiagnosticArea(entry) === "structure",
                  )}
                  open={open}
                />
              </>
            )}
          </LazyDetails>
          {product.diagnostics.some(
            (entry) => productDiagnosticArea(entry) === "evidence",
          ) && (
            <LazyDetails
              className="product-coverage"
              summary={
                <>
                  来源依据待处理 ·{" "}
                  {
                    new Set(
                      product.diagnostics
                        .filter(
                          (entry) =>
                            productDiagnosticArea(entry) === "evidence",
                        )
                        .map((entry) => entry.path || entry.code),
                    ).size
                  }{" "}
                  个文件或事项
                </>
              }
            >
              {() => (
                <>
                  <p className="muted">
                    产品正文已读取；以下来源缺失或核对问题影响相关依据，需由
                    vNext 按实际涉及范围处理。
                  </p>
                  <ProductDiagnostics
                    diagnostics={product.diagnostics.filter(
                      (entry) => productDiagnosticArea(entry) === "evidence",
                    )}
                    open={open}
                  />
                </>
              )}
            </LazyDetails>
          )}
          {product.diagnostics.some(
            (entry) => productDiagnosticArea(entry) === "pending",
          ) && (
            <LazyDetails
              className="product-coverage"
              summary={
                <>
                  业务待核对 ·{" "}
                  {
                    product.diagnostics.filter(
                      (entry) => productDiagnosticArea(entry) === "pending",
                    ).length
                  }{" "}
                  项
                </>
              }
            >
              {() => (
                <>
                  <p className="muted">
                    这些是 vNext
                    保留的待核对状态，不表示文档解析失败，也不构成开发阻塞。
                  </p>
                  <ProductDiagnostics
                    diagnostics={product.diagnostics.filter(
                      (entry) => productDiagnosticArea(entry) === "pending",
                    )}
                    open={open}
                  />
                </>
              )}
            </LazyDetails>
          )}
        </>
      )}
    </section>
  );
}
function ProductDiagnostics({
  diagnostics,
  open,
}: {
  diagnostics: ProductSnapshot["diagnostics"];
  open: OpenSource;
}) {
  return diagnostics.length ? (
    <PagedItems items={diagnostics}>
      {(entries) => (
        <ul className="warning-list">
          {entries.map((entry, i) => (
            <li key={i}>
              <span>
                <strong>{entry.code}</strong> · {entry.message}
              </span>
              {entry.source ? (
                <SourceButton source={entry.source} open={open} />
              ) : (
                entry.path && (
                  <code>
                    {entry.path}
                    {entry.line ? `:${entry.line}` : ""}
                  </code>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </PagedItems>
  ) : (
    <p className="muted">本次未报告产品结构诊断。</p>
  );
}

const readLabels: Record<ProductSourceCheck["readState"], string> = {
  read: "已收录快照",
  "not-read": "未读取",
  excluded: "已排除",
  unavailable: "不可用",
  outside: "范围外",
  unsupported: "格式不支持",
  external: "外部 URI，未读取",
  text: "文字依据",
};
const locationLabels: Record<ProductSourceCheck["locationState"], string> = {
  located: "已定位",
  unlocated: "未定位",
  ambiguous: "定位有歧义",
  "not-applicable": "不适用",
};
function sourceRole(role: string): string {
  if (role.startsWith("pending_sources")) return "待对账新材料";
  if (role === "target_basis") return "报告当时的需求依据";
  if (role === "raw_ref") return "讨论原文";
  if (role.startsWith("inventory.checked_sources")) return "盘点已核对来源";
  if (role.startsWith("inventory.unreviewed_sources")) return "盘点未核对来源";
  if (role.includes("repairs")) return "被修复工作或修复范围依据";
  if (role.includes("task.source")) return "任务身份来源";
  if (role.startsWith("task_bindings")) return "范围绑定依据";
  if (role.startsWith("links")) return "关系依据";
  if (role.startsWith("work_items")) return "工作安排依据";
  if (role.startsWith("basis.sources")) return "变更依据";
  if (role.startsWith("sources")) return "条目依据";
  return role;
}
const byteLabels: Record<ProductSourceCheck["byteState"], string> = {
  "same-bytes": "原文字节相同",
  changed: "原文字节已变化",
  unknown: "字节核对未知",
  unavailable: "字节不可核对",
};
function SourceReference({ reference }: { reference: ProductSource }) {
  if (!reference || typeof reference !== "object")
    return <span>来源格式不可用</span>;
  if (reference.kind === "text")
    return (
      <div>
        <strong>{reference.label}</strong>
        <p className="product-text">{reference.text}</p>
      </div>
    );
  if (reference.kind === "uri")
    return (
      <div>
        {/^https?:\/\//i.test(reference.uri) ? (
          <a
            className="text-link"
            href={reference.uri}
            target="_blank"
            rel="noreferrer noopener"
          >
            {reference.uri}
          </a>
        ) : (
          <code>{reference.uri}</code>
        )}
        {reference.note && <p>{reference.note}</p>}
      </div>
    );
  return (
    <div>
      <code>
        {reference.path}
        {reference.item_id ? ` · ${reference.item_id}` : ""}
        {reference.section ? ` · ${reference.section}` : ""}
        {reference.lines
          ? ` · 行 ${reference.lines.start}–${reference.lines.end}`
          : ""}
      </code>
      {reference.sha256 && (
        <p className="muted">
          声明的文件字节 SHA-256：<code>{reference.sha256}</code>
        </p>
      )}
      {reference.note && <p>{reference.note}</p>}
    </div>
  );
}
export function ProductSourceRow({
  check,
  open,
}: {
  check: ProductSourceCheck;
  open: OpenSource;
}) {
  return (
    <li className="product-source">
      <div className="product-inline">
        <span className="relation-method" title={check.role}>
          {sourceRole(check.role)}
        </span>
        <span className="status neutral">{readLabels[check.readState]}</span>
        <span className="status neutral">
          {locationLabels[check.locationState]}
        </span>
        <span
          className={`status ${check.byteState === "changed" ? "amber" : "neutral"}`}
        >
          {byteLabels[check.byteState]}
        </span>
      </div>
      <small className="muted">原始角色：{check.role}</small>
      <SourceReference reference={check.reference} />
      <p className="muted">{check.detail}</p>
      {check.definitionSha256 !== undefined && (
        <p className="muted">
          来源中实际定义摘要：
          <code>{check.definitionSha256 || "未知"}</code> ·
          {check.definitionAlgorithm || "算法未知"}
        </p>
      )}
      {check.source && <SourceButton source={check.source} open={open} />}
      {check.endLine && check.source && (
        <small>
          定位范围：{check.source.line}–{check.endLine} 行
        </small>
      )}
      {check.readState === "not-read" && (
        <p className="muted">
          调整读取范围或预算后手动刷新。点击来源不会临时读取磁盘。
        </p>
      )}
    </li>
  );
}
function ProductEvidence({
  sources,
  product,
  ownerKey,
  open,
}: {
  sources?: ProductSource[];
  product: ProductSnapshot;
  ownerKey: string;
  open: OpenSource;
}) {
  return (
    <ul className="product-evidence-list">
      {list(sources).map((reference, i) => {
        const check = product.sources.find(
          (source) =>
            source.ownerKey === ownerKey &&
            JSON.stringify(source.reference) === JSON.stringify(reference),
        );
        return check ? (
          <ProductSourceRow key={i} check={check} open={open} />
        ) : (
          <li key={i}>
            <SourceReference reference={reference} />
            <p className="muted">来源核对结果未知，未定位到本快照原文。</p>
          </li>
        );
      })}
    </ul>
  );
}
function TaskMatch({
  match,
  snapshot,
  open,
  openTask,
  ownerKey,
}: {
  match: ProductTaskMatch;
  snapshot: Snapshot;
  open: OpenSource;
  openTask: (id: string) => void;
  ownerKey: string;
}) {
  const product = snapshot.product!;
  const tasks = match.taskIds
    .map((id) => snapshot.tasks.find((task) => task.id === id))
    .filter((task): task is Task => Boolean(task));
  return (
    <div className="product-task-match">
      <div className="product-inline">
        <strong>{match.task.label || match.task.task_id || "历史任务"}</strong>
        <span
          className={`status ${match.state === "matched" ? "neutral" : "amber"}`}
        >
          {
            {
              matched: "真实任务身份已匹配",
              "identity-unknown": "身份未确认",
              unresolved: "任务未定位",
              conflict: "任务身份或来源冲突",
            }[match.state]
          }
        </span>
      </div>
      <dl className="product-fields">
        <dt>真实 task_id</dt>
        <dd>
          <code>{match.task.task_id ?? "null（未确认）"}</code>
        </dd>
        {match.task.plan_ref && (
          <>
            <dt>Runtime plan_ref</dt>
            <dd>
              <code>{match.task.plan_ref}</code>
            </dd>
          </>
        )}
        {match.task.step_id && (
          <>
            <dt>任务内 step_id</dt>
            <dd>
              <code>{match.task.step_id}</code> · 原任务内步骤，不是独立任务
            </dd>
          </>
        )}
      </dl>
      <p className="muted">{match.detail}</p>
      {tasks.map((task) => (
        <div className="product-task-observation" key={task.id}>
          <button className="text-link" onClick={() => openTask(task.id)}>
            {task.number || "无显示编号"} · {task.title}
            <ArrowRight size={13} />
          </button>
          <p className="muted">
            {task.runtimeLifecycle ? "Runtime 生命周期：" : "文档声明的状态："}
          </p>
          {task.statuses.length ? (
            task.statuses.map((entry, i) => (
              <div className="product-inline" key={i}>
                <Status text={entry.text} />
                {!task.runtimeLifecycle && (
                  <SourceButton source={entry.source} open={open} />
                )}
              </div>
            ))
          ) : (
            <p className="muted">
              未记录状态{task.current ? "；当前焦点不等于正在执行" : ""}
            </p>
          )}
          {!task.runtimeLifecycle && (
            <SourceButton source={task.source} open={open} />
          )}
        </div>
      ))}
      <ProductEvidence
        sources={[match.task.source]}
        product={product}
        ownerKey={ownerKey}
        open={open}
      />
    </div>
  );
}
export function BindingCard({
  view,
  context,
  showOwner = false,
}: {
  view: ProductBindingView;
  context: ProductContext;
  showOwner?: boolean;
}) {
  const { snapshot, open, openProduct, openTask } = context;
  const product = snapshot.product!;
  const owner = product.items.find((item) => item.key === view.ownerKey);
  const binding = view.binding;
  return (
    <article
      className={`product-binding ${binding.state === "dismissed" ? "dismissed" : ""}`}
      data-binding-id={binding.id}
    >
      <div className="section-heading">
        <h4>关联 {binding.id}</h4>
        <div className="product-inline">
          <span
            className="tag"
            data-contribution={binding.contribution || "unclassified"}
          >
            {contributionLabel(binding)}
          </span>
          <Tag value={binding.role} />
          <Tag value={binding.origin} />
          <Tag value={binding.state} />
        </div>
      </div>
      {contributionDiagnostics(product.bindings)
        .get(view.key)
        ?.map((issue) => (
          <p key={issue} className="requirements-v3-warning">
            {issue}
          </p>
        ))}
      <p className="muted">
        记录的分类不证明当前义务已核验或交付满足；来源可定位也不等于语义正确。
      </p>
      {showOwner && owner && (
        <button
          className="text-link task-requirement-title"
          onClick={() => openProduct(owner.key)}
        >
          {productTypeLabels[owner.type]} · {owner.id} · {owner.title}
          <ArrowRight size={13} />
        </button>
      )}
      <p>
        <strong>覆盖范围：</strong>
        {binding.coverage}
      </p>
      {binding.reason && (
        <p>
          <strong>理由：</strong>
          {binding.reason}
        </p>
      )}
      <TaskMatch
        match={view.match}
        snapshot={snapshot}
        open={open}
        openTask={openTask}
        ownerKey={view.ownerKey}
      />
      <h4>项目计划工作项</h4>
      {view.planItems.length ? (
        <ul className="product-evidence-list">
          {view.planItems.map((ref, i) => {
            const plans = product.items.filter(
              (item) =>
                item.usable && item.type === "plan" && item.id === ref.planId,
            );
            return (
              <li key={i}>
                {ref.state === "resolved" && plans.length === 1 ? (
                  <button
                    className="text-link"
                    onClick={() => openProduct(plans[0].key, ref.workItemId)}
                  >
                    {ref.planId} / {ref.workItemId}
                    <ArrowRight size={13} />
                  </button>
                ) : (
                  <span>
                    {ref.planId} / {ref.workItemId} ·{" "}
                    {ref.state === "ambiguous" ? "身份有歧义" : "未定位"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">未记录计划工作项关联；直接任务关联仍然有效。</p>
      )}
      {view.repairs.length > 0 && (
        <section className="product-repairs">
          <h4>修复的历史工作与范围</h4>
          <p className="muted">
            指向被修复的范围，不认定缺陷引入者，也不自动重开原任务。
          </p>
          {view.repairs.map((repair, i) => (
            <div className="product-repair" key={i}>
              <p>
                <strong>本次修复范围：</strong>
                {repair.coverage}
              </p>
              <TaskMatch
                match={repair.match}
                snapshot={snapshot}
                open={open}
                openTask={openTask}
                ownerKey={view.ownerKey}
              />
              <ProductEvidence
                sources={repair.sources}
                product={product}
                ownerKey={view.ownerKey}
                open={open}
              />
            </div>
          ))}
        </section>
      )}
      <ProductEvidence
        sources={binding.sources}
        product={product}
        ownerKey={view.ownerKey}
        open={open}
      />
      {owner && (
        <SourceButton
          source={{ ...owner.source, line: owner.metadataLine }}
          open={open}
        />
      )}
    </article>
  );
}
export function Body({
  item,
  context,
}: {
  item: ProductItem;
  context: Pick<ProductContext, "snapshot" | "open">;
}) {
  const document = item.body
    ? context.snapshot.documents.find(
        (entry) =>
          entry.id === item.source.documentId &&
          entry.path === item.source.path &&
          entry.digest === item.source.digest &&
          !entry.contentOmitted &&
          Boolean(entry.raw),
      )
    : undefined;
  // YAML is not item Markdown. Mask its envelope without moving the original
  // lines, so metadata strings cannot become definitions or swallow the body.
  const text =
    document?.raw.replace(
      /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)(?:[\s\S]*?(?:\r\n|\n|\r))?---[ \t]*(?=\r\n|\n|\r|$)/,
      (frontmatter) => frontmatter.replace(/[^\r\n]/g, " "),
    ) ?? item.body;
  return (
    <section className="product-body">
      <div className="section-heading">
        <h3>完整业务正文</h3>
        <SourceButton source={item.source} open={context.open} />
      </div>
      <p className="muted">
        原文件第 {item.source.line}–{item.endLine} 行 · {item.source.path}
      </p>
      <div className="markdown">
        <SnapshotMarkdown
          text={text}
          documentId={item.source.documentId}
          path={item.source.path}
          startLine={document ? 1 : item.source.line}
          lineRange={
            document
              ? { start: item.source.line, end: item.endLine }
              : undefined
          }
          snapshot={context.snapshot}
          open={context.open}
        />
      </div>
    </section>
  );
}
function AssessmentFacts({
  item,
  view,
  context,
}: {
  item: ProductItem;
  view?: ProductAssessmentView;
  context: ProductContext;
}) {
  const metadata = item.metadata;
  const pending = list(metadata.pending_sources);
  return (
    <div className="product-assessment">
      <div className="product-inline">
        <span>
          实施：
          <span>{reportLabel(metadata.implementation, "implementation")}</span>
        </span>
        <span>
          验证：
          <span>{reportLabel(metadata.verification, "verification")}</span>
        </span>
      </div>
      <dl className="product-fields">
        <dt>报告需求</dt>
        <dd>{metadata.target || "未记录"}</dd>
        <dt>报告对象</dt>
        <dd>{reportSubject(item)}</dd>
        <dt>对账时间</dt>
        <dd>{metadata.checked_at || "未记录"}</dd>
        <dt>当前需求定义对齐</dt>
        <dd>
          {view
            ? {
                same: "定义摘要相同",
                changed: "定义摘要已变化",
                unknown: "报告尚未记录需求定义版本，待核对",
              }[view.definitionState]
            : "未作为该需求的有效选择核对"}
        </dd>
        <dt>原依据需求定义对齐</dt>
        <dd>
          {view?.basisDefinitionState
            ? {
                same: "原依据的实际定义与报告摘要相同",
                changed: "原依据的实际定义与报告摘要不匹配",
                unknown: "原依据定义核对未知",
              }[view.basisDefinitionState]
            : "原依据定义核对未知"}
        </dd>
        <dt>历史原件完整性</dt>
        <dd>
          {view
            ? {
                verified: "历史原件字节已核对",
                changed: "历史原件字节已变化",
                unknown: "历史可核验性未知",
              }[view.historicalState]
            : "未知"}
        </dd>
        <dt>报告的需求定义摘要</dt>
        <dd>
          <code>{metadata.target_definition_sha256 || "null（未知）"}</code>
          <small>
            vnext-requirement-definition/v1，与文件字节 SHA-256、Git SHA 分开。
          </small>
        </dd>
      </dl>
      {view && <p className="muted">{view.detail}</p>}
      <p className="banner">
        当前实现适用性仍需核对。摘要相同、任务关闭或修复结束都不构成新的通过报告。
      </p>
      {pending.length > 0 && (
        <div className="product-pending" role="note">
          <h4>待对账新材料 · {pending.length} 项</h4>
          <p>以下新材料尚未纳入原报告；原有报告结论与待对账信息同时保留。</p>
          <ProductEvidence
            sources={pending}
            product={context.snapshot.product!}
            ownerKey={item.key}
            open={context.open}
          />
        </div>
      )}
    </div>
  );
}
function RequirementAssessment({
  item,
  context,
}: {
  item: ProductItem;
  context: ProductContext;
}) {
  const product = context.snapshot.product!;
  const view = product.assessments.find(
    (entry) => entry.requirementKey === item.key,
  );
  const report = view?.assessmentKey
    ? product.items.find(
        (entry) => entry.key === view.assessmentKey && entry.usable,
      )
    : undefined;
  const state = view?.state || "unselected";
  return (
    <section className="product-delivery">
      <h3>已报告交付范围</h3>
      {state !== "selected" || !report ? (
        <div className="banner">
          <div>
            <strong>
              {
                {
                  selected: "交付报告不可用",
                  unselected: "未选择交付摘要",
                  missing: "所选交付摘要无效或未找到",
                  "target-mismatch": "所选报告目标不匹配",
                  ambiguous: "所选报告身份有歧义",
                }[state]
              }
            </strong>
            <p>
              {view?.detail ||
                "仅沿 requirement.assessment_id 选择报告，不按时间选择最新报告。当前交付未知。"}
            </p>
            {item.metadata.assessment_id && (
              <code>assessment_id: {item.metadata.assessment_id}</code>
            )}
          </div>
        </div>
      ) : (
        <>
          <button
            className="text-link"
            onClick={() => context.openProduct(report.key)}
          >
            {report.id} · {report.title}
            <ArrowRight size={13} />
          </button>
          <AssessmentFacts item={report} view={view} context={context} />
          <Body item={report} context={context} />
        </>
      )}
    </section>
  );
}
function ProductRelations({
  item,
  context,
}: {
  item: ProductItem;
  context: ProductContext;
}) {
  const product = context.snapshot.product!;
  const relations = product.relations.filter(
    (entry) => entry.ownerKey === item.key || entry.targetKey === item.key,
  );
  const [showDismissed, setShowDismissed] = useState(true);
  const visible = relations.filter(
    (entry) => showDismissed || entry.link.state !== "dismissed",
  );
  return (
    <section>
      <div className="section-heading">
        <h3>业务关联 · {relations.length}</h3>
        <button
          className="text-link"
          onClick={() => context.relations(item.key)}
        >
          <Network size={14} />
          查看局部图
        </button>
      </div>
      {relations.some((entry) => entry.link.state === "dismissed") && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(event) => setShowDismissed(event.target.checked)}
          />
          显示已否定关联及理由
        </label>
      )}
      {!relations.length && (
        <p className="muted">未记录该关联；不能据此判断实现或遗漏。</p>
      )}
      <ul className="product-evidence-list">
        {visible.map((entry) => {
          const owner = product.items.find(
            (candidate) => candidate.key === entry.ownerKey,
          );
          return (
            <li
              key={entry.key}
              className={
                entry.link.state === "dismissed" ? "dismissed" : undefined
              }
            >
              <div className="product-inline">
                {owner && (
                  <button
                    className="text-link"
                    onClick={() => context.openProduct(owner.key)}
                  >
                    {owner.id} · {owner.title}
                  </button>
                )}
                <strong>{label(entry.link.relation)}</strong>
                <ItemLink
                  id={entry.link.target}
                  product={product}
                  openProduct={context.openProduct}
                />
              </div>
              <div className="product-inline">
                <Tag value={entry.link.origin} />
                <Tag value={entry.link.state} />
                <span className="status neutral">
                  {
                    {
                      resolved: "目标已定位",
                      missing: "目标未定位",
                      ambiguous: "目标有歧义",
                      "invalid-direction": "关系方向无效",
                      cycle: "关系存在循环",
                    }[entry.resolution]
                  }
                </span>
              </div>
              {entry.link.reason && <p>理由：{entry.link.reason}</p>}
              <ProductEvidence
                sources={entry.link.sources}
                product={product}
                ownerKey={entry.ownerKey}
                open={context.open}
              />
              {owner && (
                <SourceButton
                  source={{ ...owner.source, line: owner.metadataLine }}
                  open={context.open}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
function Inventory({
  item,
  context,
}: {
  item: ProductItem;
  context: ProductContext;
}) {
  const inventory = item.metadata.inventory;
  if (!inventory) return null;
  return (
    <details className="product-inventory">
      <summary>
        业务资料盘点 · 已核对 {inventory.checked_sources.length} 份 / 待核对{" "}
        {inventory.unreviewed_sources.length} 份
      </summary>
      <Tag value={inventory.state} />
      <p>{inventory.note}</p>
      <h4>已核对的所列来源</h4>
      <ProductEvidence
        sources={inventory.checked_sources}
        product={context.snapshot.product!}
        ownerKey={item.key}
        open={context.open}
      />
      <h4>未核对来源</h4>
      <ProductEvidence
        sources={inventory.unreviewed_sources}
        product={context.snapshot.product!}
        ownerKey={item.key}
        open={context.open}
      />
      <p className="muted">
        只表示所列来源的盘点状态，不证明全项目需求齐全或已交付。
      </p>
    </details>
  );
}
function RoadmapReconciliation({
  item,
  context,
}: {
  item: ProductItem;
  context: ProductContext;
}) {
  const product = context.snapshot.product!;
  const result = product.roadmaps?.find((entry) => entry.planKey === item.key);
  if (!result) return <p>已保存安排仍可浏览，路线图核对结果尚不可用。</p>;
  const labels = {
    current: "材料与已核对基线一致",
    "changes-pending": "存在待核对变化",
    "reviewed-deferred": "已核对并明确延期",
    unknown: "当前适用性待核对",
  };
  return (
    <section className="roadmap-reconciliation" aria-label="路线图只读核对">
      <h3>Implementation Roadmap · {labels[result.status]}</h3>
      <p>
        核对材料版本与安排，不认证工作完成、业务前置已满足或下一 Task
        已就绪。任何核对状态均可继续阅读。
      </p>
      {result.reasons.map((reason) => (
        <p key={reason} className="muted">
          {reason}
        </p>
      ))}
      <dl className="product-fields">
        <dt>工作副本</dt>
        <dd>{item.metadata.planning_baseline?.working_copy || "基线缺失"}</dd>
        <dt>基线核对时间</dt>
        <dd>{item.metadata.planning_baseline?.checked_at || "未知"}</dd>
        <dt>成员范围</dt>
        <dd>{result.scope?.member_ids.join("、") || "未定位"}</dd>
        <dt>实际读取完整性</dt>
        <dd>{result.scope?.complete ? "注册身份读取完整" : "未知或未完整"}</dd>
      </dl>
      {!!result.changes.length && (
        <ul>
          {result.changes.map((change, index) => (
            <li key={index}>
              {change.kind} · {change.id || "路线图安排"}
            </li>
          ))}
        </ul>
      )}
      {!!result.affected_work_items?.length && (
        <p>
          受影响工作项候选：{result.affected_work_items.join("、")}
          ；不代表已证明全部业务影响
        </p>
      )}
      {!!result.unarranged_requirements?.length && (
        <p>
          未记录直接工作项目标的候选：
          {result.unarranged_requirements.join("、")}；不等于未实施或已证明漏项
        </p>
      )}
      {!!result.exceptions?.length && (
        <details>
          <summary>精确版本下的例外与延期 · {result.exceptions.length}</summary>
          {result.exceptions.map((exception, index) => (
            <div key={index}>
              <p>
                {exception.target} · {exception.disposition} ·{" "}
                {exception.reason}
              </p>
              <ProductEvidence
                sources={exception.sources}
                product={product}
                ownerKey={item.key}
                open={context.open}
              />
            </div>
          ))}
        </details>
      )}
      {!!result.stale_exceptions?.length && (
        <details>
          <summary>
            已不适用的历史例外 · {result.stale_exceptions.length}
          </summary>
          {result.stale_exceptions.map((exception, index) => (
            <p key={index}>
              {exception.target} · {exception.reason}
            </p>
          ))}
        </details>
      )}
      <details>
        <summary>核对基线、定义与上下文</summary>
        <pre>
          {JSON.stringify(
            {
              selector: result.scope?.selector,
              definitions: result.scope?.definitions,
              context: result.scope?.context,
              arrangement: result.arrangement,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <ProductEvidence
        sources={item.metadata.planning_baseline?.sources}
        product={product}
        ownerKey={item.key}
        open={context.open}
      />
    </section>
  );
}

export function ProductDetail({
  item,
  context,
  includeWork = true,
}: {
  item: ProductItem;
  context: ProductContext;
  includeWork?: boolean;
}) {
  const product = context.snapshot.product!;
  const bindings = product.bindings.filter(
    (binding) => binding.ownerKey === item.key,
  );
  const currentBindings = [3, 4, 5].includes(item.version || 0)
    ? requirementBindings(product, item)
    : bindings;
  const sources = product.sources.filter(
    (source) => source.ownerKey === item.key,
  );
  return (
    <article className="product-detail" data-product-id={item.id}>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">
            {productTypeLabels[item.type] || item.type} · {item.id}
          </span>
          <h2>{item.title}</h2>
          <div className="product-inline">
            {item.metadata.scope && <Tag value={item.metadata.scope} />}
            {item.metadata.intent_state && (
              <Tag value={item.metadata.intent_state} intent />
            )}
            {!item.usable && (
              <span className="status amber">结构不可用 · 原文保留</span>
            )}
          </div>
        </div>
        <button
          className="secondary"
          onClick={() => context.relations(item.key)}
        >
          <Network size={15} />
          关联
        </button>
      </div>
      <div className="product-inline">
        <SourceButton source={item.source} open={context.open} />
        <button
          className="text-link"
          onClick={() =>
            context.open({ ...item.source, line: item.metadataLine })
          }
        >
          <FileText size={13} />
          元数据来源 · 行 {item.metadataLine}
        </button>
      </div>
      {item.diagnostics.some(productStructureIssue) && (
        <ProductDiagnostics
          diagnostics={item.diagnostics.filter(productStructureIssue)}
          open={context.open}
        />
      )}
      {item.usable && (
        <>
          {item.type === "project" && (
            <Inventory item={item} context={context} />
          )}
          {item.type === "requirement" &&
            ![3, 4, 5].includes(item.version || 0) && (
              <RequirementAssessment item={item} context={context} />
            )}
          {item.type === "assessment" && (
            <>
              <p className="muted">
                本条为独立范围化报告。当前结论由所选目标的范围声明、对象与两份定义依据确定；assessment_id
                仅为历史导航入口。
              </p>
              <AssessmentFacts
                item={item}
                view={product.assessments.find(
                  (entry) =>
                    entry.assessmentKey === item.key &&
                    entry.state === "selected",
                )}
                context={context}
              />
            </>
          )}
          {item.type === "discussion" && (
            <section>
              <h3>讨论原文与整理状态</h3>
              <dl className="product-fields">
                <dt>资料状态</dt>
                <dd>
                  {item.metadata.record_state === "active"
                    ? "活跃资料"
                    : "已归档"}
                </dd>
                <dt>提交时间</dt>
                <dd>{item.metadata.submitted_at}</dd>
                <dt>原始渠道 / 时间</dt>
                <dd>
                  {item.metadata.origin?.channel} ·{" "}
                  {item.metadata.origin?.occurred_at || "未知"} ·{" "}
                  {item.metadata.origin?.locator}
                </dd>
              </dl>
              <p className="muted">
                讨论关联不表示观点已采纳。整理摘要与取得的原文分别保留。
              </p>
              <ProductEvidence
                sources={item.metadata.raw_ref ? [item.metadata.raw_ref] : []}
                product={product}
                ownerKey={item.key}
                open={context.open}
              />
            </section>
          )}
          {item.type === "change" && (
            <section>
              <h3>变化范围与依据</h3>
              <p>
                {item.metadata.recorded_at} · {item.metadata.basis?.kind}
              </p>
              <p>{item.metadata.basis?.text}</p>
              <ProductEvidence
                sources={item.metadata.basis?.sources}
                product={product}
                ownerKey={item.key}
                open={context.open}
              />
              <ul className="product-evidence-list">
                {list(item.metadata.deltas).map((delta, i) => (
                  <li key={i}>
                    <ItemLink
                      id={delta.target}
                      product={product}
                      openProduct={context.openProduct}
                    />
                    <p>之前：{delta.before ?? "未记录 / 不存在"}</p>
                    <p>之后：{delta.after ?? "未记录 / 不存在"}</p>
                    {delta.note && <p>{delta.note}</p>}
                  </li>
                ))}
              </ul>
              <p className="muted">
                记录变化不证明所有正文已同步；未同步项见完整正文。
              </p>
            </section>
          )}
        </>
      )}
      {item.type === "plan" && (
        <RoadmapReconciliation item={item} context={context} />
      )}
      <Body item={item} context={context} />
      {item.usable && (
        <>
          <ProductRelations item={item} context={context} />
          {(item.type === "goal" || item.type === "requirement") && (
            <section>
              <h3>关联任务与范围 · {currentBindings.length}</h3>
              {[3, 4, 5].includes(item.version || 0) &&
                item.type === "requirement" && (
                  <p className="muted">
                    自身及当前组成子需求的有效关联；来源与角色分别保留，不表示父需求已交付。
                  </p>
                )}
              {currentBindings.length ? (
                [3, 4, 5].includes(item.version || 0) ? (
                  <CompactTasks bindings={currentBindings} context={context} />
                ) : (
                  bindings.map((binding) => (
                    <BindingCard
                      key={binding.key}
                      view={binding}
                      context={context}
                    />
                  ))
                )
              ) : (
                <p className="muted">
                  未记录任务关联；不表示该业务范围未实现。
                </p>
              )}
              {[3, 4, 5].includes(item.version || 0) &&
                bindings.some((b) => b.binding.state === "dismissed") && (
                  <details>
                    <summary>自身已否定关联</summary>
                    {bindings
                      .filter((b) => b.binding.state === "dismissed")
                      .map((b) => (
                        <BindingCard key={b.key} view={b} context={context} />
                      ))}
                  </details>
                )}
            </section>
          )}
          {item.type === "plan" && includeWork && (
            <WorkItems plan={item} context={context} />
          )}
        </>
      )}
      <details className="product-coverage">
        <summary>来源与核对 · {sources.length}</summary>
        {sources.length ? (
          <ul className="product-evidence-list">
            {sources.map((source) => (
              <ProductSourceRow
                key={source.id}
                check={source}
                open={context.open}
              />
            ))}
          </ul>
        ) : (
          <p className="muted">未记录已核对来源。</p>
        )}
      </details>
      <details className="product-metadata">
        <summary>完整原始元数据</summary>
        <pre>
          {JSON.stringify(
            "rawMetadata" in item && item.rawMetadata !== undefined
              ? item.rawMetadata
              : item.metadata,
            null,
            2,
          )}
        </pre>
      </details>
    </article>
  );
}
export function CompactTasks({
  bindings,
  context,
}: {
  bindings: ProductBindingView[];
  context: ProductContext;
}) {
  const groups = new Map<string, ProductBindingView[]>();
  for (const binding of bindings) {
    const id = JSON.stringify(
      binding.binding.task.task_id === null
        ? ["unconfirmed", binding.key]
        : ["task", binding.binding.task.task_id],
    );
    groups.set(id, [...(groups.get(id) || []), binding]);
  }
  return (
    <ul className="compact-task-list">
      {[...groups].map(([id, rows]) => {
        const task = context.snapshot.tasks.find((t) =>
          rows.some(
            (b) =>
              b.match.state === "matched" && b.match.taskIds.includes(t.id),
          ),
        );
        return (
          <li key={id}>
            <strong>
              {task?.title || rows[0].binding.task.task_id || "身份未确认"}
            </strong>{" "}
            ·{" "}
            {task?.runtimeLifecycle
              ? lifecycleLabels[task.runtimeLifecycle]
              : "身份或任务数据待核对"}
            {rows.some((r) => r.match.state !== "matched") && (
              <span className="status amber">关联待核对</span>
            )}
            {task && (
              <button
                className="text-link"
                onClick={() => context.openTask(task.id)}
              >
                查看 Task / Step
              </button>
            )}
            <small>
              {rows.map((r) => `${r.binding.id}：${r.match.detail}`).join("；")}
            </small>
            <details>
              <summary>关联范围与来源 · {rows.length}</summary>
              {rows.map((r) => (
                <div key={r.key}>
                  <p>
                    来源需求：
                    {context.snapshot.product?.items.find(
                      (i) => i.key === r.ownerKey,
                    )?.id || r.ownerKey}
                  </p>
                  <BindingCard view={r} context={context} />
                </div>
              ))}
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export { RequirementsV3 as RequirementsPage } from "./product-v3";

function Targets({
  targets,
  context,
}: {
  targets?: { target: string; coverage: string }[];
  context: ProductContext;
}) {
  return list(targets).length ? (
    <ul className="product-evidence-list">
      {list(targets).map((entry, i) => (
        <li key={i}>
          <ItemLink
            id={entry.target}
            product={context.snapshot.product!}
            openProduct={context.openProduct}
          />
          <p>覆盖：{entry.coverage}</p>
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">业务归属待明确</p>
  );
}
function WorkReports({
  work,
  bindings,
  context,
}: {
  work: ProductWorkItem;
  bindings: ProductBindingView[];
  context: ProductContext;
}) {
  const product = context.snapshot.product!;
  const targetIds = new Set(list(work.targets).map((entry) => entry.target));
  const ownerKeys = new Set(
    bindings
      .filter((entry) => entry.binding.state === "active")
      .map((entry) => entry.ownerKey),
  );
  const requirements = product.items.filter(
    (item) =>
      item.usable &&
      item.type === "requirement" &&
      (targetIds.has(item.id) || ownerKeys.has(item.key)),
  );
  return (
    <section className="product-work-reports">
      <h4>相关需求的范围化交付报告</h4>
      {requirements.length ? (
        requirements.map((requirement) => {
          const view = product.assessments.find(
            (entry) => entry.requirementKey === requirement.key,
          );
          const report =
            view?.state === "selected"
              ? product.items.find(
                  (item) => item.key === view.assessmentKey && item.usable,
                )
              : undefined;
          return (
            <div key={requirement.key}>
              <button
                className="text-link"
                onClick={() => context.openProduct(requirement.key)}
              >
                {requirement.id} · {requirement.title}
                <ArrowRight size={13} />
              </button>
              {report ? (
                <>
                  <div className="product-inline">
                    <span>
                      实施：
                      {reportLabel(
                        report.metadata.implementation,
                        "implementation",
                      )}
                    </span>
                    <span>
                      验证：
                      {reportLabel(
                        report.metadata.verification,
                        "verification",
                      )}
                    </span>
                  </div>
                  <p>
                    报告对象：{reportSubject(report)} ·{" "}
                    {report.metadata.checked_at || "对账时间未记录"}
                  </p>
                  <button
                    className="text-link"
                    onClick={() => context.openProduct(report.key)}
                  >
                    核对 {report.id} 的原覆盖范围与依据
                    <ArrowRight size={13} />
                  </button>
                  {list(report.metadata.pending_sources).length > 0 && (
                    <p className="warning-text">
                      待对账新材料{" "}
                      {list(report.metadata.pending_sources).length}{" "}
                      项，未纳入原结论
                    </p>
                  )}
                  <p className="muted">
                    报告适用范围需与本工作项覆盖逐项核对，当前代码适用性未知。
                  </p>
                </>
              ) : (
                <p className="muted">
                  {view?.state === "unselected" || !view
                    ? "未选择交付摘要"
                    : "所选报告不可用或目标需核对"}{" "}
                  · 交付未知
                </p>
              )}
            </div>
          );
        })
      ) : (
        <p className="muted">未记录可核对的需求报告入口，工作项交付未知。</p>
      )}
    </section>
  );
}
function workElementId(plan: ProductItem, id: string, occurrence?: number) {
  return `product-work-${encodeURIComponent(plan.key)}-${encodeURIComponent(id)}${occurrence !== undefined ? `-occurrence-${occurrence}` : ""}`;
}
function WorkItems({
  plan,
  context,
  selectedWork,
}: {
  plan: ProductItem;
  context: ProductContext;
  selectedWork?: string;
}) {
  const product = context.snapshot.product!;
  const items = list(plan.metadata.work_items);
  const occurrences = (id: string) =>
    items.filter((item) => item.id === id).length;
  useEffect(() => {
    if (selectedWork && occurrences(selectedWork) === 1)
      document
        .getElementById(workElementId(plan, selectedWork))
        ?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [selectedWork, plan.key, context.snapshot.id]);
  return (
    <section className="product-work-items">
      <h3>工作项 · 原数组顺序</h3>
      <p className="muted">
        阶段仅作展示分组；顺序不表示依赖，也不证明可并行。安排、任务状态与交付报告分别阅读。
      </p>
      {!items.length && (
        <p className="muted">尚未分解工作项，不能宣称计划完整。</p>
      )}
      {selectedWork && !items.some((entry) => entry.id === selectedWork) && (
        <p className="banner">所选工作项已退出本计划，未自动替换。</p>
      )}
      {selectedWork && occurrences(selectedWork) > 1 && (
        <p className="banner">
          所选工作项身份有歧义，保留全部同 ID 原文，不定位到首项。
        </p>
      )}
      {items.map((work: ProductWorkItem, index) => {
        const ambiguous = occurrences(work.id) > 1;
        const bindings = product.bindings.filter((binding) =>
          binding.planItems.some(
            (ref) =>
              ref.planId === plan.id &&
              ref.workItemId === work.id &&
              ref.state === "resolved",
          ),
        );
        const stageChanged =
          index === 0 || items[index - 1].stage !== work.stage;
        return (
          <div key={`${work.id}:${index}`}>
            {stageChanged && (
              <h4 className="product-stage">
                阶段：{work.stage || "未记录阶段"}
              </h4>
            )}
            <article
              id={workElementId(plan, work.id, ambiguous ? index : undefined)}
              data-work-item-id={work.id}
              className={`product-work-card ${selectedWork === work.id && !ambiguous ? "source-highlight" : ""}`}
            >
              <div className="section-heading">
                <h3>
                  {index + 1}. {work.id} · {work.title}
                </h3>
                <div className="product-inline">
                  {ambiguous && (
                    <span className="status amber">工作项身份有歧义</span>
                  )}
                  <Tag value={work.origin} />
                  <Tag value={work.state} />
                </div>
              </div>
              <p>
                <strong>预期结果：</strong>
                {work.outcome}
              </p>
              <p>
                <strong>工作范围：</strong>
                {work.scope}
              </p>
              <h4>业务覆盖</h4>
              <Targets targets={work.targets} context={context} />
              <h4>明确依赖</h4>
              {list(work.depends_on).length ? (
                <ul className="product-evidence-list">
                  {list(work.depends_on).map((dep, i) => (
                    <li key={i}>
                      {occurrences(dep.item_id) === 1 ? (
                        <button
                          className="text-link"
                          onClick={() =>
                            context.openProduct(plan.key, dep.item_id)
                          }
                        >
                          {plan.id} / {dep.item_id}
                        </button>
                      ) : (
                        <span>
                          {plan.id} / {dep.item_id} ·{" "}
                          {occurrences(dep.item_id) > 1
                            ? "工作项身份有歧义"
                            : "工作项未定位"}
                        </span>
                      )}{" "}
                      · {dep.kind === "order" ? "安排顺序" : "声明的工程前提"}
                      <p>{dep.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  未记录明确依赖；不能据此推断串行或已确认可并行。
                </p>
              )}
              {list(work.replaces).length > 0 && (
                <p>替代工作项：{list(work.replaces).join("、")}</p>
              )}
              <ProductEvidence
                sources={work.sources}
                product={product}
                ownerKey={plan.key}
                open={context.open}
              />
              {work.origin === "added" && !list(work.sources).length && (
                <p className="warning-text">后加工作未记录来源，依据不足。</p>
              )}
              <h4>任务文档声明与范围关联 · {bindings.length}</h4>
              {bindings.length ? (
                bindings.map((binding) => (
                  <BindingCard
                    key={binding.key}
                    view={binding}
                    context={context}
                    showOwner
                  />
                ))
              ) : (
                <p className="muted">
                  未记录任务关联。工作项保留，不创建假任务 ID。
                </p>
              )}
              <WorkReports work={work} bindings={bindings} context={context} />
              <p className="muted">
                交付以相关需求的范围化报告为依据；关联任务关闭不代表本工作项或阶段已完成。
              </p>
            </article>
          </div>
        );
      })}
    </section>
  );
}
function KnownScope({ context }: { context: ProductContext }) {
  const items = context.snapshot.product!.items;
  const business = items.filter((item) =>
    ["goal", "module", "requirement", "design"].includes(item.type),
  );
  return (
    <section className="product-known-scope">
      <h3>完整已知业务范围 · {business.length}</h3>
      <p className="muted">
        保留全部 current / planned / candidate /
        retired，以及没有直接任务或工作项关联的共享约束。阅读顺序不是实施顺序。
      </p>
      <div className="product-scope-list">
        {business.map((item) => (
          <div key={item.key}>
            <button
              className="text-link"
              onClick={() => context.openProduct(item.key)}
            >
              {item.id} · {item.title}
              <ArrowRight size={13} />
            </button>
            <span>
              {productTypeLabels[item.type]} ·{" "}
              {item.metadata.scope
                ? label(item.metadata.scope)
                : intentLabel(item.metadata.intent_state)}
            </span>
            <small>
              {
                context.snapshot.product!.bindings.filter(
                  (binding) => binding.ownerKey === item.key,
                ).length
              }{" "}
              条已记录任务关联
            </small>
          </div>
        ))}
      </div>
      {items
        .filter((item) => item.type === "project")
        .map((item) => (
          <div key={item.key}>
            <h3>项目正文与动态选取说明 · {item.title}</h3>
            <Body item={item} context={context} />
          </div>
        ))}
    </section>
  );
}
export function PlanningPage({
  selected,
  selectedWork,
  select,
  configure,
  ...context
}: ProductContext & {
  selected?: string;
  selectedWork?: string;
  select: (key: string) => void;
  configure: () => void;
}) {
  const product = context.snapshot.product;
  const plans = product?.items.filter((item) => item.type === "plan") || [];
  const plan = plans.find((item) => item.key === selected);
  useEffect(() => {
    if (selected === undefined && plans.length === 1) select(plans[0].key);
  }, [selected, plans.length, plans[0]?.key]);
  return (
    <div className="product-page planning-page">
      <div className="page-title">
        <h2>总体规划</h2>
        <span className="muted">
          项目业务安排，与当前任务 adopted-plan 分开
        </span>
      </div>
      <ProductStatusPanel
        product={product}
        navigation={context.snapshot.navigation}
        open={context.open}
        configure={configure}
      />
      {product && ["ready", "partial", "empty"].includes(product.status) && (
        <>
          {plans.length > 0 ? (
            <>
              <label className="product-plan-picker">
                选择项目计划
                <select
                  aria-label="选择项目计划"
                  value={plan?.key || ""}
                  onChange={(event) => select(event.target.value)}
                >
                  <option value="">请选择一份计划</option>
                  {plans.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.id} · {item.title} ·{" "}
                      {intentLabel(item.metadata.intent_state)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                {plans.length}{" "}
                份独立计划；已采用不等于唯一全项目计划，不自动合并。
              </p>
              {plan ? (
                <>
                  <section>
                    <h3>所选计划的业务覆盖</h3>
                    <Targets
                      targets={plan.metadata.targets}
                      context={context}
                    />
                  </section>
                  <ProductDetail
                    item={plan}
                    context={context}
                    includeWork={false}
                  />
                  {plan.usable && (
                    <WorkItems
                      plan={plan}
                      context={context}
                      selectedWork={selectedWork}
                    />
                  )}
                </>
              ) : (
                <Empty
                  title={
                    selected ? "所选计划已退出本次范围" : "请选择要查看的计划"
                  }
                  detail={
                    selected
                      ? "保留原选择，不会自动切换到其他计划。"
                      : "多份计划独立展示，不按文件时间或首项猜当前安排。"
                  }
                />
              )}
            </>
          ) : (
            <>
              <div className="banner">
                <div>
                  <strong>未记录项目计划</strong>
                  <p>
                    仍可查看完整已知业务范围和任务关联。项目正文中的动态选取说明原样展示，不自动生成待办顺序。
                  </p>
                </div>
              </div>
              {selected && (
                <p className="warning-text">原选择的计划已退出本次范围。</p>
              )}
            </>
          )}
          <KnownScope context={context} />
        </>
      )}
    </div>
  );
}

export function TaskProductLinks({
  task,
  context,
}: {
  task: Task;
  context: ProductContext;
}) {
  const product = context.snapshot.product;
  if (!product || product.status === "disabled") return null;
  const bindings = product.bindings.filter((binding) =>
    binding.match.taskIds.includes(task.id),
  );
  const repairs = product.bindings.filter((binding) =>
    binding.repairs.some((repair) => repair.match.taskIds.includes(task.id)),
  );
  return (
    <section className="task-product-links">
      <h3>产品业务与计划反查</h3>
      <dl className="product-fields">
        <dt>真实 task_id</dt>
        <dd>
          <code>{task.realTaskId || "未确认"}</code>
        </dd>
        <dt>显示编号</dt>
        <dd>{task.number || "未记录"}</dd>
      </dl>
      {task.identitySources?.map((source, i) => (
        <SourceButton key={i} source={source} open={context.open} />
      ))}
      <p className="muted">
        角色与覆盖属于每条关联；UI 身份、显示编号与真实任务 ID 分开。
      </p>
      {bindings.length ? (
        bindings.map((binding) => (
          <BindingCard
            key={binding.key}
            view={binding}
            context={context}
            showOwner
          />
        ))
      ) : (
        <p className="muted">
          没有可靠匹配到本任务的产品绑定，不能据此判断实现缺口。
        </p>
      )}
      {repairs.length > 0 && (
        <>
          <h4>涉及本任务交付范围的后续修复</h4>
          {repairs.map((binding) => (
            <BindingCard
              key={binding.key}
              view={binding}
              context={context}
              showOwner
            />
          ))}
        </>
      )}
    </section>
  );
}
function RequirementSummary({
  item,
  context,
}: {
  item: ProductItem;
  context: ProductContext;
}) {
  const product = context.snapshot.product!;
  const view = product.assessments.find(
    (entry) => entry.requirementKey === item.key,
  );
  const report =
    view?.state === "selected"
      ? product.items.find((entry) => entry.key === view.assessmentKey)
      : undefined;
  const designs = product.relations.filter(
    (entry) =>
      entry.targetKey === item.key &&
      entry.link.relation === "addresses" &&
      entry.link.state === "active" &&
      entry.resolution === "resolved",
  );
  const bindings = product.bindings.filter(
    (entry) => entry.ownerKey === item.key && entry.binding.state === "active",
  );
  return (
    <div className="product-requirement-summary" data-requirement-id={item.id}>
      <button
        className="text-link"
        onClick={() => context.openProduct(item.key)}
      >
        {item.title}
        <ArrowRight size={13} />
      </button>
      <div className="product-inline">
        <small>{item.id}</small>
        <Tag value={item.metadata.scope} />
        <small>
          设计 {designs.length} · 任务关联 {bindings.length}
        </small>
      </div>
      <p className="muted">
        实施：{reportLabel(report?.metadata.implementation, "implementation")}
        ；验证：{reportLabel(report?.metadata.verification, "verification")}
      </p>
      {report && list(report.metadata.pending_sources).length > 0 && (
        <small className="muted">
          待核对材料 {list(report.metadata.pending_sources).length}{" "}
          项（未计入原报告结论）
        </small>
      )}
    </div>
  );
}

function BusinessScope({
  product,
  context,
}: {
  product: ProductSnapshot;
  context: ProductContext;
}) {
  const requirements = product.items.filter(
    (item) => item.usable && item.type === "requirement",
  );
  const scope = scopeGroups(product, requirements);
  return (
    <section className="product-business-scope">
      <h3>目标与需求全景</h3>
      <p className="muted">
        {requirements.length} 项需求 ·{" "}
        {scope.groups.filter((row) => row.group.type === "goal").length} 个目标
        · {scope.groups.filter((row) => row.group.type === "module").length}{" "}
        个模块。按已记录关系展示，同一需求可支持多个目标。
      </p>
      <div className="product-business-groups">
        {scope.groups.map(({ group, requirements: entries }) => (
          <section
            className="product-business-group"
            key={group.key}
            data-scope-id={group.id}
          >
            <div className="section-heading">
              <button
                className="text-link"
                onClick={() => context.openProduct(group.key)}
              >
                {group.title}
                <ArrowRight size={14} />
              </button>
              <span className="status neutral">
                {productTypeLabels[group.type]} · {entries.length} 项需求
              </span>
            </div>
            <small className="muted">{group.id}</small>
            {entries.map(({ item, inferred, indirect }) => (
              <div key={item.key}>
                {(inferred || indirect) && (
                  <small className="muted">
                    {inferred ? "vNext 记录的推断关联" : "明确声明的关联"}
                    {indirect ? " · 经上级业务归属" : ""}
                  </small>
                )}
                <RequirementSummary item={item} context={context} />
              </div>
            ))}
            {!entries.length && (
              <p className="muted">
                尚未记录该范围下的需求关联。可阅读目标正文，与 vNext
                讨论后整理。
              </p>
            )}
          </section>
        ))}
        {scope.ungrouped.length > 0 && (
          <section className="product-business-group">
            <h4>尚未关联目标或模块 · {scope.ungrouped.length} 项</h4>
            {scope.ungrouped.map((item) => (
              <RequirementSummary
                key={item.key}
                item={item}
                context={context}
              />
            ))}
          </section>
        )}
      </div>
      {!requirements.length && (
        <p className="muted">尚未登记标准需求条目，可先阅读项目总纲。</p>
      )}
      <p className="muted">
        拆分仅展示已记录的需求归属；未形成独立条目的整体要求保留在项目总纲与需求完整正文中。
      </p>
    </section>
  );
}

function OverviewReading({
  context,
  configure,
}: {
  context: ProductContext;
  configure: () => void;
}) {
  const product = context.snapshot.product;
  const projects =
    product?.items.filter((item) => item.usable && item.type === "project") ||
    [];
  const plans =
    product?.items.filter((item) => item.usable && item.type === "plan") || [];
  return (
    <>
      <ProductStatusPanel
        product={product}
        navigation={context.snapshot.navigation}
        open={context.open}
        configure={configure}
      />
      {projects.map((item) => (
        <section className="product-project-summary" key={item.key}>
          <h2>{item.title}</h2>
          <LazyDetails
            className="product-project-body"
            summary="项目需求总纲与完整正文"
          >
            {() => <Body item={item} context={context} />}
          </LazyDetails>
          <Inventory item={item} context={context} />
        </section>
      ))}
      <section>
        <h3>项目计划 · {plans.length}</h3>
        {plans.length ? (
          plans.map((plan) => (
            <p key={plan.key}>
              <button
                className="text-link"
                onClick={() => context.openProduct(plan.key)}
              >
                {plan.title}
                <ArrowRight size={14} />
              </button>{" "}
              · {intentLabel(plan.metadata.intent_state)}
            </p>
          ))
        ) : (
          <p className="muted">
            尚未登记标准项目计划；目标、需求与现有任务仍可阅读。
          </p>
        )}
      </section>
    </>
  );
}

export function ProductOverview({
  context,
  configure,
  requirements,
  planning,
  projectName = "本地项目",
  root = "",
  loadSnapshot,
}: {
  context: OverviewContext;
  configure: () => void;
  requirements: () => void;
  planning: () => void;
  projectName?: string;
  root?: string;
  loadSnapshot?: () => Promise<Snapshot>;
}) {
  const snapshot = context.snapshot;
  const overview = isOverviewSnapshot(snapshot)
    ? snapshot.overview!
    : buildOverviewData(snapshot);
  const pending = useRef<
    { id: string; promise: Promise<Snapshot> } | undefined
  >(undefined);
  function loadDetails(): Promise<Snapshot> {
    if (!isOverviewSnapshot(snapshot)) return Promise.resolve(snapshot);
    if (pending.current?.id === snapshot.id) return pending.current.promise;
    if (!loadSnapshot) return Promise.reject(new Error("详细记录暂不可用"));
    const promise = loadSnapshot().catch((error) => {
      if (pending.current?.id === snapshot.id) pending.current = undefined;
      throw error;
    });
    pending.current = { id: snapshot.id, promise };
    return promise;
  }
  return (
    <section className="product-overview">
      {overview.ready ? (
        <OverviewDashboard
          context={context}
          requirements={requirements}
          planning={planning}
        />
      ) : (
        <div className="overview-dashboard">
          <section
            className="overview-hero overview-pending"
            aria-label="项目总览"
          >
            <div className="overview-hero-section overview-hero-goal">
              <div className="overview-eyebrow">PROJECT OVERVIEW</div>
              <h1>{projectName}</h1>
              <p>目标与需求尚未就绪，已读取的任务和文档仍可查看。</p>
              <button className="overview-hero-link" onClick={requirements}>
                查看需求视图 ↗
              </button>
            </div>
          </section>
          <CurrentWorkPanel work={overview.currentWork} context={context} />
          <section className="product-status">
            <h3>{productStatusLabels[overview.productStatus]}</h3>
            <p>{productStatusDetails[overview.productStatus]}</p>
            <button className="text-link" onClick={configure}>
              查看项目设置
            </button>
          </section>
        </div>
      )}
      <LazyDetails
        className="overview-reading-details"
        summary="文档读取与来源核对"
      >
        {() => (
          <OverviewDetails snapshotId={snapshot.id} load={loadDetails}>
            {(full) => (
              <OverviewReading
                context={{ ...context, snapshot: full }}
                configure={configure}
              />
            )}
          </OverviewDetails>
        )}
      </LazyDetails>
      <LazyDetails
        className="overview-record-details"
        summary="当前任务、文档记录与扫描详情"
      >
        {() => (
          <OverviewDetails snapshotId={snapshot.id} load={loadDetails}>
            {(full) => (
              <ProjectRecords
                snapshot={full}
                open={context.open}
                openTask={context.openTask}
                projectName={projectName}
                root={root}
              />
            )}
          </OverviewDetails>
        )}
      </LazyDetails>
    </section>
  );
}
