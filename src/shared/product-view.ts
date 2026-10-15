// Deterministic VN-01 consumer, adapted from upstream scoped.ts (MIT).
import { scopedProductVersion } from "./product-roadmap.js";
import {
  definitionReviewIssues,
  assessmentReviewCategory,
  evidenceReuseReasonLabels,
  reportReviewSources,
  reviewReference,
  reviewSourceStatus,
  reviewValue,
  type AssessmentReviewIssue,
} from "./assessment-review.js";
import {
  assessmentEvidence,
  dispositionSourceKey,
} from "./evidence-dispositions.js";
import type {
  ProductItem,
  ProductMetadata,
  ProductSnapshot,
  EvidenceDispositionView,
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
  reviewIssues?: { reportKey: string; issue: AssessmentReviewIssue }[];
  evidenceDispositions?: {
    reportKey: string;
    disposition: EvidenceDispositionView;
  }[];
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
  const reviewIssues: NonNullable<AssessmentSelection["reviewIssues"]> = [];
  const evidenceDispositions: NonNullable<
    AssessmentSelection["evidenceDispositions"]
  > = [];
  const review = (report: ProductItem, issue: AssessmentReviewIssue) =>
    reviewIssues.push({
      reportKey: report.key,
      issue: {
        ...issue,
        category: issue.category || assessmentReviewCategory(issue.code),
      },
    });
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
    reviewIssues,
    ...(evidenceDispositions.length ? { evidenceDispositions } : {}),
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
  if (!goal || goal.type !== "goal" || !scopedProductVersion(goal.version))
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
  const conflicts = new Map<
    string,
    { detail: string; related: ProductItem[] }[]
  >();
  const conflict = (
    report: ProductItem,
    detail: string,
    related: ProductItem[],
  ) =>
    conflicts.set(report.key, [
      ...(conflicts.get(report.key) || []),
      { detail, related },
    ]);
  for (const item of all) {
    const valid: string[] = [];
    const supersedes = metadata(item).supersedes;
    for (const id of Array.isArray(supersedes) ? supersedes : []) {
      const found = product.items.filter((i) => i.id === id);
      if (found.length !== 1 || !all.includes(found[0])) {
        invalid.add(item.id);
        let detail = `supersedes 引用 ${id}，但该条目不属于相同需求、目标、范围和交付对象的验收报告。`;
        if (!found.length) detail = `supersedes 引用 ${id}，但未找到对应条目。`;
        else if (found.length > 1)
          detail = `supersedes 引用 ${id}，但存在 ${found.length} 个同 ID 条目，无法唯一确认。`;
        conflict(item, detail, [item, ...found]);
      } else valid.push(id);
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
      if (reaches(id, item.id)) {
        invalid.add(item.id);
        const cycle = all.filter(
          (candidate) =>
            reaches(item.id, candidate.id) && reaches(candidate.id, item.id),
        );
        conflict(
          item,
          `报告替代关系形成循环，涉及：${cycle.map((candidate) => candidate.id).join("、")}。`,
          cycle,
        );
      } else removed.add(id);
    }
  for (const item of all)
    (removed.has(item.id) ? historical : reports).push(item);
  if (!reports.length) return fail("no-applicable-report");
  let reportConflict = false,
    metadataIncomplete = false;
  for (const report of reports) {
    if (
      invalid.has(report.id) ||
      product.items.filter((x) => x.id === report.id).length !== 1
    ) {
      reportConflict = true;
      const details = [...(conflicts.get(report.key) || [])];
      const duplicates = product.items.filter((item) => item.id === report.id);
      if (duplicates.length > 1)
        details.push({
          detail: `存在 ${duplicates.length} 个 ID 为 ${report.id} 的条目，无法唯一确认报告。`,
          related: duplicates,
        });
      const related = [...new Set(details.flatMap((entry) => entry.related))];
      review(report, {
        code: "report-conflict",
        title: "报告标识或替代关系冲突",
        detail: details.map((entry) => entry.detail).join("；"),
        action:
          "核对涉及报告的 ID、目标、范围及交付对象；修正替代关系并明确仍适用的报告。",
        sources: reportReviewSources(related),
      });
    }
    if (!report.usable || !scopedProductVersion(report.version)) {
      metadataIncomplete = true;
      review(report, {
        code: "report-metadata-incomplete",
        title: "报告字段不完整或版本不受支持",
        detail:
          report.diagnostics
            .map((diagnostic) => `${diagnostic.code}：${diagnostic.message}`)
            .join("；") ||
          `报告 ${report.id} 未通过元数据校验，或其版本不能用于当前范围验收。`,
        action:
          "根据报告字段诊断补齐或修正元数据，使用受支持的报告版本后重新核验。",
        sources: reportReviewSources([report]),
      });
    }
  }
  if (reportConflict) reasons.push("conflict");
  if (metadataIncomplete) reasons.push("metadata-incomplete");
  if (reports.length > 1) {
    reasons.push("multiple-reports");
    for (const report of reports)
      review(report, {
        code: "multiple-reports",
        title: "同一验收对象存在多份当前报告",
        detail: `相同需求、目标、范围和交付对象下，有 ${reports.length} 份未被明确替代的报告：${reports.map((item) => item.id).join("、")}。`,
        action:
          "逐份核对报告适用范围及结论，确认有效报告，并通过明确的 supersedes 关系处理旧报告。",
        sources: reportReviewSources(reports),
      });
  }
  for (const report of reports) {
    const m = metadata(report);
    if (
      typeof m.applicability?.coverage !== "string" ||
      normalized(m.applicability.coverage) !== normalized(scope.coverage)
    ) {
      reasons.push("scope-definition-changed");
      review(report, {
        code: "scope-definition-changed",
        ...(typeof m.applicability?.coverage === "string"
          ? {
              scopeChange: {
                targetKey: target.key,
                targetId: target.id,
                goalKey: goal.key,
                goalId: goal.id,
                scopeId: scope.scope_id,
                recordedCoverage: m.applicability.coverage,
                currentCoverage: scope.coverage,
              },
            }
          : {}),
        title: "验收覆盖范围变化",
        detail: `报告记录的范围 ${scope.scope_id} 与当前目标声明的覆盖范围不一致。`,
        action:
          "逐项比较报告覆盖范围与当前范围，补核新增或变化部分；必要时重新验收。",
        comparisons: [
          {
            label: "验收覆盖范围",
            recorded: reviewValue(m.applicability?.coverage),
            current: scope.coverage,
          },
        ],
        sources: [
          ...reportReviewSources([report]),
          { label: `当前目标 ${goal.id} 的范围声明`, source: goal.source },
        ],
      });
    }
    for (const prefix of ["target", "goal"] as const) {
      const definition = prefix === "target" ? target : goal;
      const name = prefix === "target" ? "definition" : "goal-definition";
      const algorithm = m[`${prefix}_definition_algorithm`],
        digest = m[`${prefix}_definition_sha256`],
        basis = m[`${prefix}_basis`];
      const checked = product.sources.find(
        (s) => s.ownerKey === report.key && s.role === `${prefix}_basis`,
      );
      const comparison = checked?.goalScopeComparison;
      // A verified captured goal may differ only in other assessment scopes.
      // Its original whole-definition digest remains checked against the source below.
      const sameGoalScope =
        prefix === "goal" &&
        target !== goal &&
        comparison?.same &&
        comparison.target === target.id &&
        comparison.scopeId === scope.scope_id &&
        comparison.basisDefinitionSha256 === digest &&
        comparison.currentDefinitionSha256 === definition.definitionSha256;
      const algorithmChanged =
        [
          "vnext-product-definition/v1",
          "vnext-requirement-definition/v1",
        ].includes(algorithm || "") &&
        algorithm !== definition.definitionAlgorithm;
      if (algorithmChanged) reasons.push("definition-algorithm-changed");
      const definitionChanged = Boolean(
        algorithm === definition.definitionAlgorithm &&
        digest &&
        digest !== definition.definitionSha256 &&
        !sameGoalScope,
      );
      if (definitionChanged) reasons.push(`${name}-changed`);
      const unverified =
        !digest ||
        !basis ||
        basis.kind !== "file" ||
        basis.item_id !== definition.id ||
        algorithm !== definition.definitionAlgorithm ||
        checked?.readState !== "read" ||
        checked.locationState !== "located" ||
        checked.definitionAlgorithm !== algorithm ||
        checked.definitionSha256 !== digest ||
        checked.byteState === "changed";
      if (unverified) reasons.push(`${name}-unverified`);
      for (const issue of definitionReviewIssues({
        prefix,
        definition,
        algorithm,
        digest,
        basis,
        checked,
        algorithmChanged,
        definitionChanged,
        unverified,
      }))
        review(report, issue);
    }
    const evidence = assessmentEvidence(product, report);
    evidenceDispositions.push(
      ...evidence.evidence_dispositions.map((disposition) => ({
        reportKey: report.key,
        disposition,
      })),
    );
    if (evidence.pending_sources.length) {
      reasons.push("pending-evidence");
      for (const reference of evidence.pending_sources) {
        const index = (m.pending_sources || []).findIndex(
          (source) =>
            dispositionSourceKey(source) === dispositionSourceKey(reference),
        );
        const dispositions = evidence.evidence_dispositions.filter(
          (entry) =>
            dispositionSourceKey(entry.source) ===
            dispositionSourceKey(reference),
        );
        const kinds = [...new Set(dispositions.map((entry) => entry.kind))];
        const kind = kinds.length === 1 ? kinds[0] : undefined;
        const ids = [...new Set(dispositions.map((entry) => entry.change_id))];
        const checked = product.sources.find(
          (source) =>
            source.ownerKey === report.key &&
            source.role === `pending_sources[${index}]`,
        );
        const stale = dispositions
          .filter((entry) => entry.reuse_status === "not-reusable")
          .flatMap((entry) => entry.reuse_reasons);
        review(report, {
          code: "pending-evidence",
          category: kind || "unclassified",
          change: {
            ...(ids.length === 1 ? { id: ids[0] } : {}),
            kind,
            source: reference,
          },
          title: "报告登记了待对账材料",
          detail: `报告 ${report.id} 登记了此材料，尚未完成当前范围的对账。${stale.length ? `先前处置不再适用：${[...new Set(stale)].map((reason) => evidenceReuseReasonLabels[reason] || reason).join("、")}。` : ""}`,
          action:
            "按本次变化核对实际受影响的义务与证据；可复用依据未变的已记录处置。仅补核变化部分，不要求重跑整份需求验收。",
          sources: [
            {
              label: `待对账材料 ${index + 1}`,
              reference: reviewReference(reference),
              source: checked?.source || undefined,
              status: reviewSourceStatus(checked),
            },
          ],
        });
        if (dispositions.some((entry) => entry.reuse_status === "conflict"))
          review(report, {
            code: "disposition-conflict",
            category: "report-conflict",
            change: {
              ...(ids.length === 1 ? { id: ids[0] } : {}),
              kind,
              source: reference,
            },
            title: "同一材料的局部处置相互冲突",
            detail:
              "精确来源与当前范围下记录了不同处置，不能按时间或任取一条消除待核对。",
            action: "核对并纠正冲突的处置记录；保留真实延期和原报告结果。",
          });
      }
    }
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
        .map((item) => metadata(item).subject)
        .filter(
          (subject): subject is Subject =>
            subject != null &&
            ["working-copy", "commit", "release"].includes(subject.kind) &&
            typeof subject.value === "string" &&
            subject.value.length > 0 &&
            (subject.revision === undefined ||
              typeof subject.revision === "string") &&
            (subject.limitations === undefined ||
              typeof subject.limitations === "string"),
        )
        .map((subject) => [subjectKey(subject), subject]),
    ).values(),
  ];
}
