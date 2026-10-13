import { expect, it } from "vitest";
import { tasksByDescendingNumber } from "../src/shared/task-order.js";
import type { Task } from "../src/shared/types.js";

function task(id: string, number: string | null, current = false): Task {
  return {
    id,
    number,
    current,
    title: id,
    source: {
      documentId: "doc",
      path: "tasks.md",
      line: 1,
      section: null,
      digest: "",
    },
    statuses: [],
    goals: [],
    steps: [],
    checks: [],
    issues: [],
  };
}

it("orders numeric Task labels descending without pinning an older current task or mutating the snapshot", () => {
  const tasks = [
    task("older-current", "TASK-2", true),
    task("newest", "TASK-010"),
    task("middle", "TASK-9"),
  ];
  expect(tasksByDescendingNumber(tasks).map((t) => t.id)).toEqual([
    "newest",
    "middle",
    "older-current",
  ]);
  expect(tasks[0].id).toBe("older-current");
});

it("keeps duplicate numbers stable and puts unnumbered/opaque identifiers last without inferring dates", () => {
  const tasks = [
    task("opaque", "task-ab12cd"),
    task("a", "TASK-01"),
    task("missing", null),
    task("b", "TASK-001"),
  ];
  expect(tasksByDescendingNumber(tasks).map((t) => t.id)).toEqual([
    "a",
    "b",
    "opaque",
    "missing",
  ]);
  expect(tasksByDescendingNumber([])).toEqual([]);
});
