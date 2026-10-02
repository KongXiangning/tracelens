import path from "node:path";
import os from "node:os";
import { open, opendir } from "node:fs/promises";
import { AppError, assertNoLinks, validateRoot, within } from "./config.js";
import type {
  CodexProjects,
  DirectoryListing,
  Project,
} from "../shared/types.js";

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export async function codexProjects(
  registered: Project[],
  dataDir: string,
  home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
): Promise<CodexProjects> {
  const file = path.join(home, ".codex-global-state.json");
  let state: Record<string, unknown>;
  try {
    await assertNoLinks(path.resolve(file));
    const handle = await open(file, "r");
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024)
        throw new AppError("Codex 登记文件不是普通文件或超过 16 MiB");
      const bytes = Buffer.alloc(16 * 1024 * 1024 + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 16 * 1024 * 1024)
        throw new AppError("Codex 登记文件超过 16 MiB");
      state = record(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")));
    } finally {
      await handle.close();
    }
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      projects: [],
      notice: missing
        ? "未找到服务机器上的 Codex 项目登记，可使用浏览目录。"
        : `无法读取 Codex 项目登记，可使用浏览目录。（${error instanceof Error ? error.message : String(error)}）`,
    };
  }
  const candidates = new Map<string, { name: string; root: string }>();
  function add(root: unknown, name: unknown) {
    if (
      typeof root !== "string" ||
      !root ||
      root.length > 2000 ||
      candidates.size >= 500
    )
      return;
    const key = pathKey(root);
    if (!candidates.has(key))
      candidates.set(key, {
        root,
        name:
          typeof name === "string" && name.trim()
            ? name.slice(0, 120)
            : path.basename(root) || root,
      });
  }
  const local = record(state["local-projects"]);
  for (const value of Object.values(local)) {
    const project = record(value);
    if (project.hostId && project.hostId !== "local") continue;
    if (Array.isArray(project.rootPaths))
      for (const root of project.rootPaths) add(root, project.name);
  }
  const roots = state["electron-saved-workspace-roots"];
  const labels = record(state["electron-workspace-root-labels"]);
  if (Array.isArray(roots))
    for (const root of roots)
      add(root, typeof root === "string" ? labels[root] : undefined);
  const existing = new Set(registered.map((p) => pathKey(p.root)));
  const projects = [];
  // Check metadata only; discovering document scope remains an explicit user action.
  for (const candidate of candidates.values()) {
    let reason: string | undefined;
    try {
      const real = await validateRoot(candidate.root, dataDir);
      if (existing.has(pathKey(real))) reason = "已添加";
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    projects.push({ ...candidate, reason });
  }
  return {
    projects,
    notice: projects.length
      ? undefined
      : "Codex 尚未登记可识别的本地项目，可使用浏览目录。",
  };
}

export async function browseDirectories(
  input: string | undefined,
  dataDir: string,
): Promise<DirectoryListing> {
  const current = await validateRoot(input || os.homedir());
  const parent = path.dirname(current);
  const directories: DirectoryListing["directories"] = [];
  let count = 0;
  let truncated = false;
  try {
    const directory = await opendir(current);
    for await (const entry of directory) {
      if (++count > 10000 || directories.length >= 500) {
        truncated = true;
        break;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink())
        directories.push({
          name: entry.name,
          path: path.join(current, entry.name),
        });
    }
  } catch {
    throw new AppError("目录不存在或无法列出，请选择其他目录");
  }
  directories.sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
  );
  const shortcuts = [{ name: "用户目录", path: os.homedir() }];
  const roots =
    process.platform === "win32"
      ? Array.from(
          { length: 26 },
          (_, i) => `${String.fromCharCode(65 + i)}:\\`,
        )
      : ["/"];
  for (const root of roots) {
    try {
      await validateRoot(root);
      shortcuts.push({ name: root, path: root });
    } catch {
      /* Unavailable drive roots are not shortcuts. */
    }
  }
  const selectable = !within(current, path.resolve(dataDir));
  return {
    current,
    parent: parent === current ? null : parent,
    shortcuts,
    directories,
    truncated,
    selectable,
    reason: selectable
      ? undefined
      : "工具配置目录不能位于被观察项目内，请选择独立的项目目录",
  };
}
