import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Snapshot, Task } from "../shared/types";
import type { TaskTimes } from "../shared/runtime-types";

// One visible card at a time: each lookup may read archived Runtime events.
const pending: Array<() => Promise<void>> = [];
let running = false;
function next() {
  if (running) return;
  const job = pending.shift();
  if (!job) return;
  running = true;
  void job().finally(() => {
    running = false;
    next();
  });
}
function displayTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TaskCardTimes({
  snapshot,
  task,
}: {
  snapshot: Snapshot;
  task: Task;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [times, setTimes] = useState<TaskTimes>();
  const [error, setError] = useState("");
  useEffect(() => {
    setTimes(undefined);
    setError("");
    if (!task.realTaskId || !task.runtimeLifecycle || !element.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        pending.push(async () => {
          if (cancelled) return;
          try {
            const result = await api<TaskTimes>(
              `/projects/${snapshot.projectId}/task-times`,
              { snapshotId: snapshot.id, taskId: task.realTaskId },
              "POST",
            );
            if (!cancelled) setTimes(result);
          } catch (e) {
            if (!cancelled) setError(String(e));
          }
        });
        next();
      },
      { root: element.current.closest(".task-card-grid") },
    );
    observer.observe(element.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [snapshot.projectId, snapshot.id, task.realTaskId, task.runtimeLifecycle]);
  let unknown = "未记录";
  if (task.runtimeLifecycle && task.realTaskId && !times)
    unknown = error ? "读取失败" : "读取中…";
  else if (times?.issues.length) unknown = "未核对";
  if (
    error.includes("QUERY_VIEW_CHANGED") ||
    error.includes("快照") ||
    error.includes("配置已变化")
  )
    unknown = "需刷新";
  let completion = unknown;
  if (task.runtimeLifecycle === "ambiguous") completion = "待核对";
  else if (task.runtimeLifecycle && task.runtimeLifecycle !== "closed")
    completion = "未完成";
  return (
    <span
      className="task-card-times"
      ref={element}
      title={error || times?.issues.join("\n")}
    >
      <span>
        <span>创建时间</span>
        {times?.createdAt ? (
          <time
            dateTime={times.createdAt}
            title={`任务创建记录：${times.createdRef}`}
          >
            {displayTime(times.createdAt)}
          </time>
        ) : (
          <span>{unknown}</span>
        )}
      </span>
      <span>
        <span>完成时间</span>
        {times?.completedAt ? (
          <time
            dateTime={times.completedAt}
            title={`Task 关闭记录时间：${times.completedRef}`}
          >
            {displayTime(times.completedAt)}
          </time>
        ) : (
          <span>{completion}</span>
        )}
      </span>
    </span>
  );
}
