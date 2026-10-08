import type { SourceRef } from "./types.js";
export type ProductType =
  | "project"
  | "goal"
  | "module"
  | "requirement"
  | "design"
  | "plan"
  | "change"
  | "assessment"
  | "discussion";
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
export interface ProductBinding {
  id: string;
  task: ProductTaskRef;
  role: string;
  coverage: string;
  origin: "declared" | "inferred";
  state: "active" | "dismissed";
  reason?: string;
  sources?: ProductSource[];
  plan_items?: { plan_id: string; work_item_id: string }[];
  repairs?: {
    task: ProductTaskRef;
    coverage: string;
    sources: ProductSource[];
  }[];
}
export interface ProductWorkItem {
  id: string;
  title: string;
  outcome: string;
  scope: string;
  targets: { target: string; coverage: string }[];
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
export interface ProductMetadata {
  id: string;
  type: ProductType;
  scope?: "current" | "planned" | "candidate" | "retired";
  intent_state?: "proposed" | "adopted" | "retired";
  links?: ProductLink[];
  sources?: ProductSource[];
  extensions?: Record<string, unknown>;
  task_bindings?: ProductBinding[];
  assessment_id?: string | null;
  targets?: { target: string; coverage: string }[];
  work_items?: ProductWorkItem[];
  inventory?: {
    state: string;
    checked_sources: ProductSource[];
    unreviewed_sources: ProductSource[];
    note?: string;
  };
  target?: string;
  target_basis?: ProductSource;
  target_definition_sha256?: string | null;
  checked_at?: string;
  subject?: { kind: string; value: string | null };
  implementation?: string;
  verification?: string;
  pending_sources?: ProductSource[];
  raw_ref?: ProductSource;
  submitted_at?: string;
  origin?: { channel: string; locator?: string; occurred_at?: string | null };
  record_state?: string;
  recorded_at?: string;
  basis?: { kind: string; text: string; sources?: ProductSource[] };
  deltas?: {
    target: string;
    before: string | null;
    after: string | null;
    note?: string;
  }[];
}
export interface ProductDiagnostic {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  path?: string;
  line?: number;
  itemId?: string;
  source?: SourceRef;
}
export interface ProductItem {
  key: string;
  id: string;
  type: ProductType | "unknown";
  rawMetadata?: unknown;
  title: string;
  metadata: ProductMetadata;
  body: string;
  source: SourceRef;
  endLine: number;
  metadataLine: number;
  usable: boolean;
  definitionSha256: string | null;
  diagnostics: ProductDiagnostic[];
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
export interface ProductSourceCheck {
  definitionSha256?: string | null;
  id: string;
  ownerKey: string;
  role: string;
  reference: ProductSource;
  readState:
    | "read"
    | "not-read"
    | "excluded"
    | "unavailable"
    | "outside"
    | "unsupported"
    | "external"
    | "text";
  locationState: "located" | "unlocated" | "ambiguous" | "not-applicable";
  byteState: "same-bytes" | "changed" | "unknown" | "unavailable";
  source: SourceRef | null;
  endLine?: number;
  detail: string;
}
export interface ProductRelation {
  key: string;
  ownerKey: string;
  link: ProductLink;
  targetKey: string | null;
  resolution: "resolved" | "missing" | "ambiguous" | "invalid-direction";
}
export interface ProductTaskMatch {
  task: ProductTaskRef;
  taskIds: string[];
  state: "matched" | "identity-unknown" | "unresolved" | "conflict";
  detail: string;
  sourceCheckId?: string;
}
export interface ProductBindingView {
  key: string;
  ownerKey: string;
  binding: ProductBinding;
  match: ProductTaskMatch;
  planItems: {
    planId: string;
    workItemId: string;
    key: string | null;
    state: "resolved" | "missing" | "ambiguous";
  }[];
  repairs: {
    task: ProductTaskRef;
    coverage: string;
    sources: ProductSource[];
    match: ProductTaskMatch;
  }[];
}
export interface ProductAssessmentView {
  basisDefinitionState?: "same" | "changed" | "unknown";
  requirementKey: string;
  assessmentKey: string | null;
  state:
    "selected" | "unselected" | "missing" | "target-mismatch" | "ambiguous";
  definitionState: "same" | "changed" | "unknown";
  historicalState: "verified" | "changed" | "unknown";
  detail: string;
}
export interface ProductSnapshot {
  status:
    | "disabled"
    | "missing"
    | "excluded"
    | "unavailable"
    | "unsupported"
    | "partial"
    | "ready"
    | "empty";
  manifestPath: string;
  manifest: ProductManifest | null;
  manifestSource: SourceRef | null;
  items: ProductItem[];
  relations: ProductRelation[];
  bindings: ProductBindingView[];
  assessments: ProductAssessmentView[];
  sources: ProductSourceCheck[];
  diagnostics: ProductDiagnostic[];
  coverage: {
    complete: boolean;
    paths: string[];
    omitted: { path: string; reason: string }[];
    excluded: { path: string; reason: string }[];
  };
  workingCopy: string;
}
export interface ProductPreview {
  path: string;
  status: ProductSnapshot["status"];
  projectId?: string;
  managedPaths: string[];
  sourcePaths: string[];
  maintenance?: string;
  diagnostics: ProductDiagnostic[];
}
