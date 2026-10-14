import {
  isOverviewSnapshot,
  type OverviewSnapshot,
} from "../shared/overview-data";
import { mergeProjectView, type ProjectView } from "./view-state";
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
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
  FolderOpen,
  Trash2,
  AlertTriangle,
  LoaderCircle,
  X,
  CheckCircle2,
  BookOpenCheck,
  Search,
} from "lucide-react";
import { api, session } from "./api";
import { Empty, IconButton, Modal, ProjectForm } from "./components";
import { TasksPage, DocumentsPage } from "./pages";
import { VNextGuide } from "./vnext-guide";
import { RuntimeStatus } from "./runtime";
import {
  initialNavigation,
  useNavigationHistory,
  saveNavigationScroll,
  returnFromDetail,
  type NavigationState,
} from "./navigation-history";
import type {
  Project,
  ScanConfig,
  SnapshotView,
  SourceRef,
} from "../shared/types";

type Page = NavigationState["page"];
const RelationsPage = lazy(() =>
  import("./relations").then((module) => ({ default: module.RelationsPage })),
);
const RequirementsPage = lazy(() =>
  import("./product").then((module) => ({ default: module.RequirementsPage })),
);
const RequirementDetailPage = lazy(() =>
  import("./requirement-detail").then((module) => ({
    default: module.RequirementDetailPage,
  })),
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
function scanState(view?: ProjectView): { label: string; tone: string } {
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
  const [initial] = useState(initialNavigation);
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState(initial.active);
  const [views, setViews] = useState<Record<string, ProjectView>>({});
  const [page, setPage] = useState<Page>(initial.page);
  const [loading, setLoading] = useState(true);
  const [loadingView, setLoadingView] = useState(false);
  const [error, setError] = useState("");
  const [paging, setPaging] = useState(false);
  const [form, setForm] = useState<"add" | "edit" | null>(null);
  const [remove, setRemove] = useState(false);
  const [dataDir, setDataDir] = useState("");
  const [selection, setSelection] = useState<NavigationState["selection"]>(
    initial.selection,
  );
  useNavigationHistory(
    { active, page, selection },
    !loading && projects.some((item) => item.id === active),
    (route) => {
      setActive(route.active);
      setPage(route.page);
      setSelection(route.selection);
      setError("");
      setForm(null);
      setRemove(false);
    },
    !loading && !loadingView,
  );
  const mounted = useRef(true);
  const projectStrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = projectStrip.current;
    const card = strip?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    );
    if (!strip || !card) return;
    if (card.offsetLeft < strip.scrollLeft) strip.scrollLeft = card.offsetLeft;
    else if (
      card.offsetLeft + card.offsetWidth >
      strip.scrollLeft + strip.clientWidth
    )
      strip.scrollLeft = card.offsetLeft + card.offsetWidth - strip.clientWidth;
  }, [active, projects.length]);
  const projectListGeneration = useRef(0);
  const refreshGenerations = useRef<Record<string, number>>({});
  const project = projects.find((p) => p.id === active);
  const view = views[active];
  const snapshot = view?.snapshot;
  const fullSnapshot =
    snapshot && !isOverviewSnapshot(snapshot) ? snapshot : undefined;
  const overview =
    snapshot && isOverviewSnapshot(snapshot) ? snapshot.overview : undefined;
  const representation = page === "overview" ? "overview" : "full";
  const currentPage = useRef<{
    active: string;
    representation: "overview" | "full";
  }>({ active, representation });
  currentPage.current = { active, representation };
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const viewRequests = useRef<Record<string, number>>({});
  const overviewCache = useRef<Record<string, OverviewSnapshot>>({});
  const acceptView = useCallback((id: string, result: ProjectView) => {
    setViews((previous) => {
      const next = mergeProjectView(previous[id], result);
      return next === previous[id] ? previous : { ...previous, [id]: next };
    });
  }, []);
  const fetchView = useCallback(
    async (id: string, mode: "overview" | "full") => {
      const generation = (viewRequests.current[id] || 0) + 1;
      viewRequests.current[id] = generation;
      const cached = overviewCache.current[id];
      const previous = viewsRef.current[id]?.snapshot;
      const endpoint =
        mode === "overview"
          ? `/projects/${id}/overview${cached ? `?knownRevision=${encodeURIComponent(cached.revision)}` : ""}`
          : `/projects/${id}/snapshot?compact=1${previous && !isOverviewSnapshot(previous) ? `&knownSnapshotId=${encodeURIComponent(previous.id)}` : ""}`;
      const result = await api<ProjectView>(endpoint);
      if (!mounted.current || viewRequests.current[id] !== generation)
        return undefined;
      if (result.snapshot && isOverviewSnapshot(result.snapshot)) {
        if (
          !result.snapshot.overview &&
          cached?.revision === result.snapshot.revision
        )
          result.snapshot = { ...result.snapshot, overview: cached.overview };
        if (!result.snapshot.overview)
          throw new Error("总览缓存已失效，请重新加载页面");
        overviewCache.current[id] = result.snapshot;
      }
      acceptView(id, result);
      return result;
    },
    [acceptView],
  );
  const scanning = view?.attempt?.state === "scanning";
  const configChanged = Boolean(
    snapshot && project && snapshot.configVersion !== project.configVersion,
  );
  const scan = scanState(view);
  const syncProjects = useCallback(async () => {
    const generation = ++projectListGeneration.current;
    try {
      const list = await api<Project[]>("/projects");
      if (!mounted.current || generation !== projectListGeneration.current)
        return;
      setProjects((previous) =>
        JSON.stringify(previous) === JSON.stringify(list) ? previous : list,
      );
      setActive((previous) =>
        list.some((p) => p.id === previous) ? previous : list[0]?.id || "",
      );
    } catch (e) {
      if (mounted.current && generation === projectListGeneration.current)
        setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const info = await session();
      setDataDir(info.dataDir);
      await syncProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [syncProjects]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    const onFocus = () => void syncProjects();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncProjects();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [syncProjects]);
  useEffect(() => {
    if (!active || page === "guide") return;
    let cancelled = false;
    setLoadingView(true);
    void fetchView(active, representation)
      .then((result) => {
        if (!cancelled && result?.restored) void refresh(active);
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingView(false);
      });
    return () => {
      cancelled = true;
      viewRequests.current[active] = (viewRequests.current[active] || 0) + 1;
    };
  }, [active, representation, page === "guide", fetchView]);
  useEffect(() => {
    if (!scanning || page === "guide") return;
    let cancelled = false;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void fetchView(active, representation)
        .catch((error) => {
          if (!cancelled) setError(String(error));
        })
        .finally(() => {
          pending = false;
        });
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, scanning, representation, page === "guide", fetchView]);
  useEffect(() => {
    setSelection((s) => (s.doc ? s : { ...s, line: 1 }));
  }, [snapshot?.id]);
  async function refresh(
    id = active,
    mode: "overview" | "full" = representation,
  ) {
    refreshGenerations.current[id] = (refreshGenerations.current[id] || 0) + 1;
    const generation = refreshGenerations.current[id];
    viewRequests.current[id] = (viewRequests.current[id] || 0) + 1;
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
        { background: true, statusOnly: true },
        "POST",
      );
      if (!mounted.current || refreshGenerations.current[id] !== generation)
        return;
      acceptView(id, result);
      await fetchView(
        id,
        currentPage.current.active === id
          ? currentPage.current.representation
          : mode,
      );
    } catch (e) {
      if (!mounted.current || refreshGenerations.current[id] !== generation)
        return;
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
      projectListGeneration.current++;
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
      projectListGeneration.current++;
      setProjects((p) => [
        ...p.filter((item) => item.id !== result.id),
        result,
      ]);
      setActive(result.id);
      setPage("overview");
      setSelection({});
      // Registration is complete before scanning; a failed first scan still has a manageable project.
      void refresh(result.id, "overview");
    }
  }
  async function removeProject() {
    if (!project) return;
    try {
      await api(`/projects/${project.id}`, {}, "DELETE");
      projectListGeneration.current++;
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
    saveNavigationScroll();
    setSelection((s) => ({ ...s, doc: source.documentId, line: source.line }));
    setPage("documents");
  }
  function openTask(
    id?: string,
    requirementKey?: string,
    reviewAssociations = false,
  ) {
    saveNavigationScroll();
    setSelection((s) => ({
      ...s,
      task: id,
      taskRequirement: requirementKey,
      taskAssociationReview: reviewAssociations,
      taskRealId:
        (fullSnapshot?.tasks || overview?.tasks)?.find((task) => task.id === id)
          ?.realTaskId ?? null,
    }));
    setPage("tasks");
  }
  function openRelations(id: string) {
    const task = (fullSnapshot?.tasks || overview?.tasks)?.find(
      (entry) => entry.id === id,
    );
    setSelection((s) => ({
      ...s,
      relation: id,
      relationRealId: task ? (task.realTaskId ?? null) : undefined,
    }));
    setPage("relations");
  }
  function openProduct(key: string, workItemId?: string) {
    saveNavigationScroll();
    const type =
      fullSnapshot?.product?.items.find((entry) => entry.key === key)?.type ||
      overview?.itemTypes[key];
    if (type === "plan") {
      setSelection((s) => ({ ...s, plan: key, work: workItemId }));
      setPage("planning");
    } else {
      setSelection((s) => ({ ...s, product: key }));
      setPage(type === "requirement" ? "requirement-detail" : "requirements");
    }
  }
  const navigationRef = useRef({
    openSource,
    openTask,
    openProduct,
    openRelations,
  });
  navigationRef.current = { openSource, openTask, openProduct, openRelations };
  const navigation = useMemo(
    () => ({
      open: (source: SourceRef) => navigationRef.current.openSource(source),
      openTask: (
        id?: string,
        requirementKey?: string,
        reviewAssociations?: boolean,
      ) =>
        navigationRef.current.openTask(id, requirementKey, reviewAssociations),
      openProduct: (key: string, work?: string) =>
        navigationRef.current.openProduct(key, work),
      relations: (id: string) => navigationRef.current.openRelations(id),
    }),
    [],
  );
  const showRequirements = useCallback(() => setPage("requirements"), []);
  const showPlanning = useCallback(() => setPage("planning"), []);
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
              ? "正在建立需求索引，需求就绪后即可浏览，证据将在后台继续核验。"
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
    if (page === "overview")
      return (
        <Suspense fallback={<ProductLoading />}>
          <ProductOverview
            key={active}
            context={{ snapshot, ...navigation }}
            configure={() => setForm("edit")}
            requirements={showRequirements}
            planning={showPlanning}
            projectName={project.name}
            root={project.root}
            loadSnapshot={async () => {
              const result = await api<SnapshotView>(
                `/projects/${active}/snapshot?compact=1&snapshotId=${encodeURIComponent(snapshot.id)}`,
              );
              if (!result.snapshot) throw new Error("没有可读取的详细快照");
              return result.snapshot;
            }}
          />
        </Suspense>
      );
    if (isOverviewSnapshot(snapshot)) return <ProductLoading />;
    const context = { snapshot, ...navigation };
    switch (page) {
      case "requirement-detail":
        return (
          <Suspense fallback={<ProductLoading />}>
            <RequirementDetailPage
              key={`${active}:${selection.product}`}
              context={context}
              selected={selection.product}
              back={() => returnFromDetail(() => setPage("requirements"))}
            />
          </Suspense>
        );
      case "requirements":
        return (
          <Suspense fallback={<ProductLoading />}>
            <RequirementsPage
              key={active}
              {...context}
              selected={selection.product}
              select={(key) => {
                if (
                  snapshot.product?.items.find((item) => item.key === key)
                    ?.type === "requirement"
                )
                  openProduct(key);
                else setSelection((s) => ({ ...s, product: key }));
              }}
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
      case "tasks":
        return (
          <TasksPage
            key={active}
            snapshot={snapshot}
            selected={selection.task}
            selectedRealTaskId={selection.taskRealId}
            select={(id) => openTask(id, selection.taskRequirement)}
            requirementKey={selection.taskRequirement}
            reviewAssociations={selection.taskAssociationReview}
            showAssociationReview={() =>
              openTask(undefined, selection.taskRequirement, true)
            }
            clearRequirement={() =>
              setSelection((s) => ({
                ...s,
                taskRequirement: undefined,
                taskAssociationReview: false,
              }))
            }
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
  const overviewVisual = page === "overview";
  return (
    <div
      className={`app-shell modern-shell overview-theme${page === "requirements" || page === "requirement-detail" ? " requirements-theme" : ""}${page === "tasks" ? " task-view-shell" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand overview-brand">
          <span className="overview-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="overview-brand-name">TraceLens</span>
        </div>
        <div className="overview-sidebar-caption">WORKSPACE</div>
        <nav aria-label="主导航">
          {overviewPages.map((p) => (
            <button
              key={p.id}
              aria-label={p.id === "overview" ? "概览" : p.name}
              className={`${page === p.id || (page === "requirement-detail" && p.id === "requirements") ? "active" : ""}${p.id === "guide" ? " overview-guide-link" : ""}`}
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
        <section
          className="sidebar-footer overview-sidebar-footer"
          aria-label="项目管理"
        >
          <div className="overview-sidebar-caption">项目管理</div>
          <p className="project-switch-hint">点击顶部项目标签切换</p>
          <small title={dataDir}>只读呈现 · 文档驱动</small>
        </section>
      </aside>
      <main className="workspace">
        <header className="project-switcher" aria-label="项目与操作">
          <nav
            className="project-switcher-cards"
            ref={projectStrip}
            aria-label="项目切换"
          >
            {projects.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`project-switch-card${item.id === active ? " active" : ""}`}
                data-project-id={item.id}
                aria-pressed={item.id === active}
                title={`${item.name}\n${item.root}`}
                onClick={() => {
                  if (item.id === active) return;
                  setActive(item.id);
                  setPage("overview");
                  setSelection({});
                  setError("");
                }}
              >
                <FolderOpen size={16} aria-hidden="true" />
                <span>{item.name}</span>
              </button>
            ))}
            {!projects.length && (
              <span className="project-switch-empty">尚无项目</span>
            )}
          </nav>
          <div className="overview-top-actions">
            <button
              type="button"
              className="overview-add-project project-switch-add"
              onClick={() => setForm("add")}
            >
              <Plus size={16} aria-hidden="true" />
              添加项目
            </button>
            <button
              type="button"
              disabled={!project}
              onClick={() => {
                const source =
                  fullSnapshot?.product?.manifestSource ||
                  overview?.manifestSource;
                if (source) openSource(source);
                else setPage("documents");
              }}
            >
              源文档 ↗
            </button>
            {project && page !== "guide" && (
              <>
                <button
                  type="button"
                  className="overview-refresh"
                  disabled={scanning}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={14} className={scanning ? "spin" : ""} />
                  {scanning ? "扫描中" : "刷新"}
                </button>
                <button type="button" onClick={() => setForm("edit")}>
                  <Settings2 size={16} aria-hidden="true" />
                  项目设置
                </button>
                <button
                  type="button"
                  className="overview-remove-project"
                  onClick={() => setRemove(true)}
                  disabled={scanning}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  移除项目
                </button>
              </>
            )}
          </div>
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
        {project &&
          page !== "guide" &&
          (scanning || view?.restored || snapshot?.phase === "core") && (
            <div className="scan-strip" role="status" aria-live="polite">
              <span>
                {scanning
                  ? view?.attempt?.phase || "正在检查更新"
                  : view?.restored
                    ? "已恢复上次结果"
                    : "需求已载入，证据核验尚未完成"}
              </span>
              {scanning && view?.attempt?.total !== undefined && (
                <span>
                  {view.attempt.completed} / {view.attempt.total}
                </span>
              )}
              {snapshot && (
                <span>
                  上次读取：{time(snapshot.completedAt)}
                  {view?.restored ? " · 点击刷新检查文件变化" : " · 可继续浏览"}
                </span>
              )}
            </div>
          )}
        <div className="page-content" key={active}>
          {snapshot &&
            page !== "guide" &&
            page !== "tasks" &&
            !overviewVisual && <RuntimeStatus view={fullSnapshot?.runtime} />}
          {fullSnapshot?.runtime?.nextRequest &&
            page !== "guide" &&
            !overviewVisual && (
              <button
                className="secondary"
                disabled={paging || scanning || configChanged}
                onClick={async () => {
                  const id = fullSnapshot.projectId;
                  const generation = refreshGenerations.current[id] || 0;
                  const isCurrent = () =>
                    mounted.current &&
                    (refreshGenerations.current[id] || 0) === generation;
                  setPaging(true);
                  try {
                    const next = await api<SnapshotView>(
                      `/projects/${id}/task-page`,
                      { snapshotId: fullSnapshot.id },
                      "POST",
                    );
                    if (mounted.current)
                      setViews((v) =>
                        isCurrent() && v[id]?.snapshot?.id === fullSnapshot.id
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
                  : `读取下一页 Task（已读 ${fullSnapshot.tasks.length}/${fullSnapshot.runtime.total}）`}
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
              快照 {snapshot.id.slice(0, 8)} ·{" "}
              {fullSnapshot?.documents.length ??
                overview?.counts.documents ??
                0}{" "}
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
          runtimeSaved={(p) => {
            projectListGeneration.current++;
            setProjects((v) => v.map((x) => (x.id === p.id ? p : x)));
            void refresh(p.id);
          }}
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
