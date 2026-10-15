import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OverviewRequirement } from "../src/shared/overview-data";
import type { OverviewContext } from "../src/web/product";
import {
  AssessmentReviewDialog,
  assessmentReviewText,
} from "../src/web/assessment-review-dialog";

const source = {
  documentId: "source",
  path: "docs/验收记录.md",
  line: 23,
  section: "报告依据",
  digest: "report-digest",
};
const item: OverviewRequirement = {
  key: "requirement",
  id: "R-IMPORT",
  title: "设备导入",
  type: "requirement",
  description: "导入指定设备",
  dependencies: [],
  childCount: 0,
  taskState: { total: 0, unconfirmed: 0, associationPending: 0, states: [] },
  assessmentRecords: [
    {
      report: {
        key: "report",
        id: "A-IMPORT",
        title: "导入验收",
        usable: true,
        source,
        metadata: {
          conclusion: "satisfied",
          checked_at: "2026-10-14T08:00:00Z",
          applicability: {
            goal_id: "G",
            scope_id: "S",
            coverage: "单设备导入",
          },
          subject: {
            kind: "commit",
            value: "project",
            revision: "original-revision",
            limitations: "尚未覆盖双设备",
          },
        },
      },
      selection: {
        conclusion: "undetermined",
        reasons: ["definition-unverified"],
      },
      review: {
        issues: [
          {
            code: "definition-unverified",
            title: "来源文件变化",
            detail: "文件摘要不一致，本需求定义摘要仍一致。",
            action: "确认整文件变动是否影响本需求。",
            comparisons: [
              { label: "文件 SHA-256", recorded: "old", current: "new" },
            ],
            sources: [
              {
                label: "需求依据",
                reference: {
                  kind: "file",
                  path: "docs/需求.md",
                  item_id: "R-IMPORT",
                },
                source,
              },
            ],
          },
        ],
      },
    },
    {
      report: {
        key: "healthy",
        id: "A-HEALTHY",
        title: "正常报告",
        usable: true,
        metadata: { conclusion: "satisfied" },
      },
      selection: {
        conclusion: "undetermined",
        reasons: ["definition-unverified"],
      },
      review: { issues: [] },
    },
  ],
};
const snapshot = {
  id: "snapshot-version",
  projectId: "project-id",
  completedAt: "2026-10-15T05:31:12Z",
};
const context: OverviewContext = {
  snapshot: {
    ...snapshot,
    revision: "r",
    configVersion: 1,
    startedAt: "now",
    outcome: "success",
    phase: "complete",
  },
  open: () => {},
  openTask: () => {},
  openProduct: () => {},
  relations: () => {},
};

it("copies exact report context and evidence without attributing another report's issue to a healthy report", () => {
  const text = assessmentReviewText(item, snapshot);
  expect(text).toContain("整文件摘要不同本身不证明本需求定义变化");
  expect(text).toContain("snapshot-version");
  const data = JSON.parse(text.slice(text.indexOf('{\n  "requirement"')));
  expect(data.reports).toHaveLength(1);
  expect(data.reports[0].report).toMatchObject({
    id: "A-IMPORT",
    goal: "G",
    scope: "S",
    source,
    subject: { revision: "original-revision", limitations: "尚未覆盖双设备" },
  });
  expect(data.reports[0].issues[0].comparisons[0]).toEqual({
    label: "文件 SHA-256",
    recorded: "old",
    current: "new",
  });
  expect(text).not.toContain("A-HEALTHY");
});

it("renders the actual reason, source location and next action alongside the original report scope", () => {
  const html = renderToStaticMarkup(
    <AssessmentReviewDialog item={item} context={context} close={() => {}} />,
  );
  expect(html).toContain("来源文件变化");
  expect(html).toContain("docs/验收记录.md:23");
  expect(html).toContain("确认整文件变动是否影响本需求");
  expect(html).toContain("尚未覆盖双设备");
  expect(html).not.toContain("A-HEALTHY");
});

it("does not substitute an undetermined verdict for a missing original conclusion", () => {
  const missingConclusion = structuredClone(item);
  delete missingConclusion.assessmentRecords[0].report.metadata.conclusion;
  const html = renderToStaticMarkup(
    <AssessmentReviewDialog
      item={missingConclusion}
      context={context}
      close={() => {}}
    />,
  );
  expect(html).toContain("未记录或字段异常");
  expect(html).not.toContain("尚未判定");
});
