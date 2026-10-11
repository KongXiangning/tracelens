import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
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
  BookOpenCheck,
  Target,
  Route,
  Search,
} from "lucide-react";
import { api, session } from "./api";
import { Empty, IconButton, Modal, ProjectForm } from "./components";
import { Overview, TasksPage, DocumentsPage } from "./pages";
import { VNextGuide } from "./vnext-guide";
import { RuntimeStatus, RuntimeTrustPanel } from "./runtime";
import { navigationScrollContainer } from "./navigation-scroll";
import type {
  Project,
  ScanConfig,
  SnapshotView,
  SourceRef,
} from "../shared/types";

type Page =
  | "overview"
  | "requirements"
  | "planning"
  | "tasks"
  | "documents"
  | "relations"
  | "guide";
const RelationsPage = lazy(() =>
  import("./relations").then((module) => ({ default: module.RelationsPage })),
);
const RequirementsPage = lazy(() =>
  import("./product").then((module) => ({ default: module.RequirementsPage })),
);
const PlanningPage = lazy(() =>
  import("./product").then((module) => ({ default: module.PlanningPage })),
);
const ProductOverview = lazy(() =>
  import("./product").then((module) => ({ default: module.ProductOverview })),
);
function ProductLoading() {
  return (
    <Empty
      title="正在读取产品视图"
      action={<LoaderCircle className="spin" />}
    />
  );
}
const pages = [
  { id: "overview", name: "概览", icon: LayoutDashboard },
  { id: "requirements", name: "需求", icon: Target },
  { id: "planning", name: "规划", icon: Route },
  { id: "tasks", name: "任务", icon: ListTodo },
  { id: "documents", name: "文档", icon: BookOpen },
  { id: "relations", name: "关联", icon: Network },
  { id: "guide", name: "vNext 使用说明", icon: BookOpenCheck },
] as const;
const overviewPages = [
  { id: "overview", name: "项目总览", icon: LayoutDashboard },
  { id: "requirements", name: "需求视图", icon: Network },
  { id: "tasks", name: "Task 视图", icon: ListTodo },
  { id: "documents", name: "文档来源", icon: BookOpen },
  { id: "relations", name: "搜索", icon: Search },
  { id: "guide", name: "vNext 使用说明", icon: BookOpenCheck },
] as const;
export const time = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "尚未扫描";
const cleanConfig = (config: ScanConfig): ScanConfig => ({
  readingMode: config.readingMode,
  product: config.product
    ? {
        enabled: config.product.enabled,
        manifestPath: config.product.manifestPath.trim(),
      }
    : undefined,
  autoDiscover: config.autoDiscover,
  includeRecords: config.includeRecords,
  candidateRoots: config.candidateRoots?.map((r) => r.trim()).filter(Boolean),
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
    return { label: "读取完成，有待核对项", tone: "partial" };
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
  const [paging, setPaging] = useState(false);
  const [form, setForm] = useState<"add" | "edit" | null>(null);
  const [remove, setRemove] = useState(false);
  const [dataDir, setDataDir] = useState("");
  const [selection, setSelection] = useState<{
    task?: string;
    taskRealId?: string | null;
    doc?: string;
    line?: number;
    relation?: string;
    relationRealId?: string | null;
    product?: string;
    plan?: string;
    work?: string;
  }>({});
  const [backStack, setBackStack] = useState<
    { page: Page; selection: typeof selection; scroll: number }[]
  >([]);
  useEffect(() => {
    setBackStack([]);
  }, [active]);
  function remember() {
    setBackStack((v) => [
      ...v.slice(-19),
      {
        page,
        selection,
        scroll: navigationScrollContainer()?.scrollTop || 0,
      },
    ]);
  }
  function back() {
    const previous = backStack.at(-1);
    if (!previous) return;
    setBackStack((v) => v.slice(0, -1));
    setSelection(previous.selection);
    setPage(previous.page);
    setTimeout(() => {
      const container = navigationScrollContainer();
      if (container) container.scrollTop = previous.scroll;
    }, 100);
  }
  const mounted = useRef(true);
  const refreshGenerations = useRef<Record<string, number>>({});
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
    refreshGenerations.current[id] = (refreshGenerations.current[id] || 0) + 1;
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
      void refresh(result.id);
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
    remember();
    setSelection((s) => ({ ...s, doc: source.documentId, line: source.line }));
    setPage("documents");
  }
  function openTask(id: string) {
    remember();
    setSelection((s) => ({
      ...s,
      task: id,
      taskRealId:
        snapshot?.tasks.find((task) => task.id === id)?.realTaskId ?? null,
    }));
    setPage("tasks");
  }
  function openRelations(id: string) {
    const task = snapshot?.tasks.find((entry) => entry.id === id);
    setSelection((s) => ({
      ...s,
      relation: id,
      relationRealId: task ? (task.realTaskId ?? null) : undefined,
    }));
    setPage("relations");
  }
  function openProduct(key: string, workItemId?: string) {
    remember();
    const item = snapshot?.product?.items.find((entry) => entry.key === key);
    if (item?.type === "plan") {
      setSelection((s) => ({ ...s, plan: key, work: workItemId }));
      setPage("planning");
    } else {
      setSelection((s) => ({ ...s, product: key }));
      setPage("requirements");
    }
  }
  function renderContent() {
    if (page === "guide") return <VNextGuide />;
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
    const context = {
      snapshot,
      open: openSource,
      openTask,
      openProduct,
      relations: openRelations,
    };
    switch (page) {
      case "requirements":
        return (
          <Suspense fallback={<ProductLoading />}>
            <RequirementsPage
              key={active}
              {...context}
              selected={selection.product}
              select={(key) => setSelection((s) => ({ ...s, product: key }))}
              configure={() => setForm("edit")}
            />
          </Suspense>
        );
      case "planning":
        return (
          <Suspense fallback={<ProductLoading />}>
            <PlanningPage
              {...context}
              selected={selection.plan}
              selectedWork={selection.work}
              select={(key) =>
                setSelection((s) => ({ ...s, plan: key, work: undefined }))
              }
              configure={() => setForm("edit")}
            />
          </Suspense>
        );
      case "overview":
        return (
          <>
            <Suspense
              fallback={
                <p className="product-overview muted" role="status">
                  正在读取产品概况…
                </p>
              }
            >
              <ProductOverview
                key={active}
                context={context}
                configure={() => setForm("edit")}
                requirements={() => setPage("requirements")}
                planning={() => setPage("planning")}
              />
            </Suspense>
            <details
              className="overview-record-details"
              open={
                !snapshot.product?.manifest ||
                !["ready", "partial", "empty"].includes(snapshot.product.status)
              }
            >
              <summary>当前任务、文档记录与扫描详情</summary>
              <Overview
                snapshot={snapshot}
                open={openSource}
                openTask={openTask}
                projectName={project?.name || "本地项目"}
                root={project?.root || ""}
              />
            </details>
          </>
        );
      case "tasks":
        return (
          <TasksPage
            key={active}
            snapshot={snapshot}
            selected={selection.task}
            selectedRealTaskId={selection.taskRealId}
            select={openTask}
            open={openSource}
            relations={openRelations}
            openProduct={openProduct}
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
            openProduct={openProduct}
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
              selectedRealTaskId={selection.relationRealId}
              select={openRelations}
              open={openSource}
              openTask={openTask}
              openProduct={openProduct}
            />
          </Suspense>
        );
    }
  }
  let subtitle = project?.root || "本地项目文档";
  if (page === "guide") subtitle = "业务场景 · Skill 指令 · 使用边界";
  else if (page === "overview")
    subtitle = "从项目文档中解析目标、需求、Task 与状态";
  const overviewVisual = page === "overview" && Boolean(project);
  const navPages = overviewVisual ? overviewPages : pages;
  return (
    <div
      className={`app-shell modern-shell${overviewVisual ? " overview-theme" : ""}`}
    >
      <aside className="sidebar">
        <div className={`brand${overviewVisual ? " overview-brand" : ""}`}>
          {overviewVisual ? (
            <span className="overview-brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span className="brand-icon">
              <LayoutDashboard size={25} />
            </span>
          )}
          <span>
            {overviewVisual ? (
              <span className="overview-brand-name">TraceLens</span>
            ) : (
              <>
                TraceLens<small>本地文档工作台</small>
              </>
            )}
          </span>
        </div>
        {overviewVisual ? (
          <div className="overview-sidebar-caption">WORKSPACE</div>
        ) : (
          <div className="sidebar-label">
            <span>项目</span>
            <IconButton label="添加项目" onClick={() => setForm("add")}>
              <Plus size={17} />
            </IconButton>
          </div>
        )}
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
          {navPages.map((p) => (
            <button
              key={p.id}
              aria-label={p.id === "overview" ? "概览" : p.name}
              className={`${page === p.id ? "active" : ""}${overviewVisual && p.id === "guide" ? " overview-guide-link" : ""}`}
              onClick={() => setPage(p.id as Page)}
            >
              <p.icon size={18} />
              <span className={p.id === "guide" ? "nav-label-full" : undefined}>
                {p.name}
              </span>
              {p.id === "guide" && (
                <span className="nav-label-compact" aria-hidden="true">
                  指南
                </span>
              )}
              {page === p.id && <span className="nav-line" />}
            </button>
          ))}
        </nav>
        {overviewVisual ? (
          <div className="sidebar-footer overview-sidebar-footer">
            <div className="overview-sidebar-caption">CURRENT PROJECT</div>
            <label className="overview-sidebar-project">
              <select
                aria-label="当前项目"
                value={active}
                onChange={(event) => {
                  setActive(event.target.value);
                  setPage("overview");
                  setSelection({});
                  setError("");
                }}
              >
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <small>只读呈现 · 文档驱动</small>
          </div>
        ) : (
          <div className="sidebar-footer">
            <span className="online-dot" />
            本机 · 只读<small title={dataDir}>登记保存在本机</small>
          </div>
        )}
      </aside>
      <main className="workspace">
        {overviewVisual ? (
          <header className="topbar overview-topbar">
            <div className="overview-breadcrumb">
              <strong>TRACELENS</strong>
              <span>/</span>
              <h1 className="overview-breadcrumb-project">
                {project?.name || "当前项目"}
              </h1>
              <span>/</span>
              <span>需求总览</span>
            </div>
            <div className="overview-top-actions">
              <span>从项目文档读取</span>
              <button
                type="button"
                onClick={() => {
                  const source = snapshot?.product?.manifestSource;
                  if (source) openSource(source);
                  else setPage("documents");
                }}
              >
                源文档 ↗
              </button>
            </div>
          </header>
        ) : (
          <header className="topbar">
            <div className="project-heading">
              <h1>
                {page === "guide"
                  ? "vNext 场景指南"
                  : project?.name || "TraceLens"}
              </h1>
              <p title={page === "guide" ? undefined : project?.root}>
                {subtitle}
              </p>
            </div>
            {project && page !== "guide" && (
              <div className="toolbar">
                <IconButton label="项目设置" onClick={() => setForm("edit")}>
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
        )}
        {error && (
          <div className="banner error" role="alert">
            <AlertTriangle size={17} />
            <span>{error}</span>
            <IconButton label="关闭提示" onClick={() => setError("")}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        {project && page !== "guide" && !overviewVisual && (
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
        {page !== "guide" && view?.attempt?.state === "failed" && (
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
        <div className="page-content" key={active}>
          {!!backStack.length && (
            <button className="secondary navigation-back" onClick={back}>
              返回上一视图
            </button>
          )}
          {project && page !== "guide" && !overviewVisual && (
            <RuntimeTrustPanel
              key={`runtime-trust:${project.id}`}
              project={project}
              saved={(p) => {
                setProjects((v) => v.map((x) => (x.id === p.id ? p : x)));
                void refresh(p.id);
              }}
            />
          )}
          {snapshot &&
            page !== "guide" &&
            page !== "tasks" &&
            !overviewVisual && <RuntimeStatus view={snapshot.runtime} />}
          {snapshot?.runtime?.nextRequest &&
            page !== "guide" &&
            !overviewVisual && (
              <button
                className="secondary"
                disabled={paging || scanning || configChanged}
                onClick={async () => {
                  const id = snapshot.projectId;
                  const generation = refreshGenerations.current[id] || 0;
                  const isCurrent = () =>
                    mounted.current &&
                    (refreshGenerations.current[id] || 0) === generation;
                  setPaging(true);
                  try {
                    const next = await api<SnapshotView>(
                      `/projects/${id}/task-page`,
                      { snapshotId: snapshot.id },
                      "POST",
                    );
                    if (mounted.current)
                      setViews((v) =>
                        isCurrent() && v[id]?.snapshot?.id === snapshot.id
                          ? { ...v, [id]: next }
                          : v,
                      );
                  } catch (e) {
                    if (isCurrent()) setError(String(e));
                  } finally {
                    setPaging(false);
                  }
                }}
              >
                {" "}
                {paging
                  ? "续读中…"
                  : `读取下一页 Task（已读 ${snapshot.tasks.length}/${snapshot.runtime.total}）`}
              </button>
            )}
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
          <span>
            {page === "guide"
              ? "静态使用说明 · 不执行项目指令"
              : "文档记录的状态"}
          </span>
          {snapshot && page !== "guide" && (
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
