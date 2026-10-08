import type { SourceRef } from "./types.js";

export const productTypes = [
  "project",
  "goal",
  "module",
  "requirement",
  "design",
  "plan",
  "change",
  "assessment",
  "discussion",
] as const;
export type ProductType = (typeof productTypes)[number];
export type ProductScope = "current" | "planned" | "candidate" | "retired";
export type ProductSource =
  | {
      kind: "file";
      path: string;
      item_id?: string;
      section?: string;
      lines?: { start: number; end: number };
      sha256?: string;
      note?: string;
    }
  | { kind: "uri"; uri: string; note?: string }
  | { kind: "text"; text: string; label: string };
export interface ProductLink {
  id: string;
  relation: string;
  target: string;
  origin: "declared" | "inferred";
  state: "active" | "dismissed";
  reason?: string;
  sources?: ProductSource[];
}
export interface ProductTaskRef {
  task_id: string | null;
  source: ProductSource;
  label?: string;
  plan_ref?: string;
  step_id?: string;
}
export interface PlanItemRef {
  plan_id: string;
  work_item_id: string;
}
export interface TaskBinding {
  id: string;
  task: ProductTaskRef;
  role:
    "implementation" | "repair" | "verification" | "exploration" | "reference";
  coverage: string;
  origin: "declared" | "inferred";
  state: "active" | "dismissed";
  reason?: string;
  sources?: ProductSource[];
  plan_items?: PlanItemRef[];
  repairs?: {
    task: ProductTaskRef;
    coverage: string;
    sources: ProductSource[];
  }[];
}
export interface ProductTarget {
  target: string;
  coverage: string;
}
export interface WorkItem {
  id: string;
  title: string;
  outcome: string;
  scope: string;
  targets: ProductTarget[];
  state: "included" | "deferred" | "withdrawn";
  origin: "initial" | "added" | "unknown";
  stage?: string;
  depends_on?: {
    item_id: string;
    kind: "order" | "prerequisite";
    reason: string;
  }[];
  replaces?: string[];
  sources?: ProductSource[];
}
// This metadata mirrors the pinned contract. It is used only after production Schema validation.
export interface ProductMetadata {
  id: string;
  type: ProductType;
  links?: ProductLink[];
  sources?: ProductSource[];
  extensions?: Record<string, unknown>;
  scope?: ProductScope;
  intent_state?: "proposed" | "adopted" | "retired";
  inventory?: {
    state: "partial" | "reconciled";
    checked_sources: ProductSource[];
    unreviewed_sources: ProductSource[];
    note?: string;
  };
  task_bindings?: TaskBinding[];
  assessment_id?: string | null;
  targets?: ProductTarget[];
  work_items?: WorkItem[];
  recorded_at?: string;
  basis?: {
    kind: "user" | "delegated" | "document-edit";
    text: string;
    sources?: ProductSource[];
  };
  deltas?: {
    target: string;
    before: string | null;
    after: string | null;
    note?: string;
  }[];
  target?: string;
  target_basis?: ProductSource;
  target_definition_sha256?: string | null;
  checked_at?: string;
  subject?: {
    kind: "working-copy" | "commit" | "release" | "unknown";
    value: string | null;
  };
  implementation?:
    "unknown" | "none-reported" | "partial-reported" | "delivered-reported";
  verification?:
    | "unknown"
    | "not-run-reported"
    | "failure-reported"
    | "pass-reported"
    | "mixed-reported";
  pending_sources?: ProductSource[];
  raw_ref?: ProductSource;
  submitted_at?: string;
  origin?: {
    channel: "chat" | "codex" | "other" | "unknown";
    locator?: string;
    occurred_at?: string | null;
  };
  record_state?: "active" | "archived";
}
export interface ProductManifest {
  schema: string;
  project_id: string;
  entry: string;
  managed_paths: string[];
  source_paths: string[];
  capture_paths?: string[];
  exclude_paths: string[];
  maintenance: "enabled" | "paused";
  extensions?: Record<string, unknown>;
}
export interface ProductDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
  path: string;
  line?: number;
  itemId?: string;
  pointer?: string;
}
export interface ProductItem {
  key: string;
  id: string;
  type: ProductType | null;
  title: string;
  usable: boolean;
  version: 1 | 2;
  metadata: ProductMetadata | null;
  rawMetadata: unknown;
  body: string;
  source: SourceRef;
  endLine: number;
  metadataLine: number;
  metadataLocations: Record<string, number>;
  headings: { title: string; depth: number; line: number }[];
  definitionSha256: string | null;
}
export type TargetResolution = "resolved" | "missing" | "ambiguous" | "invalid";
export interface ProductRelation {
  key: string;
  ownerKey: string;
  targetKey: string | null;
  resolution: TargetResolution;
  declaration: ProductLink;
  source: SourceRef;
}
export interface ProductSourceCheck {
  key: string;
  ownerKey: string;
  pointer: string;
  role: string;
  ref: ProductSource;
  readState:
    | "read"
    | "not-read"
    | "excluded"
    | "outside"
    | "unavailable"
    | "unsupported"
    | "unsafe"
    | "external"
    | "text";
  locationState: "located" | "not-located";
  digestState: "same-bytes" | "changed" | "unavailable" | "unknown";
  actualDigest: string | null;
  target: SourceRef | null;
  endLine: number | null;
  detail?: string;
}
export interface ProductBinding {
  key: string;
  ownerKey: string;
  declaration: TaskBinding;
  taskIds: string[];
  match:
    "matched" | "unknown-identity" | "unresolved" | "ambiguous" | "conflict";
  detail: string;
  planItems: {
    ref: PlanItemRef;
    key: string | null;
    resolution: TargetResolution;
  }[];
  repairs: {
    task: ProductTaskRef;
    taskIds: string[];
    match: ProductBinding["match"];
    coverage: string;
    sources: ProductSource[];
    detail: string;
  }[];
  source: SourceRef;
}
export interface ProductWorkItem {
  key: string;
  planKey: string;
  declaration: WorkItem;
  bindingKeys: string[];
  source: SourceRef;
}
export interface ProductAssessment {
  requirementKey: string;
  selectedId: string | null;
  assessmentKey: string | null;
  selection:
    "unselected" | "resolved" | "missing" | "ambiguous" | "target-mismatch";
  definitionAlignment: "same" | "changed" | "unknown";
  currentDefinitionSha256: string | null;
  historicalDefinitionSha256: string | null;
  historicalDefinitionAlignment: "same" | "changed" | "unknown";
  historicalState: "available" | "unavailable" | "unknown";
}
export interface ProductView {
  status:
    | "disabled"
    | "missing"
    | "excluded"
    | "unavailable"
    | "unsupported"
    | "partial"
    | "available";
  manifestPath: string;
  manifestSource: SourceRef | null;
  manifest: ProductManifest | null;
  root: string;
  items: ProductItem[];
  relations: ProductRelation[];
  bindings: ProductBinding[];
  workItems: ProductWorkItem[];
  sources: ProductSourceCheck[];
  assessments: ProductAssessment[];
  diagnostics: ProductDiagnostic[];
  coverage: {
    paths: string[];
    read: string[];
    omitted: { path: string; reason: string }[];
    excluded: string[];
    complete: boolean;
  };
}
