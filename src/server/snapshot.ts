import path from "node:path";
import { productStructureIssue } from "../shared/product-health.js";
import { randomUUID, createHash } from "node:crypto";
import {
  buildOverviewData,
  type OverviewSnapshot,
} from "../shared/overview-data.js";
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
import {
  blockedPath,
  matches,
  scanFiles,
  type ScanOptions,
} from "./scanner.js";
import { FileIndex } from "./file-index.js";
import { SnapshotCache } from "./snapshot-cache.js";
import { treeFingerprint } from "./tree-fingerprint.js";
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
import { RuntimeReader, runtimeTasks } from "./runtime-reader.js";
import { readTaskTimes } from "./task-times.js";
import type { TaskTimes } from "../shared/runtime-types.js";
const runtimeReader = new RuntimeReader();
interface BuildContext {
  reader: RuntimeReader;
  isCurrent: () => boolean;
  scan?: ScanOptions;
}

export async function buildSnapshot(
  project: Project,
  startedAt: string,
  previous?: Snapshot,
  runtimeContext: BuildContext = {
    reader: runtimeReader,
    isCurrent: () => true,
  },
): Promise<Snapshot> {
  const started = Date.now();
  const scan = await scanFiles(
    project,
    previous?.navigation,
    false,
    runtimeContext.scan,
  );
  if (!runtimeContext.isCurrent()) throw new AppError("扫描上下文已过期", 409);
  const parsed = scan.inputs.map((input): Parsed => {
    const parse = (): Parsed => {
      try {
        // Explicit SourceRefs may point to code or extensionless UTF-8 text.
        // Preserve captured bytes without interpreting them as task documents.
        if (!/\.(md|markdown|ya?ml|json|txt)$/i.test(input.path))
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
            warnings: [],
          };
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
    };
    const result =
      runtimeContext.scan?.index?.memo(
        input,
        `document:${project.id}:${input.kind}:${scan.productPaths?.has(documentPathKey(input.path))}`,
        parse,
      ) || parse();
    result.document = { ...result.document, ...input };
    return result;
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
  const documentTasks = parsed.flatMap((p) => (p.task ? [p.task] : []));
  for (const task of documentTasks)
    task.current = Boolean(
      currentPath &&
      documentPathKey(task.source.path) === documentPathKey(currentPath),
    );
  if (!runtimeContext.isCurrent()) throw new AppError("查询上下文已过期", 409);
  runtimeContext.scan?.progress?.(
    runtimeContext.scan.coreOnly ? "发布需求与报告" : "更新 Task 状态",
  );
  const runtime = runtimeContext.scan?.coreOnly
    ? undefined
    : await runtimeContext.reader.refresh(project);
  const tasks = runtime ? runtimeTasks(project, runtime) : [];
  const isCurrentSource = (filename: string) =>
    Boolean(
      currentPath && documentPathKey(filename) === documentPathKey(currentPath),
    );
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
      const matches = documentTasks.filter(
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
        !documentTasks.some(
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
  for (const task of documentTasks) {
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
      !documentTasks.some((t) => t.source.documentId === s.source.documentId),
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
    buildProductIndex(scan.product, [...tasks, ...documentTasks]);
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
      scan.product.diagnostics.some(productStructureIssue)
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
    phase: runtimeContext.scan?.coreOnly ? "core" : "complete",
    metrics: {
      durationMs: Date.now() - started,
      filesRead: runtimeContext.scan?.index?.stats.read || 0,
      filesReused: runtimeContext.scan?.index?.stats.reused || 0,
      parsed: runtimeContext.scan?.index?.stats.parsed || 0,
      reusedParses: runtimeContext.scan?.index?.stats.reusedParses || 0,
    },
    id: randomUUID(),
    projectId: project.id,
    configVersion: project.configVersion,
    config: project.config,
    startedAt,
    completedAt: new Date().toISOString(),
    outcome: warnings.some((w) => w.level !== "info") ? "partial" : "success",
    documents,
    tasks,
    taskObservations: documentTasks,
    statements,
    relations,
    files: scan.files,
    warnings,
    navigation: scan.navigation,
    effectiveRules: scan.effectiveRules,
    product: scan.product,
    runtime,
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
  private taskTimesCache = new Map<string, Promise<TaskTimes>>();
  private reader: RuntimeReader;
  private cache: SnapshotCache;
  private indexes = new Map<string, { version: number; index: FileIndex }>();
  private restored = new Set<string>();
  private loaded = new Map<string, Promise<void>>();
  private overviewCache = new WeakMap<Snapshot, OverviewSnapshot>();
  private isCurrent(project: Project): boolean {
    try {
      const current = this.registry.get(project.id);
      return (
        current.configVersion === project.configVersion &&
        current.root === project.root
      );
    } catch {
      return false;
    }
  }
  private snapshots = new Map<string, Snapshot>();
  private attempts = new Map<string, RefreshAttempt>();
  private running = new Map<string, Promise<SnapshotView>>();
  constructor(
    private registry: ProjectRegistry,
    private builder = buildSnapshot,
  ) {
    this.reader = new RuntimeReader((project) => this.isCurrent(project));
    this.cache = new SnapshotCache(registry.dataDir);
  }
  async restore(id: string): Promise<void> {
    const project = this.registry.get(id);
    const key = `${id}:${project.configVersion}`;
    let loading = this.loaded.get(key);
    if (!loading) {
      loading = (async () => {
        const cached = await this.cache.load(project);
        if (!cached || !this.isCurrent(project) || this.snapshots.has(id))
          return;
        this.indexes.set(id, {
          version: project.configVersion,
          index: new FileIndex(cached.files),
        });
        if (cached.snapshot) {
          this.snapshots.set(id, cached.snapshot);
          this.restored.add(id);
        }
      })();
      this.loaded.set(key, loading);
    }
    await loading;
  }
  view(id: string): SnapshotView {
    const project = this.registry.get(id);
    const snapshot = this.snapshots.get(id) || null;
    return {
      restored: this.restored.has(id),
      snapshot,
      attempt: this.attempts.get(id) || null,
      configChanged: Boolean(
        snapshot && snapshot.configVersion !== project.configVersion,
      ),
    };
  }
  summary(id: string, knownSnapshotId?: string): SnapshotView {
    const view = this.view(id);
    if (!view.snapshot) return view;
    if (view.snapshot.id === knownSnapshotId)
      return { ...view, snapshot: null, unchanged: true };
    const managed = new Set(
      view.snapshot.product?.items.map((item) => item.source.documentId),
    );
    return {
      ...view,
      snapshot: {
        ...view.snapshot,
        documents: view.snapshot.documents.map((document) =>
          managed.has(document.id)
            ? document
            : { ...document, raw: "", contentOmitted: true },
        ),
        product: view.snapshot.product
          ? {
              ...view.snapshot.product,
              items: view.snapshot.product.items.map((item) =>
                item.usable ? { ...item, rawMetadata: undefined } : item,
              ),
            }
          : undefined,
      },
    };
  }
  overview(id: string, knownRevision?: string): SnapshotView<OverviewSnapshot> {
    const view = this.view(id);
    if (!view.snapshot) return { ...view, snapshot: null };
    const snapshot = view.snapshot;
    let summary = this.overviewCache.get(snapshot);
    if (!summary) {
      const overview = buildOverviewData(snapshot);
      summary = {
        id: snapshot.id,
        projectId: snapshot.projectId,
        configVersion: snapshot.configVersion,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        outcome: snapshot.outcome,
        phase: snapshot.phase,
        revision: createHash("sha256")
          .update(JSON.stringify(overview))
          .digest("hex"),
        overview,
      };
      this.overviewCache.set(snapshot, summary);
    }
    if (knownRevision === summary.revision)
      return {
        ...view,
        snapshot: { ...summary, overview: undefined },
        unchanged: true,
      };
    return { ...view, snapshot: summary };
  }
  status(id: string): SnapshotView {
    const view = this.view(id);
    return { ...view, snapshot: null, unchanged: true };
  }
  async remove(id: string): Promise<void> {
    this.snapshots.delete(id);
    this.attempts.delete(id);
    this.reader.remove(id);
    this.indexes.delete(id);
    this.restored.delete(id);
    for (const key of this.loaded.keys())
      if (key.startsWith(`${id}:`)) this.loaded.delete(key);
    await this.cache.remove(id);
  }
  refresh(id: string): Promise<SnapshotView> {
    const project = this.registry.get(id);
    const runKey = `${id}:${project.configVersion}`;
    const existing = this.running.get(runKey);
    if (existing) return existing;
    const startedAt = new Date().toISOString();
    this.attempts.set(id, { state: "scanning", startedAt });
    const operation = (async () => {
      try {
        if (this.builder === buildSnapshot) await this.restore(id);
        const previous = this.snapshots.get(id);
        const prior = this.indexes.get(id);
        const index =
          prior?.version === project.configVersion
            ? prior.index
            : new FileIndex();
        this.indexes.set(id, { version: project.configVersion, index });
        index.begin();
        const progress: ScanOptions["progress"] = (phase, completed, total) => {
          if (this.isCurrent(project))
            this.attempts.set(id, {
              state: "scanning",
              startedAt,
              phase,
              completed,
              total,
            });
        };
        const checkpoint = async () => {
          await this.cache.save(
            project,
            {
              snapshot: this.snapshots.get(id) || null,
              files: index.entries(),
            },
            () => this.isCurrent(project),
          );
        };
        const staged = this.builder === buildSnapshot;
        const context: BuildContext = {
          reader: this.reader,
          isCurrent: () => this.isCurrent(project),
          ...(staged
            ? {
                scan: {
                  index,
                  batched: true,
                  isCurrent: () => this.isCurrent(project),
                  checkpoint,
                  progress,
                },
              }
            : {}),
        };
        let fingerprint: string | undefined;
        if (
          staged &&
          previous?.phase === "complete" &&
          previous.configVersion === project.configVersion
        ) {
          progress("检查文件变化");
          fingerprint = await treeFingerprint(project, previous);
          if (fingerprint && fingerprint === previous.treeFingerprint) {
            progress("更新 Task 状态");
            const runtime = await this.reader.refresh(project);
            if (!this.isCurrent(project)) return this.view(id);
            const next: Snapshot = {
              ...previous,
              id: randomUUID(),
              startedAt,
              completedAt: new Date().toISOString(),
              runtime,
              tasks: runtimeTasks(project, runtime),
              product: previous.product
                ? structuredClone(previous.product)
                : undefined,
              metrics: {
                durationMs: Date.now() - Date.parse(startedAt),
                filesRead: 0,
                filesReused: index.files.size,
                parsed: 0,
                reusedParses: 0,
              },
            };
            if (next.product)
              buildProductIndex(next.product, [
                ...next.tasks,
                ...(next.taskObservations || []),
              ]);
            this.snapshots.set(id, next);
            this.restored.delete(id);
            await checkpoint();
            this.attempts.set(id, {
              state: next.outcome,
              startedAt,
              completedAt: next.completedAt,
            });
            return this.view(id);
          }
        }
        if (staged && project.config.product?.enabled) {
          const core = await this.builder(project, startedAt, undefined, {
            ...context,
            scan: { ...context.scan, coreOnly: true },
          });
          if (!this.isCurrent(project)) return this.view(id);
          this.snapshots.set(id, core);
          this.restored.delete(id);
          await checkpoint();
          fingerprint ||= await treeFingerprint(project, core);
          // Let the browser retrieve the core view before continuing historical work.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        const snapshot = await this.builder(
          project,
          startedAt,
          previous,
          context,
        );
        const current = this.registry.get(id);
        if (
          current.configVersion !== project.configVersion ||
          current.root !== project.root
        )
          return this.view(id);
        this.snapshots.set(id, snapshot);
        if (
          staged &&
          fingerprint &&
          fingerprint === (await treeFingerprint(project, snapshot))
        )
          snapshot.treeFingerprint = fingerprint;
        this.restored.delete(id);
        if (staged) index.entries(true);
        await checkpoint();
        this.attempts.set(id, {
          state: snapshot.outcome,
          startedAt,
          completedAt: snapshot.completedAt,
        });
      } catch (error) {
        try {
          if (this.registry.get(id).configVersion !== project.configVersion)
            return this.view(id);
        } catch {
          return { snapshot: null, attempt: null, configChanged: false };
        }
        this.attempts.set(id, {
          state: "failed",
          startedAt,
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.running.delete(runKey);
      }
      return this.view(id);
    })();
    this.running.set(runKey, operation);
    return operation;
  }
  async taskDetail(
    id: string,
    snapshotId: string,
    taskId: string,
    stepId?: string,
  ) {
    const project = this.registry.get(id);
    const snapshot = this.view(id).snapshot;
    if (
      !snapshot ||
      snapshot.id !== snapshotId ||
      snapshot.configVersion !== project.configVersion
    )
      throw new AppError("快照或配置已变化，请刷新", 409);
    if (!snapshot.runtime) throw new AppError("任务数据暂不可用", 503);
    const result = await this.reader.detail(
      project,
      snapshot.runtime,
      taskId,
      stepId,
    );
    if (
      this.registry.get(id).configVersion !== project.configVersion ||
      this.view(id).snapshot?.id !== snapshotId
    )
      throw new AppError("请求期间快照已变化", 409);
    return result;
  }
  async taskTimes(
    id: string,
    snapshotId: string,
    taskId: string,
  ): Promise<TaskTimes> {
    const project = this.registry.get(id);
    const snapshot = this.view(id).snapshot;
    if (
      !snapshot ||
      snapshot.id !== snapshotId ||
      snapshot.configVersion !== project.configVersion
    )
      throw new AppError("快照或配置已变化，请刷新", 409);
    if (!snapshot.runtime?.tasks.some((task) => task.task_id === taskId))
      throw new AppError("任务不在当前快照中", 404);
    const cacheKey = JSON.stringify([
      id,
      project.configVersion,
      snapshotId,
      taskId,
    ]);
    let operation = this.taskTimesCache.get(cacheKey);
    if (!operation) {
      operation = (async () => {
        const detail = await this.taskDetail(id, snapshotId, taskId);
        if (detail.status !== "available" || !detail.task)
          throw new AppError(detail.error || "任务详情暂不可用", 503);
        return readTaskTimes(detail.task, (ref) =>
          this.taskSource(id, snapshotId, ref),
        );
      })();
      this.taskTimesCache.set(cacheKey, operation);
      void operation.catch(() => this.taskTimesCache.delete(cacheKey));
      if (this.taskTimesCache.size > 256)
        this.taskTimesCache.delete(this.taskTimesCache.keys().next().value!);
    }
    const result = await operation;
    if (
      this.registry.get(id).configVersion !== project.configVersion ||
      this.view(id).snapshot?.id !== snapshotId
    )
      throw new AppError("读取期间快照已变化", 409);
    return result;
  }
  async moreTasks(id: string, snapshotId: string): Promise<SnapshotView> {
    const project = this.registry.get(id),
      snapshot = this.view(id).snapshot;
    if (
      !snapshot ||
      snapshot.id !== snapshotId ||
      snapshot.configVersion !== project.configVersion ||
      !snapshot.runtime
    )
      throw new AppError("快照或配置已变化，请刷新", 409);
    const runtime = await this.reader.more(project, snapshot.runtime);
    if (
      this.registry.get(id).configVersion !== project.configVersion ||
      this.view(id).snapshot?.id !== snapshotId
    )
      throw new AppError("续读期间上下文已变化", 409);
    const next = {
      ...snapshot,
      id: randomUUID(),
      runtime,
      tasks: runtimeTasks(project, runtime),
      product: snapshot.product ? structuredClone(snapshot.product) : undefined,
    };
    if (next.product) {
      const observations = next.documents
        .filter((d) => !inspectProductEnvelope(d.raw).isProduct)
        .flatMap((d) => {
          try {
            const parsed = parseInput(project.id, d);
            return parsed.task ? [parsed.task] : [];
          } catch {
            return [];
          }
        });
      buildProductIndex(next.product, [...next.tasks, ...observations]);
    }
    this.snapshots.set(id, next);
    await this.cache.save(
      project,
      { snapshot: next, files: this.indexes.get(id)?.index.entries() || [] },
      () => this.isCurrent(project),
    );
    return this.view(id);
  }
  async taskSource(id: string, snapshotId: string, ref: string) {
    const project = this.registry.get(id),
      snapshot = this.view(id).snapshot;
    if (
      !snapshot ||
      snapshot.id !== snapshotId ||
      snapshot.configVersion !== project.configVersion
    )
      throw new AppError("快照或配置已变化", 409);
    if (!snapshot.runtime) throw new AppError("任务数据暂不可用", 503);
    const allowed = (snapshot.product?.sources || []).flatMap((s) =>
      s.reference.kind === "file" &&
      s.readState !== "outside" &&
      s.readState !== "excluded"
        ? [s.reference.path]
        : [],
    );
    const result = await this.reader.readSource(
      project,
      snapshot.runtime,
      ref,
      allowed,
    );
    if (
      this.registry.get(id).configVersion !== project.configVersion ||
      this.view(id).snapshot?.id !== snapshotId
    )
      throw new AppError("读取期间快照已变化", 409);
    return result;
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
