import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildSnapshot } from "../src/server/snapshot.js";
import type { Snapshot } from "../src/shared/types.js";
import { ProductDetail } from "../src/web/product.js";
import { DocumentReader } from "../src/web/reader.js";

let base: Snapshot;
beforeAll(async () => {
  base = await buildSnapshot(
    {
      id: "reference-rendering",
      name: "Synthetic reference rendering",
      root: path.resolve("examples/product-comprehensive"),
      configVersion: 1,
      config: {
        rules: { management: [], requirements: [], design: [], planning: [] },
        excludes: [],
        product: {
          enabled: true,
          manifestPath: ".workflow-system/PRODUCT.yaml",
        },
      },
    },
    new Date().toISOString(),
  );
});
afterEach(() => vi.unstubAllGlobals());

// All variations are in-memory snapshots; no observed project is edited.
function fixture(body: string, before = "", after = "", eol = "\n") {
  const snapshot = structuredClone(base);
  const item = snapshot.product!.items.find((entry) => entry.type === "goal")!;
  const document = snapshot.documents.find(
    (entry) => entry.id === item.source.documentId,
  )!;
  const prefix = `# Captured document\n\n## Other item before\n\n${before}\n\n`;
  item.body = `## [${item.id}] Focused item\n\n${body}\n\n`.replaceAll(
    "\n",
    eol,
  );
  item.source.line = prefix.split("\n").length;
  item.endLine = item.source.line + item.body.split(/\r\n|\n/).length - 2;
  document.raw =
    prefix.replaceAll("\n", eol) +
    item.body +
    `## Other item after\n\n${after}\n`.replaceAll("\n", eol);
  document.digest = createHash("sha256").update(document.raw).digest("hex");
  item.source.digest = document.digest;
  document.headings = [];
  snapshot.relations = [];
  return { snapshot, item, document };
}
function renderBody({ snapshot, item }: ReturnType<typeof fixture>) {
  const html = renderToStaticMarkup(
    <ProductDetail
      item={item}
      context={{
        snapshot,
        open: () => {},
        openProduct: () => {},
        openTask: () => {},
        relations: () => {},
      }}
    />,
  );
  return html.match(/<section class="product-body">([\s\S]*?)<\/section>/)![1];
}
function renderDocument({ document, snapshot }: ReturnType<typeof fixture>) {
  return renderToStaticMarkup(
    <DocumentReader
      document={document}
      snapshot={snapshot}
      line={1}
      open={() => {}}
      relations={() => {}}
    />,
  );
}
const inline = (label: string) =>
  `<button class="inline-link">${label}</button>`;

describe("PRODUCT body reference rendering from the captured document", () => {
  it("resolves full, collapsed and shortcut references defined in other items or at EOF", () => {
    const data = fixture(
      "[Full reference][shared]\n\n[Collapsed][]\n\n[Shortcut]",
      "[shared]: ../evidence/baseline-report.md\n\nOutside paragraph before.",
      "Outside paragraph after.\n\n[Collapsed]: ../evidence/baseline-report.md\n\n> [Shortcut]: ../evidence/baseline-report.md",
    );
    const complete = renderDocument(data);
    for (const label of ["Full reference", "Collapsed", "Shortcut"])
      expect(complete).toContain(inline(label));
    const html = renderBody(data);
    for (const label of ["Full reference", "Collapsed", "Shortcut"])
      expect(html).toContain(inline(label));
    expect(html).not.toMatch(/Other item|Outside paragraph|\[shared\]:/);
    const lines = [...html.matchAll(/data-line="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(lines).toEqual([
      data.item.source.line,
      data.item.source.line + 2,
      data.item.source.line + 4,
      data.item.source.line + 6,
    ]);
    expect(lines.every((line) => line <= data.item.endLine)).toBe(true);
  });

  it("keeps local definitions ahead of later duplicates outside the item", () => {
    const data = fixture(
      "[Chosen][duplicate]\n\n[duplicate]: ../evidence/baseline-report.md",
      "",
      "[duplicate]: https://example.com/later-definition",
    );
    expect(renderDocument(data)).toContain(inline("Chosen"));
    const html = renderBody(data);
    expect(html).toContain(inline("Chosen"));
    expect(html).not.toContain("later-definition");
  });

  it("uses the document's first definition when an earlier item declares the same identifier", () => {
    const data = fixture(
      "[Chosen][DuPlicate]\n\n[duplicate]: https://example.com/later-definition",
      "[DUPLICATE]: ../evidence/baseline-report.md",
    );
    expect(renderDocument(data)).toContain(inline("Chosen"));
    expect(renderBody(data)).toContain(inline("Chosen"));
  });

  it.each(["\n", "\r\n"])(
    "does not interpret YAML frontmatter as Markdown with %j line endings",
    (eol) => {
      const data = fixture(
        "[Body definition][shared]\n\n[shared]: ../evidence/baseline-report.md",
        "",
        "",
        eol,
      );
      const frontmatter = [
        "\uFEFF---  ",
        "schema: vnext-product-doc/v2",
        "note: |",
        "  [shared]: https://example.com/metadata-is-not-markdown",
        "  <script>",
        "---\t",
        "",
      ].join(eol);
      data.document.raw = frontmatter + data.document.raw;
      data.document.digest = createHash("sha256")
        .update(data.document.raw)
        .digest("hex");
      data.item.source.digest = data.document.digest;
      data.item.source.line += 6;
      data.item.endLine += 6;
      const html = renderBody(data);
      expect(html).toContain(inline("Body definition"));
      expect(html).toContain(`data-line="${data.item.source.line}"`);
      expect(html).not.toContain("metadata-is-not-markdown");
    },
  );

  it.each(["\n", "\r\n"])(
    "matches relation sources at original absolute lines with %j line endings",
    (eol) => {
      const data = fixture(
        "[Source location][position]",
        "[position]: #snapshot-only-relation",
        "",
        eol,
      );
      const target = data.snapshot.documents.find(
        (entry) => entry.path === "docs/evidence/baseline-report.md",
      )!;
      const sourceLine = data.item.source.line + 2;
      data.snapshot.relations.push({
        id: "reference-at-absolute-line",
        from: data.document.id,
        to: target.id,
        targetPath: target.path,
        targetLine: 3,
        type: "reference",
        method: "markdown",
        raw: "#snapshot-only-relation",
        label: "Source location",
        section: null,
        revision: null,
        state: "resolved",
        source: { ...data.item.source, line: sourceLine },
      });
      expect(renderBody(data)).toContain(
        `<p data-line="${sourceLine}">${inline("Source location")}</p>`,
      );
      // No local-heading fallback can hide a wrong line offset in this test.
      data.snapshot.relations[0].source.line = 3;
      expect(renderBody(data)).not.toContain(inline("Source location"));
      expect(renderBody(data)).toContain("[未定位]");
    },
  );

  it("leaves missing definitions and definition-like code literal", () => {
    const data = fixture(
      "[Missing][absent]\n\n[Collapsed missing][]\n\n[Not a definition][code-only]",
      "```md\n[code-only]: ../evidence/baseline-report.md\n```",
    );
    const html = renderBody(data);
    expect(html).toContain("[Missing][absent]");
    expect(html).toContain("[Collapsed missing][]");
    expect(html).toContain("[Not a definition][code-only]");
    expect(html).not.toContain('class="inline-link"');
  });

  it("keeps reference targets snapshot-only and never loads remote images or executes HTML", () => {
    const fetch = vi.fn(() => {
      throw new Error("Rendering must not fetch any resource");
    });
    vi.stubGlobal("fetch", fetch);
    const data = fixture(
      "[Unsafe script][script]\n\n[Unsafe data][data]\n\n[Unsafe file][file]\n\n[Protocol relative][protocol]\n\n[Outside root][outside]\n\n[Unloaded local][unloaded]\n\n[Remote page][remote]\n\n![Remote image][image]\n\n<script>alert('not executed')</script>\n\n<iframe src=\"https://example.com/frame\"></iframe>",
      "",
      "[script]: javascript:alert(1)\n[data]: data:text/html,unsafe\n[file]: file:///private.txt\n[protocol]: //example.com/page\n[outside]: ../../../outside.md\n[unloaded]: ../not-in-snapshot.md\n[remote]: https://example.com/page\n[image]: https://example.com/image.png",
    );
    const html = renderBody(data);
    expect(html.match(/class="unresolved-link"/g)).toHaveLength(6);
    expect(html).toContain(
      '<a href="https://example.com/page" target="_blank" rel="noreferrer noopener">Remote page</a>',
    );
    expect(html).toContain("[图片：Remote image]");
    expect(html).not.toMatch(
      /<img|<script|<iframe|\bsrc=|javascript:|data:text|file:\/\/|image\.png/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["missing", "changed-digest", "changed-id", "changed-path"])(
    "does not borrow definitions from a %s source document",
    (state) => {
      const data = fixture(
        "[Shared][shared]\n\n[Local][local]\n\n[local]: https://example.com/local",
        "[shared]: ../evidence/baseline-report.md",
      );
      if (state === "missing") data.snapshot.documents = [];
      if (state === "changed-digest") data.document.digest = "different-bytes";
      if (state === "changed-id") data.document.id = "different-document";
      if (state === "changed-path") data.document.path = "docs/another.md";
      const html = renderBody(data);
      expect(html).toContain("[Shared][shared]");
      expect(html).toContain('href="https://example.com/local"');
      expect(html).toContain(`data-line="${data.item.source.line}"`);
    },
  );
});
