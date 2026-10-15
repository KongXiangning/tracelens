import { expect, it } from "vitest";
import { parseProductDocument } from "../src/server/product-parser.js";
import { buildOverviewData } from "../src/shared/overview-data.js";
import { selectAssessment } from "../src/shared/product-view.js";
import { assessmentReviewText } from "../src/web/assessment-review-dialog.js";
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
const subject = { kind: "working-copy", value: "test-copy" };
function source(path: string, line = 1, digest = originalDigest): SourceRef {
  return { documentId: path, path, line, section: null, digest };
}
function item(
  id: string,
  type: ProductMetadata["type"],
  metadata: Partial<ProductMetadata> = {},
): ProductItem {
  return {
    key: id,
    id,
    type,
    version: 5,
    title: id,
    body: id,
    metadata: { id, type, scope: "current", ...metadata },
    source: source(`docs/${id}.md`, 12),
    endLine: 20,
    metadataLine: 2,
    usable: true,
    definitionAlgorithm: algorithm,
    definitionSha256: originalDigest,
    diagnostics: [],
  };
}
function fixture() {
  const requirement = item("R", "requirement");
  const goal = item("G", "goal", {
    assessment_scopes: [
      { target: "R", scope_id: "scope", coverage: "完整功能" },
    ],
  });
  const project = item("P", "project", {
    root_goal_id: "G",
    requirement_order: ["R"],
  });
  const report = item("A", "assessment", {
    target: "R",
    conclusion: "satisfied",
    applicability: { goal_id: "G", scope_id: "scope", coverage: "完整功能" },
    subject,
    target_definition_algorithm: algorithm,
    target_definition_sha256: originalDigest,
    target_basis: {
      kind: "file",
      path: "docs/R.md",
      item_id: "R",
      sha256: originalDigest,
      lines: { start: 12, end: 20 },
    },
    goal_definition_algorithm: algorithm,
    goal_definition_sha256: originalDigest,
    goal_basis: {
      kind: "file",
      path: "docs/G.md",
      item_id: "G",
      sha256: originalDigest,
    },
  });
  function checks(owner: ProductItem): ProductSourceCheck[] {
    return (["target", "goal"] as const).map((prefix) => ({
      id: `${owner.key}:${prefix}`,
      ownerKey: owner.key,
      role: `${prefix}_basis`,
      reference: owner.metadata[`${prefix}_basis`]!,
      readState: "read",
      locationState: "located",
      byteState: "same-bytes",
      source: source(prefix === "target" ? "docs/R.md" : "docs/G.md", 12),
      definitionAlgorithm: algorithm,
      definitionSha256: originalDigest,
      detail: "已读取并定位条目",
    }));
  }
  const product: ProductSnapshot = {
    status: "ready",
    manifestPath: ".workflow-system/PRODUCT.yaml",
    manifest: {
      schema: "vnext-product-manifest/v2",
      project_id: "test",
      entry: project.source.path,
      managed_paths: ["docs/*.md"],
      source_paths: [],
      exclude_paths: [],
      maintenance: "enabled",
    },
    manifestSource: null,
    items: [project, requirement, goal, report],
    sources: checks(report),
    relations: [],
    bindings: [],
    assessments: [],
    diagnostics: [],
    coverage: { complete: true, paths: [], omitted: [], excluded: [] },
    workingCopy: "test-copy",
  };
  function addReport(id: string): ProductItem {
    const other = structuredClone(report);
    other.id = other.metadata.id = other.key = id;
    other.source = source(`reports/${id}.md`, 31);
    product.items.push(other);
    product.sources.push(...checks(other));
    return other;
  }
  const select = () => selectAssessment(product, "R", "G", subject, "scope");
  return { product, requirement, goal, report, addReport, select };
}
function snapshot(product: ProductSnapshot): Snapshot {
  const rules = { management: [], requirements: [], design: [], planning: [] };
  return {
    id: "snapshot",
    projectId: "test",
    configVersion: 1,
    config: { rules, excludes: [] },
    startedAt: "2026-10-15T00:00:00Z",
    completedAt: "2026-10-15T00:00:00Z",
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

it("explains a changed whole file without claiming that its unchanged requirement definition changed", () => {
  const f = fixture();
  const checked = f.product.sources[0];
  checked.byteState = "changed";
  checked.source!.digest = currentDigest;
  const selected = f.select();
  expect(selected.reasons).toEqual(["definition-unverified"]);
  expect(selected.reviewIssues).toHaveLength(1);
  expect(selected.reviewIssues![0]).toMatchObject({
    reportKey: "A",
    issue: {
      code: "target-source-file-changed",
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
            path: "docs/R.md",
            item_id: "R",
            lines: { start: 12, end: 20 },
          },
          source: { path: "docs/R.md", line: 12 },
        },
        { source: { path: "docs/R.md", line: 12 } },
      ],
    },
  });
});

it.each(["target", "goal"] as const)(
  "distinguishes an actual %s definition change from a whole-file change",
  (prefix) => {
    const f = fixture();
    const definition = prefix === "target" ? f.requirement : f.goal;
    definition.definitionSha256 = currentDigest;
    const selected = f.select();
    expect(selected.reasons).toEqual([
      prefix === "target" ? "definition-changed" : "goal-definition-changed",
    ]);
    expect(selected.reviewIssues).toEqual([
      expect.objectContaining({
        reportKey: "A",
        issue: expect.objectContaining({
          code: `${prefix}-definition-changed`,
          title: prefix === "target" ? "需求定义变化" : "目标定义变化",
          comparisons: [
            {
              label: `${prefix === "target" ? "需求" : "目标"}定义 SHA-256`,
              recorded: originalDigest,
              current: currentDigest,
            },
          ],
          action: expect.stringContaining("不能只刷新摘要"),
        }),
      }),
    ]);
  },
);

it("keeps report-specific failures attached to their owner while listing every competing report", () => {
  const f = fixture();
  const other = f.addReport("B");
  const checked = f.product.sources.find(
    (check) => check.ownerKey === other.key && check.role === "target_basis",
  )!;
  checked.byteState = "changed";
  checked.source!.digest = currentDigest;
  other.metadata.pending_sources = [
    { kind: "uri", uri: "https://example.test/new-evidence" },
  ];
  const selected = f.select();
  const first = selected.reviewIssues!.filter(
    (entry) => entry.reportKey === "A",
  );
  const second = selected.reviewIssues!.filter(
    (entry) => entry.reportKey === "B",
  );
  expect(first.map((entry) => entry.issue.code)).toEqual(["multiple-reports"]);
  expect(second.map((entry) => entry.issue.code)).toEqual([
    "multiple-reports",
    "target-source-file-changed",
    "pending-evidence",
  ]);
  expect(first[0].issue.sources!.map((entry) => entry.source?.path)).toEqual([
    "docs/A.md",
    "reports/B.md",
  ]);
  const records = buildOverviewData(snapshot(f.product)).planned[0]
    .assessmentRecords;
  expect(
    records
      .find((record) => record.report.key === "A")!
      .review!.issues.map((issue) => issue.code),
  ).toEqual(["multiple-reports"]);
  expect(
    records
      .find((record) => record.report.key === "B")!
      .review!.issues.map((issue) => issue.code),
  ).toEqual(second.map((entry) => entry.issue.code));
  expect(
    records.find((record) => record.report.key === "B")!.report.source,
  ).toEqual(other.source);
});

it("carries each pending material's actual indexed source check, location and reading status", () => {
  const f = fixture();
  const reference = {
    kind: "file" as const,
    path: "evidence/new.md",
    section: "新验证结果",
    lines: { start: 6, end: 9 },
    note: "核对新增用例",
  };
  f.report.metadata.pending_sources = [reference];
  f.product.sources.push({
    id: "pending",
    ownerKey: "A",
    role: "pending_sources[0]",
    reference,
    readState: "not-read",
    locationState: "not-applicable",
    byteState: "unknown",
    source: null,
    detail: "文件尚未读取",
  });
  const selected = f.select();
  expect(selected.reasons).toEqual(["pending-evidence"]);
  expect(selected.reviewIssues).toEqual([
    expect.objectContaining({
      reportKey: "A",
      issue: expect.objectContaining({
        code: "pending-evidence",
        sources: [
          {
            label: "待对账材料 1",
            reference: expect.objectContaining(reference),
            source: undefined,
            status: expect.stringContaining("文件尚未读取"),
          },
        ],
      }),
    }),
  ]);
});

it.each([
  ["missing", "target-basis-missing"],
  ["not-read", "target-basis-not-read"],
  ["unlocated", "target-basis-not-located"],
  ["algorithm", "target-definition-algorithm-changed"],
] as const)(
  "explains %s evidence failures without implying a requirement definition changed",
  (condition, code) => {
    const f = fixture();
    if (condition === "missing") delete f.report.metadata.target_basis;
    if (condition === "not-read") f.product.sources[0].readState = "not-read";
    if (condition === "unlocated")
      f.product.sources[0].locationState = "unlocated";
    if (condition === "algorithm")
      f.report.metadata.target_definition_algorithm =
        "vnext-requirement-definition/v1";
    const issues = f.select().reviewIssues!.map((entry) => entry.issue);
    expect(issues.some((issue) => issue.code === code)).toBe(true);
    expect(issues.some((issue) => issue.title === "需求定义变化")).toBe(false);
  },
);

it("does not fabricate a goal definition change when a verified comparison excludes other scopes", () => {
  const f = fixture();
  f.goal.definitionSha256 = currentDigest;
  f.product.sources[1].goalScopeComparison = {
    target: "R",
    scopeId: "scope",
    basisDefinitionSha256: originalDigest,
    currentDefinitionSha256: currentDigest,
    same: true,
  };
  expect(f.select()).toMatchObject({
    conclusion: "satisfied",
    reasons: [],
    reviewIssues: [],
  });
  f.product.sources[0].byteState = "changed";
  expect(f.select().reviewIssues!.map((entry) => entry.issue.code)).toEqual([
    "target-source-file-changed",
  ]);
});

it("identifies missing and cross-object superseded reports instead of emitting an unexplained conflict", () => {
  const f = fixture();
  const other = f.addReport("B");
  other.metadata.subject = { kind: "release", value: "other-release" };
  f.report.metadata.supersedes = ["missing", "B"];
  const issue = f
    .select()
    .reviewIssues!.find(
      (entry) => entry.issue.code === "report-conflict",
    )!.issue;
  expect(issue.detail).toContain("supersedes 引用 missing，但未找到对应条目");
  expect(issue.detail).toContain("supersedes 引用 B，但该条目不属于相同需求");
  expect(issue.sources!.map((entry) => entry.source?.path)).toEqual([
    "docs/A.md",
    "reports/B.md",
  ]);
});

it("keeps malformed report metadata inspectable without passing invalid source fields to the overview", () => {
  const f = fixture();
  f.report.usable = false;
  f.report.rawMetadata = {
    ...f.report.metadata,
    target_definition_sha256: { invalid: true },
    target_basis: { kind: "file", path: 99 },
    pending_sources: { length: 1 },
  };
  const selected = f.select();
  expect(selected.reasons).toContain("metadata-incomplete");
  const issue = selected.reviewIssues!.find(
    (entry) => entry.issue.code === "target-definition-changed",
  )!.issue;
  expect(issue.title).toBe("需求定义摘要无法确认");
  expect(issue.sources![0].reference).toBeUndefined();
  expect(() => buildOverviewData(snapshot(f.product))).not.toThrow();
});

it("preserves a real parser's cleared invalid report identity and diagnostics in the agent handoff", () => {
  const f = fixture();
  const revision = "verified-snapshot-revision";
  f.report.metadata.subject = { ...subject, revision };
  const rawReport = {
    ...f.report.metadata,
    id: "B",
    checked_at: "yesterday",
    implementation: "delivered-reported",
    verification: "pass-reported",
    sources: [{ kind: "file", path: "evidence/validation.md" }],
  };
  delete rawReport.scope;
  const raw = `---\n${JSON.stringify({ schema: "vnext-product-doc/v5", items: [rawReport] })}\n---\n## [B] 时间字段异常的报告\n### 覆盖范围\n完整功能\n### 交付与验证依据\n已验证\n### 剩余与待核对\n时间待修正\n`;
  const parsed = parseProductDocument("test", "test-copy", {
    path: "reports/B.md",
    kind: "requirements",
    raw,
    digest: originalDigest,
    bytes: Buffer.byteLength(raw),
    modifiedAt: "2026-10-15T00:00:00Z",
  }).items[0];
  expect(parsed.usable).toBe(false);
  expect(parsed.metadata).toEqual({ id: "B", type: "assessment" });
  expect(parsed.diagnostics).toEqual([
    expect.objectContaining({
      code: "ASSESSMENT_METADATA",
      message: expect.stringContaining("checked_at"),
    }),
  ]);
  f.product.items.push(parsed);
  const read = snapshot(f.product);
  const requirement = buildOverviewData(read).planned[0];
  const record = requirement.assessmentRecords.find(
    (row) => row.report.id === "B",
  )!;
  expect(record.report.metadata).toEqual({
    target: "R",
    conclusion: "satisfied",
    applicability: { goal_id: "G", scope_id: "scope", coverage: "完整功能" },
    subject: { ...subject, revision, limitations: undefined },
    checked_at: undefined,
  });
  expect(record.review!.issues).toContainEqual(
    expect.objectContaining({
      code: "report-metadata-incomplete",
      detail: expect.stringContaining("checked_at"),
    }),
  );
  const handoff = assessmentReviewText(requirement, read);
  expect(handoff).toContain('"id": "B"');
  expect(handoff).toContain(`"revision": "${revision}"`);
  expect(handoff).toContain('"originalConclusion": "satisfied"');
  expect(handoff).toContain(
    "checked_at must be an actual ISO time with timezone",
  );
});
