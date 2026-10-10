import { useState } from "react";
import { Check, Copy, FileText, MessageSquareText } from "lucide-react";
import {
  documentKinds,
  kindLabels,
  type NavigationReport,
  type Snapshot,
} from "../shared/types";
import { organizationPrompt } from "../shared/organization-prompt";
import {
  documentIssues,
  type ProductReadState,
} from "../shared/document-health";
import { Modal, SourceButton, type OpenSource } from "./components";

const classifications = {
  declared: "明确登记",
  manual: "手动分类",
  suggested: "建议分类",
  unclassified: "待分类",
};
const availability = {
  read: "已读取",
  missing: "文件缺失",
  error: "不可读",
  excluded: "已排除",
  pending: "未读取",
};
export function RegistrationList({
  report,
  snapshot,
  open,
}: {
  report: NavigationReport;
  snapshot?: Snapshot;
  open?: OpenSource;
}) {
  const [kind, setKind] = useState("business");
  const entries = report.entries.filter(
    (e) =>
      kind === "all" ||
      (kind === "business" ? e.kind !== "management" : e.kind === kind),
  );
  return (
    <>
      <div className="registration-heading">
        <span className="muted">
          {report.entries.length} 项登记 ·{" "}
          {!report.enabled
            ? "未启用自动登记核对"
            : report.incomplete
              ? "核对不完整"
              : "已核对本次发现范围"}
        </span>
        <select
          aria-label="登记文档类型"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="business">项目文档</option>
          <option value="all">全部登记</option>
          {documentKinds.map((k) => (
            <option key={k} value={k}>
              {kindLabels[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="registration-list">
        {entries.map((entry) => {
          const target = snapshot?.documents.find((d) => d.path === entry.path);
          return (
            <div className="registration-row" key={entry.path}>
              <div className="registration-path">
                {target && open ? (
                  <SourceButton
                    source={{
                      documentId: target.id,
                      path: target.path,
                      line: 1,
                      section: null,
                      digest: target.digest,
                    }}
                    open={open}
                  />
                ) : (
                  <code>{entry.path}</code>
                )}
                <span className="registration-meta">
                  <span>{kindLabels[entry.kind]}</span>
                  <span
                    className={
                      entry.classification === "suggested" ||
                      entry.classification === "unclassified"
                        ? "warning-text"
                        : ""
                    }
                  >
                    {classifications[entry.classification]}
                  </span>
                  <span>{entry.status || "未声明状态"}</span>
                  {entry.supersededBy && (
                    <span>替代文档：{entry.supersededBy}</span>
                  )}
                  <span>{availability[entry.availability]}</span>
                  {entry.sourcesTruncated && <span>登记来源已截断</span>}
                </span>
              </div>
              <div className="registration-evidence">
                {entry.sources.map((source, i) => {
                  const document = snapshot?.documents.find(
                    (d) => d.path === source.path,
                  );
                  return (
                    <div key={i}>
                      <small>{source.label}</small>
                      {document && open ? (
                        <SourceButton
                          source={{
                            documentId: document.id,
                            path: source.path,
                            line: source.line,
                            section: null,
                            digest: document.digest,
                          }}
                          open={open}
                        />
                      ) : (
                        <code>
                          {source.path}:{source.line}
                        </code>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!entries.length && <p className="muted">本次范围内没有此类登记</p>}
      </div>
    </>
  );
}

export function CandidateList({ report }: { report: NavigationReport }) {
  const [query, setQuery] = useState("");
  const inventory = report.inventory;
  if (!inventory) return null;
  const candidates = inventory.candidates.filter((path) =>
    path.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <details className="candidate-documents">
      <summary>
        磁盘存在但未登记 <span>{inventory.candidates.length}</span>
      </summary>
      <p className="muted">
        盘点目录：{inventory.roots.join("、") || "未配置"}。
        {inventory.incomplete ? "盘点不完整。" : "已完成本次目录盘点。"}
        这里只确认文件存在，尚未读取正文或确认用途。请将整理提示词交给项目中的
        vNext，由它核对用途、规范位置和登记。
      </p>
      <input
        aria-label="搜索未登记文档"
        placeholder="搜索路径"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="registration-list">
        {candidates.map((path) => (
          <div className="registration-row" key={path}>
            <code>{path}</code>
            <small>存在 · 未登记 · 未读取正文</small>
          </div>
        ))}
        {!candidates.length && (
          <p className="muted">本次盘点范围内没有匹配的未登记文件</p>
        )}
      </div>
      {inventory.excluded.length > 0 && (
        <details>
          <summary>
            未盘点的路径 <span>{inventory.excluded.length}</span>
          </summary>
          <div className="registration-list">
            {inventory.excluded.map((entry, index) => (
              <div className="registration-row" key={`${entry.path}:${index}`}>
                <code>{entry.path}</code>
                <small>{entry.reason}</small>
              </div>
            ))}
          </div>
        </details>
      )}
    </details>
  );
}

export function OrganizationPromptButton({
  report,
  product,
  projectName,
  root,
}: {
  report: NavigationReport;
  product?: ProductReadState;
  projectName: string;
  root: string;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const prompt = organizationPrompt(projectName, root, report, product);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("剪贴板不可用，提示词仍可在下方选择。");
    }
  }
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setPromptOpen(true);
          setCopied(false);
          setCopyError("");
        }}
      >
        <MessageSquareText size={16} />
        交给 vNext 整理
      </button>
      {promptOpen && (
        <Modal title="文档整理提示词" close={() => setPromptOpen(false)}>
          <div className="modal-body">
            <p className="muted">
              复制到该项目的 vNext 对话中，讨论并整理后回到 TraceLens
              刷新。文档结构与登记由 vNext 维护。
            </p>
            <textarea
              aria-label="文档整理提示词"
              className="organization-prompt"
              readOnly
              value={prompt}
              rows={16}
            />
            {copyError && (
              <p className="error-message" role="alert">
                {copyError}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="secondary"
              onClick={() => setPromptOpen(false)}
            >
              关闭
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void copy()}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "已复制" : "复制提示词"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function DocumentSummary({
  report,
  product,
  projectName,
  root,
}: {
  report: NavigationReport;
  product?: ProductReadState;
  projectName: string;
  root: string;
}) {
  const issues = documentIssues(report, product);
  const read = report.entries.filter(
    (entry) => entry.availability === "read",
  ).length;
  let productSummary = "标准产品资料待就绪";
  if (product && ["ready", "partial", "empty"].includes(product.status)) {
    productSummary = "已找到标准产品入口";
    if ("items" in product)
      productSummary = `${product.items.filter((item) => item.usable).length} 个标准产品条目`;
  }
  return (
    <section className="document-summary" aria-label="vNext 文档状态">
      <div className="section-heading">
        <h3>
          <FileText size={17} /> vNext 文档
        </h3>
        <OrganizationPromptButton
          report={report}
          product={product}
          projectName={projectName}
          root={root}
        />
      </div>
      <p>
        已读取 {read} 份项目文档 · {productSummary}
      </p>
      <p className="muted">
        自动跟随 vNext 的文档登记。缺失内容请在项目中与 vNext
        讨论、整理，完成后刷新即可。
      </p>
      {issues.length > 0 ? (
        <>
          <details>
            <summary>文档读取与引用待处理 · {issues.length} 项</summary>
            <IssueList issues={issues} />
          </details>
        </>
      ) : (
        <p className="muted">
          本次未发现登记与读取问题。业务内容是否齐全，仍需在 vNext 中确认。
        </p>
      )}
    </section>
  );
}

function IssueList({ issues }: { issues: ReturnType<typeof documentIssues> }) {
  return (
    <ul className="navigation-gaps document-issues">
      {issues.map((issue, index) => (
        <li key={index}>
          {issue.path && <code>{issue.path}</code>}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function NavigationAudit({
  snapshot,
  projectName,
  root,
  open,
}: {
  snapshot: Snapshot;
  projectName: string;
  root: string;
  open: OpenSource;
}) {
  return (
    <section className="navigation-audit">
      <DocumentSummary
        report={snapshot.navigation}
        product={snapshot.product}
        projectName={projectName}
        root={root}
      />
      <details>
        <summary>
          文档登记与读取详情 · {snapshot.navigation.entries.length} 项
        </summary>
        <RegistrationList
          report={snapshot.navigation}
          snapshot={snapshot}
          open={open}
        />
        <CandidateList report={snapshot.navigation} />
      </details>
    </section>
  );
}
