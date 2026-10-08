import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  LoaderCircle,
  Plus,
  Save,
  X,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { api } from "./api";
import { productStatusLabels } from "./product-labels";
import { ProjectPicker } from "./project-picker";
import { CandidateList, RegistrationList } from "./navigation-audit";
import {
  kinds,
  kindLabels,
  type Discovery,
  type Entry,
  type Project,
  type ScanConfig,
  type SourceRef,
} from "../shared/types";

export type OpenSource = (source: SourceRef) => void;
export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <FolderOpen size={34} strokeWidth={1.3} />
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
export function SourceButton({
  source,
  open,
}: {
  source: SourceRef;
  open: OpenSource;
}) {
  return (
    <button
      type="button"
      className="source-link"
      title={`${source.path}:${source.line}${source.section ? ` · ${source.section}` : ""}`}
      onClick={() => open(source)}
    >
      <FileText size={13} />
      <span>
        {source.path}:{source.line}
      </span>
      <ArrowUpRight size={12} />
    </button>
  );
}
export function EntryList({
  entries,
  open,
  empty = "未记录",
  compact = false,
}: {
  entries: Entry[];
  open: OpenSource;
  empty?: string;
  compact?: boolean;
}) {
  if (!entries.length) return <p className="muted missing">{empty}</p>;
  return (
    <ul className={`entry-list ${compact ? "compact" : ""}`}>
      {entries.map((entry, index) => (
        <li key={`${entry.source.line}-${index}`}>
          {entry.checked !== null && (
            <span
              className={`checkmark ${entry.checked ? "checked" : ""}`}
              aria-label={entry.checked ? "已勾选" : "未勾选"}
            >
              {entry.checked && <Check size={12} />}
            </span>
          )}
          <div>
            <p>
              {entry.link?.target ? (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => open(entry.link!.target!)}
                >
                  {entry.link.label}
                  <ArrowUpRight size={13} />
                </button>
              ) : (
                entry.link?.label || entry.text
              )}
            </p>
            {entry.link?.detail && <p className="muted">{entry.link.detail}</p>}
            <SourceButton source={entry.source} open={open} />
          </div>
        </li>
      ))}
    </ul>
  );
}
export function stateKnown(text: string): boolean {
  return /^(done|complete|completed|已完成|完成|active|in[_-]progress|进行中|执行中|paused|暂停|已暂停|terminated|cancelled|终止|已终止|skipped|跳过|已跳过|draft|草稿|archived|已归档|blocked|阻塞|pending|待开始)$/i.test(
    text.trim(),
  );
}
export function Status({ text }: { text: string | null }) {
  const value = text || "未记录";
  let tone = "neutral";
  if (/^(completed|complete|done|已完成|完成)$/i.test(value)) tone = "green";
  else if (/^(active|in[_-]progress|进行中|执行中)$/i.test(value))
    tone = "teal";
  return (
    <span className={`status ${tone}`}>
      {value}
      {text && !stateKnown(text) && <small> · 未识别</small>}
    </span>
  );
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <IconButton label="关闭" onClick={close}>
          <X size={18} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function ProjectForm({
  project,
  close,
  submit,
}: {
  project?: Project;
  close: () => void;
  submit: (name: string, root: string, config: ScanConfig) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name || "");
  const [root, setRoot] = useState(project?.root || "");
  const [config, setConfig] = useState<ScanConfig>(
    project?.config || {
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
    },
  );
  const [confirmed, setConfirmed] = useState(Boolean(project));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  async function discover(selectedRoot: string, selectedName?: string) {
    setRoot(selectedRoot);
    setConfirmed(false);
    setBusy(true);
    setError("");
    try {
      const result = await api<Discovery>(
        "/discover",
        { root: selectedRoot },
        "POST",
      );
      // Discovery is only a preview; it never opts the user into PRODUCT reads.
      setConfig({
        ...result.config,
        product: result.config.product
          ? { ...result.config.product, enabled: false }
          : undefined,
      });
      setDiscovery(result);
      setConfirmed(true);
      setName(
        selectedName ||
          selectedRoot.split(/[\\/]/).filter(Boolean).at(-1) ||
          "本地项目",
      );
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  async function previewProduct() {
    setBusy(true);
    setError("");
    try {
      const result = await api<Discovery>(
        "/discover",
        { root, config },
        "POST",
      );
      setDiscovery(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const manifestPath =
    config.product?.manifestPath ?? ".workflow-system/PRODUCT.yaml";
  const productPreview =
    discovery?.product?.path === manifestPath ? discovery.product : undefined;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await submit(name, root, config);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={project ? "项目与扫描范围" : "添加本地项目"}
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={save}>
        <div className="modal-body">
          {!project && !confirmed && (
            <ProjectPicker
              disabled={busy}
              choose={(selected, label) => void discover(selected, label)}
            />
          )}
          {(project || root) && (
            <label>
              项目绝对路径
              <input
                required
                value={root}
                readOnly
                placeholder="E:\\coding\\我的项目"
              />
            </label>
          )}
          {!project && confirmed && (
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmed(false);
                setRoot("");
                setError("");
              }}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <FolderOpen size={16} />
              )}
              重新选择项目
              <ChevronRight size={15} />
            </button>
          )}
          {confirmed && (
            <>
              <label>
                项目名称
                <input
                  autoFocus={Boolean(project)}
                  required
                  maxLength={120}
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="form-section">
                <h3>文档发现预览</h3>
                {discovery && (
                  <>
                    <RegistrationList report={discovery.navigation} />
                    <CandidateList report={discovery.navigation} />
                  </>
                )}
                <section
                  className="product-config"
                  aria-label="PRODUCT 发现预览"
                >
                  <div className="section-heading">
                    <h3>标准产品文档 PRODUCT</h3>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void previewProduct()}
                    >
                      预览 PRODUCT 范围
                    </button>
                  </div>
                  <code>{manifestPath}</code>
                  {productPreview ? (
                    <>
                      <p>
                        <strong>
                          {productStatusLabels[productPreview.status]}
                        </strong>
                        {productPreview.projectId &&
                          ` · ${productPreview.projectId}`}
                      </p>
                      <dl className="product-fields">
                        <dt>将读取的当前定义</dt>
                        <dd>
                          <pre>
                            {productPreview.managedPaths.join("\n") ||
                              "未获得有效范围"}
                          </pre>
                        </dd>
                        <dt>明确引用来源许可</dt>
                        <dd>
                          <pre>
                            {productPreview.sourcePaths.join("\n") || "无"}
                          </pre>
                          <small>
                            仅读取条目直接引用的具体文件，不递归扫描来源目录。
                          </small>
                        </dd>
                      </dl>
                      {productPreview.maintenance === "paused" && (
                        <p className="muted">维护已暂停，但允许只读查看。</p>
                      )}
                      {productPreview.diagnostics.map((entry, i) => (
                        <p className="warning-text" key={i}>
                          {entry.code} · {entry.message}
                        </p>
                      ))}
                    </>
                  ) : (
                    <p className="muted">
                      先预览所选入口，核对将读取的范围。预览不会启用或发布产品快照。
                    </p>
                  )}
                  <label className="checkbox-label">
                    <input
                      aria-label="启用标准产品文档读取"
                      type="checkbox"
                      checked={Boolean(config.product?.enabled)}
                      disabled={
                        busy || (!productPreview && !config.product?.enabled)
                      }
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          product: {
                            enabled: event.target.checked,
                            manifestPath,
                          },
                        })
                      }
                    />
                    我已核对范围，启用标准产品文档读取
                  </label>
                  <p className="muted">
                    与通用自动发现、records 开关独立。
                    {project
                      ? "保存配置后需手动刷新才能生效。"
                      : "仅勾选后，添加并扫描才会读取 PRODUCT 登记的当前定义和精确来源。"}
                  </p>
                </section>
                <details className="advanced-scope" open={Boolean(project)}>
                  <summary>高级扫描设置</summary>
                  <label>
                    PRODUCT 入口相对路径
                    <input
                      aria-label="PRODUCT 入口相对路径"
                      value={manifestPath}
                      disabled={busy}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          product: {
                            enabled: false,
                            manifestPath: event.target.value,
                          },
                        })
                      }
                    />
                    <small>
                      一次只使用一个入口。更换路径后请重新预览并明确启用。
                    </small>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={Boolean(config.autoDiscover)}
                      disabled={busy}
                      onChange={(e) =>
                        setConfig({ ...config, autoDiscover: e.target.checked })
                      }
                    />
                    刷新时从 vNext 文档入口自动发现
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={Boolean(config.includeRecords)}
                      disabled={busy}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          includeRecords: event.target.checked,
                        })
                      }
                    />
                    允许读取 records 目录中的 Markdown / YAML 文档
                  </label>
                  {config.autoDiscover && (
                    <label>
                      候选文档盘点目录（每行一个项目相对目录）
                      <textarea
                        rows={2}
                        value={(
                          config.candidateRoots ?? ["docs", "TASKS"]
                        ).join("\n")}
                        disabled={busy}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            candidateRoots: event.target.value.split("\n"),
                          })
                        }
                      />
                      <small>
                        仅列出未登记文件；清空后停用候选盘点。盘点不会将文件自动登记为需求或设计。
                      </small>
                    </label>
                  )}
                  <p className="muted">
                    {config.autoDiscover
                      ? "以下规则补充或覆盖自动分类；排除规则优先。"
                      : "仅扫描以下手动范围。"}
                  </p>
                  {discovery?.warnings.map((w, i) => (
                    <p key={i} className="warning-text">
                      {w.message}
                    </p>
                  ))}
                  <div className="rule-fields">
                    {kinds.map((kind) => (
                      <label key={kind}>
                        {kindLabels[kind]}文档
                        <textarea
                          rows={kind === "management" ? 5 : 2}
                          value={config.rules[kind].join("\n")}
                          disabled={busy}
                          placeholder={
                            kind === "requirements"
                              ? "docs/requirements.md"
                              : kind === "design"
                                ? "docs/design/**/*.md"
                                : ""
                          }
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              rules: {
                                ...config.rules,
                                [kind]: e.target.value.split("\n"),
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    排除规则
                    <textarea
                      rows={2}
                      value={config.excludes.join("\n")}
                      disabled={busy}
                      placeholder="docs/workflow/generated/**"
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          excludes: e.target.value.split("\n"),
                        })
                      }
                    />
                  </label>
                  <p className="muted">
                    固定跳过 .git、node_modules、构建产物、.vnext、journal
                    和符号链接；通用发现读取 Markdown / YAML，PRODUCT 或
                    adopted-plan 的精确来源可包括 JSON / TXT。 records
                    默认跳过，可通过上方选项允许；允许后仍需通过文档导航或手动规则纳入正文扫描。
                  </p>
                </details>
              </div>
            </>
          )}
          {error && (
            <div className="error-message" role="alert">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button className="primary" disabled={!confirmed || busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : project ? (
              <Save size={16} />
            ) : (
              <Plus size={16} />
            )}
            {project ? "保存配置" : "添加并扫描"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
