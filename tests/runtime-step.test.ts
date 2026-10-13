import { expect, it } from "vitest";
import { stepFromTask } from "../src/shared/runtime-step.js";
import type { RuntimeDetail } from "../src/shared/runtime-types.js";

const detail: RuntimeDetail = {
  status: "available",
  source: "runtime-query",
  viewRevision: "old-view",
  task: {
    task_id: "task-a",
    lifecycle: "closed",
    steps: [{ id: "S1", state: "not-started", review_ref: "review-a" }],
    reviews: [
      { ref: "review-a", verdict: "clean" },
      { ref: "review-b", verdict: "needs-work" },
    ],
  },
};
it("reads the same-version step and its exact review without rewriting unfinished state", () => {
  const result = stepFromTask(detail, "S1");
  expect(result?.step?.state).toBe("not-started");
  expect(result?.viewRevision).toBe("old-view");
  expect(result?.review).toEqual({ ref: "review-a", verdict: "clean" });
});
it("never substitutes another or ambiguous step for an unresolved selection", () => {
  expect(stepFromTask(detail, "S2")).toBeUndefined();
  expect(
    stepFromTask(
      {
        ...detail,
        task: {
          ...detail.task!,
          steps: [detail.task!.steps![0], detail.task!.steps![0]],
        },
      },
      "S1",
    ),
  ).toBeUndefined();
});
