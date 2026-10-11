export const runtimeModules = [
  "assistance.mjs",
  "task-management.mjs",
  "task-event-codec.mjs",
  "record-storage.mjs",
] as const;
export type Lifecycle = "draft" | "active" | "paused" | "closed" | "ambiguous";
export interface RuntimeTrust {
  sourceDirectory: string;
  moduleHashes: Record<string, string>;
  selectedAt: string;
  workflowHome: string;
}
export interface RuntimeStep {
  id: string;
  state: string;
  [key: string]: unknown;
}
export interface RuntimeTask {
  task_id: string;
  lifecycle: Lifecycle;
  steps?: RuntimeStep[];
  title?: string;
  display_id?: string;
  [key: string]: unknown;
}
export interface RuntimeView {
  source: "runtime-query" | "file-snapshot" | "memory-snapshot" | "unavailable";
  workflowHome: string;
  viewRevision: string | null;
  sourceRevision?: string;
  readAt: string;
  queryReadAt?: string;
  reuseAt?: string;
  fileMtime?: string;
  freshness: "queried" | "stale-or-unknown";
  complete: boolean;
  total: number | null;
  tasks: RuntimeTask[];
  issues: unknown[];
  queryMetadata?: Record<string, unknown>;
  diagnostics: string[];
  currentTaskId?: string | null;
  batchId: string;
  nextRequest?: Record<string, unknown>;
  pagesRead?: number;
}
export interface RuntimeDetail {
  status: "available" | "unavailable";
  task?: RuntimeTask | null;
  step?: RuntimeStep | null;
  review?: unknown;
  error?: string;
  viewRevision: string | null;
  source: RuntimeView["source"];
}
