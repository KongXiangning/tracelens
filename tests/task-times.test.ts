import { expect, it, vi } from "vitest";
import { readTaskTimes } from "../src/server/task-times.js";
import type { RuntimeTask } from "../src/shared/runtime-types.js";

const task: RuntimeTask = {
  task_id: "task-a",
  lifecycle: "closed",
  lifecycle_ref: "close-current.json",
  plans: [
    { ref: "create.json", parent_plan_ref: null },
    { ref: "revise.json", parent_plan_ref: "create.json" },
  ],
};
function source(
  action: string,
  time: string,
  create = false,
  taskId = "task-a",
) {
  return {
    raw: JSON.stringify({
      kind: "workflow-observation",
      recorded_at: time,
      payload: {
        task_event: { version: 1, task_id: taskId, action, data: { create } },
      },
    }),
  };
}

it("uses the creation event and current closure instead of revision, file or snapshot times", async () => {
  const read = vi.fn(async (ref: string) =>
    ref === "create.json"
      ? source("prepare", "2026-10-01T08:00:00Z", true)
      : source("close", "2026-10-13T01:00:00Z"),
  );
  expect(await readTaskTimes(task, read)).toEqual({
    createdAt: "2026-10-01T08:00:00.000Z",
    completedAt: "2026-10-13T01:00:00.000Z",
    createdRef: "create.json",
    completedRef: "close-current.json",
    issues: [],
  });
  expect(read.mock.calls.map(([ref]) => ref)).toEqual([
    "create.json",
    "close-current.json",
  ]);
});

it("does not show a previous completion for reopened tasks or infer legacy creation from files", async () => {
  const read = vi.fn(async () =>
    source("prepare", "2026-10-01T08:00:00Z", true),
  );
  expect(
    (await readTaskTimes({ ...task, lifecycle: "active" }, read)).completedAt,
  ).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
  const legacy = await readTaskTimes(
    { task_id: "legacy-task", lifecycle: "closed", legacy_source: "legacy.md" },
    read,
  );
  expect(legacy.createdAt).toBeNull();
  expect(legacy.completedAt).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
});

it("rejects another task's events, non-create prepares and malformed timestamps", async () => {
  for (const record of [
    source("prepare", "2026-10-01T08:00:00Z", true, "task-b"),
    source("prepare", "2026-10-01T08:00:00Z", false),
    source("prepare", "invalid-time", true),
  ]) {
    const result = await readTaskTimes(
      { ...task, lifecycle: "draft" },
      async () => record,
    );
    expect(result.createdAt).toBeNull();
  }
});

it("keeps unavailable creation evidence unknown while independently reading closure", async () => {
  const result = await readTaskTimes(
    { ...task, plans: [{ ref: "known.json" }, { ref: "missing.json" }] },
    async (ref) =>
      ref === "missing.json"
        ? { error: "missing" }
        : ref === "known.json"
          ? source("prepare", "2026-10-01T08:00:00Z", true)
          : source("close", "2026-10-13T01:00:00Z"),
  );
  expect(result.createdAt).toBeNull();
  expect(result.completedAt).toBe("2026-10-13T01:00:00.000Z");
  expect(result.issues).toHaveLength(1);
});
