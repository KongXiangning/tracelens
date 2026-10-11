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
  return (
    <section className="runtime-status" role="status">
      <strong>
        {view.source === "unavailable"
          ? "任务数据暂不可用"
          : {
              "runtime-query": "Runtime 只读查询",
              "file-snapshot": "文件降级快照",
              "memory-snapshot": "内存降级快照",
            }[view.source]}
      </strong>
      <span>
        {" "}
        ·{" "}
        {view.source === "unavailable"
          ? "产品内容继续可读"
          : unresolvedEmpty
            ? "尚未定位 Task；事实关联存在缺口，不能确认零任务"
            : `${view.tasks.length}/${view.total ?? "未知"} 个任务；${view.complete ? "列表完整" : "列表未读完"}`}
      </span>
      <small>
        读取：{view.queryReadAt || view.readAt}
        {view.reuseAt && ` · 复用：${view.reuseAt}`}
        {view.fileMtime && ` · 文件修改：${view.fileMtime}`} ·{" "}
        {view.freshness === "queried" ? "截至本次读取" : "陈旧性未知"}
      </small>
      <details>
        <summary>查询来源与诊断</summary>
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
      </details>
    </section>
  );
}
export function RuntimeTrustPanel({
  project,
  saved,
}: {
  project: Project;
  saved: (project: Project) => void;
}) {
  const [directory, setDirectory] = useState(
    project.runtimeTrust?.sourceDirectory || "",
  );
  const [home, setHome] = useState(
    project.runtimeTrust?.workflowHome || "docs/workflow",
  );
  const [preview, setPreview] =
    useState<Pick<RuntimeTrust, "sourceDirectory" | "moduleHashes">>();
  const [error, setError] = useState("");
  return (
    <details className="runtime-trust">
      <summary>
        Runtime 来源信任 {project.runtimeTrust ? "· 已登记" : "· 尚未选择"}
      </summary>
      <p>
        选择你信任的本机 Runtime
        源目录或分发目录，核对四模块摘要后，允许此副本执行只读任务查询与来源读取。
      </p>
      <label>
        可信模块目录
        <input
          aria-label="可信 Runtime 目录"
          value={directory}
          onChange={(e) => {
            setDirectory(e.target.value);
            setPreview(undefined);
          }}
        />
      </label>
      <label>
        workflow home
        <input
          aria-label="Runtime workflow home"
          value={home}
          onChange={(e) => setHome(e.target.value)}
        />
      </label>
      <button
        className="secondary"
        onClick={async () => {
          try {
            setError("");
            setPreview(
              await api(
                "/runtime-source-preview",
                { sourceDirectory: directory },
                "POST",
              ),
            );
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        核对可信来源
      </button>
      {preview && (
        <>
          <pre>{JSON.stringify(preview.moduleHashes, null, 2)}</pre>
          <button
            className="primary"
            onClick={async () => {
              try {
                const p = await api<Project>(
                  `/projects/${project.id}/runtime-trust`,
                  { ...preview, workflowHome: home, accept: true },
                  "POST",
                );
                saved(p);
                setPreview(undefined);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            信任这些字节用于此副本的只读查询
          </button>
        </>
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
