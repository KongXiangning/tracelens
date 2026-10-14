import { afterEach, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewV3, ScopedConclusion } from "../src/web/product-v3.js";
import { buildSnapshot } from "../src/server/snapshot.js";
import {
  productView,
  goalRequirements,
  selectAssessment,
  reportedSubjects,
} from "../src/shared/product-view.js";
import type { ProductSnapshot } from "../src/shared/product-types.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  await mkdir("output", { recursive: true });
  const root = await mkdtemp(path.resolve("output/scoped-test-"));
  roots.push(root);
  await cp("examples/product-scoped", root, { recursive: true });
  const project = {
    id: "scoped",
    root,
    name: "synthetic",
    configVersion: 1,
    config: {
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
      product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
    },
  };
  const readSnapshot = () => buildSnapshot(project, new Date().toISOString());
  const read = async () => (await readSnapshot()).product!;
  const mutate = async (file: string, change: (items: any[]) => void) => {
    const filename = path.join(root, "docs/product", file),
      raw = await readFile(filename, "utf8");
    const end = raw.indexOf("\n---", 4),
      value = parse(raw.slice(4, end));
    change(value.items);
    await writeFile(
      filename,
      `---\n${stringify(value)}---${raw.slice(end + 4)}`,
    );
  };
  return { root, read, readSnapshot, mutate };
}
const subject = {
  kind: "working-copy" as const,
  value: "sample-copy-a",
  revision: "sample-baseline",
};
const selection = (p: ProductSnapshot, goal = "G-DEMO") =>
  selectAssessment(p, "R-IMPORT", goal, subject);
it.each(["kind", "value", "revision", "limitations"])(
  "isolates a malformed subject.%s without losing other reports or the overview",
  async (field) => {
    const f = await fixture();
    await f.mutate("ASSESSMENTS.md", (items) => {
      items[0].subject[field] = { invalid: "retained for inspection" };
    });
    const snapshot = await f.readSnapshot(),
      product = snapshot.product!;
    const report = product.items.find((i) => i.id === "A-DEMO")!;
    expect(report.usable).toBe(false);
    expect(report.rawMetadata).toMatchObject({
      subject: { [field]: { invalid: "retained for inspection" } },
    });
    expect(reportedSubjects({ ...product, items: [report] })).toEqual([]);
    expect(reportedSubjects(product)).toContainEqual(subject);
    expect(selection(product, "G-LIVE").conclusion).toBe("partially-satisfied");
    const html = renderToStaticMarkup(
      createElement(OverviewV3, {
        context: {
          snapshot,
          open: () => {},
          openProduct: () => {},
          openTask: () => {},
          relations: () => {},
        },
        requirements: () => {},
      }),
    );
    expect(html).toContain("需求全景");
    // Reports and Task association alone never make a requirement appear as worked on.
    expect(html).not.toContain("data-overview-card");
    expect(html).toContain("查看全部需求");
    expect(
      goalRequirements(product).some((item) => item.id === "R-PIPELINE"),
    ).toBe(true);
  },
);
it("renders an invalid report's original fields without changing the current undetermined conclusion", async () => {
  const f = await fixture();
  await f.mutate("ASSESSMENTS.md", (items) => {
    items[0].checked_at = "yesterday";
  });
  const snapshot = await f.readSnapshot(),
    product = snapshot.product!;
  const report = product.items.find((i) => i.id === "A-DEMO")!;
  expect(report.usable).toBe(false);
  expect(reportedSubjects({ ...product, items: [report] })).toEqual([subject]);
  expect(report.rawMetadata).toMatchObject({
    conclusion: "satisfied",
    checked_at: "yesterday",
  });
  const html = renderToStaticMarkup(
    createElement(ScopedConclusion, {
      item: product.items.find((i) => i.id === "R-IMPORT")!,
      goal: product.items.find((i) => i.id === "G-DEMO")!,
      subject,
      context: {
        snapshot,
        open: () => {},
        openProduct: () => {},
        openTask: () => {},
        relations: () => {},
      },
    }),
  );
  expect(html).toContain('data-conclusion="undetermined"');
  expect(html).toContain("<h3>尚未判定</h3>");
  expect(html).toContain("原报告：已满足 · yesterday");
  expect(html).toContain("字段异常，保留原字段供核对");
  expect(html).toContain("metadata-incomplete");
  expect(selection(product).conclusion).toBe("undetermined");
});
it("consumes the VN-01 common sample with exact definitions, registration, hierarchy and four scoped values", async () => {
  const f = await fixture(),
    p = await f.read(),
    model = productView(p);
  expect(model.rootGoal?.id).toBe("G-ALL");
  expect(model.registered.map((i) => i.id)).toEqual([
    "R-PIPELINE",
    "R-IMPORT",
    "R-OLD",
    "R-DELTA",
    "R-NEW",
  ]);
  expect(model.unordered.map((i) => i.id)).toEqual(["R-UNORDERED"]);
  expect(
    goalRequirements(p, p.items.find((i) => i.id === "G-DEMO")!.key).map(
      (i) => i.id,
    ),
  ).toEqual(["R-IMPORT", "R-NEW"]);
  expect(
    goalRequirements(p, p.items.find((i) => i.id === "G-LIVE")!.key).map(
      (i) => i.id,
    ),
  ).toEqual(["R-PIPELINE", "R-IMPORT", "R-DELTA"]);
  expect(selection(p)).toMatchObject({ conclusion: "satisfied", reasons: [] });
  expect(selection(p, "G-LIVE")).toMatchObject({
    conclusion: "partially-satisfied",
    reasons: [],
  });
  expect(
    selectAssessment(p, "R-IMPORT", "G-DEMO", {
      kind: "release",
      value: "sample-release-0",
    }).conclusion,
  ).toBe("not-satisfied");
  expect(selectAssessment(p, "G-ALL", "G-ALL", subject)).toMatchObject({
    conclusion: "undetermined",
    reasons: [],
  });
  expect(selectAssessment(p, "R-IMPORT", "G-DEMO").reasons).toContain(
    "subject-selection-required",
  );
  expect(
    selectAssessment(p, "R-IMPORT", "G-DEMO", {
      ...subject,
      revision: "another",
    }).reasons,
  ).toContain("no-applicable-report");
  expect(p.items.find((i) => i.id === "R-IMPORT")!.definitionSha256).toBe(
    "67c6af37db967502e78c5b9de0b2a700b7adc0749c911f49c53e243432a808cc",
  );
});
it("preserves metadata-incomplete same-tuple reports until explicitly superseded", async () => {
  const f = await fixture();
  await f.mutate("ASSESSMENTS.md", (items) => {
    const bad = structuredClone(items[0]);
    bad.id = "A-BAD";
    delete bad.goal_basis;
    items.push(bad);
  });
  let p = await f.read();
  expect(selection(p).reasons).toEqual(
    expect.arrayContaining(["metadata-incomplete", "multiple-reports"]),
  );
  await f.mutate("ASSESSMENTS.md", (items) => {
    items[0].supersedes = ["A-BAD"];
  });
  p = await f.read();
  expect(selection(p)).toMatchObject({ conclusion: "satisfied", reasons: [] });
  expect(selection(p).historical.map((i) => i.id)).toContain("A-BAD");
});
it("degrades changed definitions, scopes and cross-object supersedes without hiding report prose", async () => {
  const f = await fixture();
  await f.mutate("PROJECT.md", (items) => {
    items.find((i) => i.id === "G-DEMO").assessment_scopes[0].coverage =
      "Changed agreed coverage";
  });
  expect(selection(await f.read()).reasons).toEqual(
    expect.arrayContaining([
      "scope-definition-changed",
      "goal-definition-changed",
    ]),
  );
  await f.mutate("ASSESSMENTS.md", (items) => {
    items[0].supersedes = ["A-RELEASE"];
  });
  expect(selection(await f.read()).reasons).toContain("conflict");
  await f.mutate("PROJECT.md", (items) => {
    delete items[0].root_goal_id;
  });
  expect(productView(await f.read()).rootReason).toBe("ROOT_GOAL_UNSPECIFIED");
});
it("matches production assessment metadata and separate-storage checks for the three cloud reproductions", async () => {
  for (const variant of ["unfixed", "invalid-time", "mixed-storage"]) {
    const f = await fixture();
    if (variant === "unfixed")
      await f.mutate("ASSESSMENTS.md", (items) => {
        delete items[0].subject.revision;
        delete items[0].subject.limitations;
      });
    if (variant === "invalid-time")
      await f.mutate("ASSESSMENTS.md", (items) => {
        items[0].checked_at = "yesterday";
      });
    if (variant === "mixed-storage") {
      const file = path.join(f.root, "docs/product/ASSESSMENTS.md"),
        raw = await readFile(file, "utf8"),
        end = raw.indexOf("\n---", 4),
        value = parse(raw.slice(4, end));
      const moved = value.items.shift();
      await f.mutate("PROJECT.md", (items) => items.push(moved));
      const source = path.join(f.root, "docs/product/PROJECT.md");
      const headingStart = raw.indexOf("## [A-DEMO]"),
        headingEnd = raw.indexOf("\n## [", headingStart + 1);
      await writeFile(
        source,
        (await readFile(source, "utf8")) +
          "\n" +
          raw.slice(headingStart, headingEnd),
      );
      await writeFile(
        file,
        `---\n${stringify(value)}---${raw.slice(end + 4, headingStart)}${raw.slice(headingEnd)}`,
      );
    }
    const product = await f.read(),
      report = product.items.find((i) => i.id === "A-DEMO")!;
    expect(report.usable).toBe(false);
    expect(report.rawMetadata).toBeDefined();
    expect(report.body).toContain("###");
    expect(
      report.diagnostics.some((d) => d.code === "ASSESSMENT_METADATA"),
    ).toBe(true);
    const result = selectAssessment(
      product,
      "R-IMPORT",
      "G-DEMO",
      variant === "unfixed"
        ? { kind: "working-copy", value: "sample-copy-a" }
        : subject,
    );
    expect(result.conclusion).toBe("undetermined");
    expect(result.reasons).toContain("metadata-incomplete");
  }
});
