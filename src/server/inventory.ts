import path from "node:path";
import { opendir, realpath } from "node:fs/promises";
import { assertNoLinks, documentPathKey, within } from "./config.js";
import { blockedPath, limits, matches } from "./scanner.js";
import type {
  DocumentInventory,
  ScanConfig,
  Warning,
} from "../shared/types.js";

// This inventory reads directory metadata only. Candidates never become declarations.
export async function inventoryDocuments(
  root: string,
  config: ScanConfig,
  registered: Set<string>,
  warnings: Warning[],
): Promise<DocumentInventory> {
  const report: DocumentInventory = {
    roots: [...new Set(config.candidateRoots ?? ["docs", "TASKS"])],
    candidates: [],
    excluded: [],
    incomplete: false,
  };
  const visited = new Set<string>();
  let count = 0;
  function exclude(relative: string, reason: string) {
    if (report.excluded.length < 500)
      report.excluded.push({ path: relative, reason });
    else report.incomplete = true;
  }
  function exclusion(relative: string): string | null {
    if (blockedPath(relative, config.includeRecords)) return "默认跳过的目录";
    if (
      config.excludes.some(
        (p) => matches(relative, p) || matches(`${relative}/`, p),
      )
    )
      return "扫描配置已排除";
    return null;
  }
  async function walk(relative: string, depth: number): Promise<void> {
    const key = documentPathKey(relative);
    if (visited.has(key)) return;
    visited.add(key);
    const reason = exclusion(relative);
    if (reason) {
      exclude(relative, reason);
      return;
    }
    if (depth > limits.depth || count >= limits.entries) {
      report.incomplete = true;
      return;
    }
    const absolute = path.resolve(root, relative);
    try {
      await assertNoLinks(absolute);
      if (!within(root, await realpath(absolute)))
        throw new Error("目录真实路径越界");
      for await (const entry of await opendir(absolute)) {
        if (++count > limits.entries) {
          report.incomplete = true;
          break;
        }
        const child = `${relative}/${entry.name}`;
        const skipped = exclusion(child);
        if (skipped) exclude(child, skipped);
        else if (entry.isSymbolicLink()) exclude(child, "符号链接或目录联接");
        else if (entry.isDirectory()) await walk(child, depth + 1);
        else if (
          entry.isFile() &&
          /\.(?:md|markdown|ya?ml)$/i.test(child) &&
          !registered.has(documentPathKey(child))
        ) {
          if (report.candidates.length >= limits.files) {
            report.incomplete = true;
            break;
          }
          report.candidates.push(child);
        }
      }
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" &&
        depth === 0 &&
        !config.candidateRoots
      )
        return;
      report.incomplete = true;
      exclude(relative, `无法盘点：${String(error)}`);
    }
  }
  for (const directory of report.roots)
    await walk(directory.replace(/\/$/, ""), 0);
  report.candidates.sort((a, b) => a.localeCompare(b));
  if (report.incomplete)
    warnings.push({
      code: "inventory-incomplete",
      message:
        "候选目录盘点遇到不可读路径或数量／深度上限，请查看候选范围；不能据此判断全部文件缺失。",
    });
  return report;
}
