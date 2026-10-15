import type {
  EvidenceDispositionBasis,
  EvidenceDispositionView,
  ProductItem,
  ProductMetadata,
  ProductSnapshot,
  ProductSource,
} from "./product-types.js";

export const dispositionReportAlgorithm = "vnext-assessment-disposition/v1";
const normalize = (text: string): string => text.replace(/\r\n|\r/g, "\n");

export function canonicalDisposition(value: unknown): string {
  function ordered(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(ordered);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [
            key,
            ordered((input as Record<string, unknown>)[key]),
          ]),
      );
    return input;
  }
  return JSON.stringify(ordered(value));
}

export function dispositionSourceKey(source: ProductSource): string {
  const identity = { ...source };
  if ("note" in identity) delete identity.note;
  return canonicalDisposition(identity);
}

/** Shared with the server hash; no project code or hashing library runs in the UI. */
export function dispositionReportText(
  metadata: ProductMetadata,
  body: string,
): string {
  const { evidence_dispositions, pending_sources, sources, ...context } =
    metadata;
  return `${dispositionReportAlgorithm}\n${canonicalDisposition({
    metadata: context,
    body: normalize(body).replace(/\n+$/, ""),
  })}`;
}

export function dispositionBasis(
  product: ProductSnapshot,
  report: ProductItem,
): EvidenceDispositionBasis | null {
  if (
    !report.usable ||
    report.type !== "assessment" ||
    report.version !== 6 ||
    !report.dispositionSha256
  )
    return null;
  function unique(id: string | undefined): ProductItem | undefined {
    const items = product.items.filter((item) => item.id === id);
    return items.length === 1 && items[0].usable ? items[0] : undefined;
  }
  const m = report.metadata;
  const goal = unique(m.applicability?.goal_id),
    target = unique(m.target);
  if (
    !goal ||
    goal.type !== "goal" ||
    !target ||
    !["goal", "requirement"].includes(target.type) ||
    (target.type === "goal" && target !== goal) ||
    !m.subject?.value ||
    !["working-copy", "commit", "release"].includes(m.subject.kind)
  )
    return null;
  const declarations = goal.metadata.assessment_scopes || [];
  const keys = declarations.map((scope) =>
    canonicalDisposition([scope.target, scope.scope_id]),
  );
  if (
    new Set(keys).size !== keys.length ||
    declarations.some((scope) => {
      const item = unique(scope.target);
      return !item || (item.type !== "requirement" && item !== goal);
    })
  )
    return null;
  const scope = declarations.find(
    (scope) =>
      scope.target === m.target && scope.scope_id === m.applicability?.scope_id,
  );
  if (
    !scope ||
    !m.applicability ||
    normalize(scope.coverage) !== normalize(m.applicability.coverage) ||
    !target.definitionAlgorithm ||
    !target.definitionSha256 ||
    !goal.definitionAlgorithm ||
    !goal.definitionSha256
  )
    return null;
  const goalScopeDigest =
    target === goal
      ? goal.definitionSha256
      : goal.assessmentScopeDigests?.find(
          (entry) =>
            entry.target === target.id && entry.scope_id === scope.scope_id,
        )?.sha256;
  if (!goalScopeDigest) return null;
  return {
    target: target.id,
    goal_id: goal.id,
    scope_id: scope.scope_id,
    coverage: normalize(scope.coverage),
    subject: m.subject,
    target_definition_algorithm: target.definitionAlgorithm,
    target_definition_sha256: target.definitionSha256,
    goal_definition_algorithm: goal.definitionAlgorithm,
    goal_definition_sha256: goal.definitionSha256,
    goal_scope_definition_sha256: goalScopeDigest,
    report_sources: m.sources || [],
    report_algorithm: dispositionReportAlgorithm,
    report_sha256: report.dispositionSha256,
  };
}

function basisMatches(
  saved: EvidenceDispositionBasis,
  current: EvidenceDispositionBasis | null,
): boolean {
  if (!current) return false;
  const {
    goal_definition_sha256: savedGoal,
    report_sources: savedSources,
    ...before
  } = saved;
  const {
    goal_definition_sha256: currentGoal,
    report_sources: currentSources,
    ...after
  } = current;
  if (current.target === current.goal_id && savedGoal !== currentGoal)
    return false;
  if (canonicalDisposition(before) !== canonicalDisposition(after))
    return false;
  const currentKeys = new Set(currentSources.map(dispositionSourceKey));
  return savedSources.every((source) =>
    currentKeys.has(dispositionSourceKey(source)),
  );
}

/** Reuse affects only the exact pending source. Definition and conflict checks remain separate. */
export function assessmentEvidence(
  product: ProductSnapshot,
  report: ProductItem,
): {
  disposition_basis: EvidenceDispositionBasis | null;
  evidence_dispositions: EvidenceDispositionView[];
  pending_sources: ProductSource[];
  handled_sources: ProductSource[];
} {
  const pending = report.metadata.pending_sources || [];
  const basis = dispositionBasis(product, report);
  if (!report.usable || report.version !== 6)
    return {
      disposition_basis: null,
      evidence_dispositions: [],
      pending_sources: pending,
      handled_sources: [],
    };
  function sourceFresh(source: ProductSource, role: string): boolean {
    if (source.kind === "text") return true;
    if (source.kind !== "file" || !source.sha256) return false;
    const check = product.sources.find(
      (check) =>
        check.ownerKey === report.key &&
        check.role === role &&
        dispositionSourceKey(check.reference) === dispositionSourceKey(source),
    );
    return (
      check?.readState === "read" &&
      check.byteState === "same-bytes" &&
      check.locationState === "located"
    );
  }
  const rows: EvidenceDispositionView[] = (
    report.metadata.evidence_dispositions || []
  ).map((entry, index) => {
    const reasons: string[] = [];
    if (!basisMatches(entry.basis, basis)) reasons.push("basis-changed");
    if (
      !sourceFresh(entry.source, `evidence_dispositions[${index}].source`) ||
      (entry.sources || []).some(
        (source, sourceIndex) =>
          !sourceFresh(
            source,
            `evidence_dispositions[${index}].sources[${sourceIndex}]`,
          ),
      )
    )
      reasons.push("source-unverified");
    if (
      entry.disposition === "evidence-incorporated" &&
      !(report.metadata.sources || []).some(
        (source) =>
          dispositionSourceKey(source) === dispositionSourceKey(entry.source),
      )
    )
      reasons.push("evidence-not-incorporated");
    let status: EvidenceDispositionView["reuse_status"] = "reused";
    if (entry.disposition === "deferred") status = "deferred";
    if (reasons.length) status = "not-reusable";
    return { ...entry, reuse_status: status, reuse_reasons: reasons };
  });
  for (const row of rows) {
    if (row.reuse_status === "not-reusable") continue;
    const related = rows.filter(
      (other) =>
        other.reuse_status !== "not-reusable" &&
        dispositionSourceKey(other.source) === dispositionSourceKey(row.source),
    );
    if (new Set(related.map((other) => other.disposition)).size > 1)
      for (const other of related) {
        other.reuse_status = "conflict";
        other.reuse_reasons = ["conflicting-dispositions"];
      }
  }
  const handled = pending.filter((source) =>
    rows.some(
      (entry) =>
        entry.reuse_status === "reused" &&
        dispositionSourceKey(entry.source) === dispositionSourceKey(source),
    ),
  );
  const handledKeys = new Set(handled.map(dispositionSourceKey));
  return {
    disposition_basis: basis,
    evidence_dispositions: rows,
    pending_sources: pending.filter(
      (source) => !handledKeys.has(dispositionSourceKey(source)),
    ),
    handled_sources: handled,
  };
}
