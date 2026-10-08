import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import type {
  Project,
  Relation,
  Snapshot,
  SnapshotView,
  RefreshAttempt,
  Warning,
} from "../shared/types.js";
import {
  AppError,
  assertNoLinks,
  documentPathKey,
  safePattern,
  within,
} from "./config.js";
import { blockedPath, matches, scanFiles } from "./scanner.js";
import { examplePath } from "./document-metadata.js";
import { attachCurrentPlan } from "./current-plan.js";
import { buildProductIndex } from "./product-index.js";
import { inspectProductEnvelope } from "./product-parser.js";
import { parseProductMarkdown } from "./product-markdown.js";
import {
  anchor,
  parseInput,
  stableId,
  stateKey,
  taskNumberKey,
  type Parsed,
  type PendingReference,
} from "./parser.js";
import type { ProjectRegistry } from "./registry.js";

export async function buildSnapshot(
  project: Project,
  startedAt: string,
  previous?: Snapshot,
): Promise<Snapshot> {
  const scan = await scanFiles(project, previous?.navigation);
  const parsed = scan.inputs.map((input): Parsed => {
    try {
      const envelope = inspectProductEnvelope(input.raw);
      // A standard product file is one source document with many business items.
      // Never feed its prose or state labels into generic task extraction.
      if (
        scan.productPaths?.has(documentPathKey(input.path)) ||
        envelope.isProduct ||
        /\.txt$/i.test(input.path)
      ) {
        return parseProductMarkdown(
          project.id,
          input,
          envelope.bodyStart,
          Boolean(scan.productPaths?.has(documentPathKey(input.path))),
        );
      }
      return parseInput(project.id, input);
    } catch (error) {
      return {
        document: {
          ...input,
          id: stableId(project.id, input.path),
          title: path.posix.basename(input.path),
          headings: [],
          recognized: false,
        },
        task: null,
        statements: [],
        references: [],
        warnings: [
          {
            code: "parse",
            path: input.path,
            message: `文档提取失败，原文保留：${String(error)}`,
          },
        ],
      };
    }
  });
  const manualCurrent = parsed
    .flatMap((p) => (p.task ? [p.task] : []))
    .filter(
      (t) =>
        t.current &&
        !/(^|\/)(legacy|archive|archives|history|templates?)(\/|$)/i.test(
          t.source.path,
        ),
    );
  const currentPath = scan.navigation.enabled
    ? scan.navigation.currentTaskPath
    : manualCurrent.length === 1
      ? manualCurrent[0].source.path
      : undefined;
  await attachCurrentPlan(project, scan, parsed, currentPath);
  const documents = parsed.map((p) => p.document);
  const tasks = parsed.flatMap((p) => (p.task ? [p.task] : []));
  const isCurrentSource = (filename: string) =>
    Boolean(
      currentPath && documentPathKey(filename) === documentPathKey(currentPath),
    );
  for (const task of tasks)
    task.current = task.current && isCurrentSource(task.source.path);
  const statements = parsed
    .flatMap((p) => p.statements)
    .filter(
      (s) =>
        !["currentTask", "currentStep"].includes(s.kind) ||
        isCurrentSource(s.source.path),
    );
  const warnings: Warning[] = [
    ...scan.warnings,
    ...parsed.flatMap((p) => p.warnings),
  ];
  const byPath = new Map(documents.map((d) => [documentPathKey(d.path), d]));
  const relations: Relation[] = [];
  const existence = new Map<string, Relation["state"]>();
  async function resolve(
    ref: PendingReference,
    from: string,
  ): Promise<Relation> {
    const base: Relation = {
      ...ref,
      id: `relation-${relations.length}`,
      from,
      to: null,
      targetPath: null,
      targetLine: null,
      type: ref.method === "task-number" ? "mention" : "reference",
      state: "outside",
    };
    if (ref.method === "task-number") {
      const matches = tasks.filter(
        (t) => taskNumberKey(t.number || "") === taskNumberKey(ref.target),
      );
      if (matches.length === 1)
        return {
          ...base,
          to: matches[0].id,
          targetPath: matches[0].source.path,
          targetLine: matches[0].source.line,
          state: "resolved",
        };
      return { ...base, state: matches.length > 1 ? "ambiguous" : "outside" };
    }
    if (/^(https?:|mailto:|\/\/)/i.test(ref.target))
      return { ...base, state: "external" };
    if (
      /^[a-z][a-z\d+.-]*:/i.test(ref.target) ||
      ref.target.startsWith("/") ||
      ref.target.startsWith("\\")
    )
      return { ...base, state: "unsafe" };
    let target: string;
    let section: string | null = ref.section;
    try {
      const [pathname, hash] = ref.target.split("#");
      target = decodeURIComponent(pathname.split("?")[0]).replace(/\\/g, "/");
      if (!section && hash) section = decodeURIComponent(hash);
    } catch {
      return { ...base, state: "unsafe" };
    }
    if (examplePath(target)) return { ...base, state: "example" };
    const resolved =
      ref.method === "structured"
        ? path.posix.normalize(target)
        : path.posix.join(
            path.posix.dirname(ref.source.path),
            target || path.posix.basename(ref.source.path),
          );
    if (
      !within(project.root, path.resolve(project.root, resolved)) ||
      resolved.startsWith("/") ||
      resolved.includes(":") ||
      /[\x00-\x1f]/.test(resolved)
    )
      return { ...base, state: "unsafe" };
    const doc = byPath.get(documentPathKey(resolved));
    if (!doc) {
      const key = documentPathKey(resolved);
      let state = existence.get(key);
      if (!state) {
        const file = scan.files.find((f) => documentPathKey(f.path) === key);
        if (!safePattern(resolved) || /[*?{[\]]/.test(resolved))
          state = "unsafe";
        else if (
          scan.readSession.exclusion(resolved, project.config.includeRecords) ||
          blockedPath(resolved, project.config.includeRecords) ||
          project.config.excludes.some(
            (p) => matches(resolved, p) || matches(`${resolved}/`, p),
          )
        )
          state = "excluded";
        else if (file?.status === "missing") state = "missing";
        else if (file && file.status !== "read") state = "unavailable";
        else if (existence.size >= 500) {
          state = "outside";
          if (!warnings.some((w) => w.code === "reference-check-limit"))
            warnings.push({
              code: "reference-check-limit",
              message:
                "引用目标存在性核对达到 500 个路径上限，其余目标保留未核对状态。",
            });
        } else {
          try {
            const absolute = path.resolve(project.root, resolved);
            await assertNoLinks(absolute);
            state = (await lstat(absolute)).isFile() ? "available" : "outside";
          } catch (error) {
            state =
              (error as NodeJS.ErrnoException).code === "ENOENT"
                ? "missing"
                : "unavailable";
          }
        }
        if (existence.size < 500) existence.set(key, state);
      }
      return {
        ...base,
        section,
        targetPath: resolved,
        state,
      };
    }
    let line = 1;
    if (section) {
      const exact = doc.headings.filter((h) => h.title === section);
      const found = exact.length
        ? exact
        : doc.headings.filter(
            (h) => h.anchor === section || h.anchor === anchor(section),
          );
      if (found.length !== 1)
        return {
          ...base,
          to: doc.id,
          section,
          targetPath: resolved,
          state: "section-missing",
        };
      line = found[0].line;
    }
    return {
      ...base,
      to: doc.id,
      section,
      targetPath: resolved,
      targetLine: line,
      state: "resolved",
    };
  }
  for (const item of parsed) {
    const seen = new Set<string>();
    for (const ref of item.references) {
      if (
        ref.method === "task-number" &&
        !tasks.some(
          (t) => taskNumberKey(t.number || "") === taskNumberKey(ref.target),
        ) &&
        !/^(?:TASK-\d+|\d{8}-\d{3})$/.test(ref.target)
      )
        continue;
      const key = JSON.stringify([
        ref.method,
        ref.target,
        ref.section,
        ref.source.line,
        ref.method === "task-number" ? ref.raw : null,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      const relation = await resolve(ref, item.task?.id || item.document.id);
      relations.push(relation);
      if (!["resolved", "external"].includes(relation.state))
        warnings.push({
          code: `reference-${relation.state}`,
          level: ["example", "excluded", "available"].includes(relation.state)
            ? "info"
            : "warning",
          path: ref.source.path,
          line: ref.source.line,
          message: `${ref.raw}：${relationLabels[relation.state]}`,
        });
    }
  }
  const statusGroups = new Map<
    string,
    { value: string; source: (typeof statements)[number]["source"] }[]
  >();
  for (const task of tasks) {
    const key = taskNumberKey(task.number || "") || task.id;
    const declarations = statusGroups.get(key) || [];
    declarations.push(
      ...task.statuses.map((s) => ({ value: s.text, source: s.source })),
    );
    statusGroups.set(key, declarations);
  }
  for (const statement of statements.filter(
    (s) =>
      s.kind === "status" &&
      !tasks.some((t) => t.source.documentId === s.source.documentId),
  )) {
    const key = taskNumberKey(statement.taskNumber || "") || "项目状态";
    const group = statusGroups.get(key) || [];
    group.push({ value: statement.text, source: statement.source });
    statusGroups.set(key, group);
  }
  for (const [key, group] of statusGroups) {
    if (new Set(group.map((s) => stateKey(s.value) || s.value)).size > 1)
      warnings.push({
        code: "status-conflict",
        message: `${key} 的状态声明冲突：${group.map((s) => `${s.value}（${s.source.path}:${s.source.line}）`).join("；")}`,
      });
  }
  if (scan.product) {
    buildProductIndex(scan.product, tasks);
    for (const diagnostic of scan.product.diagnostics) {
      const document =
        diagnostic.path && byPath.get(documentPathKey(diagnostic.path));
      if (!diagnostic.source && document)
        diagnostic.source = {
          documentId: document.id,
          path: document.path,
          line: diagnostic.line || 1,
          section: null,
          digest: document.digest,
        };
    }
    if (
      ["ready", "empty", "partial"].includes(scan.product.status) &&
      scan.product.diagnostics.some((d) => d.severity !== "info")
    )
      scan.product.status = "partial";
    warnings.push(
      ...scan.product.diagnostics.map((d) => ({
        code: `product:${d.code}`,
        message: d.message,
        path: d.path,
        line: d.line,
        level: d.severity === "info" ? ("info" as const) : ("warning" as const),
      })),
    );
  }
  return {
    id: randomUUID(),
    projectId: project.id,
    configVersion: project.configVersion,
    config: project.config,
    startedAt,
    completedAt: new Date().toISOString(),
    outcome: warnings.some((w) => w.level !== "info") ? "partial" : "success",
    documents,
    tasks,
    statements,
    relations,
    files: scan.files,
    warnings,
    navigation: scan.navigation,
    effectiveRules: scan.effectiveRules,
    product: scan.product,
  };
}
export const relationLabels = {
  resolved: "已定位",
  outside: "未纳入扫描",
  available: "文件存在，未纳入扫描",
  missing: "引用路径不存在",
  excluded: "已排除",
  example: "示例或占位路径",
  "section-missing": "章节无法唯一定位",
  unavailable: "扫描目标缺失或不可读",
  external: "外部引用（未读取）",
  ambiguous: "任务编号有歧义",
  unsafe: "不安全或越界引用",
};
export class SnapshotStore {
  private snapshots = new Map<string, Snapshot>();
  private attempts = new Map<string, RefreshAttempt>();
  private running = new Map<string, Promise<SnapshotView>>();
  constructor(
    private registry: ProjectRegistry,
    private builder = buildSnapshot,
  ) {}
  view(id: string): SnapshotView {
    const project = this.registry.get(id);
    const snapshot = this.snapshots.get(id) || null;
    return {
      snapshot,
      attempt: this.attempts.get(id) || null,
      configChanged: Boolean(
        snapshot && snapshot.configVersion !== project.configVersion,
      ),
    };
  }
  remove(id: string): void {
    this.snapshots.delete(id);
    this.attempts.delete(id);
  }
  refresh(id: string): Promise<SnapshotView> {
    const existing = this.running.get(id);
    if (existing) return existing;
    const project = this.registry.get(id);
    const startedAt = new Date().toISOString();
    this.attempts.set(id, { state: "scanning", startedAt });
    const operation = (async () => {
      try {
        const snapshot = await this.builder(
          project,
          startedAt,
          this.snapshots.get(id),
        );
        this.registry.get(id);
        this.snapshots.set(id, snapshot);
        this.attempts.set(id, {
          state: snapshot.outcome,
          startedAt,
          completedAt: snapshot.completedAt,
        });
      } catch (error) {
        this.attempts.set(id, {
          state: "failed",
          startedAt,
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.running.delete(id);
      }
      return this.view(id);
    })();
    this.running.set(id, operation);
    return operation;
  }
  document(id: string, documentId: string, snapshotId: string | undefined) {
    const snapshot = this.view(id).snapshot;
    if (!snapshot || snapshot.id !== snapshotId)
      throw new AppError("快照已变化，请重新加载当前快照", 409);
    const document = snapshot.documents.find((d) => d.id === documentId);
    if (!document) throw new AppError("当前快照未收录此文档", 404);
    return { snapshotId: snapshot.id, document };
  }
}
