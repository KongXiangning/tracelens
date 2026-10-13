import { afterEach, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSnapshot } from "../src/server/snapshot.js";
import { selectAssessment } from "../src/shared/product-view.js";
import type { Project } from "../src/shared/types.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it.each([
  [4, 3],
  [5, 3],
  [3, 4],
  [4, 5],
  [5, 5],
])(
  "uses current scope and unchanged hashes for v%s definitions with v%s reports",
  async (definitionVersion, reportVersion) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tracelens-mixed-v5-"));
    roots.push(root);
    await cp("examples/product-scoped", root, { recursive: true });
    for (const [file, version] of [
      ["PROJECT.md", definitionVersion],
      ["ASSESSMENTS.md", reportVersion],
    ] as const) {
      const filename = path.join(root, "docs/product", file);
      await writeFile(
        filename,
        (await readFile(filename, "utf8")).replace(
          "vnext-product-doc/v3",
          `vnext-product-doc/v${version}`,
        ),
      );
    }
    const project: Project = {
      id: "mixed",
      name: "synthetic",
      root,
      configVersion: 1,
      config: {
        rules: { management: [], requirements: [], design: [], planning: [] },
        excludes: [],
        product: {
          enabled: true,
          manifestPath: ".workflow-system/PRODUCT.yaml",
        },
      },
    };
    const product = (await buildSnapshot(project, new Date().toISOString()))
      .product!;
    const result = selectAssessment(product, "R-IMPORT", "G-DEMO", {
      kind: "working-copy",
      value: "sample-copy-a",
      revision: "sample-baseline",
    });
    expect(result.reasons).toEqual([]);
    expect(result.conclusion).toBe("satisfied");
    expect(result.assessment?.id).toBe("A-DEMO");
    const goalRelation = product.relations.find(
      (r) => r.link.id === "demo-parent",
    );
    expect(goalRelation?.resolution).toBe("resolved");
    expect(
      product.relations.find((r) => r.link.id === "import-parent")?.resolution,
    ).toBe("resolved");
    expect(
      product.items.find((i) => i.id === "R-IMPORT")?.definitionSha256,
    ).toBe("67c6af37db967502e78c5b9de0b2a700b7adc0749c911f49c53e243432a808cc");
  },
);
