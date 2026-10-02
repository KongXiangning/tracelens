import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  LayoutDashboard,
  ListTodo,
  BookOpen,
  Network,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  AlertTriangle,
  LoaderCircle,
  X,
  CheckCircle2,
} from "lucide-react";
import { api, session } from "./api";
import { Empty, IconButton, Modal, ProjectForm } from "./components";
import { Overview, TasksPage, DocumentsPage } from "./pages";
import type {
  Project,
  ScanConfig,
  SnapshotView,
  SourceRef,
} from "../shared/types";

type Page = "overview" | "tasks" | "documents" | "relations";
const RelationsPage = lazy(() =>
  import("./relations").then((module) => ({ default: module.RelationsPage })),
);
const pages = [
  { id: "overview", name: "概览", icon: LayoutDashboard },
  { id: "tasks", name: "任务", icon: ListTodo },
  { id: "documents", name: "文档", icon: BookOpen },
  { id: "relations", name: "关联", icon: Network },
] as const;
export const time = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "尚未扫描";
const cleanConfig = (config: ScanConfig): ScanConfig => ({
  autoDiscover: config.autoDiscover,
  rules: Object.fromEntries(
    Object.entries(config.rules).map(([kind, rules]) => [
      kind,
      rules.map((r) => r.trim()).filter(Boolean),
    ]),
  ) as ScanConfig["rules"],
  excludes: config.excludes.map((r) => r.trim()).filter(Boolean),
});
function scanState(view?: SnapshotView): { label: string; tone: string } {
  if (view?.attempt?.state === "scanning")
    return { label: "正在扫描，当前内容保持可读", tone: "busy" };
  if (view?.attempt?.state === "failed")
    return { label: "本次刷新失败", tone: "failed" };
  if (view?.snapshot?.outcome === "partial")
    return { label: "部分成功", tone: "partial" };
  if (view?.snapshot) return { label: "扫描完成", tone: "success" };
  return { label: "尚未扫描", tone: "" };
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState("");
  const [views, setViews] = useState<Record<string, SnapshotView>>({});
  const [page, setPage] = useState<Page>("overview");
  const [loading, setLoading] = useState(true);
  const [loadingView, setLoadingView] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<"add" | "edit" | null>(null);
  const [remove, setRemove] = useState(false);
  const [dataDir, setDataDir] = useState("");
  const [selection, setSelection] = useState<{
    task?: string;
    doc?: string;
    line?: number;
    relation?: string;
  }>({});
  const mounted = useRef(true);
  const project = projects.find((p) => p.id === active);
  const view = views[active];
  const snapshot = view?.snapshot;
  const scanning = view?.attempt?.state === "scanning";
  const configChanged = Boolean(
    snapshot && project && snapshot.configVersion !== project.configVersion,
  );
  const scan = scanState(view);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const info = await session();
      setDataDir(info.dataDir);
      const list = await api<Project[]>("/projects");
      setProjects(list);
      setActive((previous) =>
        list.some((p) => p.id === previous) ? previous : list[0]?.id || "",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoadingView(true);
    api<SnapshotView>(`/projects/${active}/snapshot`)
      .then((result) => {
        if (!cancelled) setViews((v) => ({ ...v, [active]: result }));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingView(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => {
      void api<SnapshotView>(`/projects/${active}/snapshot`)
        .then((result) => {
          if (mounted.current) setViews((v) => ({ ...v, [active]: result }));
        })
        .catch((e) => setError(e.message));
    }, 800);
    return () => clearInterval(timer);
  }, [active, scanning]);
  useEffect(() => {
    setSelection((s) => ({ ...s, line: 1 }));
  }, [snapshot?.id]);
  async function refresh(id = active) {
    setError("");
    setViews((v) => ({
      ...v,
      [id]: {
        snapshot: v[id]?.snapshot || null,
        configChanged: v[id]?.configChanged || false,
        attempt: { state: "scanning", startedAt: new Date().toISOString() },
      },
    }));
    try {
      const result = await api<SnapshotView>(
        `/projects/${id}/refresh`,
        {},
        "POST",
      );
      setViews((v) => ({ ...v, [id]: result }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setViews((v) => ({
        ...v,
        [id]: {
          ...v[id],
          attempt: {
            state: "failed",
            startedAt: v[id]?.attempt?.startedAt || new Date().toISOString(),
            completedAt: new Date().toISOString(),
            error: message,
          },
        },
      }));
    }
  }
  async function saveProject(name: string, root: string, config: ScanConfig) {
    if (form === "edit" && project) {
      const result = await api<Project>(
        `/projects/${project.id}`,
        { name, config: cleanConfig(config) },
        "PATCH",
      );
      setProjects((p) =>
        p.map((item) => (item.id === result.id ? result : item)),
      );
    } else {
      const result = await api<Project>(
        "/projects",
        { name, root, config: cleanConfig(config) },
        "POST",
      );
      setProjects((p) => [...p, result]);
      setActive(result.id);
      setPage("overview");
      setSelection({});
      // Registration is complete before scanning; a failed first scan still has a manageable project.
      void refresh(result.id);
    }
  }
  async function removeProject() {
    if (!project) return;
    try {
      await api(`/projects/${project.id}`, {}, "DELETE");
      const next = projects.filter((p) => p.id !== project.id);
      setProjects(next);
      setActive(next[0]?.id || "");
      setRemove(false);
      setSelection({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRemove(false);
    }
  }
  function openSource(source: SourceRef) {
    setSelection((s) => ({ ...s, doc: source.documentId, line: source.line }));
    setPage("documents");
  }
  function openTask(id: string) {
    setSelection((s) => ({ ...s, task: id }));
    setPage("tasks");
  }
  function openRelations(id: string) {
    setSelection((s) => ({ ...s, relation: id }));
    setPage("relations");
  }
  function renderContent() {
    if (loading)
      return (
        <Empty
          title="正在连接本地服务"
          action={<LoaderCircle className="spin" />}
        />
      );
    if (!project)
      return (
        <Empty
          title="添加你的第一个项目"
          detail="输入本地目录，确认管理、需求、设计与规划文档的读取范围。"
          action={
            <button className="primary" onClick={() => setForm("add")}>
              <Plus size={16} />
              添加项目
            </button>
          }
        />
      );
    if (loadingView && !view)
      return (
        <Empty
          title="正在读取快照"
          action={<LoaderCircle className="spin" />}
        />
      );
    if (!snapshot) {
      let title = "尚未扫描";
      if (scanning) title = "首次扫描中";
      else if (view?.attempt?.state === "failed") title = "扫描未完成";
      return (
        <Empty
          title={title}
          detail={
            scanning
              ? "扫描完成后在此显示文档记录。"
              : "项目和扫描范围已登记，刷新后查看内容。"
          }
          action={
            <button
              disabled={scanning}
              className="primary"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
              {scanning ? "扫描中" : "扫描文档"}
            </button>
          }
        />
      );
    }
    switch (page) {
      case "overview":
        return (
          <Overview
            snapshot={snapshot}
            open={openSource}
            openTask={openTask}
            projectName={project?.name || "本地项目"}
            root={project?.root || ""}
          />
        );
      case "tasks":
        return (
          <TasksPage
            key={active}
            snapshot={snapshot}
            selected={selection.task}
            select={(id) => setSelection((s) => ({ ...s, task: id }))}
            open={openSource}
            relations={openRelations}
          />
        );
      case "documents":
        return (
          <DocumentsPage
            key={active}
            snapshot={snapshot}
            selected={selection.doc}
            line={selection.line}
            select={(id, line = 1) =>
              setSelection((s) => ({ ...s, doc: id, line }))
            }
            open={openSource}
            openTask={openTask}
            relations={openRelations}
          />
        );
      case "relations":
        return (
          <Suspense
            fallback={
              <Empty
                title="正在加载关联"
                action={<LoaderCircle className="spin" />}
              />
            }
          >
            <RelationsPage
              key={`${active}:${snapshot.id}`}
              snapshot={snapshot}
              selected={selection.relation}
              select={(id) => setSelection((s) => ({ ...s, relation: id }))}
              open={openSource}
              openTask={openTask}
            />
          </Suspense>
        );
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Activity size={22} />
          </span>
          <span>
            TraceLens<small>本地文档工作台</small>
          </span>
        </div>
        <div className="sidebar-label">
          <span>项目</span>
          <IconButton label="添加项目" onClick={() => setForm("add")}>
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="project-list">
          {projects.map((p) => (
            <button
              key={p.id}
              title={p.root}
              className={`project-item ${active === p.id ? "selected" : ""}`}
              onClick={() => {
                setActive(p.id);
                setPage("overview");
                setSelection({});
                setError("");
              }}
            >
              <span className="project-dot" />
              <span>{p.name}</span>
            </button>
          ))}
          {!projects.length && <p className="sidebar-empty">尚无项目</p>}
        </div>
        <nav aria-label="主导航">
          {pages.map((p) => (
            <button
              key={p.id}
              className={page === p.id ? "active" : ""}
              onClick={() => setPage(p.id)}
            >
              <p.icon size={18} />
              <span>{p.name}</span>
              {page === p.id && <span className="nav-line" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="online-dot" />
          本机 · 只读<small title={dataDir}>登记保存在本机</small>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="project-heading">
            <h1>{project?.name || "TraceLens"}</h1>
            <p title={project?.root}>{project?.root || "本地项目文档"}</p>
          </div>
          {project && (
            <div className="toolbar">
              <IconButton label="配置扫描范围" onClick={() => setForm("edit")}>
                <Settings2 size={18} />
              </IconButton>
              <IconButton
                label="移除项目"
                onClick={() => setRemove(true)}
                disabled={scanning}
              >
                <Trash2 size={17} />
              </IconButton>
              <button
                className="primary"
                disabled={scanning}
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} className={scanning ? "spin" : ""} />
                {scanning ? "扫描中" : "刷新"}
              </button>
            </div>
          )}
        </header>
        {error && (
          <div className="banner error" role="alert">
            <AlertTriangle size={17} />
            <span>{error}</span>
            <IconButton label="关闭提示" onClick={() => setError("")}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        {project && (
          <div className="scan-strip" role="status">
            <span className={`scan-indicator ${scan.tone}`} />
            <span>{scan.label}</span>
            <span className="scan-time">
              {snapshot
                ? `展示快照 · ${time(snapshot.completedAt)}`
                : "手动刷新后读取文档"}
            </span>
            {configChanged && (
              <span className="status amber">配置已变更，需刷新</span>
            )}
          </div>
        )}
        {view?.attempt?.state === "failed" && (
          <div className="banner error" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>{view.attempt.error}</strong>
              <p>
                尝试时间：{time(view.attempt.completedAt)}。
                {snapshot
                  ? `已保留上次快照（${time(snapshot.completedAt)}）。`
                  : "没有可展示的旧快照，请修正后刷新。"}
              </p>
            </div>
          </div>
        )}
        <div className="page-content">
          {renderContent()}
          {loading === false && error && !projects.length && (
            <button className="secondary retry" onClick={() => void load()}>
              <RefreshCw size={16} />
              重新连接
            </button>
          )}
        </div>
        <footer className="workspace-footer">
          <CheckCircle2 size={13} />
          <span>文档记录的状态</span>
          {snapshot && (
            <span>
              快照 {snapshot.id.slice(0, 8)} · {snapshot.documents.length}{" "}
              份文档
            </span>
          )}
        </footer>
      </main>
      {form && (
        <ProjectForm
          project={form === "edit" ? project : undefined}
          close={() => setForm(null)}
          submit={saveProject}
        />
      )}
      {remove && project && (
        <Modal title="移除项目登记" close={() => setRemove(false)}>
          <div className="modal-body">
            <p>
              移除「{project.name}」在 TraceLens
              中的登记与快照？项目文件会保留。
            </p>
          </div>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setRemove(false)}>
              取消
            </button>
            <button className="danger" onClick={() => void removeProject()}>
              <Trash2 size={16} />
              移除登记
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
