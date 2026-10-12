import type { ProductItem, ProductSnapshot } from "./product-types.js";
import { goalRequirements, productView } from "./product-view.js";

const structural = (relation: string) =>
  ["part_of", "supports"].includes(relation);

/** Read-only explanation of recorded paths. Never adopts a candidate relation. */
export function productStructure(
  product: ProductSnapshot,
  goalKey?: string,
  focusKey?: string,
) {
  const model = productView(product);
  const goalId = product.items.find((i) => i.key === goalKey)?.id;
  const focusId = product.items.find((i) => i.key === focusKey)?.id;
  const formal = goalRequirements(product, goalKey);
  const formalKeys = new Set(formal.map((item) => item.key));
  const candidates = product.relations.filter(
    (r) =>
      structural(r.link.relation) &&
      r.link.origin === "inferred" &&
      r.link.state === "active",
  );
  const recorded = [...model.relations, ...candidates].filter(
    (r) =>
      structural(r.link.relation) && r.resolution === "resolved" && r.targetKey,
  );
  const contextKeys = new Set<string>(goalKey ? [goalKey] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of recorded)
      if (contextKeys.has(r.targetKey!) && !contextKeys.has(r.ownerKey)) {
        contextKeys.add(r.ownerKey);
        changed = true;
      }
  }
  const relatedCandidates = candidates.filter(
    (r) =>
      contextKeys.has(r.ownerKey) ||
      (r.targetKey && contextKeys.has(r.targetKey)) ||
      r.link.target === goalId ||
      (focusKey &&
        (r.ownerKey === focusKey ||
          r.targetKey === focusKey ||
          r.link.target === focusId)),
  );
  const goals = product.items.filter(
    (i) =>
      i.usable &&
      i.type === "goal" &&
      i.metadata.scope === "current" &&
      i.key !== goalKey,
  );
  const otherPaths = goals.map((goal) => ({
    goal,
    keys: new Set(goalRequirements(product, goal.key).map((i) => i.key)),
  }));
  // Keep registered relative order; retain readable invalid identities as separate entries.
  const requirements = [
    ...model.registered,
    ...model.unordered,
    ...product.items.filter((i) => i.type === "requirement"),
  ].filter((i, n, all) => all.findIndex((x) => x.key === i.key) === n);
  const unlinked = requirements
    .filter((i) => !goalKey || !formalKeys.has(i.key))
    .map((item) => {
      const reasons: string[] = [];
      const otherGoals = otherPaths
        .filter((p) => p.keys.has(item.key))
        .map((p) => p.goal);
      const incident = product.relations.filter(
        (r) =>
          structural(r.link.relation) &&
          r.link.state === "active" &&
          (r.ownerKey === item.key ||
            r.targetKey === item.key ||
            r.link.target === item.id),
      );
      if (!goalKey) reasons.push("未明确所选目标");
      if (item.metadata.scope !== "current")
        reasons.push(`不在当前范围（${item.metadata.scope || "未声明"}）`);
      if (otherGoals.length) reasons.push("已有其他目标的声明路径");
      if (goalKey && contextKeys.has(item.key))
        reasons.push("已有候选路径，尚未进入正式图");
      if (
        !item.usable ||
        product.items.filter((i) => i.id === item.id).length !== 1 ||
        incident.some(
          (r) =>
            r.resolution !== "resolved" ||
            (r.link.origin === "declared" && !model.relations.includes(r)),
        )
      )
        reasons.push("引用、方向或身份异常，查看来源与诊断");
      if (!reasons.length) reasons.push("核心关系未记录或尚未确定");
      return { item, reasons, otherGoals };
    });
  return {
    formal,
    candidates,
    relatedCandidates,
    unlinked,
    currentUnlinked: unlinked.filter(
      (r) => r.item.metadata.scope === "current",
    ),
    incomplete: !product.coverage.complete,
  };
}

/** Goal nodes select their own declaration; modules are not assessment targets. */
export function assessmentGoal(item: ProductItem, selectedGoal?: ProductItem) {
  return item.type === "goal"
    ? item
    : item.type === "requirement"
      ? selectedGoal
      : undefined;
}
