import path from "node:path";
import os from "node:os";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSnapshot } from "../src/server/snapshot.js";
import {
  overviewCards,
  overviewAssessmentRecords,
  overviewTaskStates,
} from "../src/shared/overview-model.js";
import { OverviewDashboard } from "../src/web/overview-dashboard.js";
import type { ProductBindingView } from "../src/shared/product-types.js";
import type { Entry, Snapshot, Task } from "../src/shared/types.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(name: string, base = "examples/product-planning") {
  const root = await mkdtemp(path.join(os.tmpdir(), "tracelens-overview-"));
  roots.push(root);
  await cp(path.resolve(base, name), root, {
    recursive: true,
  });
  return buildSnapshot(
    {
      id: name,
      name,
      root,
      configVersion: 1,
      config: {
        readingMode: "custom",
        autoDiscover: false,
        rules: { management: [], requirements: [], design: [], planning: [] },
        excludes: [],
        product: {
          enabled: true,
          manifestPath: ".workflow-system/PRODUCT.yaml",
        },
      },
    },
    "overview",
  );
}
it("keeps the reordered plan, explicit dependencies and B's binding without creating A/C tasks", async () => {
  const snapshot = await fixture("reordered");
  const product = snapshot.product!;
  const plan = product.items.find((item) => item.type === "plan")!;
  const cards = overviewCards(product, plan);
  expect(cards.map((card) => card.id)).toEqual(["B", "A", "C"]);
  expect(cards.map((card) => card.bindings.length)).toEqual([1, 0, 0]);
  expect(
    cards.every((card) => !card.followsPrevious && !card.dependencies.length),
  ).toBe(true);
  const declared = structuredClone(plan);
  declared.metadata.work_items![2].depends_on = [
    {
      item_id: "A",
      kind: "prerequisite",
      reason: "explicit synthetic dependency",
    },
  ];
  expect(
    overviewCards(product, declared)
      .filter((card) => card.followsPrevious)
      .map((card) => card.id),
  ).toEqual(["C"]);
  expect(snapshot.tasks).toEqual([]);
});

it("keeps scoped acceptance in outcomes without inferring performed work from reports", async () => {
  const snapshot = await fixture("product-scoped", "examples");
  const product = snapshot.product!;
  const requirement = product.items.find((item) => item.id === "R-IMPORT")!;
  expect(
    overviewAssessmentRecords(product, requirement).map(
      ({ report, selection }) => [report.id, selection.conclusion],
    ),
  ).toEqual([
    ["A-DEMO", "satisfied"],
    ["A-LIVE", "partially-satisfied"],
    ["A-RELEASE", "not-satisfied"],
  ]);
  product.bindings = [];
  snapshot.tasks = [];
  const html = renderToStaticMarkup(
    <OverviewDashboard
      context={{
        snapshot,
        open: () => {},
        openProduct: () => {},
        openTask: () => {},
        relations: () => {},
      }}
      requirements={() => {}}
      planning={() => {}}
    />,
  );
  expect(html).not.toContain("data-overview-card");
  expect(html).toContain("最近确认的成果 · 2");
  expect(html).toContain("尚未读到需求范围的直接执行记录");
  expect(html).not.toContain("overview-donut");
  expect(html.indexOf('class="overview-hero"')).toBeLessThan(
    html.indexOf('class="overview-assessments"'),
  );
  expect(
    html.match(/<details class="overview-assessments"[^>]*>/)![0],
  ).not.toContain(" open");
});

it("uses explicit supersession and retains same-scope conflicts instead of choosing the latest report", async () => {
  const snapshot = await fixture("product-scoped", "examples");
  const product = snapshot.product!;
  const requirement = product.items.find((item) => item.id === "R-IMPORT")!;
  const original = product.items.find((item) => item.id === "A-DEMO")!;
  const replacement = structuredClone(original);
  replacement.id = replacement.metadata.id = "A-REPLACEMENT";
  replacement.key = "replacement";
  replacement.metadata.supersedes = [original.id];
  product.items.push(replacement);
  product.sources.push(
    ...product.sources
      .filter((source) => source.ownerKey === original.key)
      .map((source) => ({
        ...source,
        id: `${source.id}-replacement`,
        ownerKey: replacement.key,
      })),
  );
  let records = overviewAssessmentRecords(product, requirement);
  expect(records.some(({ report }) => report.id === original.id)).toBe(false);
  expect(
    records.find(({ report }) => report.id === replacement.id)?.selection
      .conclusion,
  ).toBe("satisfied");
  const conflict = structuredClone(replacement);
  conflict.id = conflict.metadata.id = "A-CONFLICT";
  conflict.key = "conflict";
  conflict.metadata.checked_at = "2099-01-01";
  product.items.push(conflict);
  records = overviewAssessmentRecords(product, requirement);
  const conflicted = records.filter(({ report }) =>
    [replacement.id, conflict.id].includes(report.id),
  );
  expect(conflicted).toHaveLength(2);
  expect(
    conflicted.every(
      ({ selection }) =>
        selection.conclusion === "undetermined" &&
        selection.reasons.includes("multiple-reports"),
    ),
  ).toBe(true);
});
it("keeps all known requirements without a plan and distinguishes plans sharing a work ID", async () => {
  const snapshot = await fixture("multiple-plans"),
    product = snapshot.product!;
  const requirements = overviewCards(product);
  expect(requirements.map((card) => card.id)).toEqual(
    product.items
      .filter((item) => item.type === "requirement" && item.usable)
      .map((item) => item.id),
  );
  expect(requirements.every((card) => !card.followsPrevious)).toBe(true);
  expect(new Set(requirements.map((card) => card.state))).toEqual(
    new Set(["current", "planned", "candidate", "retired"]),
  );
  const plans = product.items.filter((item) => item.type === "plan");
  const shared = plans
    .flatMap((plan) => overviewCards(product, plan))
    .filter((card) => card.id === "W-RELEASE");
  expect(shared).toHaveLength(2);
  expect(new Set(shared.map((card) => card.key)).size).toBe(2);
  const html = renderToStaticMarkup(
    <OverviewDashboard
      context={{
        snapshot,
        open: () => {},
        openProduct: () => {},
        openTask: () => {},
        relations: () => {},
      }}
      requirements={() => {}}
      planning={() => {}}
    />,
  );
  expect(html).toContain("需求全景");
  expect(html).toContain("查看全部需求");
  expect(html).not.toContain("data-overview-card");
  expect(html).not.toContain("选择要查看的计划");
  expect(html).not.toContain("overview-road-arrow");
});
it("deduplicates real task identities and keeps closed, conflicting and unknown identity separate from completion", async () => {
  const snapshot = await fixture("reordered");
  const original = snapshot.product!.bindings[0];
  const source = snapshot.product!.items[0].source;
  const entry = (text: string): Entry => ({ text, checked: null, source });
  const task = (id: string, statuses: string[]): Task => ({
    id,
    realTaskId: id,
    number: null,
    title: id,
    current: false,
    source,
    statuses: statuses.map(entry),
    goals: [],
    steps: [],
    checks: [],
    issues: [],
  });
  snapshot.tasks = [
    task("closed", ["closed"]),
    task("completed", ["done", "已完成"]),
    task("conflict", ["active", "paused"]),
  ];
  const binding = (
    key: string,
    id: string | null,
    state: ProductBindingView["match"]["state"] = "matched",
  ): ProductBindingView => ({
    ...original,
    key,
    binding: {
      ...original.binding,
      task: { ...original.binding.task, task_id: id },
    },
    match: { ...original.match, state, taskIds: id ? [id] : [] },
  });
  const result = overviewTaskStates(snapshot as Snapshot, [
    binding("b1", "closed"),
    binding("b2", "closed"),
    binding("b3", "completed"),
    binding("b4", "conflict"),
    binding("b5", null, "identity-unknown"),
  ]);
  expect(result.total).toBe(3);
  expect(result.unconfirmed).toBe(1);
  expect(result.states.map((state) => [state.label, state.count])).toEqual([
    ["已关闭", 1],
    ["已完成", 1],
    ["状态冲突", 1],
    ["身份未确认", 1],
  ]);
});
