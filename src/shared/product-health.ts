import type { ProductDiagnostic } from "./product-types.js";

export type ProductDiagnosticArea = "structure" | "evidence" | "pending";
const pending = new Set([
  "DEFINITION_UNKNOWN",
  "PENDING_SOURCES",
  "WORK_TARGET_UNKNOWN",
  "TASK_ID_UNCONFIRMED",
]);
const evidence = new Set([
  "SOURCE_UNAVAILABLE",
  "SOURCE_CHECK",
  "SOURCE_LOCATION",
  "SOURCE_CHANGED",
  "SOURCE_DIGEST",
  "DEFINITION_CHANGED",
  "REPORT_SOURCE_MISSING",
  "BASIS_DEFINITION_CHANGED",
  "BASIS_DEFINITION_MISMATCH",
]);
export function productDiagnosticArea(
  diagnostic: ProductDiagnostic,
): ProductDiagnosticArea {
  if (pending.has(diagnostic.code)) return "pending";
  return evidence.has(diagnostic.code) ? "evidence" : "structure";
}
export function productStructureIssue(diagnostic: ProductDiagnostic): boolean {
  return (
    diagnostic.severity !== "info" &&
    productDiagnosticArea(diagnostic) === "structure"
  );
}
