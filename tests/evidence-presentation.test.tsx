import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, stringify } from "yaml";
import { buildSnapshot } from "../src/server/snapshot.js";
import {
  assessmentReviewSummary,
  assessmentReviewText,
} from "../src/shared/assessment-review-export.js";
import {
  assessmentEvidence,
  dispositionBasis,
} from "../src/shared/evidence-dispositions.js";
import { buildOverviewData } from "../src/shared/overview-data.js";
import type {
  ProductEvidenceDisposition,
  ProductMetadata,
  ProductSource,
} from "../src/shared/product-types.js";
import type { Project } from "../src/shared/types.js";
import {
  AssessmentEvidenceDetails,
  PlanningPage,
  ProductDetail,
  type ProductContext,
} from "../src/web/product.js";
import { RequirementsV3, ScopedConclusion } from "../src/web/product-v3.js";

const temporaryPrefix = "tracelens-evidence-presentation-";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith(temporaryPrefix)
    )
      throw new Error(`Refusing to remove a non-fixture directory: ${root}`);
    await rm(resolved, { recursive: true, force: true });
  }
});

async function fixture(version = 6) {
  const root = await mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
  roots.push(root);
  await cp(path.resolve("examples/product-scoped"), root, { recursive: true });
  const reportPath = path.join(root, "docs/product/ASSESSMENTS.md");
  await writeFile(
    reportPath,
    (await readFile(reportPath, "utf8")).replace(
      "vnext-product-doc/v3",
      `vnext-product-doc/v${version}`,
    ),
  );
  const project: Project = {
    id: "evidence-presentation",
    name: "Evidence presentation regression",
    root,
    configVersion: 1,
    config: {
      readingMode: "custom",
      autoDiscover: false,
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
      product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
    },
  };
  async function editReport(change: (report: ProductMetadata) => void) {
    const raw = await readFile(reportPath, "utf8");
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)!;
    const document = parse(header[1]) as { items: ProductMetadata[] };
    change(document.items.find((item) => item.id === "A-DEMO")!);
    await writeFile(
      reportPath,
      `---\n${stringify(document)}---${raw.slice(header[0].length)}`,
    );
  }
  const source: ProductSource = {
    kind: "file",
    path: "docs/evidence/boundary.md",
    sha256: createHash("sha256")
      .update("A retained local obligation.\n")
      .digest("hex"),
  };
  await writeFile(
    path.join(root, source.path),
    "A retained local obligation.\n",
  );
  const manifestPath = path.join(root, ".workflow-system/PRODUCT.yaml");
  const manifest = parse(await readFile(manifestPath, "utf8"));
  manifest.source_paths.push(source.path);
  manifest.managed_paths.push("docs/product/PLAN.md");
  await writeFile(manifestPath, stringify(manifest));
  await writeFile(
    path.join(root, "docs/product/PLAN.md"),
    `---\n${stringify({
      schema: "vnext-product-doc/v2",
      items: [
        {
          id: "PLAN-LOCAL",
          type: "plan",
          intent_state: "adopted",
          targets: [{ target: "R-IMPORT", coverage: "固定知识集全量入库" }],
          work_items: [
            {
              id: "P1",
              title: "第一步",
              outcome: "步骤证据",
              scope: "局部导入",
              targets: [{ target: "R-IMPORT", coverage: "固定知识集全量入库" }],
              state: "included",
              origin: "initial",
            },
          ],
        },
      ],
    })}---\n## [PLAN-LOCAL] 局部安排\n### 实施策略\n积累本次执行证据。\n### 阶段与工作项说明\nP1 仅覆盖局部导入。\n### 调整与未决事项\n保留现有报告结论。\n`,
  );
  const projectPath = path.join(root, "docs/product/PROJECT.md");
  const projectRaw = await readFile(projectPath, "utf8");
  await writeFile(
    projectPath,
    projectRaw
      .replace(
        "  - id: R-IMPORT\n",
        "  - id: R-IMPORT\n    assessment_id: A-DEMO\n",
      )
      .replace(
        "  - id: R-IMPORT\r\n",
        "  - id: R-IMPORT\r\n    assessment_id: A-DEMO\r\n",
      ),
  );
  await editReport((report) => {
    report.pending_sources = [source];
  });
  const snapshot = () => buildSnapshot(project, "2026-10-15T09:00:00Z");
  const original = await snapshot();
  const reportOf = (context: ProductContext) =>
    context.snapshot.product!.items.find((item) => item.id === "A-DEMO")!;
  const context = async (): Promise<ProductContext> => ({
    snapshot: await snapshot(),
    open: () => {},
    openProduct: () => {},
    openTask: () => {},
    relations: () => {},
  });
  const report = original.product!.items.find((item) => item.id === "A-DEMO")!;
  const basis = dispositionBasis(original.product!, report);
  async function save(
    disposition: ProductEvidenceDisposition["disposition"] = "no-impact",
  ) {
    if (!basis) throw new Error("Fixture has no valid v6 basis");
    await editReport((item) => {
      item.evidence_dispositions = [
        {
          change_id: "ingestion-boundary",
          kind: "scope-change",
          source,
          disposition,
          reason: "领域义务与交付对象未变，局部成果继续适用。",
          checked_at: "2026-10-15T08:00:00Z",
          basis,
        },
      ];
    });
  }
  return { root, source, reportPath, reportOf, editReport, context, save };
}

it("uses the snapshot's effective pending state across overview, report details, current scope, planning and export", async () => {
  const f = await fixture();
  await f.save();
  const context = await f.context();
  const product = context.snapshot.product!;
  const report = f.reportOf(context);
  const requirement = product.items.find((item) => item.id === "R-IMPORT")!;
  const goal = product.items.find((item) => item.id === "G-DEMO")!;
  const plan = product.items.find((item) => item.id === "PLAN-LOCAL")!;
  expect(plan.usable, JSON.stringify(plan.diagnostics)).toBe(true);
  expect(report.metadata.pending_sources).toEqual([f.source]);
  expect(assessmentEvidence(product, report).pending_sources).toEqual([]);
  const overview = buildOverviewData(context.snapshot);
  expect(
    assessmentReviewSummary(overview.reviewRequirements || []).reports,
  ).toBe(0);
  const overviewItem = overview.planned.find(
    (item) => item.id === requirement.id,
  )!;
  const record = overviewItem.assessmentRecords.find(
    (entry) => entry.report.id === report.id,
  )!;
  expect(record.selection).toMatchObject({
    conclusion: "satisfied",
    reasons: [],
  });
  const exported = assessmentReviewText(overviewItem, context.snapshot);
  const payload = JSON.parse(
    exported.slice(exported.indexOf('{\n  "requirement"')),
  );
  expect(payload.reports).toEqual([]);
  expect(payload.reusedReports[0].evidenceDispositions[0].reuse_status).toBe(
    "reused",
  );

  const detail = renderToStaticMarkup(
    <ProductDetail item={report} context={context} />,
  );
  const inspector = renderToStaticMarkup(
    <RequirementsV3
      {...context}
      selected={report.key}
      select={() => {}}
      configure={() => {}}
    />,
  );
  const currentScope = renderToStaticMarkup(
    <ScopedConclusion
      item={requirement}
      goal={goal}
      subject={report.metadata.subject}
      scopeId="FULL"
      context={context}
    />,
  );
  const planning = renderToStaticMarkup(
    <PlanningPage
      {...context}
      selected={plan.key}
      select={() => {}}
      configure={() => {}}
    />,
  );
  for (const html of [detail, inspector, currentScope, planning]) {
    expect(html).not.toContain('data-evidence-state="pending"');
    expect(html).toContain('data-evidence-state="handled"');
    expect(html).toContain("已处理的历史材料");
    expect(html).toContain("已复用的局部处置");
  }
  for (const html of [detail, inspector, currentScope]) {
    expect(html).toContain('data-evidence-state="reused"');
    expect(html).toContain("领域义务与交付对象未变，局部成果继续适用。");
    expect(html).toContain("G-DEMO / FULL");
    expect(html).toContain("sample-baseline");
    expect(html).toContain("2026-10-15T08:00:00Z");
    expect(html).toContain("原报告结论与检查时间保留");
    expect(html).toContain("docs/evidence/boundary.md");
  }
  expect(inspector.match(/data-evidence-state="reused"/g)).toHaveLength(1);
  expect(detail).not.toContain("待对账新材料");
  expect(detail).not.toContain("当前实现适用性仍需核对");
  expect(report.metadata.checked_at).toBe("2026-10-11T10:00:00+08:00");
});

it.each(["new-pending", "deferred", "conflict", "changed-source"])(
  "retains real pending work and its reason after %s",
  async (change) => {
    const f = await fixture();
    await f.save(change === "deferred" ? "deferred" : "no-impact");
    if (change === "new-pending") {
      await f.editReport((report) => {
        report.pending_sources!.push({
          kind: "text",
          label: "新反例",
          text: "失败输入仍未隔离",
        });
      });
    } else if (change === "conflict") {
      await f.editReport((report) => {
        report.evidence_dispositions!.push({
          ...structuredClone(report.evidence_dispositions![0]),
          disposition: "deferred",
          reason: "仍需后续处理",
        });
      });
    } else if (change === "changed-source") {
      if (f.source.kind !== "file")
        throw new Error("Expected fixture file source");
      await writeFile(
        path.join(f.root, f.source.path),
        "Changed local obligation.\n",
      );
    }
    const context = await f.context();
    const report = f.reportOf(context);
    expect(report.usable, JSON.stringify(report.diagnostics)).toBe(true);
    const evidence = assessmentEvidence(context.snapshot.product!, report);
    expect(evidence.pending_sources).toHaveLength(1);
    const html = renderToStaticMarkup(
      <AssessmentEvidenceDetails item={report} context={context} />,
    );
    const reportHtml = renderToStaticMarkup(
      <ProductDetail item={report} context={context} />,
    );
    expect(reportHtml).toContain("当前实现适用性仍需核对");
    expect(html).toContain('data-evidence-state="pending"');
    expect(html).toContain("待对账新材料 · 1 项");
    expect(
      assessmentReviewSummary(
        buildOverviewData(context.snapshot).reviewRequirements || [],
      ).reports,
    ).toBe(1);
    if (change === "new-pending") {
      expect(html).toContain("失败输入仍未隔离");
      expect(html).toContain('data-evidence-state="handled"');
    } else {
      expect(html).not.toContain('data-evidence-state="handled"');
      expect(html).toContain('data-evidence-state="unresolved"');
    }
  },
);

it("keeps legacy pending history active when no reusable v6 disposition exists", async () => {
  const f = await fixture(3);
  const context = await f.context();
  const report = f.reportOf(context);
  expect(report.usable).toBe(true);
  const html = renderToStaticMarkup(
    <ProductDetail item={report} context={context} />,
  );
  expect(html).toContain("待对账新材料 · 1 项");
  expect(html).toContain("当前实现适用性仍需核对");
  expect(html).not.toContain('data-evidence-state="handled"');
  expect(
    assessmentReviewSummary(
      buildOverviewData(context.snapshot).reviewRequirements || [],
    ).reports,
  ).toBe(1);
});
