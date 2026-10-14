import { toString } from "mdast-util-to-string";
import type { RootContent } from "mdast";
import type { Document, HistoricalWorkEvidence } from "../shared/types.js";
import type { ProductSnapshot } from "../shared/product-types.js";
import { contributionDiagnostics } from "../shared/product-contribution.js";
import { isDirectWorkBinding } from "../shared/overview-progress.js";
import { parseMarkdown } from "./parser.js";

/** Consume explicit saved archive fields, not status, proposed work or quoted snapshots. */
function archiveDelivery(
  document: Document,
  taskId: string,
): HistoricalWorkEvidence | undefined {
  const sections = new Map<string, RootContent[]>();
  let section = "";
  for (const node of parseMarkdown(document.raw).children) {
    if (node.type === "heading" && node.depth <= 2) {
      section = node.depth === 2 ? toString(node).trim() : "";
      if (sections.has(section)) return;
      sections.set(section, []);
    } else sections.get(section)?.push(node);
  }
  const metadata = sections.get("任务元数据") || [];
  const identities = metadata
    .flatMap((node) => (node.type === "list" ? node.children : []))
    .flatMap((node) =>
      node.children.filter((child) => child.type === "paragraph"),
    )
    .map(
      (node) =>
        toString(node).match(/^task_id:\s*["']?([^\s"']+)["']?\s*$/)?.[1],
    )
    .filter(Boolean);
  if (identities.length !== 1 || identities[0] !== taskId) return;
  for (const name of ["实际改动摘要", "实际交付"]) {
    for (const node of sections.get(name) || []) {
      if (node.type !== "list") continue;
      for (const item of node.children) {
        if (item.checked === false) continue;
        const paragraphs = item.children.filter(
          (child) => child.type === "paragraph",
        );
        const label = paragraphs
          .map((child) => toString(child))
          .join(" ")
          .trim();
        let summary = label;
        if (name === "实际改动摘要") {
          if (label !== "actual_changes:") continue;
          summary = item.children
            .filter((child) => child.type === "list")
            .flatMap((child) => child.children)
            .filter((child) => child.checked !== false)
            .map((child) => toString(child).trim())
            .filter(Boolean)
            .join("；");
        }
        if (
          !summary ||
          /^(?:["']?)(?:无|暂无|未执行|未开始|待实施|unknown|none|null|\[\])/i.test(
            summary,
          )
        )
          continue;
        return {
          bindingKey: "",
          taskId,
          summary: summary.slice(0, 180),
          source: {
            documentId: document.id,
            path: document.path,
            line: item.position?.start.line || 1,
            section: name,
            digest: document.digest,
          },
        };
      }
    }
  }
}
export function readHistoricalWork(
  product: ProductSnapshot | undefined,
  documents: Document[],
): HistoricalWorkEvidence[] {
  if (!product) return [];
  const issues = contributionDiagnostics(product.bindings);
  const result: HistoricalWorkEvidence[] = [];
  const parsed = new Map<string, HistoricalWorkEvidence | undefined>();
  for (const row of product.bindings) {
    if (!isDirectWorkBinding(row, issues) || row.binding.task.step_id) continue;
    const reference = row.binding.task.source;
    if (reference.kind !== "file" || !reference.sha256) continue;
    const check = product.sources.find(
      (entry) =>
        entry.ownerKey === row.ownerKey &&
        JSON.stringify(entry.reference) === JSON.stringify(reference),
    );
    if (
      check?.readState !== "read" ||
      check.locationState !== "located" ||
      check.byteState !== "same-bytes" ||
      !check.source
    )
      continue;
    const checkedSource = check.source;
    const document = documents.find(
      (entry) =>
        entry.id === checkedSource.documentId &&
        entry.path === reference.path &&
        entry.digest === reference.sha256 &&
        entry.digest === checkedSource.digest,
    );
    if (!document || document.contentOmitted) continue;
    const key = `${document.id}:${document.digest}:${row.binding.task.task_id}`;
    if (!parsed.has(key))
      parsed.set(key, archiveDelivery(document, row.binding.task.task_id!));
    const evidence = parsed.get(key);
    if (evidence) result.push({ ...evidence, bindingKey: row.key });
  }
  return result;
}
