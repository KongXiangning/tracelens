import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSnapshot } from "../src/server/snapshot";
import { defaultConfig } from "../src/server/config";
import type { Snapshot } from "../src/shared/types";
import {
  requirementProgress,
  requirementProgressLabel,
  hasRequirementWork,
} from "../src/shared/overview-progress";
import { buildOverviewData } from "../src/shared/overview-data";
import { matchesRequirementVisibility } from "../src/web/overview-card-state";
import { ProgressResult } from "../src/web/progress-result";

let baseline: Snapshot;
beforeAll(async () => {
  baseline = await buildSnapshot(
    {
      id: "review-result",
      name: "review-result",
      root: path.resolve("examples/product-scoped"),
      configVersion: 1,
      config: {
        ...defaultConfig(),
        readingMode: "custom",
        product: {
          enabled: true,
          manifestPath: ".workflow-system/PRODUCT.yaml",
        },
      },
    },
    "review-result",
  );
});

function fixture(outcome: string) {
  const snapshot = structuredClone(baseline);
  const item = snapshot.product!.items.find((i) => i.id === "R-IMPORT")!;
  const report = snapshot.product!.items.find((i) => i.id === "A-LIVE")!;
  report.metadata.extensions = {
    startup: {
      state: outcome,
      basis: "已核对原记录：缺少设备证据，不能扩大验证范围。",
    },
  };
  snapshot.product!.bindings = [];
  return { snapshot, item, report };
}

it.each(["已开始过", "未开始", "无法确认"])(
  "shows a completed %s review without inventing Task execution",
  (outcome) => {
    const { snapshot, item } = fixture(outcome);
    const work = requirementProgress(snapshot, item, []);
    expect(work).toMatchObject({
      pending: false,
      recorded: false,
      current: false,
    });
    expect(requirementProgressLabel(work)).toBe(`已核对 · ${outcome}`);
    const row = buildOverviewData(snapshot).planned.find(
      (i) => i.id === item.id,
    )!;
    expect(matchesRequirementVisibility(row, "pending")).toBe(false);
    expect(matchesRequirementVisibility(row, "reviewed")).toBe(true);
    expect(hasRequirementWork(row)).toBe(outcome === "已开始过");
    const html = renderToStaticMarkup(
      <ProgressResult work={work} open={() => {}} />,
    );
    expect(html).toContain("缺少设备证据");
    expect(html).not.toContain("进展待核对");
    expect(html).toContain('<details class="result-evidence">');
    expect(html).not.toContain('<details class="result-evidence" open');
  },
);

it("keeps a recorded outcome visible after its applicability changes", () => {
  const { snapshot, item, report } = fixture("已开始过");
  report.metadata.target_definition_sha256 = "0".repeat(64);
  const work = requirementProgress(snapshot, item, []);
  expect(work.pending).toBe(false);
  expect(work.reviews?.[0].outcome).toBe("已开始过");
  expect(work.reviews?.[0].applicabilityIssues.length).toBeGreaterThan(0);
  const row = buildOverviewData(snapshot).planned.find(
    (i) => i.id === item.id,
  )!;
  expect(hasRequirementWork(row)).toBe(false);
});

it("does not mistake a pending review or an assessment verdict for a progress result", () => {
  const { snapshot, item, report } = fixture("待核对");
  expect(requirementProgress(snapshot, item, []).pending).toBe(true);
  delete report.metadata.extensions;
  report.metadata.conclusion = "satisfied";
  expect(requirementProgress(snapshot, item, []).pending).toBe(true);
});

it("does not revive an explicitly superseded progress review", () => {
  const { snapshot, item, report } = fixture("未开始");
  const replacement = structuredClone(report);
  replacement.id = replacement.metadata.id = "A-REVIEWED";
  replacement.key = "replacement";
  replacement.metadata.supersedes = [report.id];
  replacement.metadata.extensions = {
    startup: { state: "已开始过", basis: "新的执行记录已定位" },
  };
  snapshot.product!.items.push(replacement);
  const work = requirementProgress(snapshot, item, []);
  expect(work.reviews?.map((r) => r.outcome)).toEqual(["已开始过"]);
});
