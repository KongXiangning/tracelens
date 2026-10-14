import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  unlink,
  stat,
} from "node:fs/promises";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { Project, Snapshot } from "../shared/types.js";
import type { IndexedFile } from "./file-index.js";
import { assertNoLinks, configFingerprint } from "./config.js";

const compress = promisify(gzip),
  decompress = promisify(gunzip);
// Bump when persisted parser/index semantics change.
const version = 2;
export interface CachedProject {
  snapshot: Snapshot | null;
  files: IndexedFile[];
}

/** Atomic, compressed checkpoints live outside the observed repository. */
export class SnapshotCache {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private filename(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid cache identity");
    return path.join(this.directory, "snapshots", `${id}.json.gz`);
  }
  async load(project: Project): Promise<CachedProject | null> {
    const filename = this.filename(project.id);
    try {
      await assertNoLinks(filename);
      if ((await stat(filename)).size > 64 * 1024 * 1024) return null;
      const value = JSON.parse(
        (
          await decompress(await readFile(filename), {
            maxOutputLength: 256 * 1024 * 1024,
          })
        ).toString("utf8"),
      );
      if (
        ![1, version].includes(value.version) ||
        value.root !== project.root ||
        value.configVersion !== project.configVersion ||
        value.config !== configFingerprint(project.config) ||
        !Array.isArray(value.files)
      )
        return null;
      const snapshot = value.snapshot as Snapshot | null;
      if (
        snapshot &&
        (snapshot.projectId !== project.id ||
          !Array.isArray(snapshot.documents) ||
          !Array.isArray(snapshot.tasks))
      )
        return null;
      if (value.version !== version) {
        // Legacy results remain readable while the UI refreshes them. Never
        // reuse old parser results or the unchanged-tree shortcut after upgrade.
        return {
          snapshot: snapshot
            ? { ...snapshot, treeFingerprint: undefined }
            : null,
          files: [],
        };
      }
      return { snapshot, files: value.files };
    } catch {
      // Missing/corrupt/old caches are disposable; project registration remains usable.
      return null;
    }
  }
  save(
    project: Project,
    value: CachedProject,
    current: () => boolean,
  ): Promise<void> {
    const operation = this.pending.then(async () => {
      if (!current()) return;
      const filename = this.filename(project.id);
      await assertNoLinks(path.resolve(this.directory));
      await mkdir(path.dirname(filename), { recursive: true });
      await assertNoLinks(path.dirname(filename));
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        const json = JSON.stringify({
          version,
          root: project.root,
          configVersion: project.configVersion,
          config: configFingerprint(project.config),
          ...value,
        });
        if (Buffer.byteLength(json) > 256 * 1024 * 1024)
          throw new Error(
            "项目缓存超过 256 MiB，当前结果仍可浏览；请收窄历史资料范围",
          );
        const compressed = await compress(json);
        if (compressed.length > 64 * 1024 * 1024)
          throw new Error("压缩缓存超过 64 MiB，当前结果仍可浏览");
        await writeFile(temporary, compressed, {
          mode: 0o600,
          flag: "wx",
          flush: true,
        });
        if (current()) await rename(temporary, filename);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  async remove(id: string): Promise<void> {
    await this.pending;
    await unlink(this.filename(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
