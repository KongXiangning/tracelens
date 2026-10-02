import path from "node:path";
import os from "node:os";
import { constants } from "node:fs";
import { access, lstat, realpath, opendir } from "node:fs/promises";
import { z } from "zod";
import { kinds, type ScanConfig } from "../shared/types.js";

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export function documentPathKey(relative: string): string {
  const normalized = path.posix.normalize(relative);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
export function safePattern(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 400 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.includes(":") &&
    !/[\x00-\x1f]/.test(value) &&
    !value.split("/").some((p) => p === ".." || p === ".") &&
    !value.startsWith("!")
  );
}
const pattern = z
  .string()
  .trim()
  .refine(
    safePattern,
    "规则须为项目内的相对路径，使用 /，不能包含 ..、盘符或反斜杠",
  );
export const configSchema = z.object({
  autoDiscover: z.boolean().optional(),
  rules: z.object({
    management: z.array(pattern).max(64),
    requirements: z.array(pattern).max(64),
    design: z.array(pattern).max(64),
    planning: z.array(pattern).max(64),
  }),
  excludes: z.array(pattern).max(64),
});
export const inputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  root: z.string().trim().min(1).max(2000),
  config: configSchema,
});
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("；"),
    );
  return result.data;
}
export function defaultConfig(home = "docs/workflow"): ScanConfig {
  return {
    rules: {
      management: [
        "CURRENT_TASK.md",
        "STATUS.md",
        "TASK_SUMMARY.md",
        "TASK_ARCHIVE.md",
        "TASKS/**/*.md",
      ].map((f) => `${home}/${f}`),
      requirements: [],
      design: [],
      planning: [`${home}/ROADMAP.md`],
    },
    excludes: [],
  };
}
export function dataDirectory(): string {
  const override = process.env.TRACELENS_DATA_DIR;
  if (override && !path.isAbsolute(override))
    throw new AppError("TRACELENS_DATA_DIR 必须是本机绝对路径");
  if (override) return path.resolve(override);
  if (process.platform === "win32")
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "TraceLens",
    );
  return path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "tracelens",
  );
}
export async function assertNoLinks(target: string): Promise<void> {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const segment of target
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink())
      throw new AppError(`跳过符号链接或目录联接：${current}`);
  }
}
export async function validateRoot(
  input: string,
  dataDir?: string,
): Promise<string> {
  if (
    !path.isAbsolute(input) ||
    (process.platform === "win32" && input.startsWith("\\\\"))
  )
    throw new AppError("请输入服务所在系统的本地绝对路径，不支持 UNC 网络目录");
  const root = path.resolve(input);
  try {
    await assertNoLinks(root);
    if (!(await lstat(root)).isDirectory())
      throw new AppError("项目路径不是目录");
    await access(root, constants.R_OK);
    const directory = await opendir(root);
    await directory.close();
    const real = await realpath(root);
    if (dataDir && within(real, path.resolve(dataDir)))
      throw new AppError(
        "工具配置目录不能位于被观察项目内，请使用独立的数据目录",
      );
    return real;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      `项目目录不存在或不可读：${root}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}
export function configFingerprint(config: ScanConfig): string {
  return JSON.stringify([
    Boolean(config.autoDiscover),
    kinds.map((k) => config.rules[k]),
    config.excludes,
  ]);
}
