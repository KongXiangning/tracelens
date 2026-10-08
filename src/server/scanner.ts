import path from "node:path";
import { open, lstat, readdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { minimatch } from "minimatch";
import {
  kinds,
  type Discovery,
  type DocumentKind,
  type Project,
  type ScanFile,
  type Warning,
  type NavigationReport,
  type ScanConfig,
} from "../shared/types.js";
import {
  AppError,
  assertNoLinks,
  documentPathKey,
  safePattern,
  validateRoot,
  within,
} from "./config.js";
import type { ProductSnapshot } from "../shared/product-types.js";
import { matchesProductPath, parseProductManifest } from "./product-parser.js";

export const limits = {
  files: 500,
  fileBytes: 2 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  entries: 20000,
  depth: 24,
};
const blocked = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "records",
  ".vnext",
  "journal",
]);
export function blockedPath(relative: string, includeRecords = false): boolean {
  return relative
    .split("/")
    .some(
      (segment) =>
        blocked.has(segment.toLowerCase()) &&
        !(includeRecords && segment.toLowerCase() === "records"),
    );
}
export function matches(file: string, pattern: string): boolean {
  return minimatch(file, pattern, {
    dot: true,
    nocase: process.platform === "win32",
  });
}
export interface InputFile {
  path: string;
  kind: DocumentKind;
  raw: string;
  digest: string;
  bytes: number;
  modifiedAt: string;
}
export interface ScanResult {
  inputs: InputFile[];
  files: ScanFile[];
  warnings: Warning[];
  navigation: NavigationReport;
  effectiveRules: Record<DocumentKind, string[]>;
  readSession: ScanReadSession;
  product?: ProductSnapshot;
  productPaths?: Set<string>;
}
// One cache and budget per refresh, shared by general navigation, PRODUCT and
// exact adopted-plan sources. Failed reads are cached too: no new-version retry.
export interface ReadAllowance {
  remainingBytes?: () => number;
  onBytesRead?: (bytes: number) => void;
  onResolvedPath?: (relative: string) => void;
}
export class ScanReadSession {
  readonly inputs = new Map<string, Omit<InputFile, "kind">>();
  private attempts = new Map<string, Promise<Omit<InputFile, "kind">>>();
  private canonicalPaths = new Map<string, string>();
  private productExclusions: string[] = [];
  private pending: Promise<void> = Promise.resolve();
  bytes = 0;
  constructor(
    readonly root: string,
    private readonly config?: ScanConfig,
  ) {}
  setProductExclusions(patterns: readonly string[]): void {
    this.productExclusions = [...patterns];
  }
  exclusion(relative: string, includeRecords = false): string | null {
    if (blockedPath(relative, includeRecords)) return "文件路径超出允许范围";
    if (
      this.config?.excludes.some(
        (p) => matches(relative, p) || matches(`${relative}/`, p),
      )
    )
      return "用户显式排除";
    // Do not append PRODUCT patterns to generic minimatch configuration: the
    // contract deliberately treats extglob/braces/classes differently.
    if (
      matchesProductPath(relative, this.productExclusions) ||
      matchesProductPath(`${relative}/`, this.productExclusions)
    )
      return "PRODUCT exclude_paths 排除";
    return null;
  }
  assertAllowed(relative: string, includeRecords = false): void {
    if (!safePattern(relative) || /[*?{[\]]/.test(relative))
      throw new AppError("文件路径超出允许范围");
    const canonical = this.canonicalPaths.get(documentPathKey(relative));
    const reason =
      this.exclusion(relative, includeRecords) ||
      (canonical && this.exclusion(canonical, includeRecords));
    if (reason) throw new AppError(reason);
  }
  async read(
    relative: string,
    includeRecords = false,
    allowance?: ReadAllowance,
  ) {
    // Policy is checked before cached success or failure is returned.
    this.assertAllowed(relative, includeRecords);
    const key = documentPathKey(relative);
    const cached = this.attempts.get(key);
    if (cached) return cached;
    if (this.attempts.size >= limits.files)
      throw new AppError("达到 500 文件读取上限，扫描不完整");
    // Serialize physical reads so concurrent callers cannot each spend the same
    // remaining budget. Coalesced requests still reuse one promise/byte image.
    const reading = this.pending.then(async () => {
      this.assertAllowed(relative, includeRecords);
      if (this.bytes >= limits.totalBytes)
        throw new AppError("达到总读取量 20 MiB 上限，未读取");
      const input = await readBounded(this.root, relative, includeRecords, {
        remainingBytes: () =>
          Math.min(
            limits.totalBytes - this.bytes,
            allowance?.remainingBytes?.() ?? Infinity,
          ),
        onBytesRead: (count) => {
          this.bytes += count;
          allowance?.onBytesRead?.(count);
        },
        onResolvedPath: (canonical) => {
          this.canonicalPaths.set(key, canonical);
          this.assertAllowed(relative, includeRecords);
          allowance?.onResolvedPath?.(canonical);
        },
      });
      this.inputs.set(key, input);
      return input;
    });
    this.attempts.set(key, reading);
    this.pending = reading.then(
      () => undefined,
      () => undefined,
    );
    return reading;
  }
}
export async function readBounded(
  root: string,
  relative: string,
  includeRecords = false,
  allowance?: ReadAllowance,
): Promise<Omit<InputFile, "kind">> {
  if (
    !safePattern(relative) ||
    /[*?{[\]]/.test(relative) ||
    blockedPath(relative, includeRecords)
  )
    throw new AppError("文件路径超出允许范围");
  const filename = path.resolve(root, relative);
  if (!within(root, filename)) throw new AppError("文件路径越界");
  await assertNoLinks(filename);
  const real = await realpath(filename);
  if (!within(root, real)) throw new AppError("真实文件路径越界");
  allowance?.onResolvedPath?.(
    path.relative(root, real).split(path.sep).join("/"),
  );
  const handle = await open(
    filename,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new AppError("不是普通文件");
    if (before.size > limits.fileBytes)
      throw new AppError("单文件超过 2 MiB 上限，扫描不完整");
    if (before.size > (allowance?.remainingBytes?.() ?? Infinity))
      throw new AppError("超过读取字节预算上限，未读取");
    // Read only the preflight size. Post-read stat checks still reject growth,
    // shrinkage or replacement. No extra EOF probe can overspend the budget.
    const buffer = Buffer.alloc(before.size);
    let length = 0;
    while (length < buffer.length) {
      const remaining = allowance?.remainingBytes?.() ?? Infinity;
      if (remaining <= 0)
        throw new AppError("达到读取字节预算上限，扫描不完整");
      const { bytesRead } = await handle.read(
        buffer,
        length,
        Math.min(64 * 1024, buffer.length - length, remaining),
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
      // Charge successful system reads immediately. UTF-8, binary detection,
      // later stat/path failures and downstream parsing cannot undo actual I/O.
      allowance?.onBytesRead?.(bytesRead);
    }
    const after = await handle.stat();
    const current = await lstat(filename);
    if (
      length !== before.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size ||
      before.ino !== current.ino ||
      before.mtimeMs !== current.mtimeMs ||
      current.isSymbolicLink()
    )
      throw new AppError("扫描期间文件变化，请重新刷新");
    if (!within(root, await realpath(filename)))
      throw new AppError("读取期间真实路径变化");
    const bytes = buffer.subarray(0, length);
    const raw = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
    if (raw.includes("\0")) throw new AppError("文件包含二进制内容");
    return {
      path: relative,
      raw,
      bytes: length,
      digest: createHash("sha256").update(bytes).digest("hex"),
      modifiedAt: before.mtime.toISOString(),
    };
  } finally {
    await handle.close();
  }
}
export async function discover(
  rootInput: string,
  dataDir: string,
  suppliedConfig?: ScanConfig,
): Promise<Discovery> {
  const root = await validateRoot(rootInput, dataDir);
  const config: ScanConfig = suppliedConfig || {
    autoDiscover: true,
    rules: { management: [], requirements: [], design: [], planning: [] },
    excludes: [],
  };
  const scan = await scanFiles(
    { id: "discovery", name: "发现预览", root, config, configVersion: 1 },
    undefined,
    true,
  );
  return {
    config,
    warnings: scan.warnings,
    profileUsed: scan.navigation.profileUsed,
    navigation: scan.navigation,
    effectiveRules: scan.effectiveRules,
    product: await (
      await import("./product-reader.js")
    ).previewProduct(root, config, scan.readSession),
  };
}
export async function scanFiles(
  project: Project,
  previousNavigation?: NavigationReport,
  preflight = false,
): Promise<ScanResult> {
  const root = await validateRoot(project.root);
  const readSession = new ScanReadSession(root, project.config);
  // Establish the enabled, valid PRODUCT exclusion policy before any generic
  // navigation or manual reads. Disabled/invalid manifests grant no new scope.
  if (project.config.product?.enabled) {
    try {
      const entry = await readSession.read(
        project.config.product.manifestPath || ".workflow-system/PRODUCT.yaml",
      );
      const { manifest } = parseProductManifest(entry.raw, entry.path);
      if (manifest) readSession.setProductExclusions(manifest.exclude_paths);
    } catch {
      // readProduct / previewProduct report the same cached failure and retain
      // whatever original bytes are safely available; no old manifest is used.
    }
  }
  const files: ScanFile[] = [];
  const warnings: Warning[] = [];
  const selected = new Map<string, { path: string; kind: DocumentKind }>();
  const { DocumentNavigation } = await import("./navigation.js");
  const navigation = project.config.autoDiscover
    ? new DocumentNavigation(root, project.config, readSession)
    : null;
  if (navigation) {
    await navigation.initialize();
    await navigation.recoverUnavailableSources(previousNavigation);
  }
  const effectiveRules: Record<DocumentKind, string[]> = {
    ...(Object.fromEntries(
      kinds.map((kind) => [
        kind,
        [...project.config.rules[kind], ...(navigation?.rules[kind] || [])],
      ]),
    ) as Record<(typeof kinds)[number], string[]>),
    unclassified: [],
  };
  let visited = 0;
  let truncated = false;
  const excluded = (p: string) =>
    Boolean(readSession.exclusion(p, project.config.includeRecords));
  async function walk(
    relative: string,
    depth: number,
    kind: DocumentKind,
    pattern: string,
  ): Promise<void> {
    if (excluded(relative)) return;
    if (
      visited >= limits.entries ||
      depth > limits.depth ||
      selected.size >= limits.files
    ) {
      if (!truncated)
        warnings.push({
          code: "limit",
          message: "达到枚举数量、深度或 500 文件上限，扫描不完整",
        });
      truncated = true;
      return;
    }
    const absolute = path.resolve(root, relative);
    try {
      await assertNoLinks(absolute);
      if (!within(root, await realpath(absolute)))
        throw new AppError("目录真实路径越界");
      const stats = await lstat(absolute);
      if (stats.isDirectory()) {
        const entries = await readdir(absolute, { withFileTypes: true });
        for (const entry of entries.sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          visited++;
          if (visited > limits.entries || selected.size >= limits.files) {
            await walk(relative, limits.depth + 1, kind, pattern);
            break;
          }
          const child = relative ? `${relative}/${entry.name}` : entry.name;
          if (excluded(child)) continue;
          if (entry.isSymbolicLink()) {
            files.push({
              path: child,
              kind,
              status: "skipped",
              detail: "跳过符号链接或目录联接",
            });
            warnings.push({
              code: "symlink",
              path: child,
              message: "跳过符号链接或目录联接",
            });
          } else if (entry.isDirectory())
            await walk(child, depth + 1, kind, pattern);
          else if (entry.isFile() && matches(child, pattern))
            select(child, kind);
        }
      } else if (stats.isFile() && matches(relative, pattern))
        select(relative, kind);
    } catch (error) {
      files.push({
        path: relative || ".",
        kind,
        status:
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "missing"
            : "error",
        detail: String(error),
      });
      warnings.push({
        code: "enumeration",
        path: relative || ".",
        message: `无法枚举配置范围：${String(error)}`,
      });
    }
  }
  function select(relative: string, kind: DocumentKind): void {
    if (excluded(relative)) return;
    if (!/\.(md|markdown|ya?ml)$/i.test(relative)) {
      files.push({
        path: relative,
        kind,
        status: "skipped",
        detail: "仅支持 Markdown 和 YAML",
      });
      warnings.push({
        code: "unsupported",
        path: relative,
        message: "已跳过不支持的文件类型",
      });
      return;
    }
    const key = documentPathKey(relative);
    const existing = selected.get(key);
    if (existing && existing.kind !== kind)
      warnings.push({
        code: "classification",
        path: relative,
        message: `文件匹配多种类型，按配置顺序使用 ${existing.kind}`,
      });
    else if (!existing) selected.set(key, { path: relative, kind });
  }
  for (const kind of kinds) {
    for (const pattern of effectiveRules[kind]) {
      if (excluded(pattern)) continue;
      const wildcard = pattern.search(/[*?{[\]]/);
      if (wildcard < 0) {
        if (
          selected.size >= limits.files &&
          !selected.has(documentPathKey(pattern))
        ) {
          truncated = true;
          warnings.push({
            code: "limit",
            message: "达到 500 文件上限，扫描不完整",
          });
          break;
        }
        select(pattern, kind);
      } else {
        const prefix = pattern.slice(0, wildcard);
        const directory = prefix.includes("/")
          ? prefix.slice(0, prefix.lastIndexOf("/"))
          : "";
        await walk(directory, 0, kind, pattern);
        if (
          ![...selected.values()].some((file) => matches(file.path, pattern)) &&
          !files.some((f) => f.path === directory)
        )
          warnings.push({
            code: "no-match",
            level: "info",
            path: pattern,
            message: "此匹配规则未发现文档",
          });
      }
    }
  }
  function selectNavigation(): void {
    for (const entry of navigation?.entries.values() || []) {
      if (entry.availability === "excluded") continue;
      const key = documentPathKey(entry.path);
      if (selected.size >= limits.files && !selected.has(key)) {
        truncated = true;
        break;
      }
      const manual = kinds.find((kind) =>
        project.config.rules[kind].some((pattern) =>
          matches(entry.path, pattern),
        ),
      );
      const existing = selected.get(key);
      if (!manual && existing) existing.kind = entry.kind;
      else select(entry.path, manual || entry.kind);
      if (!effectiveRules[manual || entry.kind].includes(entry.path))
        effectiveRules[manual || entry.kind].push(entry.path);
    }
  }
  selectNavigation();
  // The profile is the only implicit YAML input; scripts and other profile fields are never executed.
  try {
    await lstat(path.join(root, ".workflow-system/PROJECT_PROFILE.yaml"));
    if (!excluded(".workflow-system/PROJECT_PROFILE.yaml")) {
      if (
        selected.size < limits.files ||
        selected.has(documentPathKey(".workflow-system/PROJECT_PROFILE.yaml"))
      )
        select(".workflow-system/PROJECT_PROFILE.yaml", "management");
      else
        warnings.push({
          code: "limit",
          path: ".workflow-system/PROJECT_PROFILE.yaml",
          message: "达到 500 文件上限，未读取 Profile，扫描不完整",
        });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      warnings.push({ code: "profile", message: String(error) });
  }
  const inputs: InputFile[] = [];
  let bytes = navigation?.bytes || 0;
  let failed = files.filter((f) => f.status === "error").length;
  const attempted = new Set<string>();
  async function readSelected(): Promise<void> {
    for (const [key, { path: relative, kind }] of selected) {
      if (attempted.has(key)) continue;
      attempted.add(key);
      try {
        readSession.assertAllowed(relative, project.config.includeRecords);
        const cached = navigation?.inputs.get(key);
        const input =
          cached ||
          (await readSession.read(
            navigation?.entries.get(key)?.path || relative,
            project.config.includeRecords,
          ));
        if (bytes + (cached ? 0 : input.bytes) > limits.totalBytes)
          throw new AppError("超过总读取量 20 MiB 上限，扫描不完整");
        bytes += cached ? 0 : input.bytes;
        inputs.push({ ...input, kind });
        files.push({ path: input.path, kind, status: "read" });
      } catch (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        if (!missing) failed++;
        files.push({
          path: relative,
          kind,
          status: missing ? "missing" : "error",
          detail: String(error),
        });
        warnings.push({
          code: missing ? "missing" : "read",
          path: relative,
          message: missing ? "配置文件缺失" : `读取失败：${String(error)}`,
        });
      }
    }
  }
  await readSelected();
  if (navigation) {
    const previousBytes = navigation.bytes;
    await navigation.includeScanned(inputs);
    bytes += navigation.bytes - previousBytes;
    selectNavigation();
    if (bytes > limits.totalBytes)
      warnings.push({
        code: "limit",
        message: "导航与正文达到总读取量 20 MiB 上限，扫描不完整",
      });
    else await readSelected();
    for (const input of inputs) {
      const key = documentPathKey(input.path);
      input.kind = navigation.entries.get(key)?.kind || input.kind;
      const scanned = files.find(
        (file) => documentPathKey(file.path) === key && file.status === "read",
      );
      if (scanned) scanned.kind = input.kind;
    }
    for (const entry of navigation.entries.values()) {
      const file = files.find(
        (f) => documentPathKey(f.path) === documentPathKey(entry.path),
      );
      if (file)
        entry.availability =
          file.status === "skipped" ? "excluded" : file.status;
      else if (entry.availability === "read") entry.availability = "pending";
    }
    warnings.push(...navigation.warnings);
    if (truncated) navigation.incomplete = true;
  }
  const report: NavigationReport = navigation?.report() || {
    enabled: false,
    profileUsed: false,
    entries: [],
    incomplete: truncated,
    gaps: ["当前使用手动范围，未核对 vNext 文档登记"],
  };
  if (navigation) {
    const { inventoryDocuments } = await import("./inventory.js");
    report.inventory = await inventoryDocuments(
      root,
      project.config,
      new Set([
        ...inputs.map((input) => documentPathKey(input.path)),
        ...report.entries.map((entry) => documentPathKey(entry.path)),
      ]),
      warnings,
      (p) => readSession.exclusion(p, project.config.includeRecords),
    );
  }
  const result: ScanResult = {
    inputs,
    files,
    warnings,
    effectiveRules,
    navigation: report,
    readSession,
  };
  if (!preflight)
    await (await import("./product-reader.js")).readProduct(project, result);
  if (!preflight && inputs.length === 0 && failed > 0)
    throw new AppError(
      "匹配范围内文档全部读取失败；请检查目录权限、链接和大小限制",
      422,
    );
  return result;
}
