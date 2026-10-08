import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  FileText,
  ListTodo,
  Network,
  Search,
} from "lucide-react";
import {
  kinds,
  documentKinds,
  kindLabels,
  type Entry,
  type Relation,
  type Snapshot,
  type SourceRef,
} from "../shared/types";
import {
  Empty,
  EntryList,
  SourceButton,
  Status,
  type OpenSource,
} from "./components";
import { DocumentReader } from "./reader";
import { NavigationAudit } from "./navigation-audit";

const methodLabels = {
  structured: "结构化引用",
  markdown: "链接引用",
  "task-number": "编号提及",
};
export const relationLabels: Record<Relation["state"], string> = {
  resolved: "已定位",
  outside: "未纳入扫描",
  available: "文件存在，未纳入扫描",
  missing: "引用路径不存在",
  excluded: "已排除",
  example: "示例或占位路径",
  "section-missing": "章节无法唯一定位",
  unavailable: "扫描目标缺失或不可读",
  external: "外部引用（未读取）",
  ambiguous: "任务编号有歧义",
  unsafe: "不安全或越界引用",
};
export function documentSource(
  snapshot: Snapshot,
  id: string,
  line = 1,
): SourceRef | null {
  const document = snapshot.documents.find((d) => d.id === id);
  return document
    ? {
        documentId: id,
        path: document.path,
        line,
        section: document.headings.find((h) => h.line === line)?.title || null,
        digest: document.digest,
      }
    : null;
}
export function RelationList({
  relations,
  snapshot,
  open,
  openTask,
  highlight = [],
}: {
  relations: Relation[];
  snapshot: Snapshot;
  open: OpenSource;
  openTask?: (id: string) => void;
  highlight?: string[];
}) {
  if (!relations.length)
    return <p className="muted missing">扫描范围内未发现显式关联</p>;
  return (
    <ul className="relation-list">
      {relations.map((relation) => {
        const task = snapshot.tasks.find((t) => t.id === relation.to);
        const target =
          relation.to &&
          documentSource(snapshot, relation.to, relation.targetLine || 1);
        return (
          <li
            key={relation.id}
            className={highlight.includes(relation.id) ? "highlight" : ""}
          >
            <div className="relation-main">
              <span className="relation-method">
                {methodLabels[relation.method]}
              </span>
              {target ? (
                <button className="text-link" onClick={() => open(target)}>
                  {relation.label}
                  {relation.section && <small> / {relation.section}</small>}
                  <ArrowRight size={13} />
                </button>
              ) : task && openTask ? (
                <button className="text-link" onClick={() => openTask(task.id)}>
                  {task.number} · {task.title}
                  <ArrowRight size={13} />
                </button>
              ) : (
                <span>{relation.label}</span>
              )}
              <span
                className={`status ${relation.state === "resolved" ? "neutral" : "amber"}`}
              >
                {relationLabels[relation.state]}
              </span>
            </div>
            <p className="relation-path">
              {relation.targetPath || relation.raw}
              {relation.revision && (
                <span> · 声明版本：{relation.revision}</span>
              )}
            </p>
            <SourceButton source={relation.source} open={open} />
            {relation.method === "structured" && (
              <details>
                <summary>原始引用</summary>
                <pre>{relation.raw}</pre>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
function SnapshotDiagnostics({
  snapshot,
  open,
}: {
  snapshot: Snapshot;
  open: OpenSource;
}) {
  return (
    <div className="diagnostics">
      <details open={snapshot.warnings.length > 0}>
        <summary>
          <AlertTriangle size={16} />
          扫描提示 <span>{snapshot.warnings.length}</span>
        </summary>
        {snapshot.warnings.length === 0 ? (
          <p className="muted">本次扫描未报告异常。</p>
        ) : (
          <ul className="warning-list">
            {snapshot.warnings.map((warning, i) => {
              const document = snapshot.documents.find(
                (d) => d.path === warning.path,
              );
              const source =
                document &&
                documentSource(snapshot, document.id, warning.line || 1);
              return (
                <li key={i}>
                  <span>{warning.message}</span>
                  {source ? (
                    <SourceButton source={source} open={open} />
                  ) : (
                    warning.path && (
                      <code>
                        {warning.path}
                        {warning.line && `:${warning.line}`}
                      </code>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </details>
      <details>
        <summary>
          <FileText size={16} />
          本快照的扫描范围 <span>{snapshot.files.length}</span>
        </summary>
        <div className="scope-rules">
          {documentKinds.map((kind) => (
            <div key={kind}>
              <strong>{kindLabels[kind]}</strong>
              <code>
                {snapshot.effectiveRules[kind].join("\n") || "未发现"}
              </code>
            </div>
          ))}
          <div>
            <strong>排除</strong>
            <code>{snapshot.config.excludes.join("\n") || "无自定义排除"}</code>
          </div>
          <p className="muted">
            固定跳过依赖、构建产物、.git、records、journal、符号链接。Profile
            如存在则作为管理配置读取。
          </p>
        </div>
        <table className="scope-table">
          <thead>
            <tr>
              <th>实际路径</th>
              <th>类型</th>
              <th>读取结果</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.files.map((file, i) => (
              <tr key={i}>
                <td>
                  <code>{file.path}</code>
                  {file.detail && <small>{file.detail}</small>}
                </td>
                <td>{kindLabels[file.kind]}</td>
                <td>
                  {
                    {
                      read: "已读取",
                      missing: "缺失",
                      error: "读取失败",
                      skipped: "跳过",
                    }[file.status]
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!snapshot.files.length && (
          <p className="muted">配置范围内无匹配文件。</p>
        )}
      </details>
    </div>
  );
}
export function Overview({
  snapshot,
  open,
  openTask,
  projectName,
  root,
}: {
  snapshot: Snapshot;
  open: OpenSource;
  openTask: (id: string) => void;
  projectName: string;
  root: string;
}) {
  const current = snapshot.tasks.filter((t) => t.current);
  const currentStatements = snapshot.statements.filter(
    (s) => s.kind === "currentTask",
  );
  const currentStep = snapshot.statements.filter(
    (s) => s.kind === "currentStep",
  );
  const checked = current
    .flatMap((t) => t.checks)
    .filter((e) => e.checked !== null);
  const groups = [
    { kind: "achievement", label: "已记录的成果" },
    { kind: "todo", label: "待办与交接" },
    { kind: "risk", label: "风险" },
    { kind: "planning", label: "后续规划" },
  ] as const;
  return (
    <div className="overview">
      <div className="page-title">
        <h2>项目概览</h2>
        <span className="muted">来自当前扫描范围的文档记录</span>
      </div>
      <div className="overview-facts">
        <span>
          <BookOpen size={17} />
          <strong>{snapshot.documents.length}</strong>份文档
        </span>
        <span>
          <ListTodo size={17} />
          <strong>{snapshot.tasks.length}</strong>个任务记录
        </span>
        <span>
          <Network size={17} />
          <strong>{snapshot.relations.length}</strong>条显式引用
        </span>
        <span>
          当前验收清单：
          {checked.length
            ? `已勾选 ${checked.filter((e) => e.checked).length}/${checked.length} 项`
            : "未记录"}
        </span>
      </div>
      <section className="current-section">
        <div className="section-heading">
          <h3>当前任务</h3>
          <span className="section-label">CURRENT</span>
        </div>
        {current.length ? (
          current.map((task) => (
            <div className="current-task" key={task.id}>
              <div className="current-task-head">
                <button
                  className="task-title-link"
                  onClick={() => openTask(task.id)}
                >
                  <span className="task-number">
                    {task.number || "未记录编号"}
                  </span>
                  <strong>{task.title}</strong>
                  <ArrowRight size={18} />
                </button>
                {task.statuses.map((s, i) => (
                  <Status key={i} text={s.text} />
                ))}
              </div>
              <EntryList entries={task.goals} open={open} />
              <SourceButton source={task.source} open={open} />
            </div>
          ))
        ) : (
          <EntryList
            entries={currentStatements}
            open={open}
            empty="未记录当前任务"
          />
        )}
        <div className="current-step">
          <h4>当前步骤</h4>
          <EntryList
            entries={currentStep}
            open={open}
            empty="未记录当前步骤"
            compact
          />
        </div>
        <h4>扫描文档的状态声明</h4>
        <ul className="status-declarations">
          {snapshot.statements
            .filter((s) => s.kind === "status")
            .map((s, i) => (
              <li key={i}>
                <Status text={s.text} />
                <SourceButton source={s.source} open={open} />
              </li>
            ))}
        </ul>
        {!snapshot.statements.some((s) => s.kind === "status") && (
          <p className="muted missing">未记录项目状态</p>
        )}
      </section>
      <div className="overview-columns">
        {groups.map((group) => (
          <section key={group.kind}>
            <h3>{group.label}</h3>
            <CollapsibleEntries
              entries={snapshot.statements.filter((s) => s.kind === group.kind)}
              open={open}
            />
          </section>
        ))}
      </div>
      {!snapshot.documents.length && (
        <div className="banner">
          <FileText size={18} />
          <span>
            扫描范围内没有可读文档，请查看范围与缺失项，调整配置后刷新。
          </span>
        </div>
      )}
      <NavigationAudit
        snapshot={snapshot}
        projectName={projectName}
        root={root}
        open={open}
      />
      <SnapshotDiagnostics snapshot={snapshot} open={open} />
    </div>
  );
}
function CollapsibleEntries({
  entries,
  open,
}: {
  entries: Entry[];
  open: OpenSource;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <EntryList
        entries={expanded ? entries : entries.slice(0, 5)}
        open={open}
      />
      {entries.length > 5 && (
        <button className="text-link" onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : `查看其余 ${entries.length - 5} 条`}
        </button>
      )}
    </>
  );
}
export function TasksPage({
  snapshot,
  selected,
  select,
  open,
  relations,
}: {
  snapshot: Snapshot;
  selected?: string;
  select: (id: string) => void;
  open: OpenSource;
  relations: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const task =
    snapshot.tasks.find((t) => t.id === selected) ||
    snapshot.tasks.find((t) => t.current) ||
    snapshot.tasks[0];
  const filtered = snapshot.tasks.filter(
    (t) =>
      `${t.title} ${t.number || ""} ${t.source.path}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" || (filter === "current" ? t.current : !t.current)),
  );
  return (
    <div className="browser-page">
      <div className="browser-list">
        <div className="list-header">
          <h2>
            任务 <small>{snapshot.tasks.length}</small>
          </h2>
          <div className="search">
            <Search size={15} />
            <input
              aria-label="搜索任务"
              placeholder="标题、编号或路径"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="segmented">
            {[
              ["all", "全部"],
              ["current", "当前"],
              ["history", "历史记录"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="list-items">
          {filtered.map((t) => (
            <button
              key={t.id}
              className={`task-item ${task?.id === t.id ? "selected" : ""}`}
              onClick={() => select(t.id)}
            >
              <div>
                <span className="task-number">{t.number || "未记录编号"}</span>
                {t.current && <span className="tiny-label">当前</span>}
              </div>
              <strong>{t.title}</strong>
              <Status text={t.statuses[0]?.text || null} />
              <small title={t.source.path}>{t.source.path}</small>
            </button>
          ))}
          {!filtered.length && (
            <p className="list-empty">
              {snapshot.tasks.length
                ? "无匹配任务"
                : "未识别到任务记录，可在文档中查看原文"}
            </p>
          )}
        </div>
      </div>
      <div className="browser-detail">
        {task ? (
          <article className="task-detail">
            <div className="detail-heading">
              <div>
                <span className="task-number">
                  {task.number || "未记录编号"}
                </span>
                <h2>{task.title}</h2>
              </div>
              <button className="secondary" onClick={() => relations(task.id)}>
                <Network size={16} />
                关联
              </button>
            </div>
            <SourceButton source={task.source} open={open} />
            <section>
              <h3>文档声明的状态</h3>
              {task.statuses.length ? (
                <ul className="status-declarations">
                  {task.statuses.map((s, i) => (
                    <li key={i}>
                      <Status text={s.text} />
                      <SourceButton source={s.source} open={open} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">未记录</p>
              )}
            </section>
            {(
              [
                { key: "goals", label: "目标" },
                { key: "steps", label: "实施步骤" },
                { key: "checks", label: "验收清单" },
                { key: "issues", label: "问题与待确认项" },
              ] as const
            ).map((group) => (
              <section key={group.key}>
                <div className="section-heading">
                  <h3>{group.label}</h3>
                  {group.key === "checks" &&
                    task.checks.some((c) => c.checked !== null) && (
                      <span className="muted">
                        已勾选 {task.checks.filter((c) => c.checked).length}/
                        {task.checks.filter((c) => c.checked !== null).length}{" "}
                        项
                      </span>
                    )}
                </div>
                <EntryList entries={task[group.key]} open={open} />
              </section>
            ))}
            <section>
              <h3>引用与提及</h3>
              <RelationList
                snapshot={snapshot}
                relations={snapshot.relations.filter((r) => r.from === task.id)}
                open={open}
                openTask={select}
              />
            </section>
          </article>
        ) : (
          <Empty title="尚无任务记录" detail="已读取的文档仍可在文档页核对。" />
        )}
      </div>
    </div>
  );
}
export function DocumentsPage({
  snapshot,
  selected,
  line,
  select,
  open,
  openTask,
  relations,
}: {
  snapshot: Snapshot;
  selected?: string;
  line?: number;
  select: (id: string, line?: number) => void;
  open: OpenSource;
  openTask: (id: string) => void;
  relations: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const doc =
    snapshot.documents.find((d) => d.id === selected) || snapshot.documents[0];
  useEffect(() => {
    if (doc && selected === doc.id) {
      setKind("all");
      setQuery("");
    }
  }, [selected, doc?.id]);
  const filtered = snapshot.documents.filter(
    (d) =>
      (kind === "all" || d.kind === kind) &&
      `${d.title} ${d.path}`.toLowerCase().includes(query.toLowerCase()),
  );
  const task = snapshot.tasks.find((t) => t.source.documentId === doc?.id);
  const incoming = snapshot.relations.filter((r) => r.to === doc?.id);
  const outgoing = snapshot.relations.filter(
    (r) => r.from === doc?.id || r.from === task?.id,
  );
  return (
    <div className="browser-page documents-page">
      <div className="browser-list">
        <div className="list-header">
          <h2>
            文档 <small>{snapshot.documents.length}</small>
          </h2>
          <div className="search">
            <Search size={15} />
            <input
              aria-label="搜索文档"
              placeholder="标题或路径"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="文档类型"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">全部类型</option>
            {documentKinds.map((k) => (
              <option key={k} value={k}>
                {kindLabels[k]}文档
              </option>
            ))}
          </select>
        </div>
        <div className="list-items">
          {filtered.map((d) => (
            <button
              key={d.id}
              className={`document-item ${doc?.id === d.id ? "selected" : ""}`}
              onClick={() => select(d.id)}
            >
              <span className="doc-kind">{kindLabels[d.kind]}</span>
              <strong>{d.title}</strong>
              <small>{d.path}</small>
              {!d.recognized && (
                <span className="tiny-label">未识别结构 · 原文可读</span>
              )}
            </button>
          ))}
          {!filtered.length && <p className="list-empty">无匹配文档</p>}
        </div>
      </div>
      <div className="browser-detail">
        {doc ? (
          <>
            <DocumentReader
              document={doc}
              snapshot={snapshot}
              line={line || 1}
              open={open}
              relations={() => relations(task?.id || doc.id)}
            />
            <div className="document-relations">
              <section>
                <h3>引用此文档的任务与文档</h3>
                {incoming.length ? (
                  <ul className="backlinks">
                    {incoming.map((r) => {
                      const originTask = snapshot.tasks.find(
                        (t) => t.id === r.from,
                      );
                      const originDoc = snapshot.documents.find(
                        (d) => d.id === r.from,
                      );
                      return (
                        <li key={r.id}>
                          <button
                            className="text-link"
                            onClick={() =>
                              originTask
                                ? openTask(originTask.id)
                                : open(r.source)
                            }
                          >
                            {originTask
                              ? `${originTask.number || ""} · ${originTask.title}`
                              : originDoc?.title || r.source.path}
                            <ArrowRight size={14} />
                          </button>
                          <span>
                            {r.method === "task-number" ? "提及" : "引用"}
                            {r.section && ` / ${r.section}`}
                          </span>
                          <SourceButton source={r.source} open={open} />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted">扫描范围内未发现显式关联</p>
                )}
              </section>
              <section>
                <h3>此文档的引用与提及</h3>
                <RelationList
                  snapshot={snapshot}
                  relations={outgoing}
                  open={open}
                  openTask={openTask}
                />
              </section>
            </div>
          </>
        ) : (
          <Empty
            title="扫描范围内无文档"
            detail="在配置中确认文档路径，再手动刷新。"
          />
        )}
      </div>
    </div>
  );
}
