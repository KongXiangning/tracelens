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
  featureAssessmentView,
  featureReportDetail,
  featureReportContext,
  featureDefinition,
} from "../src/shared/requirement-detail.js";
import type { AssessmentSelection } from "../src/shared/product-view.js";

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

function reportFixture(body: string, key = "current") {
  const { item, snapshot } = fixture();
  item.body = "### 功能点\n- 身份\n- 版本";
  const report: ProductItem = {
    ...item,
    key,
    id: key,
    type: "assessment",
    body,
    metadata: { id: key, type: "assessment", target: item.id },
  };
  snapshot.product!.items.push(report);
  return { item, snapshot, report };
}

function selection(
  report: ProductItem,
  reasons: string[] = [],
): AssessmentSelection {
  return {
    conclusion: reasons.length ? "undetermined" : "partially-satisfied",
    assessment: reasons.length ? null : report,
    reports: [report],
    historical: [],
    pending: [],
    reasons,
  };
}

it("reads new and old feature column names with verbatim judgment and boundary fields", () => {
  for (const header of ["功能点", "原功能点", "功能点编号"]) {
    const { report } = reportFixture(
      `| ${header} | 核对结果 | 具体依据与边界 |\n|---|---|---|\n| **REQ/F1 身份** | 基础已实现，归并未闭合 | 本轮解析测试；数据库未重验 |\n| OTHER/F1 身份 | 已实现 | 错误目标 |`,
    );
    const rows = featureReportRows(report, "REQ");
    expect(rows.size).toBe(1);
    expect(rows.get("F1")![0].source.line).toBe(3);
    expect(featureReportDetail(rows.get("F1")![0])).toMatchObject({
      state: "partial",
      judgment: "基础已实现，归并未闭合",
      evidence: "本轮解析测试；数据库未重验",
    });
  }
});

it("does not turn combined prose or verification PASS into an implementation verdict", () => {
  const { report } = reportFixture(
    "| 功能点 | 实现和验证 | 剩余、发现与边界 |\n|---|---|---|\n| F1 身份 | 表结构已实现；历史 PASS | 姓名类型误判；当前库未知 |",
  );
  expect(
    featureReportDetail(featureReportRows(report, "REQ").get("F1")![0]),
  ).toMatchObject({
    state: "recorded",
    judgment: "",
    remaining: "姓名类型误判；当前库未知",
  });
  report.body =
    "| 功能点 | 实现判断 |\n|---|---|\n| F1 身份 | 基础路径已实现，身份确认有明确边界 |";
  expect(
    featureReportDetail(featureReportRows(report, "REQ").get("F1")![0]).state,
  ).toBe("recorded");
});

it("reads evidence-report aliases and keeps unfamiliar columns visible as quoted facts", () => {
  const { report } = reportFixture(
    "| 功能点 | 已实施及验证依据 | 完整范围剩余与限制 | 新增核查记录 |\n|---|---|---|---|\n| F1 身份 | 旧 PG PASS | 可信等级未接入 | 本轮没有重验 |",
  );
  expect(
    featureReportDetail(featureReportRows(report, "REQ").get("F1")![0]),
  ).toMatchObject({
    state: "recorded",
    evidence: "旧 PG PASS",
    remaining: "可信等级未接入",
    otherFields: [{ label: "新增核查记录", text: "本轮没有重验" }],
  });
});

it("uses the scope/object-selected report instead of aggregating old and current rows or Task closure", () => {
  const { item, snapshot, report } = reportFixture(
    "| 原功能点 | 核对结果 |\n|---|---|\n| F1 身份 | 已实现，归并未闭合 |\n| F2 版本 | 版本快照已实现 |",
  );
  snapshot.product!.items.push({
    ...report,
    key: "old",
    id: "old",
    metadata: { ...report.metadata, id: "old" },
    body: "| 功能点 | 实施状态 |\n|---|---|\n| F1 身份 | 已实施 |",
  });
  const points = requirementFeatures(snapshot, item);
  const current = featureAssessmentView(points, selection(report));
  expect(current.applicable).toBe(true);
  expect(
    current.points.map((point) => [point.state, point.report?.reportId]),
  ).toEqual([
    ["partial", "current"],
    ["implemented", "current"],
  ]);
  expect(current.points[0].otherReports[0].reportId).toBe("old");
  expect(points.every((point) => point.bindings.length === 0)).toBe(true);
  snapshot.runtime!.tasks = [];
  expect(
    featureAssessmentView(
      requirementFeatures(snapshot, item),
      selection(report),
    ).points.map((point) => point.state),
  ).toEqual(["partial", "implemented"]);
  expect(
    featureAssessmentView(points, selection(report, ["definition-changed"]))
      .applicable,
  ).toBe(false);
  expect(
    featureAssessmentView(points, selection(report), "old").applicable,
  ).toBe(false);
});

it("never expands a report without point rows into a complete inventory verdict", () => {
  const { item, snapshot, report } = reportFixture(
    "| 功能点 | 实施状态 |\n|---|---|\n| F1 身份 | 已实施 |",
  );
  const scoped = {
    ...report,
    key: "c5",
    id: "c5",
    body: "### 覆盖范围\nC5 仅覆盖固定集，已满足。",
  };
  const view = featureAssessmentView(
    requirementFeatures(snapshot, item),
    selection(scoped),
  );
  expect(view.points.every((point) => point.state === "unassessed")).toBe(true);
  expect(view.points[0].otherReports).toHaveLength(1);
});

it("retains supplementary context and rejects duplicate point rows as conflicting records", () => {
  const { item, snapshot, report } = reportFixture(
    "### 交付与验证依据\n历史验证；本轮静态核对。\n\n| 功能点 | 实施状态 |\n|---|---|\n| F1 身份 | 已实施 |\n| F1 身份 | 部分实施 |\n\n### 2026-10-14 补充\n正式域未接入，不扩大旧 PASS。\n\n| 范围 | 本次判定 |\n|---|---|\n| 标签 | 未实现 |",
  );
  const view = featureAssessmentView(
    requirementFeatures(snapshot, item),
    selection(report),
  );
  expect(view.points[0].state).toBe("conflict");
  expect(view.points[0].otherReports).toHaveLength(2);
  expect(featureReportContext(report)).toEqual([
    { title: "交付与验证依据", text: "历史验证；本轮静态核对。" },
    { title: "2026-10-14 补充", text: "正式域未接入，不扩大旧 PASS。" },
  ]);
});

it("reads obligation tables by explicit original feature number and exact wording, without positional guessing", () => {
  const { item, snapshot, report } = reportFixture(
    "| 功能义务 | 实现与已知成果 | 既有验证及边界 | 明确剩余 | 未知/未核对 | 来源 |\n|---|---|---|---|---|---|\n| 原功能1 / REQ-CHILD：身份关联 | 已记录身份 | 静态比对 | 缺拒绝审计 | 真机未验 | evidence.md |\n| 版本 | 已记录版本 | 原报告验证 | 无已知缺口 | 无 | version.md |\n| 另一个义务 | 未知 | 无 | 未知 | 未知 | other.md |",
  );
  const points = requirementFeatures(snapshot, item);
  expect(points.map((point) => point.reports?.length)).toEqual([1, 1]);
  const detail = featureReportDetail(points[0].reports![0]);
  expect(detail).toMatchObject({
    state: "recorded",
    implementation: "已记录身份",
    verification: "静态比对",
    remaining: "缺拒绝审计",
  });
  expect(detail.otherFields).toContainEqual({
    label: "未知/未核对",
    text: "真机未验",
  });
  expect(featureReportRows(report, item.id).has("F3")).toBe(false);
});

it.each([
  ["无法评估", "unable-to-assess", "缺少目标设备记录"],
  ["未通过", "failed", "拒绝路径没有审计关联"],
])(
  "retains %s as an assessment result with its reason",
  (judgment, state, reason) => {
    const { item, snapshot } = reportFixture(
      `| 功能点 | 评估结论 | 原因 |\n|---|---|---|\n| F1 | ${judgment} | ${reason} |`,
    );
    expect(
      featureReportDetail(requirementFeatures(snapshot, item)[0].reports![0]),
    ).toMatchObject({ state, judgment, remaining: reason });
  },
);

it("preserves full list explanations for inconclusive reports", () => {
  const { report } = reportFixture(
    "### 剩余与待核对\n- 设备不可得，无法评估。\n- 缺少原始运行记录。",
  );
  expect(featureReportContext(report)).toContainEqual({
    title: "剩余与待核对",
    text: "设备不可得，无法评估。\n缺少原始运行记录。",
  });
});

it("inlines the exact moved point and complete shared boundaries without requiring source navigation", () => {
  const { snapshot, item } = fixture();
  item.body =
    "### 功能点\n1. 已移至独立要求 [REQ-CHILD](#REQ-CHILD)；原功能1的完整定义以该项为准。\n2. 已移至独立要求 [REQ-CHILD](#REQ-CHILD)；原功能2的完整定义以该项为准。";
  snapshot.product!.items.push({
    ...item,
    key: "child",
    id: "REQ-CHILD",
    metadata: { id: "REQ-CHILD", type: "requirement" },
    body:
      "## 共享定义\n### 需求内容\n- 原REQ功能1：完整输入要求。" +
      "长描述不得截断。".repeat(30) +
      "\n- 原REQ功能2：独立的第二点。\n### 范围边界\n不能更改操作系统身份。\n### 验收要求\n验证原会话不被替换。",
  });
  const features = requirementFeatures(snapshot, item);
  const first = featureDefinition(snapshot, item, features[0]);
  expect(first).toContain("长描述不得截断。".repeat(30));
  expect(first).toContain("不能更改操作系统身份。");
  expect(first).toContain("验证原会话不被替换。");
  expect(first).not.toContain("独立的第二点");
  expect(featureDefinition(snapshot, item, features[1])).toContain(
    "独立的第二点",
  );
});

it("keeps ordinary feature descriptions complete independently of assessment reports", () => {
  const { snapshot, item } = fixture();
  item.body = "### 功能点\n- 完整描述。" + "输入和输出边界。".repeat(40);
  const feature = requirementFeatures(snapshot, item)[0];
  expect(featureDefinition(snapshot, item, feature)).toBe(feature.description);
});
