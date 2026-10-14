import type { Document } from "../shared/types.js";
import type { ProductItem, ProductSnapshot } from "../shared/product-types.js";
import {
  parseProductDocument,
  productDefinitionDigest,
} from "./product-parser.js";

/** Compare the captured goal for this scope, retaining its body, kind and relations. */
export function reconcileAssessmentScopes(
  product: ProductSnapshot | undefined,
  documents: Document[],
): void {
  if (!product) return;
  const parsed = new Map<string, ProductItem[]>();
  for (const check of product.sources) {
    delete check.goalScopeComparison;
    if (check.role !== "goal_basis" || check.reference.kind !== "file")
      continue;
    const reference = check.reference;
    const report = product.items.find((item) => item.key === check.ownerKey);
    const applicability = report?.metadata.applicability;
    const goals = product.items.filter(
      (item) => item.id === applicability?.goal_id,
    );
    const goal = goals.length === 1 ? goals[0] : undefined;
    if (
      !report?.usable ||
      !goal?.usable ||
      goal.type !== "goal" ||
      report.metadata.target === goal.id ||
      !applicability ||
      goal.definitionAlgorithm !== "vnext-product-definition/v1" ||
      report.metadata.goal_definition_algorithm !== goal.definitionAlgorithm ||
      !goal.definitionSha256 ||
      !report.metadata.goal_definition_sha256 ||
      check.definitionAlgorithm !== goal.definitionAlgorithm ||
      check.definitionSha256 !== report.metadata.goal_definition_sha256 ||
      check.readState !== "read" ||
      check.locationState !== "located" ||
      check.byteState !== "same-bytes" ||
      !check.source ||
      reference.item_id !== goal.id ||
      !reference.sha256
    )
      continue;
    if (check.definitionSha256 === goal.definitionSha256) continue;
    const source = check.source;
    const document = documents.find(
      (item) =>
        item.id === source.documentId &&
        item.path === reference.path &&
        item.digest === reference.sha256 &&
        item.digest === source.digest &&
        !item.contentOmitted,
    );
    if (!document) continue;
    if (!parsed.has(document.id))
      parsed.set(
        document.id,
        parseProductDocument("assessment-basis", document.path, {
          path: document.path,
          raw: document.raw,
          digest: document.digest,
          kind: "unclassified",
          bytes: document.bytes,
          modifiedAt: document.modifiedAt,
        }).items,
      );
    const oldGoals = parsed
      .get(document.id)!
      .filter((item) => item.id === goal.id);
    const previous = oldGoals.length === 1 ? oldGoals[0] : undefined;
    if (
      !previous?.usable ||
      previous.type !== "goal" ||
      previous.definitionAlgorithm !== goal.definitionAlgorithm ||
      previous.definitionSha256 !== check.definitionSha256 ||
      productDefinitionDigest(goal) !== goal.definitionSha256
    )
      continue;
    const scopedDigest = (item: ProductItem) => {
      const scopes = item.metadata.assessment_scopes?.filter(
        (scope) =>
          scope.target === report.metadata.target &&
          scope.scope_id === applicability.scope_id,
      );
      if (scopes?.length !== 1) return null;
      return productDefinitionDigest({
        ...item,
        metadata: { ...item.metadata, assessment_scopes: scopes },
      });
    };
    const before = scopedDigest(previous),
      after = scopedDigest(goal);
    check.goalScopeComparison = {
      target: report.metadata.target!,
      scopeId: applicability.scope_id,
      basisDefinitionSha256: check.definitionSha256,
      currentDefinitionSha256: goal.definitionSha256,
      same: Boolean(before && after && before === after),
    };
  }
}
