import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  OverviewRequirement,
  OverviewSnapshot,
} from "../src/shared/overview-data";
import {
  defaultOverviewFilters,
  matchesOverviewFilters,
  overviewRequirementSignals,
  type OverviewFilters,
} from "../src/web/overview-card-state";
import { OverviewDashboard } from "../src/web/overview-dashboard";

type Record = OverviewRequirement["assessmentRecords"][number];
function report(
  conclusion: Record["selection"]["conclusion"],
  review = false,
): Record {
  return {
    report: {
      key: `${conclusion}:${review}`,
      id: conclusion,
      title: conclusion,
      usable: true,
      metadata: { conclusion },
    },
    selection: {
      conclusion: review ? "undetermined" : conclusion,
      reasons: review ? ["来源定义待核对"] : [],
    },
  };
}
function requirement(
  records: Record[] = [],
  taskState?: Partial<OverviewRequirement["taskState"]>,
): OverviewRequirement {
  return {
    key: "requirement",
    id: "R",
    title: "需求",
    type: "requirement",
    description: "需求范围",
    dependencies: [],
    childCount: 0,
    assessmentRecords: records,
    taskState: {
      total: 0,
      unconfirmed: 0,
      associationPending: 0,
      states: [],
      ...taskState,
    },
  };
}
function matches(
  item: OverviewRequirement,
  filters: Partial<OverviewFilters>,
): boolean {
  return matchesOverviewFilters(overviewRequirementSignals(item), {
    ...defaultOverviewFilters(),
    ...filters,
  });
}

it("retains original report verdicts independently of applicability review", () => {
  const item = requirement([
    report("satisfied", true),
    report("partially-satisfied", true),
    report("undetermined", true),
  ]);
  const signals = overviewRequirementSignals(item);
  expect(
    signals.verdicts.map((v) => [v.conclusion, v.symbol, v.label]),
  ).toEqual([
    ["satisfied", "✓", "原报告：已满足"],
    ["partially-satisfied", "◐", "原报告：部分满足"],
    ["undetermined", "?", "原报告：尚未判定"],
  ]);
  expect(matches(item, { conclusions: ["satisfied"], reviewOnly: true })).toBe(
    true,
  );
  expect(
    matches(requirement([report("undetermined")]), { reviewOnly: true }),
  ).toBe(false);
});

it("matches any selected verdict and combines review and Task conditions", () => {
  const item = requirement(
    [report("satisfied", true), report("partially-satisfied")],
    {
      total: 2,
      states: [
        { label: "进行中", tone: "orange", count: 1 },
        { label: "已关闭", tone: "slate", count: 1 },
      ],
    },
  );
  expect(
    matches(item, {
      conclusions: ["not-satisfied", "partially-satisfied"],
      reviewOnly: true,
      task: "active",
    }),
  ).toBe(true);
  expect(
    matches(item, {
      conclusions: ["not-satisfied"],
      reviewOnly: true,
      task: "active",
    }),
  ).toBe(false);
  expect(matches(item, { task: "associated" })).toBe(true);
  expect(matches(item, { task: "unassociated" })).toBe(false);
  expect(matches(item, { task: "closed" })).toBe(true);
  expect(matches(item, { task: "completed" })).toBe(false);
});

it("distinguishes no report, no Task and declared associations awaiting confirmation", () => {
  const empty = requirement();
  expect(
    matches(empty, { conclusions: ["unreported"], task: "unassociated" }),
  ).toBe(true);
  expect(matches(empty, { conclusions: ["undetermined"] })).toBe(false);
  const pending = requirement([], {
    unconfirmed: 1,
    associationPending: 1,
    states: [{ label: "身份未确认", tone: "slate", count: 1 }],
  });
  expect(matches(pending, { task: "associated" })).toBe(true);
  expect(matches(pending, { task: "unassociated" })).toBe(false);
  expect(matches(pending, { task: "association-pending" })).toBe(true);
  expect(matches(pending, { task: "status-pending" })).toBe(true);
  expect(matches(pending, { reviewOnly: true })).toBe(false);
});

it("shows multi-verdict card stripes, symbols and an independent review marker using only overview data", () => {
  const item = requirement([
    report("satisfied", true),
    report("partially-satisfied", true),
    report("undetermined", true),
  ]);
  const snapshot: OverviewSnapshot = {
    id: "snapshot",
    projectId: "filter-fixture",
    configVersion: 1,
    startedAt: "now",
    completedAt: "now",
    outcome: "success",
    revision: "r",
    overview: {
      ready: true,
      productStatus: "ready",
      planned: [item],
      unordered: [],
      taskCount: 0,
      tasks: [],
      itemTypes: { requirement: "requirement" },
      assessmentGroups: [],
      counts: { documents: 0, warnings: 0, tasks: 0 },
    },
  };
  const html = renderToStaticMarkup(
    <OverviewDashboard
      context={{
        snapshot,
        open: () => {},
        openTask: () => {},
        openProduct: () => {},
        relations: () => {},
      }}
      requirements={() => {}}
    />,
  );
  const card = html.match(
    /<article[^>]*data-overview-card="R"[^>]*>[\s\S]*?<\/article>/,
  )![0];
  expect(card).toContain('data-review="true"');
  expect(card).toContain('class="overview-review-marker"');
  for (const status of ["satisfied", "partially-satisfied", "undetermined"])
    expect(card).toContain(`data-conclusion="${status}"`);
  expect(card).toContain("原报告：已满足");
  expect(card).toContain("原报告：部分满足");
  expect(card).toContain("原报告：尚未判定");
  expect(html).toContain('aria-label="需求路线图筛选"');
});
