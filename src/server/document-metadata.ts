export const metadataReferenceFields = [
  "related_docs",
  "superseded_by",
  "path_references",
] as const;

export function metadataTargets(
  value: Record<string, unknown>,
  field: (typeof metadataReferenceFields)[number],
): string[] {
  const data = value[field];
  if (field === "superseded_by") return typeof data === "string" ? [data] : [];
  if (!Array.isArray(data)) return [];
  if (field === "related_docs")
    return data.filter((item): item is string => typeof item === "string");
  return data.flatMap((item) => {
    if (!item || typeof item !== "object" || item.kind !== "repo-relative")
      return [];
    // Canonical path references explicitly declare the normalized project-relative target.
    return typeof item.normalized === "string" ? [item.normalized] : [];
  });
}

export function examplePath(value: string): boolean {
  return /<[^>]+>|\{\{[^}]+\}\}|(?:^|[-_/])YYYY(?:[-_]?MM(?:[-_]?DD)?)?(?=[-_.\/]|$)/i.test(
    value,
  );
}
import { isMap, isScalar, parseDocument } from "yaml";

// Legacy project frontmatter is not the strict PRODUCT protocol. Read common
// historical plain text spellings without changing the source or its line map.
export function readDocumentMetadata(raw: string) {
  const original = parseDocument(raw);
  let document = original;
  const notices: string[] = [];
  if (
    original.errors.length &&
    !/^["']?schema["']?:.*vnext-product-/m.test(raw)
  ) {
    const compatible = raw.replace(
      /^(owner|title|description):[ \t]+([^\r\n]+)$/gm,
      (line, key: string, value: string) => {
        if (
          value.startsWith("@") ||
          (["title", "description"].includes(key) &&
            !/^["'|>\[{]/.test(value) &&
            /: /.test(value))
        )
          return `${key}: ${JSON.stringify(value)}`;
        return line;
      },
    );
    document = parseDocument(compatible);
    if (
      compatible !== raw &&
      !document.errors.some((e) => e.code !== "DUPLICATE_KEY")
    )
      notices.push(
        "已兼容读取历史 frontmatter 的纯文本字段，原文字节与行号保留。",
      );
  }
  if (document.errors.some((e) => e.code !== "DUPLICATE_KEY"))
    throw new Error(document.errors.map((e) => e.message).join("; "));
  const value = document.toJS({ maxAliasCount: 20 });
  const conflicts: string[] = [];
  if (isMap(document.contents)) {
    const seen = new Set<string>();
    for (const pair of document.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
      const key = pair.key.value;
      if (seen.has(key)) {
        conflicts.push(key);
        delete value[key];
      }
      seen.add(key);
    }
  }
  return { document, value, notices, conflicts };
}
