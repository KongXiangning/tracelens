import { expect, it } from "vitest";
import type {
  ProductBindingView,
  ProductItem,
} from "../src/shared/product-types.js";
import type { Snapshot } from "../src/shared/types.js";
import {
  featureExecution,
  featureReportRows,
  requirementFeatures,
} from "../src/shared/requirement-detail.js";

function fixture() {
  const item = {
    key: "req",
    id: "REQ",
    type: "requirement",
    usable: true,
    metadata: { id: "REQ", type: "requirement", scope: "current" },
    title: "需求",
    body: "",
    source: { path: "requirements.md", line: 1 },
  } as ProductItem;
  const taskRef = {
    task_id: "task",
    plan_ref: "adopted-plan",
    step_id: "S1",
    source: { kind: "text" as const, text: "精确关联", label: "范围" },
  };
  const row: ProductBindingView = {
    key: "binding",
    ownerKey: item.key,
    binding: {
      id: "binding",
      task: taskRef,
      role: "implementation",
      contribution: "direct",
      origin: "declared",
      state: "active",
      coverage: "当前功能",
      reason: "直接实现",
      sources: [taskRef.source],
    },
    match: {
      task: taskRef,
      state: "matched",
      taskIds: ["ui-task"],
      detail: "精确匹配",
    },
    planItems: [],
    repairs: [],
  };
  const snapshot = {
    product: { items: [item], bindings: [row], relations: [] },
    tasks: [{ id: "ui-task", realTaskId: "task", runtimeLifecycle: "closed" }],
    runtime: {
      source: "runtime-query",
      freshness: "queried",
      tasks: [
        {
          task_id: "task",
          lifecycle: "closed",
          adopted_plan_ref: "adopted-plan",
          steps: [
            { id: "S1", state: "executed", execution_ref: "execution/S1" },
          ],
        },
      ],
    },
  } as unknown as Snapshot;
  return { item, row, snapshot };
}

it("requires exact implementation execution rather than a closed Task", () => {
  const { snapshot, row } = fixture();
  expect(featureExecution(snapshot, [row]).state).toBe("completed");
  snapshot.runtime!.tasks[0].steps = [];
  expect(featureExecution(snapshot, [row]).state).toBe("pending");
  snapshot.runtime!.tasks[0].steps = [{ id: "S1", state: "executed" }];
  expect(featureExecution(snapshot, [row]).state).toBe("pending");
});

it("keeps stale, inferred and mismatched plan evidence out of completed counts", () => {
  const { snapshot, row } = fixture();
  snapshot.runtime!.freshness = "stale-or-unknown";
  expect(featureExecution(snapshot, [row]).state).toBe("recorded");
  snapshot.runtime!.freshness = "queried";
  row.binding.origin = "inferred";
  expect(featureExecution(snapshot, [row]).state).toBe("pending");
  row.binding.origin = "declared";
  row.binding.task.plan_ref = "another-plan";
  expect(featureExecution(snapshot, [row]).state).toBe("pending");
  expect(featureExecution(snapshot, []).state).toBe("unassociated");
});

it("only binds the exact declared plan work item, not sibling scopes", () => {
  const { snapshot, item, row } = fixture();
  snapshot.product!.items.push({
    ...item,
    key: "plan-key",
    id: "PLAN",
    type: "plan",
    metadata: {
      id: "PLAN",
      type: "plan",
      work_items: ["A", "B"].map((id) => ({
        id,
        title: id,
        outcome: id,
        scope: id,
        targets: [{ target: "REQ", coverage: id }],
        state: id === "A" ? "included" : "deferred",
        origin: "initial",
      })),
    },
  });
  row.planItems = [
    {
      key: "plan-key:work:A",
      planId: "PLAN",
      workItemId: "A",
      state: "resolved",
    },
  ];
  const features = requirementFeatures(snapshot, item);
  expect(
    features.map((feature) => [
      feature.title,
      feature.state,
      feature.bindings.length,
      feature.inclusion,
    ]),
  ).toEqual([
    ["A", "completed", 1, "included"],
    ["B", "unassociated", 0, "deferred"],
  ]);
  row.planItems[0].state = "ambiguous";
  expect(requirementFeatures(snapshot, item)[0].bindings).toEqual([]);
});

it("reads explicit body features without inheriting the whole requirement's Task", () => {
  const { snapshot, item, row } = fixture();
  item.body = "### 功能点\n- 尚未结构化的功能，不自动关联整项 Task";
  const points = requirementFeatures(snapshot, item);
  expect(points).toHaveLength(1);
  expect(points[0].bindings).toEqual([]);
  expect(points[0].state).toBe("unassociated");
  item.body =
    "### 需求内容\n普通说明\n- 不是功能清单\n\n### 验收要求\n- 不是功能点";
  expect(requirementFeatures(snapshot, item)).toEqual([]);
  const child = {
    ...item,
    key: "child",
    id: "CHILD",
    metadata: { ...item.metadata, id: "CHILD" },
  };
  snapshot.product!.items.push(child);
  snapshot.product!.relations.push({
    key: "composition",
    ownerKey: child.key,
    targetKey: item.key,
    resolution: "resolved",
    link: {
      id: "part",
      relation: "part_of",
      target: item.id,
      origin: "declared",
      state: "active",
    },
  });
  row.ownerKey = child.key;
  expect(
    requirementFeatures(snapshot, item).map((feature) => [
      feature.key,
      feature.state,
    ]),
  ).toEqual([["child", "completed"]]);
});

it("preserves source lines, multiline definitions and report implementation/verification separately", () => {
  const { snapshot, item, row } = fixture();
  item.source.line = 40;
  item.body =
    "## [REQ] 需求\n\n### 功能点与输入输出\n\n说明不作为功能点。\n\n- **不可变来源**。\n  第二行说明\n  - 嵌套细节\n- 独立Parse。\n\n输入 → 输出：不作为功能点。\n\n### 异常恢复\n- 不作为功能点";
  const report: ProductItem = {
    ...item,
    key: "report",
    id: "AS",
    type: "assessment",
    metadata: { id: "AS", type: "assessment", target: "REQ" },
    body: "### 交付与验证依据\n\n| 功能点 | 实施状态 | 验证状态 | 具体缺口 |\n|---|---|---|---|\n| REQ/F1 不可变来源。 | 已实施 | 本轮仅静态核对 | 没有运行PASS |\n| REQ/F2 独立Parse。 | 部分实施 | 历史局部验证 | 未覆盖所有路径 |\n| OTHER/F1 错误范围 | 已实施 | PASS | 无 |",
    source: { ...item.source, path: "IMPLEMENTATION_STATUS.md", line: 90 },
  };
  snapshot.product!.items.push(report);
  const features = requirementFeatures(snapshot, item);
  expect(features).toHaveLength(2);
  expect(features[0].source.line).toBe(46);
  expect(features[0].description).toContain("嵌套细节");
  expect(features[0].reports?.[0].source.line).toBe(94);
  expect(features[0].reports?.[0].fields).toEqual([
    { label: "实施状态", text: "已实施" },
    { label: "验证状态", text: "本轮仅静态核对" },
    { label: "具体缺口", text: "没有运行PASS" },
  ]);
  expect(features[0].state).toBe("unassociated");
  expect(featureReportRows(report, "OTHER").size).toBe(0);
  row.binding.coverage = "REQ/F1";
  expect(
    requirementFeatures(snapshot, item).map((feature) => feature.state),
  ).toEqual(["completed", "unassociated"]);
  row.binding.coverage = "REQ/F10";
  expect(requirementFeatures(snapshot, item)[0].bindings).toEqual([]);
});

it("does not inflate the body functional inventory with overlapping plan work", () => {
  const { snapshot, item } = fixture();
  item.body = "### 功能点\n- 来源\n- 身份";
  snapshot.product!.items.push({
    ...item,
    key: "plan",
    id: "PLAN",
    type: "plan",
    metadata: {
      id: "PLAN",
      type: "plan",
      work_items: [
        {
          id: "W",
          title: "来源实现",
          outcome: "实现来源",
          scope: "来源",
          targets: [{ target: "REQ", coverage: "来源" }],
          state: "included",
          origin: "initial",
        },
      ],
    },
  });
  expect(
    requirementFeatures(snapshot, item).map((feature) => feature.kind),
  ).toEqual(["正文功能点", "正文功能点"]);
});
