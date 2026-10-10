import type {
  ProductItem,
  ProductRelation,
  ProductSnapshot,
} from "./product-types.js";

export function scopeGroups(
  product: ProductSnapshot,
  requirements: ProductItem[],
) {
  const groups = product.items.filter(
    (item) => item.usable && ["goal", "module"].includes(item.type),
  );
  const membership = product.relations.filter((relation) => {
    const owner = product.items.find((item) => item.key === relation.ownerKey);
    const target = product.items.find(
      (item) => item.key === relation.targetKey,
    );
    if (
      relation.resolution !== "resolved" ||
      relation.link.state !== "active" ||
      !owner?.usable ||
      !target?.usable ||
      !["requirement", "module"].includes(owner.type)
    )
      return false;
    return relation.link.relation === "supports"
      ? target.type === "goal"
      : relation.link.relation === "part_of" && target.type === "module";
  });
  function routes(
    key: string,
    target: string,
    visited = new Set<string>(),
  ): ProductRelation[] | null {
    if (visited.has(key)) return null;
    const nextVisited = new Set([...visited, key]);
    for (const relation of membership.filter(
      (entry) => entry.ownerKey === key,
    )) {
      if (relation.targetKey === target) return [relation];
      if (!relation.targetKey) continue;
      const parent = product.items.find(
        (item) => item.key === relation.targetKey,
      );
      if (parent?.type !== "module") continue;
      const rest = routes(parent.key, target, nextVisited);
      if (rest) return [relation, ...rest];
    }
    return null;
  }
  const rows = groups.map((group) => ({
    group,
    requirements: requirements.flatMap((item) => {
      const route = routes(item.key, group.key);
      return route
        ? [
            {
              item,
              inferred: route.some((entry) => entry.link.origin === "inferred"),
              indirect: route.length > 1,
            },
          ]
        : [];
    }),
  }));
  const grouped = new Set(
    rows.flatMap((row) => row.requirements.map((entry) => entry.item.key)),
  );
  return {
    groups: rows,
    ungrouped: requirements.filter((item) => !grouped.has(item.key)),
  };
}
