/** Read-only Implementation Roadmap contract. Algorithms are evaluated server-side. */
import type {
  ProductDiagnostic,
  ProductSource,
  ProductWorkItem,
} from "./product-types.js";

export const scopedProductVersion = (version?: number): boolean =>
  version === 3 || version === 4 || version === 5 || version === 6;
export const roadmapProductVersion = (version?: number): boolean =>
  version === 4 || version === 5 || version === 6;

export type ProductPlanningSelector = (
  | { kind: "project-current" }
  | { kind: "explicit-requirements"; requirement_ids: string[] }
  | { kind: "target-subgraph"; target_ids: string[] }
) & { exclude_ids?: string[] };
export interface ProductDefinitionSnapshot {
  id: string;
  algorithm: string;
  sha256: string | null;
}
export interface ProductArrangementSnapshot {
  algorithm: string;
  sha256: string;
}
export interface ProductPlanningException {
  target: string;
  algorithm: string;
  sha256: string;
  disposition: "no-adjustment" | "deferred";
  reason: string;
  sources: ProductSource[];
  work_item_ids?: string[];
}
export interface ProductPlanningBaseline {
  project_id: string;
  selector: ProductPlanningSelector;
  member_ids: string[];
  definitions: ProductDefinitionSnapshot[];
  context: ProductDefinitionSnapshot[];
  arrangement: ProductArrangementSnapshot;
  checked_at: string;
  working_copy: string;
  sources: ProductSource[];
  unread_sources: ProductSource[];
  exceptions: ProductPlanningException[];
}
export interface ProductPlanningScope {
  selector: ProductPlanningSelector;
  member_ids: string[];
  definitions: ProductDefinitionSnapshot[];
  context: ProductDefinitionSnapshot[];
  definition_locators: { id: string; locator: ProductSource }[];
  outside_scope: string[];
  unassigned: string[];
  reasons: string[];
  complete: boolean;
}
export interface ProductRoadmapChange {
  kind:
    | "member-added"
    | "member-exited"
    | "definition-changed"
    | "context-exited"
    | "arrangement-changed";
  id?: string;
  before?: ProductDefinitionSnapshot | ProductArrangementSnapshot;
  after?: ProductDefinitionSnapshot | ProductArrangementSnapshot;
}
export interface ProductRoadmapResult {
  planKey: string;
  plan_id: string;
  status: "current" | "changes-pending" | "reviewed-deferred" | "unknown";
  reasons: string[];
  changes: ProductRoadmapChange[];
  development_gate: false;
  business_validity: "not-evaluated";
  delivery: "not-evaluated";
  task_operations: "not-performed";
  locator?: ProductSource;
  intent_state?: "proposed" | "adopted" | "retired";
  work_items?: ProductWorkItem[];
  diagnostics?: ProductDiagnostic[];
  scope?: ProductPlanningScope;
  arrangement?: ProductArrangementSnapshot;
  unarranged_requirements?: string[];
  snapshot_proposal?: Pick<
    ProductPlanningBaseline,
    "selector" | "member_ids" | "definitions" | "context" | "arrangement"
  > & { project_id?: string };
  proposal_assurance?: string;
  exceptions?: ProductPlanningException[];
  stale_exceptions?: ProductPlanningException[];
  affected_work_items?: string[];
  change_sources?: {
    id: string;
    locator: ProductSource;
    basis?: { kind: string; text: string; sources?: ProductSource[] };
  }[];
}
