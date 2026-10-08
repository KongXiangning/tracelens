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
