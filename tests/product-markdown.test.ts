import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { buildSnapshot } from "../src/server/snapshot.js";
import { stableId } from "../src/server/parser.js";
import type { Project } from "../src/shared/types.js";

let root: string, project: Project;
const productPath = "docs/product/PRODUCT.md";
const reportPath = "docs/evidence/report.md";
const historyPath = "docs/history/old.markdown";
const textPath = "docs/evidence/raw.txt";
const report = "# Evidence\n\n## Report section\nCaptured evidence.\n";
const requirement = {
  id: "REQ",
  type: "requirement",
  scope: "current",
  sources: [{ kind: "file", path: reportPath }],
};
function document(body: string, item: unknown = requirement) {
  return (
    `---\n# [metadata](../evidence/metadata.md)\n` +
    `# [REPORT]: ../evidence/metadata.md\n` +
    stringify({ schema: "vnext-product-doc/v2", items: [item] }) +
    `---\n# Product document\n\n## [REQ] Requirement\n` +
    `### 需求内容\n${body}\n### 范围边界\nExplicit scope.\n` +
    "### 验收要求\nRead the captured source.\n"
  );
}
async function file(relative: string, raw: string) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), raw);
}
function sourceLine(raw: string, text: string) {
  const line = raw
    .split(/\r\n|\r|\n/)
    .findIndex((value) => value.includes(text));
  expect(line).toBeGreaterThanOrEqual(0);
  return line + 1;
}
const snapshot = () => buildSnapshot(project, new Date().toISOString());
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tracelens-product-links-"));
  project = {
    id: "product-markdown-test",
    name: "Synthetic PRODUCT Markdown",
    root,
    configVersion: 1,
    config: {
      rules: { management: [], requirements: [], design: [], planning: [] },
      autoDiscover: false,
      excludes: [],
      product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
    },
  };
  await file(
    ".workflow-system/PRODUCT.yaml",
    "# PRODUCT manifest comment, not a Markdown heading\n" +
      stringify({
        schema: "vnext-product-manifest/v2",
        project_id: "synthetic-links",
        entry: productPath,
        managed_paths: [productPath],
        source_paths: ["docs/evidence/**", "docs/history/**"],
        capture_paths: ["docs/history/**"],
        exclude_paths: [],
        maintenance: "enabled",
        extensions: {
          example: "# Not a Markdown heading\n[not a link](fake.md)",
        },
      }),
  );
  await file(reportPath, report);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ordinary references in passive PRODUCT documents", () => {
  it("restores inline and full-document reference links with immutable absolute sources", async () => {
    const raw =
      document(
        "[Ordinary report](../evidence/report.md#report-section)\n\n" +
          "[Shared report][REPORT]\n\n[Collapsed][]\n\n[Shortcut]\n",
      ) +
      "\n[REPORT]: ../evidence/report.md#report-section\n" +
      "[report]: ../evidence/wrong.md\n" +
      "[Collapsed]: ../evidence/report.md\n" +
      "[shortcut]: ../evidence/report.md\n";
    await file(productPath, raw);
    const scan = await snapshot();
    const refs = scan.relations.filter(
      (ref) => ref.source.path === productPath,
    );
    expect(refs.map((ref) => ref.label)).toEqual([
      "Ordinary report",
      "Shared report",
      "Collapsed",
      "Shortcut",
    ]);
    expect(
      refs.every(
        (ref) => ref.method === "markdown" && ref.type === "reference",
      ),
    ).toBe(true);
    expect(refs.map((ref) => ref.state)).toEqual(Array(4).fill("resolved"));
    expect(refs.map((ref) => ref.targetLine)).toEqual([3, 3, 1, 1]);
    expect(refs.every((ref) => ref.targetPath === reportPath)).toBe(true);
    for (const ref of refs) {
      expect(ref.from).toBe(stableId(project.id, productPath));
      expect(ref.source).toEqual({
        documentId: stableId(project.id, productPath),
        path: productPath,
        line: sourceLine(raw, `[${ref.label}]`),
        section: "需求内容",
        digest: createHash("sha256").update(raw).digest("hex"),
      });
    }
    expect(scan.tasks).toEqual([]);
    expect(scan.statements).toEqual([]);
    expect(scan.product?.relations).toEqual([]);
    expect(scan.documents.find((doc) => doc.path === productPath)?.raw).toBe(
      raw,
    );
    expect(await readFile(path.join(root, productPath), "utf8")).toBe(raw);
  });

  it("uses AST link locations in quotes and lists and ignores code, HTML and images", async () => {
    const raw = document(
      "> [Quoted report][ RePort   KEY ]\n\n" +
        "- [List report](../evidence/report.md)\n" +
        "  - [Nested report][report key]\n\n" +
        "```md\n[Fenced fake](../evidence/fenced.md)\n" +
        "[report key]: ../evidence/fenced-definition.md\n```\n\n" +
        "`[Inline fake](../evidence/inline.md)`\n\n" +
        "![Image fake](../evidence/image.png)\n\n" +
        '<a href="../evidence/html.md">HTML fake</a>\n\n' +
        "[Undefined][no-definition]\n\n" +
        "[report key]: ../evidence/report.md\n" +
        "[REPORT KEY]: ../evidence/wrong.md\n",
    );
    await file(productPath, raw);
    const refs = (await snapshot()).relations.filter(
      (ref) => ref.source.path === productPath,
    );
    expect(refs.map((ref) => ref.label)).toEqual([
      "Quoted report",
      "List report",
      "Nested report",
    ]);
    for (const ref of refs) {
      expect(ref.state).toBe("resolved");
      expect(ref.targetPath).toBe(reportPath);
      expect(ref.source.line).toBe(sourceLine(raw, `[${ref.label}]`));
      expect(ref.source.section).toBe("需求内容");
    }
  });

  it("keeps ordinary references inside the existing snapshot resolver without reading targets", async () => {
    const raw = document(
      "[Captured](../evidence/report.md?view=raw#report-section)\n\n" +
        "[Outside](../evidence/unread.md)\n\n" +
        "[Missing](../evidence/missing.md)\n\n" +
        "[Excluded](../evidence/excluded.md)\n\n" +
        "[Bad fragment](../evidence/report.md#absent)\n\n" +
        "[Remote](https://example.invalid/do-not-fetch)\n\n" +
        "[Protocol](javascript:alert)\n\n" +
        "[Traversal](../../../outside.md)\n\n" +
        "[Absolute](/etc/passwd)\n\n" +
        "[Bad encoding](../evidence/%zz.md)\n",
    );
    await file(productPath, raw);
    await file("docs/evidence/unread.md", "# Unread\ntask_id: do-not-read\n");
    await file("docs/evidence/excluded.md", "# Excluded\n");
    project.config.excludes.push("docs/evidence/excluded.md");
    const scan = await snapshot();
    const refs = scan.relations.filter(
      (ref) => ref.source.path === productPath,
    );
    expect(
      Object.fromEntries(refs.map((ref) => [ref.label, ref.state])),
    ).toEqual({
      Captured: "resolved",
      Outside: "available",
      Missing: "missing",
      Excluded: "excluded",
      "Bad fragment": "section-missing",
      Remote: "external",
      Protocol: "unsafe",
      Traversal: "unsafe",
      Absolute: "unsafe",
      "Bad encoding": "unsafe",
    });
    expect(scan.documents.map((doc) => doc.path).sort()).toEqual(
      [".workflow-system/PRODUCT.yaml", reportPath, productPath].sort(),
    );
    expect(scan.product?.sources).toHaveLength(1);
    expect(scan.product?.relations).toEqual([]);
    expect(scan.tasks).toEqual([]);
  });

  it("does not parse PRODUCT manifest YAML or exact TXT sources as Markdown", async () => {
    const text =
      "# Plain text\n[Text link](report.md)\n\n[text]: report.md\n[text]\nTask ID: fake-task\nStatus: active\n";
    await file(textPath, text);
    await file(
      productPath,
      document("Source stays plain.", {
        ...requirement,
        sources: [...requirement.sources, { kind: "file", path: textPath }],
      }),
    );
    const scan = await snapshot();
    for (const relative of [".workflow-system/PRODUCT.yaml", textPath]) {
      const captured = scan.documents.find((doc) => doc.path === relative)!;
      expect(captured).toBeDefined();
      expect(captured.headings).toEqual([]);
      expect(captured.title).toBe(path.posix.basename(relative));
      expect(
        scan.relations.filter((ref) => ref.source.path === relative),
      ).toEqual([]);
    }
    expect(scan.documents.find((doc) => doc.path === textPath)?.raw).toBe(text);
    expect(scan.tasks).toEqual([]);
    expect(scan.statements).toEqual([]);
  });

  it("retains duplicate heading anchors and whole-file locations for same-document references", async () => {
    const raw = document(
      "[Second heading](#repeated-1)\n\n" +
        "#### Repeated\nFirst section.\n\n" +
        "#### Repeated\n[Back to report](../evidence/report.md)\n",
    );
    await file(productPath, raw);
    const scan = await snapshot();
    const captured = scan.documents.find((doc) => doc.path === productPath)!;
    expect(
      captured.headings
        .filter((heading) => heading.title === "Repeated")
        .map((heading) => heading.anchor),
    ).toEqual(["repeated", "repeated-1"]);
    expect(
      scan.relations.find((ref) => ref.label === "Second heading"),
    ).toMatchObject({
      state: "resolved",
      targetPath: productPath,
      targetLine: sourceLine(raw, "[Back to report]") - 1,
    });
    expect(
      scan.relations.find((ref) => ref.label === "Back to report")?.source
        .section,
    ).toBe("Repeated");
  });

  it("preserves links without deriving tasks or current definitions from quoted-schema product history", async () => {
    const history = document(
      "Task ID: false-historical-task\n\nStatus: active\n\n" +
        "Current task: TASK-20261008-001\n\n" +
        "[Historical report](../evidence/report.md)\n\n" +
        "### Risks\n- fake generic statement\n",
      { id: "OLD", type: "requirement", scope: "retired" },
    )
      .replace(
        "schema: vnext-product-doc/v2",
        '"schema": "vnext-product-doc/v2"',
      )
      .replace(/^---$/gm, "--- \t")
      .replaceAll("\n", "\r\n");
    const raw = document(
      "Task ID: false-product-task\n\nStatus: active\n\n" +
        "[History](../history/old.markdown)\n",
      {
        ...requirement,
        sources: [...requirement.sources, { kind: "file", path: historyPath }],
      },
    );
    await file(historyPath, "\uFEFF" + history);
    await file(productPath, raw);
    const scan = await snapshot();
    expect(scan.tasks).toEqual([]);
    expect(scan.statements).toEqual([]);
    expect(scan.product?.items.map((item) => item.id)).toEqual(["REQ"]);
    const reference = scan.relations.find(
      (ref) => ref.source.path === historyPath,
    )!;
    expect(reference).toMatchObject({
      label: "Historical report",
      method: "markdown",
      type: "reference",
      state: "resolved",
      targetPath: reportPath,
      source: {
        line: sourceLine(history, "[Historical report]"),
        section: "需求内容",
      },
    });
    expect(scan.relations.map((ref) => ref.method)).toEqual([
      "markdown",
      "markdown",
    ]);
  });
});
