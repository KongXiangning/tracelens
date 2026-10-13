import { useEffect, useState, useRef } from "react";
import { api } from "./api";
import type { Project, Snapshot } from "../shared/types";
import type {
  RuntimeDetail,
  RuntimeView,
  RuntimeTrust,
} from "../shared/runtime-types";
export const lifecycleLabels = {
  draft: "草案",
  active: "进行中",
  paused: "已暂停",
  closed: "已关闭",
  ambiguous: "状态待核对",
};
export function RuntimeStatus({ view }: { view?: RuntimeView }) {
  if (!view) return null;
  const unresolvedEmpty =
    view.source === "runtime-query" &&
    view.tasks.length === 0 &&
    (view.issues.length > 0 ||
      (view.queryMetadata?.state_completeness != null &&
        view.queryMetadata.state_completeness !== "complete"));
  const sourceLabel = {
    "runtime-query": "Runtime 只读查询",
    "file-snapshot": "文件降级快照",
    "memory-snapshot": "内存降级快照",
    unavailable: "任务数据暂不可用",
  }[view.source];
  const stale =
    view.source === "file-snapshot" || view.source === "memory-snapshot";
  let label = "任务已更新";
  let tone = "ready";
  if (view.source === "unavailable") {
    label = "任务数据暂不可用";
    tone = "error";
  } else if (unresolvedEmpty) {
    label = "任务尚未定位，不能确认零任务";
    tone = "warning";
  } else if (stale || view.freshness !== "queried") {
    label = "正在显示旧任务数据";
    tone = "warning";
  } else if (!view.complete) {
    label = "任务尚未读全";
    tone = "warning";
  } else if (
    view.queryMetadata?.state_completeness != null &&
    view.queryMetadata.state_completeness !== "complete"
  ) {
    label = "任务状态有待核对";
    tone = "warning";
  }
  const readTime = new Date(view.queryReadAt || view.readAt);
  const timeKnown = Number.isFinite(readTime.getTime());
  const clock = timeKnown
    ? readTime.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "时间未知";
  const count =
    view.total == null
      ? `已读取 ${view.tasks.length} 个 · 总数未知`
      : tone === "ready"
        ? `共 ${view.tasks.length} 个`
        : `已读取 ${view.tasks.length}/${view.total} 个`;
  return (
    <section className={`runtime-status runtime-status-${tone}`} role="status">
      <div className="runtime-status-line">
        <strong>{label}</strong>
        {view.source === "unavailable" ? (
          <span> · 产品文档仍可查看</span>
        ) : (
          <>
            <span> · {count}</span>
            {!unresolvedEmpty && (
              <span
                title={
                  timeKnown
                    ? readTime.toLocaleString("zh-CN", { hour12: false })
                    : undefined
                }
              >
                {stale ? " · 更新时间未知" : ` · ${clock}`}
              </span>
            )}
          </>
        )}
      </div>
      <details>
        <summary>数据详情</summary>
        <div className="runtime-status-diagnostics">
          <p>
            {sourceLabel} · {view.tasks.length}/{view.total ?? "未知"} 个任务；
            {view.complete ? "列表完整" : "列表未读完"}
          </p>
          <p>
            读取：
            {timeKnown
              ? readTime.toLocaleString("zh-CN", { hour12: false })
              : "未提供"}
            {view.reuseAt && ` · 复用：${view.reuseAt}`}
            {view.fileMtime && ` · 文件修改：${view.fileMtime}`} ·{" "}
            {view.freshness === "queried" ? "截至本次读取" : "陈旧性未知"}
          </p>
          <p>
            视图版本：{view.viewRevision || "未提供"} · workflow home：
            {view.workflowHome}
          </p>
          {view.source === "file-snapshot" && (
            <p>生成时间未提供；快照计数不代表当前事实。</p>
          )}
          <ul>
            {view.diagnostics.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          <pre>{JSON.stringify(view.issues, null, 2)}</pre>
          {view.queryMetadata && (
            <pre>{JSON.stringify(view.queryMetadata, null, 2)}</pre>
          )}
        </div>
      </details>
    </section>
  );
}
export function RuntimeTrustPanel({
  project,
  saved,
  disabled = false,
  onSavingChange,
}: {
  project: Project;
  saved: (project: Project) => void;
  disabled?: boolean;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [directory, setDirectory] = useState(
    project.runtimeTrust?.sourceDirectory || "",
  );
  const [home, setHome] = useState(
    project.runtimeTrust?.workflowHome || "docs/workflow",
  );
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    api<Pick<RuntimeTrust, "sourceDirectory" | "workflowHome">>(
      `/projects/${project.id}/runtime-trust-defaults`,
    )
      .then((defaults) => {
        if (cancelled) return;
        setDirectory(defaults.sourceDirectory);
        setHome(defaults.workflowHome);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadFailed(true);
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    project.id,
    project.root,
    project.runtimeTrust?.sourceDirectory,
    project.runtimeTrust?.workflowHome,
    reload,
  ]);
  const unavailable = disabled || loading || saving || loadFailed;
  return (
    <details className="runtime-trust">
      <summary>
        Runtime 来源信任 {project.runtimeTrust ? "· 已登记" : "· 尚未选择"}
      </summary>
      <p>
        默认使用当前项目的 Runtime 和工作流目录，也可手动修改。
        确认信任后，将登记四个模块的指纹，允许此副本执行只读任务查询与来源读取。
      </p>
      <label>
        可信模块目录
        <input
          aria-label="可信 Runtime 目录"
          value={directory}
          disabled={unavailable}
          onChange={(e) => setDirectory(e.target.value)}
        />
      </label>
      <label>
        workflow home
        <input
          aria-label="Runtime workflow home"
          value={home}
          disabled={unavailable}
          onChange={(e) => setHome(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="primary"
        disabled={unavailable || !directory.trim() || !home.trim()}
        onClick={async () => {
          setSaving(true);
          onSavingChange?.(true);
          try {
            setError("");
            const preview = await api<
              Pick<RuntimeTrust, "sourceDirectory" | "moduleHashes">
            >(
              "/runtime-source-preview",
              { sourceDirectory: directory.trim() },
              "POST",
            );
            const p = await api<Project>(
              `/projects/${project.id}/runtime-trust`,
              { ...preview, workflowHome: home.trim(), accept: true },
              "POST",
            );
            saved(p);
          } catch (e) {
            setError(String(e));
          } finally {
            setSaving(false);
            onSavingChange?.(false);
          }
        }}
      >
        {loading
          ? "正在读取项目配置…"
          : saving
            ? "正在登记信任…"
            : "确认信任并刷新"}
      </button>
      {loadFailed && (
        <button
          type="button"
          className="secondary"
          disabled={disabled || loading || saving}
          onClick={() => setReload((value) => value + 1)}
        >
          重新读取项目配置
        </button>
      )}
      {project.runtimeTrust && (
        <details>
          <summary>已登记的模块指纹</summary>
          <pre>
            {JSON.stringify(project.runtimeTrust.moduleHashes, null, 2)}
          </pre>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export function RuntimeTaskDetail({
  snapshot,
  taskId,
}: {
  snapshot: Snapshot;
  taskId: string;
}) {
  const sourceRequest = useRef(0);
  const [detail, setDetail] = useState<RuntimeDetail>();
  const [stepId, setStepId] = useState("");
  const [step, setStep] = useState<RuntimeDetail>();
  const [source, setSource] = useState<{
    ref: string;
    raw?: string;
    error?: string;
  }>();
  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setStepId("");
    setStep(undefined);
    setSource(undefined);
    api<RuntimeDetail>(
      `/projects/${snapshot.projectId}/task-detail`,
      { snapshotId: snapshot.id, taskId },
      "POST",
    )
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled)
          setDetail({
            status: "unavailable",
            error: String(e),
            viewRevision: null,
            source: "unavailable",
          });
      });
    return () => {
      cancelled = true;
      sourceRequest.current++;
    };
  }, [snapshot.id, snapshot.projectId, taskId]);
  useEffect(() => {
    let cancelled = false;
    setStep(undefined);
    if (stepId)
      api<RuntimeDetail>(
        `/projects/${snapshot.projectId}/task-detail`,
        { snapshotId: snapshot.id, taskId, stepId },
        "POST",
      )
        .then((d) => {
          if (!cancelled) setStep(d);
        })
        .catch((e) => {
          if (!cancelled)
            setStep({
              status: "unavailable",
              error: String(e),
              viewRevision: null,
              source: "unavailable",
            });
        });
    return () => {
      cancelled = true;
    };
  }, [stepId, snapshot.id, snapshot.projectId, taskId]);
  if (!detail) return <p role="status">正在读取任务详情…</p>;
  if (detail.status === "unavailable")
    return <p role="alert">任务详情暂不可用：{detail.error}</p>;
  const task = detail.task;
  if (!task) return <p>当前选择未定位，未替换为其他任务。</p>;
  const refs = new Set<string>();
  const collect = (value: unknown, name = "") => {
    if (typeof value === "string" && (name === "ref" || name.endsWith("_ref")))
      refs.add(value);
    else if (Array.isArray(value)) value.forEach((v) => collect(v, name));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([k, v]) => collect(v, k));
  };
  collect(task);
  collect(step?.step);
  return (
    <section className="runtime-task-detail">
      <h3>Task 生命周期：{lifecycleLabels[task.lifecycle]}</h3>
      <code>{task.task_id}</code>
      <p>
        视图版本：{detail.viewRevision} · {detail.source}
      </p>
      <h3>实施步骤</h3>
      <ul>
        {task.steps?.map((s) => (
          <li key={s.id}>
            <button className="text-link" onClick={() => setStepId(s.id)}>
              {s.id} · {String(s.title || "未提供标题")} · {s.state}
            </button>
          </li>
        ))}
      </ul>
      {task.steps?.length === 0 && <p>此任务未提供步骤。</p>}
      {stepId && (
        <section>
          <button className="secondary" onClick={() => setStepId("")}>
            返回 Task
          </button>
          <h4>Step {stepId}</h4>
          {!step ? (
            <p>读取中…</p>
          ) : step.status === "unavailable" ? (
            <p role="alert">步骤暂不可用：{step.error}</p>
          ) : (
            <pre>
              {JSON.stringify(
                { step: step.step, review: step.review },
                null,
                2,
              )}
            </pre>
          )}
        </section>
      )}
      <details>
        <summary>计划、执行、测试与关闭记录</summary>
        <pre>{JSON.stringify(task, null, 2)}</pre>
      </details>
      <details>
        <summary>原始来源 · {refs.size}</summary>
        {[...refs].map((ref) => (
          <p key={ref}>
            <button
              className="text-link"
              onClick={async () => {
                const request = ++sourceRequest.current;
                setSource({ ref, raw: "读取中…" });
                try {
                  const result = await api<{
                    ref: string;
                    raw?: string;
                    error?: string;
                  }>(
                    `/projects/${snapshot.projectId}/task-source`,
                    { snapshotId: snapshot.id, ref },
                    "POST",
                  );
                  if (request === sourceRequest.current) setSource(result);
                } catch (e) {
                  if (request === sourceRequest.current)
                    setSource({ ref, error: String(e) });
                }
              }}
            >
              {ref}
            </button>
          </p>
        ))}
      </details>
      {source && (
        <section>
          <h4>来源：{source.ref}</h4>
          {source.error ? (
            <p role="alert">来源未核对：{source.error}</p>
          ) : (
            <pre>{source.raw}</pre>
          )}
        </section>
      )}
    </section>
  );
}
