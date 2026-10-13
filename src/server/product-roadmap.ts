/**
 * Read-only adapter of vNext roadmaps.ts and scoped.ts (MIT), pinned at
 * dcf7b0af7a65c53bde7218eac3a3639921d59d31. See product-assets/PROVENANCE.md.
 * The only supported-format addition is v5, which inherits v4 semantics.
 * Filesystem access is deliberately absent: all checks use this PRODUCT snapshot.
 */
import { createHash } from "node:crypto";
import {
  productDefinitionDigest,
  requirementDefinitionDigest,
} from "./product-parser.js";
import type {
  ProductItem,
  ProductSnapshot,
  ProductSource,
} from "../shared/product-types.js";
import {
  roadmapProductVersion,
  scopedProductVersion,
} from "../shared/product-roadmap.js";
import type {
  ProductArrangementSnapshot,
  ProductDefinitionSnapshot,
  ProductPlanningBaseline,
  ProductPlanningScope,
  ProductPlanningSelector,
  ProductRoadmapResult,
} from "../shared/product-roadmap.js";

const ARRANGEMENT = "vnext-roadmap-arrangement/v1";
const GRAPH = "vnext-planning-context/v1";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function canonicalPlanning(value: unknown): string {
  function ordered(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(ordered);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, ordered((v as Record<string, unknown>)[k])]),
      );
    if (typeof v === "string") return v.replace(/\r\n|\r/g, "\n");
    return v;
  }
  return JSON.stringify(ordered(value));
}
const same = (a: unknown, b: unknown): boolean =>
  canonicalPlanning(a) === canonicalPlanning(b);
const unique = (ids: string[]): string[] => [...new Set(ids)].sort();
const locator = (item: ProductItem): ProductSource => ({
  kind: "file",
  path: item.source.path,
  item_id: item.id,
});
const snapshot = (item: ProductItem): ProductDefinitionSnapshot => ({
  id: item.id,
  algorithm:
    item.definitionAlgorithm ??
    (scopedProductVersion(item.version)
      ? "vnext-product-definition/v1"
      : "vnext-requirement-definition/v1"),
  // Production recomputes material hashes, including old goals and conflicting
  // scopes. The corresponding scope reasons still prevent a current result.
  sha256: scopedProductVersion(item.version)
    ? productDefinitionDigest(item, false)
    : requirementDefinitionDigest(item),
});
const available = (product: ProductSnapshot) =>
  Boolean(product.manifest) &&
  ["ready", "partial", "empty"].includes(product.status);
function index(product: ProductSnapshot) {
  return new Map(
    product.items
      .filter(
        (i) =>
          i.usable &&
          product.items.filter((other) => other.id === i.id).length === 1,
      )
      .map((i) => [i.id, i]),
  );
}
export function arrangementSnapshot(
  plan: ProductItem,
): ProductArrangementSnapshot {
  const { id, intent_state, targets, work_items } = plan.metadata;
  const work = (work_items ?? []).map(
    ({ sources: _sources, ...arrangement }) => arrangement,
  );
  return {
    algorithm: ARRANGEMENT,
    sha256: sha256(
      `${ARRANGEMENT}\n${canonicalPlanning({ id, intent_state, targets, work_items: work, body: plan.body.replace(/\r\n|\r/g, "\n").replace(/\n+$/, "") })}`,
    ),
  };
}
/** The production graph is distinct from Task relations and excludes inferred edges. */
function planningGraph(
  product: ProductSnapshot,
  byId: Map<string, ProductItem>,
) {
  const diagnostics: { owner?: string; goal_id?: string }[] = [];
  const relations = product.items
    .filter((i) => i.usable)
    .flatMap((owner) =>
      (owner.metadata.links ?? [])
        .filter(
          (l) =>
            l.origin === "declared" &&
            l.state === "active" &&
            ["part_of", "supports", "depends_on"].includes(l.relation),
        )
        .map((l) => ({ owner: owner.id, ...l })),
    );
  const legal = relations.filter((r) => {
    const owner = byId.get(r.owner),
      target = byId.get(r.target);
    if (!owner || !target || r.owner === r.target) return false;
    if (r.relation === "supports")
      return (
        [
          "requirement",
          "module",
          ...(scopedProductVersion(owner.version) ? ["goal"] : []),
        ].includes(owner.type) && target.type === "goal"
      );
    if (r.relation === "depends_on")
      return (
        ["requirement", "design"].includes(owner.type) &&
        ["requirement", "design"].includes(target.type)
      );
    return (
      (owner.type === "module" && target.type === "module") ||
      (owner.type === "requirement" &&
        (target.type === "module" ||
          (scopedProductVersion(owner.version) &&
            target.type === "requirement"))) ||
      (scopedProductVersion(owner.version) &&
        owner.type === "goal" &&
        target.type === "goal")
    );
  });
  const reaches = (from: string, to: string, relation: string): boolean => {
    const pending = [from],
      seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of legal)
        if (edge.owner === current && edge.relation === relation)
          pending.push(edge.target);
    }
    return false;
  };
  const current = legal.filter((r) => !reaches(r.target, r.owner, r.relation));
  for (const r of relations.filter((r) => !current.includes(r)))
    diagnostics.push({ owner: r.owner });
  for (const goal of product.items.filter(
    (i) => i.usable && i.type === "goal" && scopedProductVersion(i.version),
  )) {
    const seen = new Set<string>();
    for (const scope of goal.metadata.assessment_scopes ?? []) {
      const target = byId.get(scope.target),
        key = JSON.stringify([scope.target, scope.scope_id]);
      if (
        seen.has(key) ||
        !target ||
        (target.type !== "requirement" && target !== goal)
      )
        diagnostics.push({ goal_id: goal.id });
      seen.add(key);
    }
  }
  return { current, diagnostics };
}
/** Deterministic selectors, membership, definition and context snapshots. */
export function planningScope(
  product: ProductSnapshot,
  selector: ProductPlanningSelector,
  plan?: ProductItem,
): ProductPlanningScope {
  const byId = index(product),
    reasons: string[] = [],
    exclude = new Set(selector.exclude_ids ?? []);
  const all = product.items.filter(
    (i) =>
      i.usable && i.type === "requirement" && i.metadata.scope === "current",
  );
  const view = planningGraph(product, byId);
  const relations = view.current.filter(
    (r) =>
      ["part_of", "supports"].includes(r.relation) &&
      byId.get(r.owner)?.metadata.scope === "current" &&
      byId.get(r.target)?.metadata.scope === "current",
  );
  const contextSnapshot = (item: ProductItem): ProductDefinitionSnapshot =>
    item.type === "goal"
      ? snapshot(item)
      : {
          id: item.id,
          algorithm: GRAPH,
          sha256: sha256(
            `${GRAPH}\n${canonicalPlanning({
              id: item.id,
              scope: item.metadata.scope,
              relations: relations
                .filter((r) => r.owner === item.id)
                .map((r) => [r.relation, r.target])
                .sort(),
            })}`,
          ),
        };
  let selected: string[] = [],
    context: ProductDefinitionSnapshot[] = [],
    reachable = new Set<string>();
  // coverage.paths contains files in TraceLens, not upstream selection patterns.
  // Require the separate reader-attested registeredPaths as well as complete reads.
  if (
    !product.coverage.complete ||
    !product.coverage.registeredPaths ||
    !same(
      unique(product.coverage.registeredPaths),
      unique(product.manifest?.managed_paths ?? []),
    )
  )
    reasons.push("enumeration-incomplete");
  if (product.diagnostics.some((d) => d.severity === "error" && !d.itemId))
    reasons.push("identity-coverage-incomplete");
  if (selector.kind === "explicit-requirements") {
    selected = selector.requirement_ids.filter((id) => !exclude.has(id));
    for (const id of selected)
      if (byId.get(id)?.type !== "requirement")
        reasons.push(`requirement-unavailable:${id}`);
    selected = selected.filter(
      (id) =>
        byId.get(id)?.type === "requirement" &&
        byId.get(id)?.metadata.scope === "current",
    );
  } else {
    if (product.diagnostics.some((d) => d.severity === "error"))
      reasons.push("structure-incomplete");
    if (selector.kind === "project-current") selected = all.map((i) => i.id);
    else if (selector.kind === "target-subgraph") {
      reachable = new Set(selector.target_ids.filter((id) => !exclude.has(id)));
      for (const id of reachable) {
        const item = byId.get(id);
        if (
          !item ||
          !["goal", "requirement"].includes(item.type) ||
          item.metadata.scope !== "current"
        )
          reasons.push(`target-unavailable:${id}`);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of relations)
          if (
            reachable.has(r.target) &&
            !reachable.has(r.owner) &&
            !exclude.has(r.owner)
          ) {
            reachable.add(r.owner);
            changed = true;
          }
      }
      if (view.diagnostics.some((d) => reachable.has((d.owner ?? d.goal_id)!)))
        reasons.push("scope-relations-invalid");
      selected = all.filter((i) => reachable.has(i.id)).map((i) => i.id);
      context = product.items
        .filter(
          (i) =>
            i.usable &&
            reachable.has(i.id) &&
            ["goal", "module"].includes(i.type),
        )
        .map(contextSnapshot);
    } else reasons.push("selector-unsupported");
    selected = selected.filter((id) => !exclude.has(id));
  }
  if (!available(product)) reasons.push("catalog-unavailable");
  selected = unique(selected);
  if (selector.kind !== "target-subgraph") {
    const ancestry = new Set([
      ...selected,
      ...(plan?.metadata.targets ?? []).map((t) => t.target),
    ]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of relations)
        if (ancestry.has(r.owner) && !ancestry.has(r.target)) {
          ancestry.add(r.target);
          changed = true;
        }
    }
    context = product.items
      .filter(
        (i) =>
          i.usable &&
          ancestry.has(i.id) &&
          i.metadata.scope === "current" &&
          ["goal", "module"].includes(i.type),
      )
      .map(contextSnapshot);
    if (view.diagnostics.some((d) => ancestry.has((d.owner ?? d.goal_id)!)))
      reasons.push("scope-relations-invalid");
  }
  for (const d of context)
    if (d.algorithm === "vnext-requirement-definition/v1")
      reasons.push(`goal-format-uncomparable:${d.id}`);
  if (
    (selector.kind === "explicit-requirements" &&
      unique(selector.requirement_ids).length !==
        selector.requirement_ids.length) ||
    (selector.kind === "target-subgraph" &&
      unique(selector.target_ids).length !== selector.target_ids.length)
  )
    reasons.push("selector-duplicate");
  return {
    selector,
    member_ids: selected,
    definitions: selected.map((id) => snapshot(byId.get(id)!)),
    context: context.sort((a, b) => a.id.localeCompare(b.id)),
    definition_locators: selected.map((id) => ({
      id,
      locator: locator(byId.get(id)!),
    })),
    outside_scope: all
      .filter((i) => !selected.includes(i.id))
      .map((i) => i.id)
      .sort(),
    unassigned:
      selector.kind === "target-subgraph"
        ? all
            .filter(
              (i) =>
                !reachable.has(i.id) &&
                !relations.some((r) => r.owner === i.id),
            )
            .map((i) => i.id)
            .sort()
        : [],
    reasons: unique(reasons),
    complete: !reasons.length,
  };
}
const validTime = (time: string): boolean =>
  /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(time) && Number.isFinite(Date.parse(time));
function baselineSourcesAvailable(
  product: ProductSnapshot,
  plan: ProductItem,
  baseline: ProductPlanningBaseline,
): boolean {
  return [...baseline.sources, ...baseline.exceptions.flatMap((e) => e.sources)]
    .filter((s) => s.kind === "file")
    .every((source) => {
      const read = product.sources.find(
        (check) => check.ownerKey === plan.key && same(check.reference, source),
      );
      return (
        read?.readState === "read" &&
        read.locationState === "located" &&
        (!source.sha256 || read.byteState === "same-bytes")
      );
    });
}
/** Pure production comparison, with no writes, helper execution, or Runtime calls. */
export function reconcileRoadmap(
  product: ProductSnapshot,
  query: { plan_id: string; selector?: ProductPlanningSelector },
): ProductRoadmapResult {
  const plan = index(product).get(query.plan_id),
    baseline = plan?.metadata.planning_baseline;
  const reasons: string[] = [],
    changes: ProductRoadmapResult["changes"] = [],
    selector = query.selector ?? baseline?.selector;
  const result: ProductRoadmapResult = {
    planKey: plan?.key ?? "",
    plan_id: query.plan_id,
    status: "unknown",
    reasons,
    changes,
    development_gate: false,
    business_validity: "not-evaluated",
    delivery: "not-evaluated",
    task_operations: "not-performed",
  };
  if (!plan || plan.type !== "plan") {
    reasons.push("roadmap-unavailable");
    return result;
  }
  const works = plan.metadata.work_items ?? [];
  result.locator = locator(plan);
  result.intent_state = plan.metadata.intent_state;
  result.work_items = works;
  result.diagnostics = product.diagnostics.filter((d) => d.itemId === plan.id);
  if (
    result.diagnostics.some((d) =>
      [
        "DUPLICATE_WORK_ITEM",
        "UNRESOLVED_TARGET",
        "TARGET_TYPE",
        "WORK_DEPENDENCY_MISSING",
        "WORK_DEPENDENCY_CYCLE",
      ].includes(d.code),
    )
  )
    reasons.push("roadmap-references-unresolved");
  if (!selector) {
    reasons.push("baseline-missing", "selector-required");
    return result;
  }
  const current = planningScope(product, selector, plan),
    arrangement = arrangementSnapshot(plan);
  result.scope = current;
  result.arrangement = arrangement;
  reasons.push(...current.reasons);
  result.unarranged_requirements = current.member_ids.filter(
    (id) =>
      !works.some(
        (w) =>
          w.state !== "withdrawn" && w.targets.some((t) => t.target === id),
      ),
  );
  result.snapshot_proposal = {
    project_id: product.manifest?.project_id,
    selector,
    member_ids: current.member_ids,
    definitions: current.definitions,
    context: current.context,
    arrangement,
  };
  result.proposal_assurance =
    "not-reviewed; supply actual checked_at, working_copy, sources, unread_sources and exceptions only after semantic review";
  if (!roadmapProductVersion(plan.version))
    reasons.push("format-without-baseline");
  if (!baseline) reasons.push("baseline-missing");
  else {
    if (!same(selector, baseline.selector)) reasons.push("selector-differs");
    if (baseline.project_id !== product.manifest?.project_id)
      reasons.push("project-identity-differs");
    if (baseline.working_copy !== product.workingCopy)
      reasons.push("working-copy-differs");
    if (!validTime(baseline.checked_at)) reasons.push("baseline-time-invalid");
    if (baseline.unread_sources.length) reasons.push("unread-sources");
    if (unique(baseline.member_ids).length !== baseline.member_ids.length)
      reasons.push("baseline-members-duplicate");
    for (const id of current.member_ids.filter(
      (id) => !baseline.member_ids.includes(id),
    ))
      changes.push({ kind: "member-added", id });
    for (const id of baseline.member_ids.filter(
      (id) => !current.member_ids.includes(id),
    ))
      changes.push({ kind: "member-exited", id });
    for (const field of ["definitions", "context"] as const) {
      if (
        unique(baseline[field].map((d) => d.id)).length !==
        baseline[field].length
      )
        reasons.push(`${field}-duplicate`);
      for (const d of current[field]) {
        const old = baseline[field].find((o) => o.id === d.id);
        if (!old) {
          if (field === "definitions" && !baseline.member_ids.includes(d.id))
            continue;
          reasons.push(`definition-unreviewed:${d.id}`);
          continue;
        }
        if (old.algorithm !== d.algorithm)
          reasons.push(`algorithm-incomparable:${d.id}`);
        else if (old.sha256 !== d.sha256)
          changes.push({
            kind: "definition-changed",
            id: d.id,
            before: old,
            after: d,
          });
      }
      for (const old of baseline[field])
        if (!current[field].some((d) => d.id === old.id)) {
          if (field === "context")
            changes.push({ kind: "context-exited", id: old.id });
          else if (!baseline.member_ids.includes(old.id))
            reasons.push(`snapshot-outside-members:${old.id}`);
        }
    }
    if (baseline.arrangement.algorithm !== arrangement.algorithm)
      reasons.push("arrangement-algorithm-incomparable");
    else if (baseline.arrangement.sha256 !== arrangement.sha256)
      changes.push({
        kind: "arrangement-changed",
        before: baseline.arrangement,
        after: arrangement,
      });
    result.exceptions = baseline.exceptions.filter(
      (e) =>
        current.definitions.some(
          (d) =>
            d.id === e.target &&
            d.algorithm === e.algorithm &&
            d.sha256 === e.sha256,
        ) &&
        (e.work_item_ids ?? []).every((id) => works.some((w) => w.id === id)),
    );
    result.stale_exceptions = baseline.exceptions.filter(
      (e) => !result.exceptions!.includes(e),
    );
    if (!baselineSourcesAvailable(product, plan, baseline))
      reasons.push("baseline-source-unavailable");
  }
  const affected = unique(changes.flatMap((c) => (c.id ? [c.id] : [])));
  result.affected_work_items = works
    .filter((w) => w.targets.some((t) => affected.includes(t.target)))
    .map((w) => w.id);
  result.change_sources = product.items
    .filter(
      (i) =>
        i.usable &&
        i.type === "change" &&
        i.metadata.deltas?.some(
          (d) => affected.includes(d.target) || d.target === plan.id,
        ),
    )
    .map((i) => ({ id: i.id, locator: locator(i), basis: i.metadata.basis }));
  result.status = reasons.length
    ? "unknown"
    : changes.length
      ? "changes-pending"
      : result.exceptions?.some((e) => e.disposition === "deferred")
        ? "reviewed-deferred"
        : "current";
  return result;
}
export function reconcileProductRoadmaps(
  product: ProductSnapshot,
): ProductRoadmapResult[] {
  return product.items
    .filter((item) => item.type === "plan")
    .map((item) => ({
      ...reconcileRoadmap(product, { plan_id: item.id }),
      planKey: item.key,
    }));
}
