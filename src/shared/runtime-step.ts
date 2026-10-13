import type { RuntimeDetail } from "./runtime-types.js";

/** A full Task already contains the same-version Step projection. */
export function stepFromTask(
  detail: RuntimeDetail | undefined,
  stepId: string,
): RuntimeDetail | undefined {
  if (detail?.status !== "available" || !detail.task?.steps) return;
  const matches = detail.task.steps.filter((step) => step.id === stepId);
  if (matches.length !== 1) return;
  const step = matches[0];
  const reviews = Array.isArray(detail.task.reviews) ? detail.task.reviews : [];
  return {
    ...detail,
    step,
    review: reviews.find((review) => review?.ref === step.review_ref) ?? null,
  };
}
