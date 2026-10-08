import type { ProductPreview, ProductSnapshot } from "./product-types.js";
export const kinds = [
  "management",
  "requirements",
  "design",
  "planning",
] as const;
export type ConfiguredKind = (typeof kinds)[number];
export type DocumentKind = ConfiguredKind | "unclassified";
export const documentKinds = [...kinds, "unclassified"] as const;
export const kindLabels: Record<DocumentKind, string> = {
  management: "管理",
  requirements: "需求",
  design: "设计",
  planning: "规划",
  unclassified: "待分类",
};
export interface ScanConfig {
  rules: Record<ConfiguredKind, string[]>;
  excludes: string[];
  autoDiscover?: boolean;
  candidateRoots?: string[];
  includeRecords?: boolean;
  product?: { enabled: boolean; manifestPath: string };
}
export interface Project {
  id: string;
  name: string;
  root: string;
  config: ScanConfig;
  configVersion: number;
}
export interface SourceRef {
  documentId: string;
  path: string;
  line: number;
  section: string | null;
  digest: string;
}
export interface Heading {
  title: string;
  depth: number;
  line: number;
  anchor: string;
}
export interface Entry {
  text: string;
  checked: boolean | null;
  source: SourceRef;
  link?: { label: string; target: SourceRef | null; detail?: string };
}
export type StatementKind =
  | "status"
  | "currentTask"
  | "currentStep"
  | "todo"
  | "risk"
  | "planning"
  | "achievement";
export interface Statement extends Entry {
  kind: StatementKind;
  taskNumber: string | null;
}
export interface Task {
  id: string;
  realTaskId?: string | null;
  identitySources?: SourceRef[];
  number: string | null;
  title: string;
  current: boolean;
  source: SourceRef;
  statuses: Entry[];
  goals: Entry[];
  steps: Entry[];
  checks: Entry[];
  issues: Entry[];
}
export interface Document {
  id: string;
  path: string;
  kind: DocumentKind;
  title: string;
  raw: string;
  digest: string;
  headings: Heading[];
  bytes: number;
  modifiedAt: string;
  recognized: boolean;
}
export type RelationState =
  | "resolved"
  | "outside"
  | "available"
  | "missing"
  | "excluded"
  | "example"
  | "section-missing"
  | "unavailable"
  | "external"
  | "ambiguous"
  | "unsafe";
export interface Relation {
  id: string;
  from: string;
  to: string | null;
  targetPath: string | null;
  targetLine: number | null;
  type: "reference" | "mention";
  method: "structured" | "markdown" | "task-number";
  raw: string;
  label: string;
  section: string | null;
  revision: string | null;
  state: RelationState;
  source: SourceRef;
}
export interface Warning {
  code: string;
  message: string;
  level?: "info" | "warning";
  path?: string;
  line?: number;
}
export interface ScanFile {
  path: string;
  kind: DocumentKind;
  status: "read" | "missing" | "error" | "skipped";
  detail?: string;
}
export interface Snapshot {
  id: string;
  projectId: string;
  configVersion: number;
  config: ScanConfig;
  startedAt: string;
  completedAt: string;
  outcome: "success" | "partial";
  documents: Document[];
  tasks: Task[];
  statements: Statement[];
  relations: Relation[];
  files: ScanFile[];
  warnings: Warning[];
  navigation: NavigationReport;
  effectiveRules: Record<DocumentKind, string[]>;
  product?: ProductSnapshot;
}
export interface RefreshAttempt {
  state: "scanning" | "success" | "partial" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
}
export interface SnapshotView {
  snapshot: Snapshot | null;
  attempt: RefreshAttempt | null;
  configChanged: boolean;
}
export interface Discovery {
  config: ScanConfig;
  warnings: Warning[];
  profileUsed: boolean;
  navigation: NavigationReport;
  effectiveRules: Record<DocumentKind, string[]>;
  product?: ProductPreview;
}
export interface DocumentRegistration {
  path: string;
  kind: DocumentKind;
  classification: "declared" | "suggested" | "unclassified" | "manual";
  sources: { path: string; line: number; label: string }[];
  status: string | null;
  supersededBy?: string;
  sourcesTruncated?: boolean;
  availability: "read" | "missing" | "error" | "excluded" | "pending";
}
export interface NavigationReport {
  enabled: boolean;
  currentTaskPath?: string;
  profileUsed: boolean;
  entries: DocumentRegistration[];
  incomplete: boolean;
  gaps: string[];
  inventory?: DocumentInventory;
}
export interface DocumentInventory {
  roots: string[];
  candidates: string[];
  excluded: { path: string; reason: string }[];
  incomplete: boolean;
}
export interface ProjectCandidate {
  name: string;
  root: string;
  reason?: string;
}
export interface CodexProjects {
  projects: ProjectCandidate[];
  notice?: string;
}
export interface DirectoryListing {
  current: string;
  parent: string | null;
  shortcuts: { name: string; path: string }[];
  directories: { name: string; path: string }[];
  truncated: boolean;
  selectable: boolean;
  reason?: string;
}
