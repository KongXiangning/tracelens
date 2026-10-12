import { expect, it } from "vitest";
import {
  assessmentGoal,
  productStructure,
} from "../src/shared/product-structure.js";
import { goalRequirements } from "../src/shared/product-view.js";
import { requirementHierarchy } from "../src/shared/product-hierarchy.js";
import type {
  ProductItem,
  ProductRelation,
  ProductSnapshot,
} from "../src/shared/product-types.js";

const item = (
  id: string,
  type: ProductItem["type"] = "requirement",
  scope = "current",
) =>
  ({
    key: id,
    id,
    type,
    usable: true,
    metadata: { id, type, scope },
    title: id,
  }) as ProductItem;
const relation = (
  owner: string,
  target: string,
  origin = "declared",
  resolution = "resolved",
  state = "active",
) =>
  ({
    key: `${owner}-${target}-${origin}`,
    ownerKey: owner,
    targetKey: resolution === "resolved" ? target : null,
    resolution,
    link: {
      id: `${owner}-${target}`,
      target,
      origin,
      state,
      relation: "part_of",
    },
  }) as ProductRelation;
function snapshot() {
  const items = [
    item("G", "goal"),
    item("OTHER", "goal"),
    item("PARENT"),
    item("CHILD"),
    item("CANDIDATE"),
    item("CANDIDATE-CHILD"),
    item("OTHER-REQ"),
    item("ALONE"),
    item("BAD"),
    item("PLANNED", "requirement", "planned"),
    item("OLD", "requirement", "retired"),
    item("MODULE", "module"),
  ];
  return {
    items,
    relations: [
      relation("PARENT", "G"),
      relation("CHILD", "PARENT"),
      relation("CANDIDATE", "G", "inferred"),
      relation("CANDIDATE-CHILD", "CANDIDATE"),
      relation("OTHER-REQ", "OTHER"),
      relation("BAD", "G", "inferred", "invalid-direction"),
      relation("ALONE", "G", "inferred", "resolved", "dismissed"),
    ],
    coverage: { complete: false },
  } as ProductSnapshot;
}

it("explains recorded candidates, other targets, anomalies and legitimate independent requirements without changing formal paths", () => {
  const product = snapshot(),
    before = JSON.stringify(product);
  const result = productStructure(product, "G", "ALONE");
  const row = (id: string) => result.unlinked.find((r) => r.item.id === id)!;
  expect(result.formal.map((i) => i.id)).toEqual(["CHILD", "PARENT"]);
  expect(result.relatedCandidates.map((r) => r.ownerKey)).toEqual([
    "CANDIDATE",
    "BAD",
  ]);
  expect(row("CANDIDATE-CHILD").reasons).toContain(
    "已有候选路径，尚未进入正式图",
  );
  expect(row("OTHER-REQ").otherGoals.map((g) => g.id)).toEqual(["OTHER"]);
  expect(row("ALONE").reasons).toEqual(["核心关系未记录或尚未确定"]);
  expect(row("BAD").reasons).toContain("引用、方向或身份异常，查看来源与诊断");
  expect(row("PLANNED").reasons).toContain("不在当前范围（planned）");
  expect(row("OLD").reasons).toContain("不在当前范围（retired）");
  expect(result.incomplete).toBe(true);
  expect(JSON.stringify(product)).toBe(before);
  expect(goalRequirements(product, "G").map((i) => i.id)).toEqual([
    "CHILD",
    "PARENT",
  ]);
});

it("keeps context candidates separate from all candidates and does not invent a path from selection", () => {
  const product = snapshot();
  product.relations.push(relation("ALONE", "OTHER", "inferred"));
  expect(productStructure(product, "G").relatedCandidates).toHaveLength(2);
  const focused = productStructure(product, "G", "ALONE");
  expect(focused.candidates).toHaveLength(3);
  expect(focused.relatedCandidates).toHaveLength(3);
  expect(focused.unlinked.find((r) => r.item.id === "ALONE")!.reasons).toEqual([
    "核心关系未记录或尚未确定",
  ]);
});

it("uses the same goal context in nodes and details; classification is not an assessment target", () => {
  const goal = item("ROOT", "goal"),
    childGoal = item("CHILD-GOAL", "goal");
  expect(assessmentGoal(childGoal, goal)).toBe(childGoal);
  expect(assessmentGoal(item("R"), goal)).toBe(goal);
  expect(assessmentGoal(item("M", "module"), goal)).toBeUndefined();
});

it("connects the formal goal subset to existing hierarchy without flattening children or losing filtered ancestors", () => {
  const product = snapshot(),
    requirements = goalRequirements(product, "G");
  expect(
    requirementHierarchy(product, requirements, new Set()).visible.map(
      (i) => i.id,
    ),
  ).toEqual(["PARENT"]);
  expect(
    requirementHierarchy(
      product,
      requirements,
      new Set(["PARENT"]),
    ).visible.map((i) => i.id),
  ).toEqual(["CHILD", "PARENT"]);
  expect(
    requirementHierarchy(
      product,
      requirements,
      new Set(),
      new Set(["CHILD"]),
      true,
    ).visible.map((i) => i.id),
  ).toEqual(["CHILD", "PARENT"]);
});
