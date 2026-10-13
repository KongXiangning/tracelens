import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Project, Snapshot } from "../shared/types.js";
import { assertNoLinks, safePattern, within } from "./config.js";
import { blockedPath, limits, matches } from "./scanner.js";
import { matchesProductPath } from "./product-parser.js";

/** Metadata-only invalidation, including newly added/deleted files and directory links.
 * If the inventory cannot be completed, the caller must use the normal reader. */
export async function treeFingerprint(
  project: Project,
  snapshot: Snapshot,
): Promise<string | undefined> {
  const manifest = snapshot.product?.manifest;
  const patterns = [
    "docs",
    "TASKS",
    ".workflow-system/PRODUCT.yaml",
    ".workflow-system/PROJECT_PROFILE.yaml",
    ...(project.config.candidateRoots || []),
    ...Object.values(project.config.rules).flat(),
    ...(manifest?.managed_paths || []),
    ...(manifest?.source_paths || []),
    ...snapshot.documents.map((document) => document.path),
    ...snapshot.files.map((file) => file.path),
    ...snapshot.navigation.entries.map((entry) => entry.path),
    ...snapshot.relations.flatMap((relation) =>
      relation.targetPath ? [relation.targetPath] : [],
    ),
    ...(snapshot.product?.sources.flatMap((source) =>
      source.reference.kind === "file" ? [source.reference.path] : [],
    ) || []),
  ];
  const roots = new Set(
    patterns.map((pattern) => {
      const wildcard = pattern.search(/[*?{[\]]/);
      return wildcard < 0
        ? pattern
        : pattern
            .slice(0, pattern.lastIndexOf("/", wildcard) + 1)
            .replace(/\/$/, "");
    }),
  );
  const visited = new Set<string>(),
    rows: string[] = [];
  const queue = [...roots].map((relative) => ({ relative, depth: 0 }));
  let complete = true;
  async function walk(relative: string, depth: number): Promise<void> {
    if (visited.has(relative)) return;
    visited.add(relative);
    if (visited.size > limits.entries || depth > limits.depth) {
      complete = false;
      return;
    }
    if ((relative && !safePattern(relative)) || blockedPath(relative, true))
      return;
    if (
      project.config.excludes.some(
        (p) => matches(relative, p) || matches(`${relative}/`, p),
      ) ||
      matchesProductPath(relative, manifest?.exclude_paths || []) ||
      matchesProductPath(`${relative}/`, manifest?.exclude_paths || [])
    )
      return;
    const filename = path.resolve(project.root, relative);
    if (!within(project.root, filename)) {
      complete = false;
      return;
    }
    try {
      const stat = await lstat(filename);
      rows.push(
        JSON.stringify([
          relative,
          stat.dev,
          stat.ino,
          stat.mode,
          stat.size,
          stat.mtimeMs,
          stat.ctimeMs,
        ]),
      );
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        await assertNoLinks(filename);
        const entries = await readdir(filename);
        for (const name of entries)
          queue.push({
            relative: relative ? `${relative}/${name}` : name,
            depth: depth + 1,
          });
      } else await assertNoLinks(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        rows.push(JSON.stringify([relative, "missing"]));
      else complete = false;
    }
  }
  try {
    await assertNoLinks(project.root);
  } catch {
    return undefined;
  }
  while (queue.length && complete) {
    // A single work queue bounds concurrency across nested directories too.
    await Promise.all(
      queue.splice(0, 16).map(({ relative, depth }) => walk(relative, depth)),
    );
  }
  return complete
    ? createHash("sha256").update(rows.sort().join("\n")).digest("hex")
    : undefined;
}
