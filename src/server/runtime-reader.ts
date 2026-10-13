import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { parseDocument } from "yaml";
import { AppError, assertNoLinks, safePattern, within } from "./config.js";
import {
  runtimeModules,
  type RuntimeTrust,
  type RuntimeView,
  type RuntimeTask,
  type RuntimeDetail,
} from "../shared/runtime-types.js";
import type { Project, Task } from "../shared/types.js";
import { stepFromTask } from "../shared/runtime-step.js";
import { stableId } from "./parser.js";

const positive = (name: string, fallback: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};
export const runtimeBudgets = {
  timeoutMs: positive("TRACELENS_QUERY_TIMEOUT_MS", 15000, 120000),
  outputBytes: positive(
    "TRACELENS_QUERY_OUTPUT_BYTES",
    16 * 1024 * 1024,
    64 * 1024 * 1024,
  ),
  snapshotBytes: positive(
    "TRACELENS_TASK_VIEW_BYTES",
    16 * 1024 * 1024,
    64 * 1024 * 1024,
  ),
  sourceBytes: positive(
    "TRACELENS_SOURCE_BYTES",
    2 * 1024 * 1024,
    16 * 1024 * 1024,
  ),
  concurrency: positive("TRACELENS_QUERY_CONCURRENCY", 2, 8),
  batchMs: positive("TRACELENS_QUERY_BATCH_MS", 60000, 300000),
  pages: positive("TRACELENS_QUERY_PAGES", 100, 1000),
  pageSize: positive("TRACELENS_QUERY_PAGE_SIZE", 100, 100),
};
const nonempty = z.string().min(1);
const integer = z.number().int().nonnegative();
const lifecycle = z.enum(["draft", "active", "paused", "closed", "ambiguous"]);
const stepSchema = z.object({ id: nonempty, state: nonempty }).passthrough();
const taskSchema = z
  .object({
    task_id: nonempty,
    lifecycle,
    steps: z.array(stepSchema).optional(),
  })
  .passthrough();
const baseSchema = z
  .object({
    kind: z.literal("task-query/v1"),
    status: z.literal("available"),
    detail: z.enum(["summary", "task", "step"]),
    workflow_home: nonempty,
    view_revision: nonempty,
    issues: z.array(z.unknown()),
    task_count: integer,
    lifecycle_counts: z.record(z.string(), integer),
    selection: z
      .object({
        requested_task_ref: nonempty.nullable(),
        task_id: nonempty.nullable(),
        status: z.enum(["resolved", "unresolved"]),
      })
      .passthrough(),
  })
  .passthrough();
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const signature = (s: NonNullable<Awaited<ReturnType<typeof stat>>>) =>
  `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
export async function stableRead(
  filename: string,
  budget: number,
): Promise<{ bytes: Buffer; mtime: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await assertNoLinks(filename);
    const before = await stat(filename);
    if (!before.isFile()) throw new Error("not-regular-file");
    if (before.size > budget) throw new Error("read-budget-exceeded");
    // Read a bounded buffer, including one sentinel byte, rather than trusting a racing stat size.
    const { open } = await import("node:fs/promises");
    const handle = await open(filename, "r");
    let bytes: Buffer;
    try {
      const data = Buffer.alloc(Math.min(before.size + 1, budget + 1));
      let offset = 0;
      while (offset < data.length) {
        const result = await handle.read(
          data,
          offset,
          data.length - offset,
          null,
        );
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      bytes = data.subarray(0, offset);
    } finally {
      await handle.close();
    }
    const after = await stat(filename);
    await assertNoLinks(filename);
    if (bytes.length > budget) throw new Error("read-budget-exceeded");
    if (signature(before) === signature(after) && bytes.length === before.size)
      return { bytes, mtime: before.mtime.toISOString() };
  }
  throw new Error("SOURCE_CHANGED");
}
export async function runtimeHashes(
  directory: string,
): Promise<Record<string, string>> {
  if (!path.isAbsolute(directory))
    throw new AppError("可信来源必须是本机绝对目录");
  const hashes: Record<string, string> = {};
  for (const module of runtimeModules)
    hashes[module] = hash(
      (await stableRead(path.join(directory, module), 4 * 1024 * 1024)).bytes,
    );
  return hashes;
}
export const trustSchema = z.object({
  sourceDirectory: nonempty,
  selectedAt: nonempty,
  workflowHome: nonempty,
  moduleHashes: z.object(
    Object.fromEntries(
      runtimeModules.map((m) => [m, z.string().regex(/^[a-f0-9]{64}$/)]),
    ),
  ),
});
export function normalizedHome(root: string, home: string): string {
  const absolute = path.resolve(root, home);
  const relative = path.relative(root, absolute).replace(/\\/g, "/");
  if (
    !within(root, absolute) ||
    !safePattern(relative) ||
    /[*?{\[\]]/.test(relative)
  )
    throw new Error("workflow-home-outside-context");
  return relative;
}
export async function effectiveHome(project: Project): Promise<string> {
  if (project.runtimeTrust)
    return normalizedHome(project.root, project.runtimeTrust.workflowHome);
  try {
    const { bytes } = await stableRead(
      path.join(project.root, ".workflow-system/PROJECT_PROFILE.yaml"),
      1024 * 1024,
    );
    const doc = parseDocument(bytes.toString("utf8"));
    if (doc.errors.length) throw new Error("profile-invalid");
    const home =
      doc.getIn(["paths", "workflow_home"]) ?? doc.get("workflow_home");
    if (typeof home === "string") return normalizedHome(project.root, home);
  } catch {
    /* Default context remains explicit even when profile cannot be used. */
  }
  return "docs/workflow";
}
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>, deadline: number): Promise<T> {
  if (Date.now() >= deadline) throw new Error("query-batch-budget-exceeded");
  if (active >= runtimeBudgets.concurrency)
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(
        () => {
          const index = waiting.indexOf(resume);
          if (index >= 0) waiting.splice(index, 1);
          reject(new Error("query-queue-budget-exceeded"));
        },
        Math.max(1, deadline - Date.now()),
      );
      waiting.push(resume);
    });
  else active++;
  try {
    if (Date.now() >= deadline) throw new Error("query-batch-budget-exceeded");
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
async function trusted(project: Project): Promise<void> {
  if (!project.runtimeTrust) throw new Error("runtime-untrusted");
  await assertNoLinks(project.root);
  let installed: Record<string, string>;
  try {
    installed = await runtimeHashes(
      path.join(project.root, ".workflow-system/runtime/support"),
    );
  } catch (error) {
    throw new Error(`runtime-incomplete: ${String(error)}`);
  }
  if (
    runtimeModules.some(
      (m) => installed[m] !== project.runtimeTrust!.moduleHashes[m],
    )
  )
    throw new Error("runtime-bytes-changed");
}
export async function queryRuntime(
  project: Project,
  command: "task-status" | "read",
  request: Record<string, unknown>,
  deadline = Date.now() + runtimeBudgets.batchMs,
): Promise<unknown> {
  return slot(async () => {
    await trusted(project);
    if (Date.now() >= deadline) throw new Error("query-batch-budget-exceeded");
    const result = await new Promise<unknown>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(
            project.root,
            ".workflow-system/runtime/support/assistance.mjs",
          ),
          command,
          "--root",
          project.root,
        ],
        {
          cwd: project.root,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const chunks: Buffer[] = [],
        errors: Buffer[] = [];
      let size = 0,
        failure = "";
      const stop = (reason: string) => {
        failure ||= reason;
        child.kill();
      };
      const remaining = deadline - Date.now();
      const timer = setTimeout(
        () =>
          stop(
            remaining <= runtimeBudgets.timeoutMs
              ? "query-batch-budget-exceeded"
              : "query-timeout",
          ),
        Math.max(1, Math.min(remaining, runtimeBudgets.timeoutMs)),
      );
      const take = (destination: Buffer[]) => (data: Buffer) => {
        size += data.length;
        if (size > runtimeBudgets.outputBytes)
          stop("query-output-budget-exceeded");
        else destination.push(data);
      };
      child.stdout.on("data", take(chunks));
      child.stderr.on("data", take(errors));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure) return reject(new Error(failure));
        if (errors.length)
          return reject(
            new Error(
              `query-stderr: ${Buffer.concat(errors).toString("utf8").slice(0, 1000)}`,
            ),
          );
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (code !== 0 || value.status === "unavailable")
            return reject(
              new Error(
                `${value.code || "query-failed"}: ${value.message || code}`,
              ),
            );
          resolve(value);
        } catch {
          reject(new Error("query-invalid-json"));
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(request));
    });
    if (Date.now() >= deadline) throw new Error("query-batch-budget-exceeded");
    await trusted(project); // Detect observed module changes across the call; no claim of atomic execution.
    if (Date.now() >= deadline) throw new Error("query-batch-budget-exceeded");
    return result;
  }, deadline);
}
export function validateQuery(
  value: unknown,
  detail: "summary" | "task" | "step",
  home: string,
  taskId?: string,
  stepId?: string,
) {
  const parsed = baseSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `query-contract-incompatible: ${parsed.error.message.slice(0, 500)}; 请更新配套版本`,
    );
  const q = parsed.data;
  if (q.detail !== detail || q.workflow_home !== home)
    throw new Error("query-context-mismatch");
  if (
    q.selection.status === "resolved" &&
    (!q.selection.task_id || (taskId && q.selection.task_id !== taskId))
  )
    throw new Error("query-identity-mismatch");
  if (taskId && q.selection.requested_task_ref !== taskId)
    throw new Error("query-selector-mismatch");
  if (detail === "summary") {
    const rows = z.array(taskSchema).parse(q.tasks);
    const p = z
      .object({
        total: integer,
        offset: integer,
        limit: z.number().int().min(1).max(100),
        next_offset: integer.nullable(),
        view_revision: z.literal(q.view_revision),
        next_request: z.unknown(),
      })
      .parse(q.pagination);
    if (
      p.total !== q.task_count ||
      rows.length > p.limit ||
      p.offset + rows.length > p.total ||
      new Set(rows.map((t) => t.task_id)).size !== rows.length
    )
      throw new Error("invalid-pagination");
    for (const row of rows) {
      z.object({
        detail: z.literal("task"),
        workflow_home: z.literal(home),
        task_ref: z.literal(row.task_id),
      })
        .passthrough()
        .parse(row.detail_request);
      if (row.current_step != null) stepSchema.parse(row.current_step);
    }
    if (p.next_offset === null) {
      if (p.next_request !== null || p.offset + rows.length !== p.total)
        throw new Error("incomplete-pagination");
    } else {
      const next = z
        .object({
          detail: z.literal("summary"),
          workflow_home: z.literal(home),
          expected_view_revision: z.literal(q.view_revision),
          offset: integer,
          limit: z.number().int().min(1).max(100),
        })
        .passthrough()
        .parse(p.next_request);
      if (
        !rows.length ||
        next.offset !== p.next_offset ||
        next.offset !== p.offset + rows.length
      )
        throw new Error("invalid-pagination-continuation");
    }
  }
  if (detail !== "summary") {
    const task = q.task === null ? null : taskSchema.parse(q.task);
    if (
      (q.selection.status === "resolved") !== Boolean(task) ||
      (task && task.task_id !== q.selection.task_id)
    )
      throw new Error("query-identity-mismatch");
    if (detail === "task" && task && !Array.isArray(task.steps))
      throw new Error("query-task-steps-missing");
    if (detail === "step") {
      if (
        q.selection.requested_step_id !== stepId ||
        !["resolved", "unresolved"].includes(String(q.selection.step_status))
      )
        throw new Error("query-step-selector-mismatch");
      const step = q.step === null ? null : stepSchema.parse(q.step);
      if (
        (q.selection.step_status === "resolved") !== Boolean(step) ||
        (step && step.id !== stepId)
      )
        throw new Error("query-step-identity-mismatch");
    }
  }
  return q;
}
const key = (project: Project, home: string) =>
  JSON.stringify([project.id, project.root, project.configVersion, home]);
export class RuntimeReader {
  constructor(private isCurrent: (project: Project) => boolean = () => true) {}
  private assertCurrent(project: Project) {
    if (!this.isCurrent(project)) throw new Error("runtime-context-obsolete");
  }
  private successful = new Map<string, RuntimeView>();
  private details = new Map<string, RuntimeDetail>();
  private detailRunning = new Map<string, Promise<RuntimeDetail>>();
  private sourceRefs = new Map<string, Set<string>>();
  private batches = new Map<string, string>();
  private generations = new Map<string, number>();
  private pageRunning = new Map<string, Promise<RuntimeView>>();
  remove(projectId: string) {
    this.generations.set(projectId, (this.generations.get(projectId) || 0) + 1);
    for (const k of this.successful.keys())
      if (JSON.parse(k)[0] === projectId) this.successful.delete(k);
    for (const k of this.details.keys())
      if (JSON.parse(k)[0] === projectId) this.details.delete(k);
    for (const k of this.batches.keys())
      if (JSON.parse(k)[0] === projectId) {
        this.sourceRefs.delete(this.batches.get(k)!);
        this.batches.delete(k);
      }
  }
  async readSource(
    project: Project,
    view: RuntimeView,
    ref: string,
    allowedProductRefs: string[],
  ) {
    if (
      !safePattern(ref) ||
      /[*?{\[\]]/.test(ref) ||
      /(^|\/)\.git(\/|$)/.test(ref)
    )
      throw new AppError("不安全的来源路径");
    const allowed = new Set([
      ...allowedProductRefs,
      ...(this.sourceRefs.get(view.batchId) || []),
    ]);
    const collect = (value: unknown, name = "") => {
      if (
        typeof value === "string" &&
        (name === "ref" || name.endsWith("_ref")) &&
        safePattern(value)
      )
        allowed.add(value);
      else if (Array.isArray(value)) value.forEach((v) => collect(v, name));
      else if (value && typeof value === "object")
        Object.entries(value).forEach(([k, v]) => collect(v, k));
    };
    collect(view.tasks);
    if (!allowed.has(ref))
      throw new AppError("来源不在本批任务引用或产品明确来源中", 403);
    try {
      if (view.source !== "runtime-query" || !project.runtimeTrust) {
        const file = await stableRead(
          path.join(project.root, ref),
          runtimeBudgets.sourceBytes,
        );
        return {
          ref,
          raw: file.bytes.toString("utf8"),
          digest: hash(file.bytes),
          bytes: file.bytes.length,
          source: "host-file",
          readAt: new Date().toISOString(),
        };
      }
      const buffers: Buffer[] = [];
      const started = Date.now();
      let offset = 0,
        size = -1,
        digest: string | undefined;
      for (
        let pages = 0;
        pages < Math.ceil(runtimeBudgets.sourceBytes / 65536) + 1;
        pages++
      ) {
        if (Date.now() - started > runtimeBudgets.batchMs)
          throw new Error("source-batch-budget-exceeded");
        const q = z
          .object({
            status: z.literal("read"),
            ref: nonempty,
            size: integer,
            offset: integer,
            next_offset: integer.nullable(),
            encoding: z.literal("base64"),
            data: z.string(),
            actual_sha256: z.string().optional(),
          })
          .passthrough()
          .parse(
            await queryRuntime(
              project,
              "read",
              {
                ref,
                workflow_home: view.workflowHome,
                offset,
                max_bytes: 65536,
              },
              started + runtimeBudgets.batchMs,
            ),
          );
        if (
          q.ref !== ref ||
          q.offset !== offset ||
          q.size > runtimeBudgets.sourceBytes ||
          (size !== -1 && q.size !== size) ||
          (digest && q.actual_sha256 !== digest)
        )
          throw new Error("source-changed-or-over-budget");
        size = q.size;
        digest ||= q.actual_sha256;
        if (
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            q.data,
          )
        )
          throw new Error("source-invalid-base64");
        const bytes = Buffer.from(q.data, "base64");
        buffers.push(bytes);
        offset += bytes.length;
        if (q.next_offset === null) {
          if (offset !== size) throw new Error("source-incomplete");
          const full = Buffer.concat(buffers);
          if (digest && hash(full) !== digest)
            throw new Error("source-digest-mismatch");
          return {
            ref,
            raw: full.toString("utf8"),
            digest: hash(full),
            bytes: full.length,
            source: "runtime-read",
            readAt: new Date().toISOString(),
          };
        }
        if (!bytes.length || q.next_offset !== offset)
          throw new Error("source-invalid-pagination");
      }
      throw new Error("source-page-budget-exceeded");
    } catch (error) {
      return { ref, error: String(error) };
    }
  }
  async refresh(
    project: Project,
    deadline = Date.now() + runtimeBudgets.batchMs,
  ): Promise<RuntimeView> {
    this.assertCurrent(project);
    const home = await effectiveHome(project);
    this.assertCurrent(project);
    const generation = (this.generations.get(project.id) || 0) + 1;
    this.generations.set(project.id, generation);
    const readAt = new Date().toISOString(),
      batchId = randomUUID(),
      started = Date.now();
    const context = key(project, home);
    // Keep the last successful same-config memory view, but bound detail/reference caches.
    for (const k of this.details.keys())
      if (JSON.parse(k)[0] === project.id) this.details.delete(k);
    for (const k of this.batches.keys())
      if (JSON.parse(k)[0] === project.id) {
        this.sourceRefs.delete(this.batches.get(k)!);
        this.batches.delete(k);
      }
    for (const k of this.successful.keys())
      if (JSON.parse(k)[0] === project.id && k !== context)
        this.successful.delete(k);
    this.batches.set(context, batchId);
    const result: RuntimeView = {
      source: "unavailable",
      workflowHome: home,
      viewRevision: null,
      readAt,
      freshness: "stale-or-unknown",
      complete: false,
      total: null,
      tasks: [],
      issues: [],
      diagnostics: [],
      batchId,
    };
    try {
      for (let retry = 0; retry < 2; retry++) {
        const tasks: RuntimeTask[] = [];
        let revision = "",
          offset = 0;
        try {
          for (let page = 0; page < 1; page++) {
            if (Date.now() >= deadline)
              throw new Error("query-batch-budget-exceeded");
            const request = {
              detail: "summary",
              workflow_home: home,
              offset,
              limit: runtimeBudgets.pageSize,
              ...(revision ? { expected_view_revision: revision } : {}),
            };
            const q = validateQuery(
              await queryRuntime(project, "task-status", request, deadline),
              "summary",
              home,
            );
            if (Date.now() >= deadline)
              throw new Error("query-batch-budget-exceeded");
            if (revision && q.view_revision !== revision)
              throw new Error("QUERY_VIEW_CHANGED");
            revision = q.view_revision;
            const rows = z.array(taskSchema).parse(q.tasks) as RuntimeTask[];
            for (const row of rows) {
              const r = z
                .object({
                  detail: z.literal("task"),
                  workflow_home: z.literal(home),
                  task_ref: z.literal(row.task_id),
                })
                .passthrough()
                .parse(row.detail_request);
              if (!r) throw new Error("invalid-detail-request");
              if (tasks.some((t) => t.task_id === row.task_id))
                throw new Error("duplicate-task-id");
              if (row.current_step != null) stepSchema.parse(row.current_step);
              tasks.push(row);
            }
            const p = z
              .object({
                total: integer,
                offset: integer,
                limit: z.number().int().min(1).max(100),
                next_offset: integer.nullable(),
                view_revision: z.literal(revision),
                next_request: z.unknown(),
              })
              .parse(q.pagination);
            if (p.offset !== offset || tasks.length > p.total)
              throw new Error("invalid-pagination");
            Object.assign(result, {
              source: "runtime-query",
              freshness: "queried",
              viewRevision: revision,
              tasks: [...tasks],
              issues: [
                ...q.issues,
                ...(Array.isArray(q.unassociated_records)
                  ? q.unassociated_records
                  : []),
              ],
              queryMetadata: Object.fromEntries(
                Object.entries(q).filter(
                  ([name]) => !["tasks", "pagination"].includes(name),
                ),
              ),
              total: p.total,
              currentTaskId:
                typeof q.current_task_id === "string"
                  ? q.current_task_id
                  : null,
              sourceRevision:
                typeof q.source_revision === "string"
                  ? q.source_revision
                  : undefined,
            });
            if (p.next_offset === null) {
              if (p.next_request !== null || tasks.length !== p.total)
                throw new Error("incomplete-pagination");
              result.complete = true;
              if (
                this.isCurrent(project) &&
                this.generations.get(project.id) === generation
              )
                this.successful.set(context, structuredClone(result));
              return result;
            }
            const next = z
              .object({
                detail: z.literal("summary"),
                workflow_home: z.literal(home),
                expected_view_revision: z.literal(revision),
                offset: integer,
                limit: z.number().int().min(1).max(100),
              })
              .passthrough()
              .parse(p.next_request);
            if (
              next.offset !== p.next_offset ||
              next.offset <= offset ||
              next.offset !== tasks.length
            )
              throw new Error("invalid-pagination-continuation");
            offset = next.offset;
            result.nextRequest = next;
            result.pagesRead = 1;
            if (
              this.isCurrent(project) &&
              this.generations.get(project.id) === generation
            )
              this.successful.set(context, structuredClone(result));
            return result;
          }
          throw new Error("query-page-budget-exceeded");
        } catch (error) {
          if (retry === 0 && String(error).includes("QUERY_VIEW_CHANGED"))
            continue;
          throw error;
        }
      }
    } catch (error) {
      result.diagnostics.push(String(error));
    }
    this.assertCurrent(project);
    // A failed batch is discarded as a whole. Never mix live pages with old detail.
    result.tasks = [];
    result.source = "unavailable";
    result.viewRevision = null;
    result.total = null;
    result.freshness = "stale-or-unknown";
    result.complete = false;
    result.nextRequest = undefined;
    try {
      const file = await stableRead(
        path.join(project.root, ".workflow-system/records/task-view.json"),
        runtimeBudgets.snapshotBytes,
      );
      const view = z
        .object({
          kind: z.literal("task-view/v1"),
          workflow_home: z.literal(home),
          source_revision: nonempty,
          view_revision: nonempty,
          tasks: z.array(taskSchema.extend({ steps: z.array(stepSchema) })),
          issues: z.array(z.unknown()),
          unassociated_records: z.array(z.unknown()),
          state_completeness: nonempty,
          current_task_id: nonempty.nullable(),
        })
        .passthrough()
        .parse(JSON.parse(file.bytes.toString("utf8")));
      const ids = new Set(view.tasks.map((t) => t.task_id));
      if (ids.size !== view.tasks.length)
        throw new Error("snapshot-identity-conflict");
      let currentTaskId = view.current_task_id;
      const focus =
        view.current_task == null
          ? null
          : z.object({ task_id: nonempty }).safeParse(view.current_task);
      if (
        (currentTaskId && !ids.has(currentTaskId)) ||
        (focus && (!focus.success || focus.data.task_id !== currentTaskId))
      ) {
        currentTaskId = null;
        result.diagnostics.push(
          "snapshot-current-task-conflict；焦点不可用，已识别任务列表保留",
        );
      }
      Object.assign(result, {
        source: "file-snapshot",
        freshness: "stale-or-unknown",
        tasks: view.tasks,
        issues: [...view.issues, ...view.unassociated_records],
        viewRevision: view.view_revision,
        sourceRevision: view.source_revision,
        total: view.tasks.length,
        complete: true,
        fileMtime: file.mtime,
        currentTaskId,
      });
      result.diagnostics.push(
        `快照关联完整性：${view.state_completeness}；生成时间未提供`,
      );
      return result;
    } catch (error) {
      result.diagnostics.push(`file-snapshot: ${String(error)}`);
    }
    const memory = this.successful.get(context);
    if (memory)
      return {
        ...structuredClone(memory),
        source: "memory-snapshot",
        freshness: "stale-or-unknown",
        queryReadAt: memory.readAt,
        reuseAt: readAt,
        batchId,
        nextRequest: undefined,
        diagnostics: [
          ...result.diagnostics,
          ...(!memory.complete
            ? ["内存降级批次未读完；刷新成功后才能继续分页"]
            : []),
        ],
      };
    return result;
  }
  more(project: Project, view: RuntimeView): Promise<RuntimeView> {
    const deadline = Date.now() + runtimeBudgets.batchMs;
    const context = key(project, view.workflowHome),
      cacheKey = `${context}:${view.batchId}:${view.tasks.length}`;
    const running = this.pageRunning.get(cacheKey);
    if (running) return running;
    const operation = (async () => {
      this.assertCurrent(project);
      if (view.source !== "runtime-query" || !view.nextRequest || view.complete)
        return view;
      if ((view.pagesRead || 1) >= runtimeBudgets.pages)
        return {
          ...view,
          diagnostics: [
            ...view.diagnostics,
            "query-page-budget-exceeded；已读列表保留，不继续查询",
          ],
        };
      try {
        const q = validateQuery(
          await queryRuntime(
            project,
            "task-status",
            view.nextRequest,
            deadline,
          ),
          "summary",
          view.workflowHome,
        );
        if (Date.now() >= deadline)
          throw new Error("query-batch-budget-exceeded");
        if (q.view_revision !== view.viewRevision)
          throw new Error("QUERY_VIEW_CHANGED");
        const p = q.pagination as {
          total: number;
          offset: number;
          next_offset: number | null;
          next_request: Record<string, unknown> | null;
        };
        const rows = q.tasks as RuntimeTask[];
        if (
          p.offset !== view.tasks.length ||
          p.total !== view.total ||
          rows.some((r) => view.tasks.some((t) => t.task_id === r.task_id))
        )
          throw new Error("invalid-pagination-continuation");
        const next = {
          ...view,
          tasks: [...view.tasks, ...rows],
          complete: p.next_offset === null,
          nextRequest: p.next_request || undefined,
          pagesRead: (view.pagesRead || 1) + 1,
        };
        if (
          this.isCurrent(project) &&
          this.batches.get(context) === view.batchId
        )
          this.successful.set(context, structuredClone(next));
        return next;
      } catch (error) {
        // No append across versions. One explicit continuation may restart once.
        if (String(error).includes("QUERY_VIEW_CHANGED")) {
          const restarted = await this.refresh(project, deadline);
          restarted.diagnostics.push(
            "续页时版本变化；已有界重读首批，未混合旧页",
          );
          return restarted;
        }
        return {
          ...view,
          diagnostics: [...view.diagnostics, `续页暂不可用：${String(error)}`],
        };
      }
    })().finally(() => this.pageRunning.delete(cacheKey));
    this.pageRunning.set(cacheKey, operation);
    return operation;
  }
  detail(
    project: Project,
    view: RuntimeView,
    taskId: string,
    stepId?: string,
  ): Promise<RuntimeDetail> {
    this.assertCurrent(project);
    const cacheKey = JSON.stringify([
      project.id,
      project.root,
      project.configVersion,
      view.batchId,
      taskId,
      stepId ?? null,
    ]);
    const cached = this.details.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    if (stepId) {
      const taskKey = JSON.stringify([
        project.id,
        project.root,
        project.configVersion,
        view.batchId,
        taskId,
        null,
      ]);
      const storedStep = stepFromTask(this.details.get(taskKey), stepId);
      if (storedStep) return Promise.resolve(storedStep);
    }
    const running = this.detailRunning.get(cacheKey);
    if (running) return running;
    const operation = this.loadDetail(project, view, taskId, stepId)
      .then((result) => {
        if (
          this.isCurrent(project) &&
          result.status === "available" &&
          this.batches.get(key(project, view.workflowHome)) === view.batchId
        ) {
          this.details.set(cacheKey, result);
          const refs = this.sourceRefs.get(view.batchId) || new Set<string>();
          const collect = (value: unknown, name = "") => {
            if (
              typeof value === "string" &&
              (name === "ref" || name.endsWith("_ref")) &&
              safePattern(value)
            )
              refs.add(value);
            else if (Array.isArray(value))
              value.forEach((v) => collect(v, name));
            else if (value && typeof value === "object")
              Object.entries(value).forEach(([k, v]) => collect(v, k));
          };
          collect(result);
          this.sourceRefs.set(view.batchId, refs);
          const memory = this.successful.get(key(project, view.workflowHome));
          if (!stepId && result.task && memory?.batchId === view.batchId) {
            memory.tasks = memory.tasks.map((t) =>
              t.task_id === taskId ? result.task! : t,
            );
          }
        }
        return result;
      })
      .finally(() => this.detailRunning.delete(cacheKey));
    this.detailRunning.set(cacheKey, operation);
    return operation;
  }
  private async loadDetail(
    project: Project,
    view: RuntimeView,
    taskId: string,
    stepId?: string,
  ): Promise<RuntimeDetail> {
    const result: RuntimeDetail = {
      status: "unavailable",
      viewRevision: view.viewRevision,
      source: view.source,
    };
    try {
      const task = view.tasks.find((t) => t.task_id === taskId);
      if (!task) throw new Error("task-not-in-current-batch");
      if (view.source !== "runtime-query") {
        if (!task.steps) throw new Error("snapshot-detail-not-cached");
        return {
          ...result,
          status: "available",
          task,
          ...(stepId
            ? { step: task.steps.find((s) => s.id === stepId) ?? null }
            : {}),
        };
      }
      const request = {
        detail: stepId ? "step" : "task",
        task_ref: taskId,
        workflow_home: view.workflowHome,
        expected_view_revision: view.viewRevision,
        ...(stepId ? { step_id: stepId } : {}),
      };
      const q = validateQuery(
        await queryRuntime(project, "task-status", request),
        stepId ? "step" : "task",
        view.workflowHome,
        taskId,
        stepId,
      );
      if (q.view_revision !== view.viewRevision)
        throw new Error("QUERY_VIEW_CHANGED；请显式刷新，当前列表仍保留原版本");
      return {
        ...result,
        status: "available",
        task: q.task as RuntimeTask | null,
        ...(stepId
          ? { step: q.step as RuntimeDetail["step"], review: q.review }
          : {}),
      };
    } catch (error) {
      return { ...result, error: String(error) };
    }
  }
}
export function runtimeTasks(project: Project, view: RuntimeView): Task[] {
  return view.tasks.map((row) => {
    const source = {
      documentId: "runtime",
      path: ".workflow-system/records/task-view.json",
      line: 1,
      section: null,
      digest: view.viewRevision || "",
    };
    return {
      id: stableId(project.id, `runtime:${row.task_id}`),
      realTaskId: row.task_id,
      number: typeof row.display_id === "string" ? row.display_id : row.task_id,
      title: typeof row.title === "string" ? row.title : row.task_id,
      runtimeLifecycle: row.lifecycle,
      runtimeBatchId: view.batchId,
      current: row.task_id === view.currentTaskId,
      source,
      statuses: [{ text: row.lifecycle, checked: null, source }],
      goals: [],
      steps: [],
      checks: [],
      issues: [],
    };
  });
}
