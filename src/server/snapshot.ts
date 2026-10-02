import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Project,
  Relation,
  Snapshot,
  SnapshotView,
  RefreshAttempt,
  Warning,
} from "../shared/types.js";
import { AppError, within } from "./config.js";
import { scanFiles } from "./scanner.js";
import {
  anchor,
  parseInput,
  stableId,
  stateKey,
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
  const documents = parsed.map((p) => p.document);
  const tasks = parsed.flatMap((p) => (p.task ? [p.task] : []));
  const statements = parsed.flatMap((p) => p.statements);
  const warnings: Warning[] = [
    ...scan.warnings,
    ...parsed.flatMap((p) => p.warnings),
  ];
  const byPath = new Map(
    documents.map((d) => [
      process.platform === "win32" ? d.path.toLowerCase() : d.path,
      d,
    ]),
  );
  const relations: Relation[] = [];
  function resolve(ref: PendingReference, from: string): Relation {
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
      const matches = tasks.filter((t) => t.number === ref.target);
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
    const doc = byPath.get(
      process.platform === "win32" ? resolved.toLowerCase() : resolved,
    );
    if (!doc) {
      const unavailable = scan.files.some(
        (f) =>
          f.path === resolved &&
          ["missing", "error", "skipped"].includes(f.status),
      );
      return {
        ...base,
        section,
        targetPath: resolved,
        state: unavailable ? "unavailable" : "outside",
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
        !tasks.some((t) => t.number === ref.target) &&
        !/^(?:TASK-\d+|\d{8}-\d{3})$/.test(ref.target)
      )
        continue;
      const key = JSON.stringify([
        ref.method,
        ref.target,
        ref.section,
        ref.source.line,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      const relation = resolve(ref, item.task?.id || item.document.id);
      relations.push(relation);
      if (!["resolved", "external"].includes(relation.state))
        warnings.push({
          code: `reference-${relation.state}`,
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
    const key = task.number || task.id;
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
    const key = statement.taskNumber || "项目状态";
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
  };
}
export const relationLabels = {
  resolved: "已定位",
  outside: "未纳入扫描",
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
