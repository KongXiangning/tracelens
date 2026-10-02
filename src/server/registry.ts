import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { z } from "zod";
import type { Project } from "../shared/types.js";
import {
  AppError,
  assertNoLinks,
  configFingerprint,
  configSchema,
  inputSchema,
  validate,
  validateRoot,
} from "./config.js";

const persisted = z
  .array(
    inputSchema.extend({
      id: z.string().uuid(),
      configVersion: z.number().int().positive(),
    }),
  )
  .max(100);
export class ProjectRegistry {
  private projects: Project[] = [];
  private pending: Promise<unknown> = Promise.resolve();
  constructor(public readonly dataDir: string) {}
  async load(): Promise<void> {
    try {
      await assertNoLinks(path.resolve(this.dataDir));
      this.projects = validate(
        persisted,
        JSON.parse(
          await readFile(path.join(this.dataDir, "projects.json"), "utf8"),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new AppError(
          `无法读取项目登记，原文件已保留：${String(error)}`,
          500,
        );
    }
  }
  list(): Project[] {
    return structuredClone(this.projects);
  }
  get(id: string): Project {
    const project = this.projects.find((p) => p.id === id);
    if (!project) throw new AppError("项目未登记或已移除", 404);
    return structuredClone(project);
  }
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(action);
    this.pending = operation.catch(() => {});
    return operation;
  }
  private async save(next: Project[]): Promise<void> {
    try {
      await assertNoLinks(path.resolve(this.dataDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(this.dataDir, { recursive: true });
    await assertNoLinks(path.resolve(this.dataDir));
    const temporary = path.join(this.dataDir, `projects-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(next, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, path.join(this.dataDir, "projects.json"));
      this.projects = next;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  add(body: unknown): Promise<Project> {
    return this.mutate(async () => {
      const input = validate(inputSchema, body);
      const root = await validateRoot(input.root, this.dataDir);
      const compare = (s: string) =>
        process.platform === "win32" ? s.toLowerCase() : s;
      if (this.projects.some((p) => compare(p.root) === compare(root)))
        throw new AppError("这个目录已登记，请在项目列表切换");
      if (this.projects.length >= 100)
        throw new AppError("最多登记 100 个项目");
      const project = { ...input, root, id: randomUUID(), configVersion: 1 };
      await this.save([...this.projects, project]);
      return project;
    });
  }
  update(id: string, body: unknown): Promise<Project> {
    return this.mutate(async () => {
      const input = validate(
        z.object({
          name: z.string().trim().min(1).max(120),
          config: configSchema,
        }),
        body,
      );
      const previous = this.get(id);
      const changed =
        configFingerprint(input.config) !== configFingerprint(previous.config);
      const project = {
        ...previous,
        ...input,
        configVersion: previous.configVersion + Number(changed),
      };
      await this.save(this.projects.map((p) => (p.id === id ? project : p)));
      return project;
    });
  }
  remove(id: string): Promise<void> {
    return this.mutate(async () => {
      this.get(id);
      await this.save(this.projects.filter((p) => p.id !== id));
    });
  }
}
