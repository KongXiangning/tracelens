// Deterministic VN-01 consumer, adapted from upstream scoped.ts (MIT).
import type {
  ProductItem,
  ProductMetadata,
  ProductSnapshot,
} from "./product-types.js";
export const conclusionLabels = {
  satisfied: "已满足",
  "partially-satisfied": "部分满足",
  "not-satisfied": "未满足",
  undetermined: "尚未判定",
};
export type Subject = NonNullable<ProductMetadata["subject"]>;
export interface AssessmentSelection {
  conclusion: keyof typeof conclusionLabels;
  assessment: ProductItem | null;
  reports: ProductItem[];
  historical: ProductItem[];
  pending: ProductItem[];
  reasons: string[];
  scopeId?: string;
}
const normalized = (text: string) => text.replace(/\r\n|\r/g, "\n");
const metadata = (item: ProductItem) =>
  (item.rawMetadata && typeof item.rawMetadata === "object"
    ? item.rawMetadata
    : item.metadata) as ProductMetadata;
const subjectKey = (s?: Subject) =>
  JSON.stringify([s?.kind, s?.value, s?.revision ?? null]);
const located = (m: ProductMetadata) =>
  typeof m.target === "string" &&
  typeof m.applicability?.goal_id === "string" &&
  typeof m.applicability?.scope_id === "string" &&
  ["working-copy", "commit", "release"].includes(m.subject?.kind || "") &&
  Boolean(m.subject?.value);
const tuple = (m: ProductMetadata) =>
  JSON.stringify([
    m.target,
    m.applicability?.goal_id,
    m.applicability?.scope_id,
    subjectKey(m.subject),
  ]);
export function productView(product: ProductSnapshot) {
  const usable = product.items.filter((i) => i.usable);
  const byId = new Map(
    usable
      .filter((i) => product.items.filter((x) => x.id === i.id).length === 1)
      .map((i) => [i.id, i]),
  );
  const projects = product.items.filter((i) => i.type === "project");
  const project =
    projects.length === 1 &&
    projects[0].usable &&
    projects[0].source.path === product.manifest?.entry
      ? projects[0]
      : undefined;
  const rootId = project?.metadata.root_goal_id;
  const candidate = rootId ? byId.get(rootId) : undefined;
  const rootGoal =
    candidate?.type === "goal" && candidate.metadata.scope === "current"
      ? candidate
      : null;
  const rootReason = !project
    ? "PROJECT_ENTRY_CONFLICT"
    : !rootId
      ? "ROOT_GOAL_UNSPECIFIED"
      : !candidate
        ? "ROOT_GOAL_UNRESOLVED"
        : !rootGoal
          ? "ROOT_GOAL_INVALID"
          : null;
  const diagnostics: string[] = rootReason ? [rootReason] : [];
  const registered: ProductItem[] = [],
    seen = new Set<string>();
  for (const id of project?.metadata.requirement_order || []) {
    if (seen.has(id)) diagnostics.push(`REQUIREMENT_ORDER_DUPLICATE: ${id}`);
    seen.add(id);
    const item = byId.get(id);
    if (item?.type !== "requirement")
      diagnostics.push(`REQUIREMENT_ORDER_UNRESOLVED: ${id}`);
    else if (!registered.includes(item)) registered.push(item);
  }
  const unordered = usable
    .filter(
      (i) =>
        i.type === "requirement" && byId.has(i.id) && !registered.includes(i),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const possible = product.relations.filter(
    (r) =>
      r.resolution === "resolved" &&
      r.targetKey &&
      r.link.origin === "declared" &&
      r.link.state === "active" &&
      ["part_of", "supports", "depends_on"].includes(r.link.relation),
  );
  const reaches = (
    from: string,
    to: string,
    kind: string,
    seen = new Set<string>(),
  ): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return possible.some(
      (r) =>
        r.ownerKey === from &&
        r.link.relation === kind &&
        r.targetKey &&
        reaches(r.targetKey, to, kind, seen),
    );
  };
  const relations = possible.filter(
    (r) => !reaches(r.targetKey!, r.ownerKey, r.link.relation),
  );
  for (const r of possible.filter((r) => !relations.includes(r)))
    diagnostics.push(`CURRENT_RELATION_CYCLE: ${r.link.id}`);
  return {
    project,
    rootGoal,
    rootReason,
    registered,
    unordered,
    relations,
    diagnostics,
  };
}
export function selectAssessment(
  product: ProductSnapshot,
  targetId: string,
  goalId: string,
  subject?: Subject,
  scopeId?: string,
): AssessmentSelection {
  const reasons: string[] = [],
    reports: ProductItem[] = [],
    historical: ProductItem[] = [];
  const pending = product.items.filter(
    (i) => i.type === "assessment" && !located(metadata(i)),
  );
  let selectedScope = scopeId;
  const result = (): AssessmentSelection => ({
    conclusion: reasons.length
      ? "undetermined"
      : reports[0]?.metadata.conclusion || "undetermined",
    assessment: reasons.length ? null : reports[0] || null,
    reports,
    historical,
    pending,
    reasons: [...new Set(reasons)],
    scopeId: selectedScope,
  });
  const fail = (reason: string) => {
    reasons.push(reason);
    return result();
  };
  const unique = (id: string) => {
    const rows = product.items.filter((i) => i.id === id);
    return rows.length === 1 && rows[0].usable ? rows[0] : undefined;
  };
  const goal = unique(goalId),
    target = unique(targetId);
  if (!goal || goal.type !== "goal" || goal.version !== 3)
    return fail("scope-unavailable");
  if (
    !target ||
    !["requirement", "goal"].includes(target.type) ||
    (target.type === "goal" && target !== goal)
  )
    return fail("conflict");
  const declarations = goal.metadata.assessment_scopes || [];
  const keys = new Set<string>();
  for (const s of declarations) {
    const t = unique(s.target),
      k = JSON.stringify([s.target, s.scope_id]);
    if (keys.has(k) || !t || (t.type !== "requirement" && t !== goal))
      return fail("conflict");
    keys.add(k);
  }
  const available = declarations.filter((s) => s.target === targetId);
  if (!available.length) return fail("scope-unavailable");
  if (!scopeId && available.length > 1) return fail("scope-selection-required");
  const scope = available.find(
    (s) => s.scope_id === (scopeId || available[0].scope_id),
  );
  if (!scope) return fail("scope-not-current");
  selectedScope = scope.scope_id;
  if (!subject) return fail("subject-selection-required");
  if (
    !["working-copy", "commit", "release"].includes(subject.kind) ||
    !subject.value
  )
    return fail("no-applicable-report");
  const wanted = tuple({
    id: "",
    type: "assessment",
    target: targetId,
    applicability: {
      goal_id: goalId,
      scope_id: scope.scope_id,
      coverage: scope.coverage,
    },
    subject,
  });
  const all = product.items.filter(
    (i) =>
      i.type === "assessment" &&
      located(metadata(i)) &&
      tuple(metadata(i)) === wanted,
  );
  const edges = new Map<string, string[]>(),
    invalid = new Set<string>();
  for (const item of all) {
    const valid: string[] = [];
    const supersedes = metadata(item).supersedes;
    for (const id of Array.isArray(supersedes) ? supersedes : []) {
      const found = product.items.filter((i) => i.id === id);
      if (found.length !== 1 || !all.includes(found[0])) invalid.add(item.id);
      else valid.push(id);
    }
    edges.set(item.id, valid);
  }
  const reaches = (
    from: string,
    to: string,
    seen = new Set<string>(),
  ): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (edges.get(from) || []).some((id) => reaches(id, to, seen));
  };
  const removed = new Set<string>();
  for (const item of all)
    for (const id of edges.get(item.id) || []) {
      if (reaches(id, item.id)) invalid.add(item.id);
      else removed.add(id);
    }
  for (const item of all)
    (removed.has(item.id) ? historical : reports).push(item);
  if (!reports.length) return fail("no-applicable-report");
  if (
    reports.some(
      (i) =>
        invalid.has(i.id) ||
        product.items.filter((x) => x.id === i.id).length !== 1,
    )
  )
    reasons.push("conflict");
  if (reports.some((i) => !i.usable || i.version !== 3))
    reasons.push("metadata-incomplete");
  if (reports.length > 1) reasons.push("multiple-reports");
  for (const report of reports) {
    const m = metadata(report);
    if (
      typeof m.applicability?.coverage !== "string" ||
      normalized(m.applicability.coverage) !== normalized(scope.coverage)
    )
      reasons.push("scope-definition-changed");
    for (const prefix of ["target", "goal"] as const) {
      const definition = prefix === "target" ? target : goal;
      const name = prefix === "target" ? "definition" : "goal-definition";
      const algorithm = m[`${prefix}_definition_algorithm`],
        digest = m[`${prefix}_definition_sha256`],
        basis = m[`${prefix}_basis`];
      if (
        [
          "vnext-product-definition/v1",
          "vnext-requirement-definition/v1",
        ].includes(algorithm || "") &&
        algorithm !== definition.definitionAlgorithm
      )
        reasons.push("definition-algorithm-changed");
      if (
        algorithm === definition.definitionAlgorithm &&
        digest &&
        digest !== definition.definitionSha256
      )
        reasons.push(`${name}-changed`);
      const checked = product.sources.find(
        (s) => s.ownerKey === report.key && s.role === `${prefix}_basis`,
      );
      if (
        !digest ||
        !basis ||
        basis.kind !== "file" ||
        basis.item_id !== definition.id ||
        algorithm !== definition.definitionAlgorithm ||
        checked?.readState !== "read" ||
        checked.locationState !== "located" ||
        checked.definitionAlgorithm !== algorithm ||
        checked.definitionSha256 !== digest ||
        checked.byteState === "changed"
      )
        reasons.push(`${name}-unverified`);
    }
    if (m.pending_sources?.length) reasons.push("pending-evidence");
  }
  return result();
}
/** Filter the registered subsequence. Parent nodes are added separately as graph context. */
export function goalRequirements(product: ProductSnapshot, goalKey?: string) {
  const model = productView(product);
  if (!goalKey) return [...model.registered, ...model.unordered];
  const reaches = (
    from: string,
    to: string,
    seen = new Set<string>(),
  ): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return model.relations.some(
      (r) =>
        r.ownerKey === from &&
        r.targetKey &&
        ["part_of", "supports"].includes(r.link.relation) &&
        reaches(r.targetKey, to, seen),
    );
  };
  return [...model.registered, ...model.unordered].filter((i) =>
    reaches(i.key, goalKey),
  );
}
export function reportedSubjects(product: ProductSnapshot): Subject[] {
  return [
    ...new Map(
      product.items
        .filter((i) => i.type === "assessment")
        .map(metadata)
        .filter(
          (m) => m.subject && m.subject.kind !== "unknown" && m.subject.value,
        )
        .map((m) => [subjectKey(m.subject), m.subject!]),
    ).values(),
  ];
}
