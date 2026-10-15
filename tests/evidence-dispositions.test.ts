import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";
import { buildSnapshot } from "../src/server/snapshot.js";
import {
  assessmentEvidence,
  dispositionBasis,
} from "../src/shared/evidence-dispositions.js";
import { selectAssessment } from "../src/shared/product-view.js";
import { buildOverviewData } from "../src/shared/overview-data.js";
import { assessmentReviewSummary } from "../src/shared/assessment-review-export.js";
import type {
  ProductEvidenceDisposition,
  ProductMetadata,
  ProductSnapshot,
  ProductSource,
} from "../src/shared/product-types.js";
import type { Project } from "../src/shared/types.js";

const temporaryPrefix = "tracelens-evidence-dispositions-";
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

const reportOf = (product: ProductSnapshot) =>
  product.items.find((item) => item.id === "A-DEMO")!;
const select = (product: ProductSnapshot) => {
  const report = reportOf(product);
  const metadata = (report.rawMetadata ?? report.metadata) as ProductMetadata;
  return selectAssessment(
    product,
    "R-IMPORT",
    "G-DEMO",
    metadata.subject,
    metadata.applicability?.scope_id,
  );
};

async function fixture(version = 6, captureGoal = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
  roots.push(root);
  await cp(path.resolve("examples/product-scoped"), root, {
    recursive: true,
  });
  const assessmentPath = path.join(root, "docs/product/ASSESSMENTS.md");
  await writeFile(
    assessmentPath,
    (await readFile(assessmentPath, "utf8")).replace(
      "vnext-product-doc/v3",
      `vnext-product-doc/v${version}`,
    ),
  );
  const project: Project = {
    id: "evidence-dispositions",
    name: "synthetic evidence disposition scope",
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
  };
  const snapshot = () => buildSnapshot(project, "2026-10-15T08:00:00Z");
  const read = async () => (await snapshot()).product!;
  const mutate = async (
    filename: string,
    change: (items: ProductMetadata[]) => void,
  ) => {
    const absolute = path.join(root, "docs/product", filename);
    const raw = await readFile(absolute, "utf8");
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)!;
    const document = parse(header[1]) as {
      schema: string;
      items: ProductMetadata[];
    };
    change(document.items);
    await writeFile(
      absolute,
      `---\n${stringify(document)}---${raw.slice(header[0].length)}`,
    );
  };
  const editReport = (change: (report: ProductMetadata) => void) =>
    mutate("ASSESSMENTS.md", (items) =>
      change(items.find((item) => item.id === "A-DEMO")!),
    );
  const source = async (
    filename: string,
    raw: string,
  ): Promise<Extract<ProductSource, { kind: "file" }>> => {
    const relative = `docs/evidence/${filename}`;
    await writeFile(path.join(root, relative), raw);
    const manifestPath = path.join(root, ".workflow-system/PRODUCT.yaml");
    const manifest = parse(await readFile(manifestPath, "utf8"));
    if (!manifest.source_paths.includes(relative)) {
      manifest.source_paths.push(relative);
      await writeFile(manifestPath, stringify(manifest));
    }
    return {
      kind: "file",
      path: relative,
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  };
  const pending = await source(
    "responsibility.md",
    "# Adopted responsibility decision\nGeneric ingestion now owns conversion.\n",
  );
  const judgment = await source(
    "impact-review.md",
    "# Local impact review\nThe fixed demonstration obligation is unchanged.\n",
  );
  await editReport((report) => {
    report.pending_sources = [pending];
  });
  if (captureGoal) {
    const goal = await source(
      "goal-before.md",
      await readFile(path.join(root, "docs/product/PROJECT.md"), "utf8"),
    );
    await editReport((report) => {
      report.goal_basis = { ...goal, item_id: "G-DEMO" };
    });
  }
  const original = await read();
  const basis = dispositionBasis(original, reportOf(original));
  const disposition = (
    overrides: Partial<ProductEvidenceDisposition> = {},
  ): ProductEvidenceDisposition => {
    if (!basis) throw new Error("Fixture has no usable v6 disposition basis");
    return {
      change_id: "ingestion-responsibility-20261015",
      kind: "scope-change",
      source: pending,
      disposition: "no-impact",
      reason: "This decision retains the fixed demonstration obligation.",
      checked_at: "2026-10-15T08:00:00Z",
      basis,
      sources: [judgment],
      ...overrides,
    };
  };
  const saveDisposition = async (
    overrides: Partial<ProductEvidenceDisposition> = {},
  ) => {
    await editReport((report) => {
      report.evidence_dispositions = [disposition(overrides)];
    });
  };
  return {
    root,
    assessmentPath,
    original,
    pending,
    judgment,
    read,
    snapshot,
    mutate,
    editReport,
    source,
    disposition,
    saveDisposition,
  };
}

it("reuses an exact local no-impact result without rewriting report bytes or deleting pending history", async () => {
  const f = await fixture();
  expect(select(f.original).reasons).toContain("pending-evidence");
  await f.saveDisposition();
  const before = await readFile(f.assessmentPath);
  for (let read = 0; read < 2; read++) {
    const product = await f.read();
    const report = reportOf(product);
    const evidence = assessmentEvidence(product, report);
    expect(report.usable, JSON.stringify(report.diagnostics)).toBe(true);
    expect(report.metadata.pending_sources).toEqual([f.pending]);
    expect(evidence.pending_sources).toEqual([]);
    expect(evidence.handled_sources).toEqual([f.pending]);
    expect(evidence.evidence_dispositions[0]).toMatchObject({
      change_id: "ingestion-responsibility-20261015",
      reuse_status: "reused",
      reuse_reasons: [],
    });
    expect(select(product)).toMatchObject({
      conclusion: "satisfied",
      reasons: [],
      assessment: { id: "A-DEMO" },
    });
  }
  expect(await readFile(f.assessmentPath)).toEqual(before);
});

it.each([
  "report body",
  "report metadata",
  "scope",
  "coverage",
  "subject",
  "target definition",
  "goal definition",
  "source bytes",
  "judgment bytes",
])("reopens only the disposition whose %s changed", async (change) => {
  const f = await fixture();
  await f.saveDisposition();
  expect(select(await f.read()).reasons).toEqual([]);
  if (change === "report body") {
    const raw = await readFile(f.assessmentPath, "utf8");
    await writeFile(
      f.assessmentPath,
      raw.replace(
        "此范围无已知缺口；不覆盖恢复能力。",
        "此范围新增一个待核对限制。",
      ),
    );
  } else if (change === "report metadata") {
    await f.editReport((report) => {
      report.checked_at = "2026-10-15T09:00:00Z";
    });
  } else if (change === "scope" || change === "coverage") {
    await f.mutate("PROJECT.md", (items) => {
      const scope = items
        .find((item) => item.id === "G-DEMO")!
        .assessment_scopes!.find((scope) => scope.target === "R-IMPORT")!;
      if (change === "scope") scope.scope_id = "REVISED";
      else scope.coverage += "；增加明确异常范围";
    });
    await f.editReport((report) => {
      if (change === "scope") report.applicability!.scope_id = "REVISED";
      else report.applicability!.coverage += "；增加明确异常范围";
    });
  } else if (change === "subject") {
    await f.editReport((report) => {
      report.subject!.revision = "new-implementation";
    });
  } else if (change === "target definition" || change === "goal definition") {
    const filename = path.join(f.root, "docs/product/PROJECT.md");
    const raw = await readFile(filename, "utf8");
    await writeFile(
      filename,
      change === "target definition"
        ? raw.replace(
            "将约定内容写入目标库。",
            "将约定内容写入目标库，并保留逐项失败记录。",
          )
        : raw.replace("演示固定知识集导入。", "演示固定知识集导入与恢复。"),
    );
  } else {
    const reference = change === "source bytes" ? f.pending : f.judgment;
    if (reference.kind !== "file") throw new Error("Expected a file fixture");
    await writeFile(
      path.join(f.root, reference.path),
      "# Changed source\nNew facts.\n",
    );
  }
  const product = await f.read();
  const evidence = assessmentEvidence(product, reportOf(product));
  expect(evidence.pending_sources).toEqual([f.pending]);
  expect(evidence.handled_sources).toEqual([]);
  expect(evidence.evidence_dispositions[0]).toMatchObject({
    reuse_status: "not-reusable",
    reuse_reasons: expect.arrayContaining([
      change.endsWith("bytes") ? "source-unverified" : "basis-changed",
    ]),
  });
  expect(select(product).reasons).toContain("pending-evidence");
});

it("keeps a distinct new counterexample pending while reusing the original decision", async () => {
  const f = await fixture();
  await f.saveDisposition();
  const failure = await f.source(
    "new-failure.md",
    "# New counterexample\nOne empty MD aborts the batch before per-item results.\n",
  );
  await f.editReport((report) => {
    report.pending_sources!.push(failure);
  });
  const product = await f.read();
  const evidence = assessmentEvidence(product, reportOf(product));
  expect(evidence.evidence_dispositions[0].reuse_status).toBe("reused");
  expect(evidence.handled_sources).toEqual([f.pending]);
  expect(evidence.pending_sources).toEqual([failure]);
  expect(select(product).reasons).toContain("pending-evidence");
});

it("does not treat a new digest at the same source path as an already handled change", async () => {
  const f = await fixture();
  await f.saveDisposition();
  const revised = await f.source(
    "responsibility.md",
    "# Revised responsibility decision\nThe accepted failure obligation also changes.\n",
  );
  await f.editReport((report) => {
    report.pending_sources = [revised];
  });
  const product = await f.read();
  const evidence = assessmentEvidence(product, reportOf(product));
  expect(evidence.evidence_dispositions[0].reuse_status).toBe("not-reusable");
  expect(evidence.pending_sources).toEqual([revised]);
  expect(evidence.handled_sources).toEqual([]);
});

it("keeps deferred evidence pending and exposes conflicting dispositions", async () => {
  const f = await fixture();
  await f.saveDisposition({ disposition: "deferred" });
  let product = await f.read();
  expect(assessmentEvidence(product, reportOf(product))).toMatchObject({
    pending_sources: [f.pending],
    evidence_dispositions: [{ reuse_status: "deferred" }],
  });
  await f.editReport((report) => {
    report.evidence_dispositions!.push(f.disposition());
  });
  product = await f.read();
  const evidence = assessmentEvidence(product, reportOf(product));
  expect(evidence.pending_sources).toEqual([f.pending]);
  expect(
    evidence.evidence_dispositions.map((entry) => entry.reuse_status),
  ).toEqual(["conflict", "conflict"]);
  expect(select(product).reviewIssues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        issue: expect.objectContaining({ code: "disposition-conflict" }),
      }),
    ]),
  );
});

it("requires incorporated evidence to be present in the report sources", async () => {
  const f = await fixture();
  await f.saveDisposition({
    kind: "counterevidence",
    disposition: "evidence-incorporated",
  });
  let product = await f.read();
  expect(assessmentEvidence(product, reportOf(product))).toMatchObject({
    pending_sources: [f.pending],
    evidence_dispositions: [
      {
        reuse_status: "not-reusable",
        reuse_reasons: ["evidence-not-incorporated"],
      },
    ],
  });
  await f.editReport((report) => {
    report.sources!.push(f.pending);
  });
  product = await f.read();
  expect(
    assessmentEvidence(product, reportOf(product)).pending_sources,
  ).toEqual([]);
  expect(select(product).conclusion).toBe("satisfied");
});

it("transports reused evidence and removes its pending issue from the overview", async () => {
  const f = await fixture();
  const before = buildOverviewData(await f.snapshot());
  expect(assessmentReviewSummary(before.reviewRequirements || []).reports).toBe(
    1,
  );
  await f.saveDisposition();
  const data = JSON.parse(
    JSON.stringify(buildOverviewData(await f.snapshot())),
  );
  const requirement = data.planned.find(
    (item: { id: string }) => item.id === "R-IMPORT",
  );
  const record = requirement.assessmentRecords.find(
    (record: { report: { id: string } }) => record.report.id === "A-DEMO",
  );
  expect(record.selection).toMatchObject({
    conclusion: "satisfied",
    reasons: [],
    evidenceDispositions: [{ reuse_status: "reused" }],
  });
  expect(record.review).toBeUndefined();
  expect(assessmentReviewSummary(data.reviewRequirements || []).reports).toBe(
    0,
  );
});

it("does not change the report fingerprint or reopen a disposition when positive sources accumulate", async () => {
  const f = await fixture();
  await f.saveDisposition();
  const before = reportOf(await f.read()).dispositionSha256;
  const step = await f.source(
    "step-p2.md",
    "# P2 successful local check\nOrdinary conversion progress; acceptance is unchanged.\n",
  );
  await f.editReport((report) => {
    report.sources!.push(step);
  });
  const product = await f.read();
  expect(reportOf(product).dispositionSha256).toBe(before);
  expect(assessmentEvidence(product, reportOf(product))).toMatchObject({
    pending_sources: [],
    evidence_dispositions: [{ reuse_status: "reused" }],
  });
  expect(select(product).reasons).toEqual([]);
});

it.each(["add", "modify", "remove"])(
  "does not reopen the retained obligation when another goal scope is %s",
  async (operation) => {
    const f = await fixture(6, true);
    await f.saveDisposition();
    await f.mutate("PROJECT.md", (items) => {
      const goal = items.find((item) => item.id === "G-DEMO")!;
      if (operation === "add")
        goal.assessment_scopes!.push({
          target: "R-DELTA",
          scope_id: "NEW-SCOPE",
          coverage: "Unrelated incremental input obligation",
        });
      else if (operation === "modify")
        goal.assessment_scopes!.find(
          (scope) => scope.target === "R-NEW",
        )!.coverage += "；新增批次规模要求";
      else
        goal.assessment_scopes = goal.assessment_scopes!.filter(
          (scope) => scope.target !== "R-NEW",
        );
    });
    const product = await f.read();
    expect(assessmentEvidence(product, reportOf(product))).toMatchObject({
      pending_sources: [],
      evidence_dispositions: [{ reuse_status: "reused" }],
    });
    expect(select(product).reasons).toEqual([]);
  },
);

it.each(["remove", "replace"])(
  "reopens a disposition when an existing report source is %s",
  async (operation) => {
    const f = await fixture();
    const retained = await f.source(
      "retained-evidence.md",
      "# Additional existing evidence\nThis source remains available after the change.\n",
    );
    await f.editReport((report) => {
      report.sources!.push(retained);
    });
    const baseline = await f.read();
    await f.saveDisposition({
      basis: dispositionBasis(baseline, reportOf(baseline))!,
    });
    const priorHash = reportOf(await f.read()).dispositionSha256;
    const replacement = await f.source(
      "replacement-evidence.md",
      "# Different report evidence\nThis is a new source rather than the old basis.\n",
    );
    await f.editReport((report) => {
      report.sources =
        operation === "remove" ? [retained] : [retained, replacement];
    });
    const product = await f.read();
    expect(reportOf(product).usable).toBe(true);
    expect(reportOf(product).dispositionSha256).toBe(priorHash);
    expect(assessmentEvidence(product, reportOf(product))).toMatchObject({
      pending_sources: [f.pending],
      evidence_dispositions: [
        { reuse_status: "not-reusable", reuse_reasons: ["basis-changed"] },
      ],
    });
    expect(select(product).reasons).toContain("pending-evidence");
  },
);

it.each([3, 4, 5])(
  "retains legacy v%s pending behavior without requiring migration",
  async (version) => {
    const f = await fixture(version);
    let product = await f.read();
    expect(reportOf(product).usable).toBe(true);
    expect(assessmentEvidence(product, reportOf(product))).toEqual({
      disposition_basis: null,
      evidence_dispositions: [],
      pending_sources: [f.pending],
      handled_sources: [],
    });
    expect(select(product).reasons).toContain("pending-evidence");
    await f.editReport((report) => {
      delete report.pending_sources;
    });
    product = await f.read();
    expect(select(product).conclusion).toBe("satisfied");
    expect(select(product).reasons).toEqual([]);
  },
);

it("isolates invalid disposition metadata without crashing unrelated reports or the overview", async () => {
  const f = await fixture();
  await f.saveDisposition();
  await f.editReport((report) => {
    const entry = report.evidence_dispositions![0];
    (entry as unknown as { basis: unknown }).basis = { invalid: true };
  });
  const snapshot = await f.snapshot();
  const product = snapshot.product!;
  expect(reportOf(product).usable).toBe(false);
  expect(select(product).reasons).toContain("metadata-incomplete");
  expect(
    selectAssessment(product, "R-IMPORT", "G-LIVE", {
      kind: "working-copy",
      value: "sample-copy-a",
      revision: "sample-baseline",
    }).conclusion,
  ).toBe("partially-satisfied");
  expect(() => buildOverviewData(snapshot)).not.toThrow();
});
