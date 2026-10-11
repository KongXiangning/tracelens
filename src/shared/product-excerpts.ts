import { unified } from "unified";
import remarkParse from "remark-parse";
import { toString } from "mdast-util-to-string";
import type { ProductItem } from "./product-types.js";

/** Verbatim root-section excerpts; no semantic classification or invented summary. */
export function sectionExcerpts(
  item: ProductItem,
  names: string[],
  limit = 260,
) {
  const tree = unified().use(remarkParse).parse(item.body);
  return tree.children.flatMap((node, index) => {
    if (
      node.type !== "heading" ||
      node.depth !== 3 ||
      !names.includes(toString(node))
    )
      return [];
    const next = tree.children
      .slice(index + 1)
      .findIndex((n) => n.type === "heading" && n.depth <= 3);
    const end = next < 0 ? tree.children.length : index + 1 + next;
    const text = tree.children
      .slice(index + 1, end)
      .map((n) => toString(n))
      .join("\n")
      .trim();
    return [
      {
        title: toString(node),
        text: text.slice(0, limit),
        truncated: text.length > limit,
        source: {
          ...item.source,
          line: item.source.line + (node.position?.start.line || 1) - 1,
        },
      },
    ];
  });
}
