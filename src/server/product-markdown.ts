import path from "node:path";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import type { Definition } from "mdast";
import type { InputFile } from "./scanner.js";
import { anchor, parseMarkdown, stableId, type Parsed } from "./parser.js";

/** Read ordinary Markdown without interpreting PRODUCT prose as tasks or state. */
export function parseProductMarkdown(
  projectId: string,
  input: InputFile,
  bodyStart: number,
  recognized: boolean,
): Parsed {
  const parsed: Parsed = {
    document: {
      ...input,
      id: stableId(projectId, input.path),
      title: path.posix.basename(input.path),
      headings: [],
      recognized,
    },
    task: null,
    statements: [],
    references: [],
    warnings: [],
  };
  // Manifest YAML and raw TXT/JSON sources are never Markdown, even when their
  // content contains headings, links, or task-like declarations.
  if (!/\.(md|markdown)$/i.test(input.path)) return parsed;

  // Parse one captured document, not separate item excerpts. Definitions may be
  // anywhere in its body. Mask metadata without changing offsets or line numbers.
  const tree = parseMarkdown(
    input.raw.slice(0, bodyStart).replace(/[^\r\n]/g, " ") +
      input.raw.slice(bodyStart),
  );
  const definitions = new Map<string, Definition>();
  const duplicates = new Map<string, number>();
  visit(tree, (node) => {
    if (node.type === "heading") {
      const title = toString(node);
      const slug = anchor(title);
      const count = duplicates.get(slug) || 0;
      duplicates.set(slug, count + 1);
      parsed.document.headings.push({
        title,
        depth: node.depth,
        line: node.position!.start.line,
        anchor: count ? `${slug}-${count}` : slug,
      });
    } else if (node.type === "definition") {
      // remark already normalizes identifier whitespace and case. CommonMark
      // resolves duplicate definitions to the first one, as the reader does.
      if (!definitions.has(node.identifier))
        definitions.set(node.identifier, node);
    }
  });
  parsed.document.title =
    parsed.document.headings[0]?.title || parsed.document.title;
  visit(tree, (node) => {
    if (node.type !== "link" && node.type !== "linkReference") return;
    const url =
      node.type === "link" ? node.url : definitions.get(node.identifier)?.url;
    if (url === undefined) return;
    const line = node.position!.start.line;
    parsed.references.push({
      raw: url,
      target: url,
      section: null,
      revision: null,
      label: toString(node),
      method: "markdown",
      source: {
        documentId: parsed.document.id,
        path: input.path,
        line,
        section:
          parsed.document.headings
            .filter((heading) => heading.line <= line)
            .at(-1)?.title || null,
        digest: input.digest,
      },
    });
  });
  return parsed;
}
