import type { ProductItem, ProductSnapshot } from "./product-types.js";
import { productView } from "./product-view.js";

/** Display current declared requirement composition only; preserve project order. */
export function requirementHierarchy(
  product: ProductSnapshot,
  candidates: ProductItem[],
  expanded: ReadonlySet<string>,
  reveal: ReadonlySet<string> = new Set(),
  filtered = false,
) {
  const items = candidates.filter(
    (i, n, all) =>
      i.usable &&
      i.type === "requirement" &&
      i.metadata.scope === "current" &&
      all.findIndex((x) => x.key === i.key) === n,
  );
  const keys = new Set(items.map((i) => i.key));
  const parents = new Map(items.map((i) => [i.key, [] as string[]]));
  const children = new Map(items.map((i) => [i.key, [] as string[]]));
  for (const r of productView(product).relations) {
    if (
      r.link.relation !== "part_of" ||
      !r.targetKey ||
      !keys.has(r.ownerKey) ||
      !keys.has(r.targetKey)
    )
      continue;
    if (!parents.get(r.ownerKey)!.includes(r.targetKey))
      parents.get(r.ownerKey)!.push(r.targetKey);
    if (!children.get(r.targetKey)!.includes(r.ownerKey))
      children.get(r.targetKey)!.push(r.ownerKey);
  }
  // A child with no displayable parent remains an entry. A shared child needs
  // only one expanded visible path, so folding another parent cannot hide it.
  const visible = new Set(
    filtered
      ? []
      : items.filter((i) => !parents.get(i.key)!.length).map((i) => i.key),
  );
  for (const key of reveal) {
    // Ancestor traversal has its own visited set, independent of root visibility.
    const seen = new Set<string>();
    const ancestors = (k: string) => {
      if (!keys.has(k) || seen.has(k)) return;
      seen.add(k);
      visible.add(k);
      for (const p of parents.get(k) || []) ancestors(p);
    };
    ancestors(key);
  }
  let changed = !filtered;
  while (changed) {
    changed = false;
    for (const i of items)
      if (
        !visible.has(i.key) &&
        parents.get(i.key)!.some((p) => visible.has(p) && expanded.has(p))
      ) {
        visible.add(i.key);
        changed = true;
      }
  }
  return {
    items,
    parents,
    children,
    visible: items.filter((i) => visible.has(i.key)),
  };
}

/** Collect actual binding rows from own item and current composition descendants.
 * No goal support, dependency/history traversal or persistence/propagation. */
export function requirementBindings(
  product: ProductSnapshot,
  owner: ProductItem,
) {
  const owners = new Set([owner.key]);
  if (
    owner.usable &&
    owner.type === "requirement" &&
    owner.metadata.scope === "current"
  ) {
    const current = product.items.filter(
      (i) =>
        i.usable && i.type === "requirement" && i.metadata.scope === "current",
    );
    const graph = requirementHierarchy(product, current, new Set());
    const visit = (key: string) => {
      for (const child of graph.children.get(key) || []) {
        if (owners.has(child)) continue;
        owners.add(child);
        visit(child);
      }
    };
    visit(owner.key);
  }
  const seen = new Set<string>();
  return product.bindings.filter((b) => {
    if (
      !owners.has(b.ownerKey) ||
      b.binding.state !== "active" ||
      seen.has(b.key)
    )
      return false;
    seen.add(b.key);
    return true;
  });
}
