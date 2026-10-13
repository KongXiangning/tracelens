import type { RuntimeTask, TaskTimes } from "../shared/runtime-types.js";

type SourceRead = (ref: string) => Promise<{ raw?: string; error?: string }>;

function eventTime(raw: string, taskId: string, action: string): string | null {
  const record = JSON.parse(raw);
  const event = record.payload?.task_event;
  if (
    record.kind !== "workflow-observation" ||
    event?.task_id !== taskId ||
    event.action !== action ||
    (action === "prepare" && event.data?.create !== true) ||
    typeof record.recorded_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record.recorded_at) ||
    !Number.isFinite(Date.parse(record.recorded_at))
  )
    return null;
  return new Date(record.recorded_at).toISOString();
}

export async function readTaskTimes(
  task: RuntimeTask,
  read: SourceRead,
): Promise<TaskTimes> {
  const result: TaskTimes = {
    createdAt: null,
    completedAt: null,
    createdRef: null,
    completedRef: null,
    issues: [],
  };
  const deadline = Date.now() + 60_000;
  async function readTime(ref: string, action: string) {
    try {
      if (Date.now() >= deadline) throw new Error("任务时间读取超时");
      const source = await read(ref);
      if (!source.raw) throw new Error(source.error || "来源未提供正文");
      return eventTime(source.raw, task.task_id, action);
    } catch (error) {
      result.issues.push(`${ref}: ${String(error)}`);
      return null;
    }
  }
  // Root prepare events may create a Task; later plan revisions do not.
  const refs = [
    ...new Set(
      (Array.isArray(task.plans) ? task.plans : [])
        .filter(
          (plan) =>
            plan &&
            typeof plan === "object" &&
            plan.parent_plan_ref == null &&
            typeof plan.ref === "string",
        )
        .map((plan) => plan.ref as string),
    ),
  ];
  if (refs.length > 8)
    result.issues.push("创建候选记录超过读取预算，创建时间未核对");
  else {
    for (const ref of refs) {
      const time = await readTime(ref, "prepare");
      if (time && (!result.createdAt || time < result.createdAt)) {
        result.createdAt = time;
        result.createdRef = ref;
      }
    }
    // An unread candidate may contain the original creation event.
    if (result.issues.length) {
      result.createdAt = null;
      result.createdRef = null;
    }
  }
  if (task.lifecycle === "closed" && typeof task.lifecycle_ref === "string") {
    result.completedAt = await readTime(task.lifecycle_ref, "close");
    if (result.completedAt) result.completedRef = task.lifecycle_ref;
  }
  return result;
}
