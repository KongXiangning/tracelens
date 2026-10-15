import { expect, it } from "vitest";
import type { AssessmentReviewIssue } from "../src/shared/assessment-review.js";
import {
  assessmentReviewSummary,
  projectAssessmentReviewText,
} from "../src/shared/assessment-review-export.js";
import { assessmentReviewGroups } from "../src/shared/assessment-review-groups.js";
import {
  buildOverviewData,
  type OverviewReviewRequirement,
} from "../src/shared/overview-data.js";
import type {
  ProductItem,
  ProductMetadata,
  ProductSnapshot,
  ProductSourceCheck,
} from "../src/shared/product-types.js";
import { selectAssessment } from "../src/shared/product-view.js";
import type { Snapshot } from "../src/shared/types.js";

type ReviewRecord = OverviewReviewRequirement["assessmentRecords"][number];

const algorithm = "vnext-product-definition/v1";
const digest = "a".repeat(64);
const snapshotIdentity = {
  id: "scope-change-snapshot",
  projectId: "scope-change-project",
  completedAt: "2026-10-15T08:00:00Z",
};

function item(
  id: string,
  type: ProductMetadata["type"],
  metadata: Partial<ProductMetadata> = {},
): ProductItem {
  return {
    key: `key:${id}`,
    id,
    type,
    version: 6,
    title: `标题 ${id}`,
    body: id,
    metadata: { id, type, scope: "current", ...metadata },
    source: {
      documentId: `docs/${id}.md`,
      path: `docs/${id}.md`,
      line: 12,
      section: null,
      digest,
    },
    endLine: 20,
    metadataLine: 2,
    usable: true,
    definitionAlgorithm: algorithm,
    definitionSha256: digest,
    diagnostics: [],
  };
}

function fixture({
  targetId = "R-IMPORT",
  goalId = "G-DEMO",
  scopeId = "FULL",
  recordedCoverage = "原范围\n领域约束",
  currentCoverage = "新增转换与恢复\n领域约束",
} = {}) {
  const requirement = item(targetId, "requirement");
  const goal = item(goalId, "goal", {
    assessment_scopes: [
      { target: targetId, scope_id: scopeId, coverage: currentCoverage },
    ],
  });
  const project = item("P", "project", {
    root_goal_id: goalId,
    requirement_order: [targetId],
  });
  const reports = [
    item("A-DEMO", "assessment", {
      conclusion: "satisfied",
      subject: { kind: "commit", value: "demo", revision: "demo-revision" },
    }),
    item("A-RELEASE", "assessment", {
      conclusion: "partially-satisfied",
      subject: {
        kind: "release",
        value: "release",
        revision: "release-revision",
        limitations: "发布对象仍有局部限制",
      },
    }),
  ];
  const sources: ProductSourceCheck[] = [];
  for (const report of reports) {
    Object.assign(report.metadata, {
      target: targetId,
      applicability: {
        goal_id: goalId,
        scope_id: scopeId,
        coverage: recordedCoverage,
      },
    });
    for (const [prefix, definition] of [
      ["target", requirement],
      ["goal", goal],
    ] as const) {
      const reference = {
        kind: "file" as const,
        path: definition.source.path,
        item_id: definition.id,
        sha256: digest,
      };
      report.metadata[`${prefix}_definition_algorithm`] = algorithm;
      report.metadata[`${prefix}_definition_sha256`] = digest;
      report.metadata[`${prefix}_basis`] = reference;
      sources.push({
        id: `${report.key}:${prefix}`,
        ownerKey: report.key,
        role: `${prefix}_basis`,
        reference,
        readState: "read",
        locationState: "located",
        byteState: "same-bytes",
        source: definition.source,
        definitionAlgorithm: algorithm,
        definitionSha256: digest,
        detail: "已读取并定位条目",
      });
    }
  }
  const product: ProductSnapshot = {
    status: "ready",
    manifestPath: ".workflow-system/PRODUCT.yaml",
    manifest: {
      schema: "vnext-product-manifest/v2",
      project_id: "scope-change-project",
      entry: project.source.path,
      managed_paths: ["docs/*.md"],
      source_paths: [],
      exclude_paths: [],
      maintenance: "enabled",
    },
    manifestSource: null,
    items: [project, goal, requirement, ...reports],
    sources,
    relations: [],
    bindings: [],
    assessments: [],
    diagnostics: [],
    coverage: { complete: true, paths: [], omitted: [], excluded: [] },
    workingCopy: "test-copy",
  };
  const rules = { management: [], requirements: [], design: [], planning: [] };
  const snapshot: Snapshot = {
    ...snapshotIdentity,
    configVersion: 1,
    config: { rules, excludes: [] },
    startedAt: snapshotIdentity.completedAt,
    outcome: "success",
    documents: [],
    tasks: [],
    statements: [],
    relations: [],
    files: [],
    warnings: [],
    navigation: {
      enabled: false,
      profileUsed: false,
      entries: [],
      incomplete: false,
      gaps: [],
    },
    effectiveRules: { ...rules, unclassified: [] },
    product,
  };
  const items = buildOverviewData(snapshot).reviewRequirements!;
  return { product, goal, requirement, reports, items, snapshot };
}

it("shares one selector-generated scope change across subjects and keeps UI summary and export consistent", () => {
  const { product, reports, items } = fixture();
  const before = JSON.stringify(product);
  for (const report of reports) {
    const selection = selectAssessment(
      product,
      "R-IMPORT",
      "G-DEMO",
      report.metadata.subject,
      "FULL",
    );
    expect(selection.reasons).toEqual(["scope-definition-changed"]);
    expect(selection.reviewIssues?.[0].issue.scopeChange).toEqual({
      targetKey: "key:R-IMPORT",
      targetId: "R-IMPORT",
      goalKey: "key:G-DEMO",
      goalId: "G-DEMO",
      scopeId: "FULL",
      recordedCoverage: "原范围\n领域约束",
      currentCoverage: "新增转换与恢复\n领域约束",
    });
  }
  const groups = assessmentReviewGroups(items);
  expect(groups).toHaveLength(1);
  expect(groups[0].members.map(({ record }) => record.report.id)).toEqual([
    "A-DEMO",
    "A-RELEASE",
  ]);
  expect(assessmentReviewSummary(items)).toEqual({
    changes: 1,
    requirements: 1,
    reports: 2,
    issues: 2,
  });
  const text = projectAssessmentReviewText(items, snapshotIdentity);
  const exported = JSON.parse(text.slice(text.indexOf('{\n  "project"')));
  expect(exported.summary).toEqual(assessmentReviewSummary(items));
  expect(exported.changeGroups).toHaveLength(1);
  expect(
    exported.changeGroups[0].affectedReports.map(
      ({
        report,
        issues,
      }: {
        report: Record<string, unknown>;
        issues: unknown[];
      }) => ({
        ...report,
        issues,
      }),
    ),
  ).toEqual(
    reports.map((report) => ({
      id: report.id,
      title: report.title,
      target: report.metadata.target,
      source: report.source,
      originalConclusion: report.metadata.conclusion,
      goal: "G-DEMO",
      scope: "FULL",
      coverage: "原范围\n领域约束",
      subject: report.metadata.subject,
      issues: items[0].assessmentRecords.find(
        (record) => record.report.id === report.id,
      )!.review!.issues,
    })),
  );
  expect(JSON.stringify(product)).toBe(before);
});

it.each([
  { targetId: "R-OTHER" },
  { goalId: "G-OTHER" },
  { scopeId: "OTHER" },
  { recordedCoverage: "另一旧范围" },
  { currentCoverage: "另一新范围" },
])(
  "keeps different scope identities or coverage versions separate: %j",
  (variant) => {
    const first = fixture().items;
    const second = fixture(variant).items;
    expect(assessmentReviewGroups([...first, ...second])).toHaveLength(2);
  },
);

it("uses the selector's newline semantics while retaining each original comparison", () => {
  const { items } = fixture();
  const second = items[0].assessmentRecords[1];
  second.report.metadata.applicability!.coverage = "原范围\r\n领域约束";
  second.review!.issues[0].scopeChange!.recordedCoverage = "原范围\r\n领域约束";
  second.review!.issues[0].scopeChange!.currentCoverage =
    "新增转换与恢复\r领域约束";
  second.review!.issues[0].comparisons![0].recorded = "原范围\r\n领域约束";
  expect(assessmentReviewGroups(items)).toHaveLength(1);
  expect(
    assessmentReviewGroups(items)[0].members[1].record.review!.issues[0]
      .comparisons,
  ).toEqual(second.review!.issues[0].comparisons);
});

it("does not introduce scope review for line ending changes alone", () => {
  const { items } = fixture({
    recordedCoverage: "完整范围\r\n领域约束",
    currentCoverage: "完整范围\n领域约束",
  });
  expect(items).toEqual([]);
});

it("does not infer a shared old coverage when selector metadata is missing", () => {
  const { snapshot, reports } = fixture();
  for (const report of reports) {
    const applicability: Partial<
      NonNullable<ProductMetadata["applicability"]>
    > = report.metadata.applicability!;
    delete applicability.coverage;
  }
  const items = buildOverviewData({ ...snapshot }).reviewRequirements!;
  expect(items[0].assessmentRecords).toHaveLength(2);
  for (const record of items[0].assessmentRecords)
    expect(record.review!.issues[0].scopeChange).toBeUndefined();
  expect(assessmentReviewGroups(items)).toHaveLength(2);
});

it("keeps missing or inconsistent scope metadata independent despite identical display comparisons", () => {
  const mutations = [
    (record: ReviewRecord) => {
      delete record.review!.issues[0].scopeChange;
    },
    (record: ReviewRecord) => {
      record.review!.issues[0].scopeChange!.goalKey = "";
    },
    (record: ReviewRecord) => {
      const change: Partial<NonNullable<AssessmentReviewIssue["scopeChange"]>> =
        record.review!.issues[0].scopeChange!;
      delete change.goalKey;
    },
    (record: ReviewRecord) => {
      record.review!.issues[0].scopeChange!.scopeId = "MISMATCH";
    },
    (record: ReviewRecord) => {
      record.review!.issues[0].scopeChange!.recordedCoverage = "未定位的旧范围";
    },
  ];
  for (const mutate of mutations) {
    const { items } = fixture();
    items[0].assessmentRecords.forEach(mutate);
    expect(assessmentReviewGroups(items)).toHaveLength(2);
  }
});

it("retains legacy selection reasons without introducing structured scope requirements", () => {
  const { items } = fixture();
  for (const record of items[0].assessmentRecords) delete record.review;
  const groups = assessmentReviewGroups(items);
  expect(groups).toHaveLength(2);
  expect(groups.every((group) => group.category === "unclassified")).toBe(true);
  expect(
    groups.map((group) => group.members[0].record.selection.reasons),
  ).toEqual([["scope-definition-changed"], ["scope-definition-changed"]]);
});
