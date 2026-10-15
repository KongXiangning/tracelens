import { expect, it } from "vitest";
import type { AssessmentReviewIssue } from "../src/shared/assessment-review.js";
import type { OverviewReviewRequirement } from "../src/shared/overview-data.js";
import type { ProductSource } from "../src/shared/product-types.js";
import {
  assessmentReviewGroups,
  reviewSourceIdentity,
} from "../src/shared/assessment-review-groups.js";
import {
  assessmentReviewSummary,
  projectAssessmentReviewText,
} from "../src/shared/assessment-review-export.js";

const source: ProductSource = {
  kind: "file",
  path: "decisions/ingest-boundary.md",
  item_id: "boundary",
  section: "职责调整",
  lines: { start: 12, end: 19 },
  sha256: "a".repeat(64),
};

function issue(reference = source): AssessmentReviewIssue {
  return {
    code: "pending-evidence",
    category: "scope-change",
    change: {
      id: "boundary-20261015",
      kind: "scope-change",
      source: reference,
    },
    title: "职责调整待局部核对",
    detail: "通用导入改由 INGEST 承担。",
    action: "只确认本报告受影响的义务映射。",
  };
}

function requirement(
  id: string,
  issues: AssessmentReviewIssue[],
): OverviewReviewRequirement {
  return {
    key: `key:${id}`,
    id,
    title: `需求 ${id}`,
    assessmentRecords: [
      {
        report: {
          key: `key:A-${id}`,
          id: `A-${id}`,
          title: `报告 ${id}`,
          usable: true,
          metadata: {
            target: id,
            conclusion: "satisfied",
            applicability: {
              goal_id: "G",
              scope_id: `scope:${id}`,
              coverage: `${id} 的领域义务`,
            },
            subject: {
              kind: "commit",
              value: "project",
              revision: `revision:${id}`,
            },
          },
        },
        selection: {
          conclusion: "undetermined",
          reasons: ["pending-evidence"],
        },
        review: { issues },
      },
    ],
  };
}

it("groups one exact change across requirements but preserves each report scope and original conclusion", () => {
  const items = [
    requirement("LAW", [issue({ ...source, note: "核对法规职责" })]),
    requirement("JUDICIAL", [issue({ ...source, note: "核对司法职责" })]),
  ];
  const before = JSON.stringify(items);
  const groups = assessmentReviewGroups([...items, ...items]);
  expect(groups).toHaveLength(1);
  expect(groups[0].source).toEqual(source);
  expect(
    groups[0].members.map(({ requirement, record }) => [
      requirement.id,
      record.report.metadata.applicability?.scope_id,
      record.report.metadata.conclusion,
    ]),
  ).toEqual([
    ["LAW", "scope:LAW", "satisfied"],
    ["JUDICIAL", "scope:JUDICIAL", "satisfied"],
  ]);
  expect(assessmentReviewSummary(items)).toEqual({
    changes: 1,
    requirements: 2,
    reports: 2,
    issues: 2,
  });
  expect(JSON.stringify(items)).toBe(before);
  const text = projectAssessmentReviewText(items, {
    id: "snapshot",
    projectId: "project",
    completedAt: "2026-10-15T08:00:00Z",
  });
  const data = JSON.parse(text.slice(text.indexOf('{\n  "project"')));
  expect(data.changeGroups).toHaveLength(1);
  expect(data.changeGroups[0].affectedReports).toHaveLength(2);
  expect(data.changeGroups[0].affectedReports[0].report.subject.revision).toBe(
    "revision:LAW",
  );
  expect(
    data.changeGroups[0].affectedReports[1].issues[0].change.source.note,
  ).toBe("核对司法职责");
  expect(text).toContain(
    "不要要求逐报告完整验收、全项目核对或为核对重新开 task",
  );
});

it("does not combine different source bytes or file locations even with the same change id", () => {
  const variants: ProductSource[] = [
    source,
    { ...source, sha256: "b".repeat(64) },
    { ...source, item_id: "other-boundary" },
    { ...source, section: "另一节" },
    { ...source, lines: { start: 20, end: 25 } },
  ];
  const items = variants.map((reference, index) =>
    requirement(`R${index}`, [issue(reference)]),
  );
  const groups = assessmentReviewGroups(items);
  expect(groups).toHaveLength(variants.length);
  expect(new Set(variants.map(reviewSourceIdentity)).size).toBe(
    variants.length,
  );
});

it("keeps different reasons separate and does not infer legacy evidence kind from its note", () => {
  const scoped = issue();
  const counterevidence: AssessmentReviewIssue = {
    ...issue(),
    category: "counterevidence",
    change: { ...issue().change!, kind: "counterevidence" },
  };
  const legacy = issue({ ...source, note: "新增反例，但旧格式没有 kind" });
  delete legacy.category;
  delete legacy.change!.kind;
  const groups = assessmentReviewGroups([
    requirement("LAW", [scoped, counterevidence, legacy]),
  ]);
  expect(groups.map((group) => group.category)).toEqual([
    "scope-change",
    "counterevidence",
    "unclassified",
  ]);
  expect(groups[2].label).toBe("旧材料未分类");
});

it("shares a definition comparison only for the same definition identity and versions", () => {
  const definitionIssue: AssessmentReviewIssue = {
    code: "target-definition-changed",
    category: "scope-change",
    title: "需求定义变化",
    detail: "定义变化",
    action: "比较局部义务",
    comparisons: [
      { label: "需求定义 SHA-256", recorded: "old", current: "new" },
    ],
  };
  const first = requirement("LAW", [definitionIssue]);
  const second = structuredClone(first);
  second.assessmentRecords[0].report.key = "another-report";
  second.assessmentRecords[0].report.id = "A-ANOTHER";
  const differentVersion = structuredClone(second);
  differentVersion.assessmentRecords[0].report.key = "another-version";
  differentVersion.assessmentRecords[0].review!.issues[0].comparisons![0].current =
    "newer";
  expect(
    assessmentReviewGroups([
      first,
      second,
      differentVersion,
      requirement("JUDICIAL", [definitionIssue]),
    ]).map((group) => group.members.length),
  ).toEqual([2, 1, 1]);
});
