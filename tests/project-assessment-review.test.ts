import { expect, it } from "vitest";
import {
  assessmentReviewSummary,
  assessmentReviewText,
  pendingAssessmentRecords,
  projectAssessmentReviewText,
} from "../src/shared/assessment-review-export.js";
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
import type { Snapshot, SourceRef } from "../src/shared/types.js";

const algorithm = "vnext-product-definition/v1";
const originalDigest = "a".repeat(64);
const currentDigest = "b".repeat(64);
const snapshotIdentity = {
  id: "snapshot-specific-version",
  projectId: "configured-project-id",
  completedAt: "2026-10-15T05:31:12Z",
};
function source(path: string, line = 12, digest = originalDigest): SourceRef {
  return { documentId: path, path, line, section: "核对依据", digest };
}
function item(
  id: string,
  type: ProductMetadata["type"],
  metadata: Partial<ProductMetadata> = {},
): ProductItem {
  return {
    key: `key:${id}`,
    id,
    type,
    version: 5,
    title: `标题 ${id}`,
    body: id,
    metadata: { id, type, scope: "current", ...metadata },
    source: source(`docs/${id}.md`),
    endLine: 20,
    metadataLine: 2,
    usable: true,
    definitionAlgorithm: algorithm,
    definitionSha256: originalDigest,
    diagnostics: [],
  };
}
function fixture() {
  const requirements = [
    item("R-CURRENT", "requirement"),
    item("R-PLANNED", "requirement", { scope: "planned" }),
    item("R-CANDIDATE", "requirement", { scope: "candidate" }),
    item("R-RETIRED", "requirement", { scope: "retired" }),
    item("R-CLEAN", "requirement"),
  ];
  const project = item("declared-project-item", "project", {
    root_goal_id: "G",
    requirement_order: ["R-CURRENT", "R-PLANNED", "R-CLEAN"],
  });
  const goal = item("G", "goal", {
    assessment_scopes: requirements.map((requirement) => ({
      target: requirement.id,
      scope_id: "scope",
      coverage: `完整范围 ${requirement.id}`,
    })),
  });
  const product: ProductSnapshot = {
    status: "ready",
    manifestPath: ".workflow-system/PRODUCT.yaml",
    manifest: {
      schema: "vnext-product-manifest/v2",
      project_id: "declared-project-id",
      entry: project.source.path,
      managed_paths: ["docs/*.md"],
      source_paths: [],
      exclude_paths: [],
      maintenance: "enabled",
    },
    manifestSource: null,
    items: [project, goal, ...requirements],
    sources: [],
    relations: [],
    bindings: [],
    assessments: [],
    diagnostics: [],
    coverage: { complete: true, paths: [], omitted: [], excluded: [] },
    workingCopy: "working-copy",
  };
  function report(id: string, requirement: ProductItem, revision = "revision") {
    const assessment = item(id, "assessment", {
      target: requirement.id,
      conclusion: "satisfied",
      checked_at: "2026-10-14T08:00:00Z",
      applicability: {
        goal_id: goal.id,
        scope_id: "scope",
        coverage: `完整范围 ${requirement.id}`,
      },
      subject: {
        kind: "commit",
        value: "delivery-project",
        revision,
        limitations: "保留原交付对象限制",
      },
      target_definition_algorithm: algorithm,
      target_definition_sha256: originalDigest,
      target_basis: {
        kind: "file",
        path: requirement.source.path,
        item_id: requirement.id,
        sha256: originalDigest,
        section: "需求内容",
        lines: { start: 12, end: 20 },
      },
      goal_definition_algorithm: algorithm,
      goal_definition_sha256: originalDigest,
      goal_basis: {
        kind: "file",
        path: goal.source.path,
        item_id: goal.id,
        sha256: originalDigest,
      },
    });
    assessment.source = source(`reports/${id}.md`, 31);
    product.items.push(assessment);
    product.sources.push(
      ...(["target", "goal"] as const).map((prefix): ProductSourceCheck => ({
        id: `${assessment.key}:${prefix}`,
        ownerKey: assessment.key,
        role: `${prefix}_basis`,
        reference: assessment.metadata[`${prefix}_basis`]!,
        readState: "read",
        locationState: "located",
        byteState: "same-bytes",
        source: prefix === "target" ? requirement.source : goal.source,
        definitionAlgorithm: algorithm,
        definitionSha256: originalDigest,
        detail: "已读取并定位条目",
      })),
    );
    return assessment;
  }
  const fileReport = report("A-FILE", requirements[0]);
  report("A-CLEAN-OTHER-VERSION", requirements[0], "clean-revision");
  const fileCheck = product.sources.find(
    (check) =>
      check.ownerKey === fileReport.key && check.role === "target_basis",
  )!;
  fileCheck.byteState = "changed";
  fileCheck.source = { ...fileCheck.source!, digest: currentDigest };
  requirements[1].definitionSha256 = currentDigest;
  report("A-DEFINITION", requirements[1]);
  const pending = report("A-PENDING", requirements[2]);
  report("A-CONFLICT", requirements[2]);
  pending.metadata.pending_sources = [
    {
      kind: "file",
      path: "evidence/新增结果.md",
      section: "新验证结果",
      lines: { start: 6, end: 9 },
      note: "待核对新增用例",
    },
  ];
  product.sources.push({
    id: "pending-check",
    ownerKey: pending.key,
    role: "pending_sources[0]",
    reference: pending.metadata.pending_sources[0],
    readState: "not-read",
    locationState: "not-applicable",
    byteState: "unknown",
    source: null,
    detail: "文件尚未读取",
  });
  const retiredReport = report("A-RETIRED", requirements[3]);
  product.sources.find(
    (check) =>
      check.ownerKey === retiredReport.key && check.role === "target_basis",
  )!.locationState = "unlocated";
  report("A-CLEAN", requirements[4]);
  return { product, requirements };
}
function snapshot(product: ProductSnapshot): Snapshot {
  const rules = { management: [], requirements: [], design: [], planning: [] };
  return {
    ...snapshotIdentity,
    configVersion: 9,
    config: { rules, excludes: [] },
    startedAt: "2026-10-15T05:30:00Z",
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
}
function projectData(items: readonly OverviewReviewRequirement[]) {
  const text = projectAssessmentReviewText(
    items,
    snapshotIdentity,
    "当前项目名",
  );
  return { text, data: JSON.parse(text.slice(text.indexOf('{\n  "project"'))) };
}

it("transports pending assessments for every requirement scope, including registered and unordered requirements absent from cards", () => {
  const { product } = fixture();
  const overview = buildOverviewData(snapshot(product));
  expect(overview.planned.map((requirement) => requirement.id)).toEqual([
    "R-CURRENT",
    "R-CLEAN",
  ]);
  expect(overview.unordered).toEqual([]);
  expect(
    overview.reviewRequirements!.map(({ id, scope }) => [id, scope]),
  ).toEqual([
    ["R-CURRENT", "current"],
    ["R-PLANNED", "planned"],
    ["R-CANDIDATE", "candidate"],
    ["R-RETIRED", "retired"],
  ]);
  expect(overview.reviewRequirements![0].assessmentRecords[0]).toBe(
    overview.planned[0].assessmentRecords[0],
  );
  expect(Object.keys(overview.reviewRequirements![0]).sort()).toEqual([
    "assessmentRecords",
    "id",
    "key",
    "scope",
    "title",
  ]);
  expect(
    overview.reviewRequirements!.flatMap((requirement) =>
      requirement.assessmentRecords.map((record) => record.report.id),
    ),
  ).toEqual(["A-FILE", "A-DEFINITION", "A-PENDING", "A-CONFLICT", "A-RETIRED"]);
});

it("exports exact project and snapshot identities, original report objects, and all source provenance without conflating file and definition changes", () => {
  const { product } = fixture();
  const items = buildOverviewData(snapshot(product)).reviewRequirements!;
  const { text, data } = projectData(items);
  expect(data.project).toEqual({
    id: snapshotIdentity.projectId,
    title: "当前项目名",
    snapshotId: snapshotIdentity.id,
    completedAt: snapshotIdentity.completedAt,
  });
  expect(data.summary).toEqual({
    changes: 6,
    requirements: 4,
    reports: 5,
    issues: 6,
  });
  expect(data.summary).toEqual(assessmentReviewSummary(items));
  const file = data.requirements[0].reports[0];
  expect(file.report).toEqual({
    id: "A-FILE",
    title: "标题 A-FILE",
    target: "R-CURRENT",
    source: source("reports/A-FILE.md", 31),
    originalConclusion: "satisfied",
    checkedAt: "2026-10-14T08:00:00Z",
    goal: "G",
    scope: "scope",
    coverage: "完整范围 R-CURRENT",
    subject: {
      kind: "commit",
      value: "delivery-project",
      revision: "revision",
      limitations: "保留原交付对象限制",
    },
  });
  expect(file.reasonCodes).toEqual(["target-source-file-changed"]);
  expect(file.issues[0]).toMatchObject({
    title: "来源文件变化（需求依据）",
    detail: expect.stringContaining("需求条目的定义摘要仍与报告一致"),
    comparisons: [
      {
        label: "整份来源文件 SHA-256",
        recorded: originalDigest,
        current: currentDigest,
      },
    ],
    sources: [
      {
        reference: {
          kind: "file",
          path: "docs/R-CURRENT.md",
          item_id: "R-CURRENT",
          sha256: originalDigest,
          section: "需求内容",
          lines: { start: 12, end: 20 },
        },
        source: source("docs/R-CURRENT.md", 12, currentDigest),
      },
      {},
    ],
  });
  const definition = data.requirements[1].reports[0];
  expect(definition.reasonCodes).toEqual(["target-definition-changed"]);
  expect(definition.issues[0].title).toBe("需求定义变化");
  expect(definition.issues[0].comparisons[0].label).toBe("需求定义 SHA-256");
  const pending = data.requirements[2].reports.find(
    (entry: { report: { id: string } }) => entry.report.id === "A-PENDING",
  );
  expect(
    pending.issues.find(
      (issue: { code: string }) => issue.code === "pending-evidence",
    ).sources,
  ).toEqual([
    {
      label: "待对账材料 1",
      reference: {
        kind: "file",
        path: "evidence/新增结果.md",
        section: "新验证结果",
        lines: { start: 6, end: 9 },
        note: "待核对新增用例",
      },
      status: "未读取；无法定位文件条目；文件尚未读取",
    },
  ]);
  expect(text.match(/核对要求：/g)).toHaveLength(1);
  expect(text).toContain("整文件摘要不同本身不证明本需求定义变化");
  expect(text).toContain("不要仅为消除提示而覆盖摘要或删除待核对材料");
  expect(text).not.toContain('"A-CLEAN');
});

it("deduplicates repeated requirement and report keys while retaining additional reports, issue details, and each requirement association", () => {
  const { product } = fixture();
  const items = buildOverviewData(snapshot(product)).reviewRequirements!;
  const extra = structuredClone(items[0]);
  extra.assessmentRecords.push(extra.assessmentRecords[0]);
  const more = structuredClone(extra.assessmentRecords[0]);
  more.report.key = "additional-report-key";
  more.report.id = "A-ADDITIONAL";
  more.report.metadata.subject!.revision = "another-revision";
  extra.assessmentRecords.push(more);
  extra.assessmentRecords[0].review!.issues.push({
    code: "extra-source-detail",
    title: "补充来源核对明细",
    detail: "同一报告的其他实际来源",
    action: "核对补充来源",
    sources: [{ label: "补充来源", source: source("evidence/extra.md", 46) }],
  });
  const before = JSON.stringify(items);
  const repeated = [items[0], extra, ...items.slice(1), ...items];
  const { data } = projectData(repeated);
  expect(data.summary).toEqual({
    changes: 7,
    requirements: 4,
    reports: 6,
    issues: 8,
  });
  expect(data.requirements[0].reports[0].issues).toHaveLength(2);
  expect(data.requirements[0].reports[0].issues[1].sources[0].source).toEqual(
    source("evidence/extra.md", 46),
  );
  expect(
    data.requirements[0].reports.map(
      (entry: { report: { id: string } }) => entry.report.id,
    ),
  ).toEqual(["A-FILE", "A-ADDITIONAL"]);
  expect(
    data.requirements[1].reports.map(
      (entry: { report: { id: string } }) => entry.report.id,
    ),
  ).toEqual(["A-DEFINITION"]);
  expect(
    data.requirements[2].reports.map(
      (entry: { report: { id: string } }) => entry.report.id,
    ),
  ).toEqual(["A-PENDING", "A-CONFLICT"]);
  expect(JSON.stringify(items)).toBe(before);

  const separateIdentity = structuredClone(items[0]);
  separateIdentity.key = "different-requirement-key";
  const distinct = projectData([items[0], separateIdentity]).data;
  expect(distinct.summary).toEqual({
    changes: 1,
    requirements: 2,
    reports: 2,
    issues: 2,
  });
});

it("ignores clean reports even when their shared selection has reasons, and retains legacy reason codes when detailed issues are unavailable", () => {
  const item: OverviewReviewRequirement = {
    key: "legacy-requirement",
    id: "LEGACY",
    title: "未带明细的旧快照",
    assessmentRecords: [
      {
        report: {
          key: "legacy",
          id: "A-LEGACY",
          title: "旧报告",
          usable: true,
          metadata: {},
        },
        selection: {
          conclusion: "undetermined",
          reasons: ["definition-unverified", "pending-evidence"],
        },
      },
      {
        report: {
          key: "clean",
          id: "A-CLEAN",
          title: "无自身异常",
          usable: true,
          metadata: {},
        },
        selection: {
          conclusion: "undetermined",
          reasons: ["definition-unverified"],
        },
        review: { issues: [] },
      },
      {
        report: {
          key: "satisfied",
          id: "A-SATISFIED",
          title: "正常结论",
          usable: true,
          metadata: {},
        },
        selection: { conclusion: "satisfied", reasons: [] },
      },
    ],
  };
  expect(
    pendingAssessmentRecords(item).map((record) => record.report.id),
  ).toEqual(["A-LEGACY"]);
  const { data } = projectData([item]);
  expect(data.summary).toEqual({
    changes: 2,
    requirements: 1,
    reports: 1,
    issues: 2,
  });
  expect(data.requirements[0].reports[0].reasonCodes).toEqual([
    "definition-unverified",
    "pending-evidence",
  ]);
  expect(data.requirements[0].reports[0].issues).toBeUndefined();
  const single = assessmentReviewText(item, snapshotIdentity);
  const singleData = JSON.parse(
    single.slice(single.indexOf('{\n  "requirement"')),
  );
  expect(singleData).toEqual({
    requirement: { id: item.id, title: item.title },
    reports: data.requirements[0].reports,
    changeGroups: data.changeGroups,
  });
  expect(projectData([]).data.summary).toEqual({
    changes: 0,
    requirements: 0,
    reports: 0,
    issues: 0,
  });
});
