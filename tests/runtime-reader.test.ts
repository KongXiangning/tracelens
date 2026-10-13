import { describe, expect, it, vi } from "vitest";
import * as scanner from "../src/server/scanner.js";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  RuntimeReader,
  runtimeHashes,
  validateQuery,
  stableRead,
  queryRuntime,
  runtimeBudgets,
} from "../src/server/runtime-reader.js";
import { runtimeModules } from "../src/shared/runtime-types.js";
import type { Project } from "../src/shared/types.js";
import { ProjectRegistry } from "../src/server/registry.js";
import { SnapshotStore } from "../src/server/snapshot.js";
import { readTaskTimes } from "../src/server/task-times.js";
import corpus from "./fixtures/task-query-v1.json" with { type: "json" };

const upstream = path.resolve("tests/fixtures/runtime-vn05");
const config = {
  rules: { management: [], requirements: [], design: [], planning: [] },
  excludes: [],
};
async function cli(root: string, request: object) {
  return new Promise<any>((resolve, reject) => {
    const process = spawn(
      globalThis.process.execPath,
      [
        path.join(root, ".workflow-system/runtime/support/assistance.mjs"),
        "task",
        "--root",
        root,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let text = "",
      errors = "";
    process.stdout.on("data", (data) => (text += data));
    process.stderr.on("data", (data) => (errors += data));
    process.on("error", reject);
    process.on("close", (code) => {
      try {
        if (code !== 0) reject(new Error(errors || text));
        else resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    process.stdin.end(JSON.stringify(request));
  });
}
async function fixture() {
  await mkdir(path.resolve("output"), { recursive: true });
  const directory = await mkdtemp(path.resolve("output/tracelens-runtime-"));
  const root = path.join(directory, "copy-a"),
    support = path.join(root, ".workflow-system/runtime/support");
  await mkdir(support, { recursive: true });
  for (const name of runtimeModules)
    await cp(path.join(upstream, name), path.join(support, name));
  const moduleHashes = await runtimeHashes(upstream);
  const project: Project = {
    id: "copy-a",
    root,
    name: "synthetic",
    config,
    configVersion: 1,
    runtimeTrust: {
      sourceDirectory: upstream,
      moduleHashes,
      selectedAt: new Date().toISOString(),
      workflowHome: "docs/workflow",
    },
  };
  return {
    directory,
    root,
    project,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
async function tree(root: string) {
  const result: Record<string, string> = {};
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else
        result[path.relative(root, file)] = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
    }
  }
  await walk(root);
  return result;
}
describe("VN-02 current contract consumer", () => {
  it("optional snapshot focus conflict does not discard the independently valid task list", async () => {
    const f = await fixture();
    try {
      const payload = structuredClone(
        (corpus as any).snapshot_examples[0].file_payload,
      );
      const project = {
        ...f.project,
        runtimeTrust: {
          ...f.project.runtimeTrust!,
          workflowHome: payload.workflow_home,
        },
      };
      await mkdir(path.join(f.root, ".workflow-system/records"), {
        recursive: true,
      });
      const file = path.join(f.root, ".workflow-system/records/task-view.json");
      // Do not execute installed modules in this comparison: the bytes are untrusted.
      project.runtimeTrust.moduleHashes["assistance.mjs"] = "0".repeat(64);
      await writeFile(file, JSON.stringify(payload));
      const reader = new RuntimeReader(),
        recognized = await reader.refresh(project);
      expect(recognized.source).toBe("file-snapshot");
      expect(recognized.tasks).toHaveLength(2);
      expect(recognized.currentTaskId).toBe(payload.current_task_id);
      payload.current_task.task_id = "different-focus-identity";
      await writeFile(file, JSON.stringify(payload));
      const conflict = await reader.refresh(project);
      expect(conflict.source).toBe("file-snapshot");
      expect(conflict.tasks).toEqual(recognized.tasks);
      expect(conflict.currentTaskId).toBeNull();
      expect(conflict.diagnostics.join(" ")).toContain("焦点不可用");
    } finally {
      await f.cleanup();
    }
  });
  it("bounds child concurrency, kills timeouts and output overflow while the event loop remains responsive", async () => {
    const f = await fixture(),
      saved = { ...runtimeBudgets };
    const entry = path.join(
      f.root,
      ".workflow-system/runtime/support/assistance.mjs",
    );
    async function script(raw: string) {
      await writeFile(entry, raw);
      f.project.runtimeTrust!.moduleHashes = await runtimeHashes(
        path.dirname(entry),
      );
    }
    try {
      runtimeBudgets.concurrency = 2;
      await script(
        `import {appendFileSync} from 'node:fs'; const log='probe.log'; appendFileSync(log,JSON.stringify({delta:1,pid:process.pid})+'\\n'); setTimeout(()=>{appendFileSync(log,JSON.stringify({delta:-1,pid:process.pid})+'\\n'); console.log('{}');},300);`,
      );
      let ticks = 0;
      const timer = setInterval(() => ticks++, 20);
      await Promise.all(
        [1, 2, 3, 4].map(() => queryRuntime(f.project, "task-status", {})),
      );
      clearInterval(timer);
      const events = (await readFile(path.join(f.root, "probe.log"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      let peak = 0,
        active = 0;
      for (const event of events) {
        active += event.delta;
        peak = Math.max(peak, active);
      }
      expect(peak).toBeLessThanOrEqual(2);
      expect(peak).toBeGreaterThan(0);
      expect(active).toBe(0);
      expect(ticks).toBeGreaterThan(0);
      runtimeBudgets.timeoutMs = 1000;
      await script(
        `import {writeFileSync} from 'node:fs';writeFileSync('pid.txt',String(process.pid));setTimeout(()=>console.log('{}'),30000);`,
      );
      await expect(queryRuntime(f.project, "task-status", {})).rejects.toThrow(
        "query-timeout",
      );
      const pid = Number(await readFile(path.join(f.root, "pid.txt"), "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
      runtimeBudgets.outputBytes = 1024;
      await script(
        `process.stdout.write('x'.repeat(4096));setTimeout(()=>{},30000);`,
      );
      await expect(queryRuntime(f.project, "task-status", {})).rejects.toThrow(
        "query-output-budget-exceeded",
      );
    } finally {
      Object.assign(runtimeBudgets, saved);
      await f.cleanup();
    }
  }, 10000);
  it("loads subsequent summary pages only on request", async () => {
    const f = await fixture();
    try {
      const cases = (corpus as any).cases;
      const first = cases.find((c: any) => c.id === "summary").response;
      const second = cases.find((c: any) => c.id === "summary-next").response;
      const entry = path.join(
        f.root,
        ".workflow-system/runtime/support/assistance.mjs",
      );
      await writeFile(
        entry,
        `let input='';for await(const chunk of process.stdin)input+=chunk;const r=JSON.parse(input);console.log(JSON.stringify(r.offset?${JSON.stringify(second)}:${JSON.stringify(first)}));`,
      );
      f.project.runtimeTrust!.moduleHashes = await runtimeHashes(
        path.dirname(entry),
      );
      f.project.runtimeTrust!.workflowHome = first.workflow_home;
      const reader = new RuntimeReader(),
        view = await reader.refresh(f.project);
      expect(view.tasks).toHaveLength(1);
      expect(view.total).toBe(2);
      expect(view.complete).toBe(false);
      const page = await reader.more(f.project, view);
      expect(page.tasks).toHaveLength(2);
      expect(page.complete).toBe(true);
      expect(page.viewRevision).toBe(view.viewRevision);
      expect(page.batchId).toBe(view.batchId);
    } finally {
      await f.cleanup();
    }
  });
  it("continues real Runtime pages and restarts the first batch after a normal saved task write", async () => {
    const f = await fixture(),
      saved = runtimeBudgets.pageSize;
    try {
      runtimeBudgets.pageSize = 1;
      await cli(f.root, {
        action: "prepare",
        plan: { title: "First", steps: [] },
      });
      await cli(f.root, {
        action: "prepare",
        plan: { title: "Second", steps: [] },
      });
      const reader = new RuntimeReader(),
        first = await reader.refresh(f.project);
      expect(first.tasks).toHaveLength(1);
      expect(first.total).toBe(2);
      expect(first.complete).toBe(false);
      const second = await reader.more(f.project, first);
      expect(second.tasks).toHaveLength(2);
      expect(second.complete).toBe(true);
      await cli(f.root, {
        action: "prepare",
        plan: { title: "Normal third write", steps: [] },
      });
      const restarted = await reader.more(f.project, first);
      expect(restarted.source).toBe("runtime-query");
      expect(restarted.tasks).toHaveLength(1);
      expect(restarted.total).toBe(3);
      expect(restarted.viewRevision).not.toBe(first.viewRevision);
      expect(restarted.batchId).not.toBe(first.batchId);
      expect(restarted.diagnostics.join(" ")).toContain("有界重读首批");
    } finally {
      runtimeBudgets.pageSize = saved;
      await f.cleanup();
    }
  }, 30000);
  it("marks a readable old file stale after a successful first page, failed continuation and failed bounded restart", async () => {
    const f = await fixture();
    try {
      const saved = await cli(f.root, {
        action: "prepare",
        plan: { title: "Retained old snapshot", steps: [] },
      });
      const fileView = JSON.parse(
        await readFile(
          path.join(f.root, ".workflow-system/records/task-view.json"),
          "utf8",
        ),
      );
      const first = structuredClone(
        (corpus as any).cases.find((c: any) => c.id === "summary").response,
      );
      first.workflow_home = "docs/workflow";
      first.tasks[0].detail_request.workflow_home = "docs/workflow";
      first.pagination.next_request.workflow_home = "docs/workflow";
      const entry = path.join(
        f.root,
        ".workflow-system/runtime/support/assistance.mjs",
      );
      await writeFile(
        entry,
        `import {existsSync,readFileSync,writeFileSync}from'node:fs';const n=existsSync('calls.txt')?Number(readFileSync('calls.txt','utf8')):0;writeFileSync('calls.txt',String(n+1));if(!n)console.log(${JSON.stringify(JSON.stringify(first))});else {console.log(JSON.stringify({status:'unavailable',code:n===1?'QUERY_VIEW_CHANGED':'query-failed'}));process.exitCode=1;}`,
      );
      f.project.runtimeTrust!.moduleHashes = await runtimeHashes(
        path.dirname(entry),
      );
      const reader = new RuntimeReader(),
        live = await reader.refresh(f.project);
      expect(live.freshness).toBe("queried");
      expect(live.complete).toBe(false);
      const fallback = await reader.more(f.project, live);
      expect(fallback).toMatchObject({
        source: "file-snapshot",
        freshness: "stale-or-unknown",
        viewRevision: fileView.view_revision,
        total: 1,
        complete: true,
      });
      expect(fallback.tasks[0].task_id).toBe(saved.task_id);
      expect(fallback.nextRequest).toBeUndefined();
      expect(fallback.fileMtime).toBeTruthy();
      expect(fallback.diagnostics.join(" ")).toContain("query-failed");
    } finally {
      await f.cleanup();
    }
  });
  it("includes queued time in the same batch deadline and never starts expired queued children", async () => {
    const f = await fixture(),
      saved = { ...runtimeBudgets };
    try {
      const first = structuredClone(
        (corpus as any).cases.find((c: any) => c.id === "summary").response,
      );
      first.workflow_home = "docs/workflow";
      first.tasks[0].detail_request.workflow_home = "docs/workflow";
      first.pagination.next_request.workflow_home = "docs/workflow";
      const entry = path.join(
        f.root,
        ".workflow-system/runtime/support/assistance.mjs",
      );
      await writeFile(
        entry,
        `import{appendFileSync}from'node:fs';appendFileSync('started.txt','start\\n');setTimeout(()=>console.log(${JSON.stringify(JSON.stringify(first))}),150);`,
      );
      f.project.runtimeTrust!.moduleHashes = await runtimeHashes(
        path.dirname(entry),
      );
      runtimeBudgets.batchMs = 100;
      runtimeBudgets.concurrency = 1;
      runtimeBudgets.timeoutMs = 5000;
      const reader = new RuntimeReader(),
        results = await Promise.all(
          ["a", "b", "c"].map((id) => reader.refresh({ ...f.project, id })),
        );
      for (const result of results) {
        expect(result.source).toBe("unavailable");
        expect(result.diagnostics.join(" ")).toContain("budget-exceeded");
        expect(result.freshness).toBe("stale-or-unknown");
      }
      expect(
        results.some((r) =>
          r.diagnostics.join(" ").includes("query-queue-budget-exceeded"),
        ),
      ).toBe(true);
      const started = await readFile(
        path.join(f.root, "started.txt"),
        "utf8",
      ).catch(() => "");
      expect(
        started.trim().split("\n").filter(Boolean).length,
      ).toBeLessThanOrEqual(1);
      Object.assign(runtimeBudgets, saved);
      await writeFile(
        entry,
        `console.log(${JSON.stringify(JSON.stringify(first))});`,
      );
      f.project.runtimeTrust!.moduleHashes = await runtimeHashes(
        path.dirname(entry),
      );
      expect((await reader.refresh(f.project)).source).toBe("runtime-query");
    } finally {
      Object.assign(runtimeBudgets, saved);
      await f.cleanup();
    }
  });
  it("accepts additive/optional fields and rejects required/unknown-format variants", () => {
    const cases = (corpus as any).cases;
    for (const name of [
      "summary",
      "unknown-additive-field",
      "optional-fields-absent",
    ]) {
      const c = cases.find((c: any) => c.id === name);
      expect(() =>
        validateQuery(c.response, "summary", c.response.workflow_home),
      ).not.toThrow();
    }
    for (const name of [
      "required-field-error",
      "required-field-absent",
      "unrecognized-kind",
    ]) {
      const c = cases.find((c: any) => c.id === name);
      // Summary rows are checked by refresh, beyond the common envelope validator.
      expect(() =>
        validateQuery(c.response, "summary", c.response.workflow_home),
      ).toThrow();
    }
  });
  it("reads real retained facts without a projection, isolates clone IDs, detects normal writes and preserves bytes", async () => {
    const f = await fixture();
    try {
      const prepared = await cli(f.root, {
        action: "prepare",
        plan: {
          title: "Same title",
          goal: "Synthetic acceptance",
          steps: [{ id: "S1", title: "Not executed" }],
        },
      });
      const taskId = prepared.task_id;
      expect(taskId).toBeTruthy();
      await cli(f.root, {
        action: "adopt",
        task_id: taskId,
        plan_ref: prepared.ref,
        decision_source: "synthetic-test",
        decision_text: "Adopt isolated synthetic plan",
      });
      await cli(f.root, {
        action: "close",
        task_id: taskId,
        remaining_work: ["S1 not executed"],
        decision_source: "synthetic-test",
        decision_text: "Close synthetic task with retained gap",
      });
      await rm(path.join(f.root, ".workflow-system/records/task-view.json"));
      const before = await tree(f.root),
        reader = new RuntimeReader();
      const view = await reader.refresh(f.project);
      expect(view.source).toBe("runtime-query");
      expect(view.tasks[0].task_id).toBe(taskId);
      expect(view.tasks[0].lifecycle).toBe("closed");
      const detail = await reader.detail(f.project, view, taskId);
      expect(detail.status).toBe("available");
      expect(detail.task?.steps?.[0].state).toBe("not-started");
      const step = await reader.detail(f.project, view, taskId, "S1");
      expect(step.step?.id).toBe("S1");
      const source = await reader.readSource(f.project, view, prepared.ref, []);
      expect(source.raw).toContain("Same title");
      const times = await readTaskTimes(detail.task!, (ref) =>
        reader.readSource(f.project, view, ref, []),
      );
      expect(times.createdAt).toBe(JSON.parse(source.raw!).recorded_at);
      expect(times.createdRef).toBe(prepared.ref);
      expect(times.completedRef).toBe(detail.task!.lifecycle_ref);
      expect(times.completedAt).toBeTruthy();
      expect(times.issues).toEqual([]);
      expect(await tree(f.root)).toEqual(before);
      const clone = path.join(f.directory, "copy-b");
      await cp(f.root, clone, { recursive: true });
      const other = { ...f.project, id: "copy-b", root: clone };
      const b = await reader.refresh(other);
      expect(b.tasks[0].task_id).toBe(taskId);
      expect(b.batchId).not.toBe(view.batchId);
      await cli(f.root, {
        action: "prepare",
        plan: { title: "Second", steps: [] },
      });
      const changed = await reader.detail(
        f.project,
        view,
        taskId,
        "missing-step",
      );
      expect(changed.status).toBe("unavailable");
      expect(changed.error).toContain("QUERY_VIEW_CHANGED");
      expect((await reader.refresh(other)).tasks).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  }, 30000);
  it("does not execute untrusted/replaced modules; uses only recognized same-context snapshots", async () => {
    const f = await fixture(),
      savedPageSize = runtimeBudgets.pageSize;
    try {
      await cli(f.root, {
        action: "prepare",
        plan: { title: "Draft", steps: [] },
      });
      const reader = new RuntimeReader();
      const untrusted = { ...f.project, runtimeTrust: undefined };
      const old = await reader.refresh(untrusted);
      expect(old.source).toBe("file-snapshot");
      expect(old.diagnostics[0]).toContain("runtime-untrusted");
      await cli(f.root, {
        action: "prepare",
        plan: { title: "Second draft", steps: [] },
      });
      runtimeBudgets.pageSize = 1;
      const live = await reader.refresh(f.project);
      expect(live.source).toBe("runtime-query");
      expect(live.nextRequest).toBeDefined();
      await writeFile(
        path.join(f.root, ".workflow-system/runtime/support/assistance.mjs"),
        "throw new Error('must not execute');",
      );
      expect((await reader.refresh(f.project)).source).toBe("file-snapshot");
      await rm(path.join(f.root, ".workflow-system/records/task-view.json"));
      const memory = await reader.refresh(f.project);
      expect(memory.source).toBe("memory-snapshot");
      expect(memory.diagnostics[0]).toContain("runtime-bytes-changed");
      expect(memory.nextRequest).toBeUndefined();
      expect(memory.complete).toBe(false);
      expect(memory.diagnostics.join(" ")).toContain("刷新成功后才能继续分页");
      expect(
        (await reader.refresh({ ...f.project, configVersion: 2 })).source,
      ).toBe("unavailable");
      await writeFile(
        path.join(f.root, ".workflow-system/records/task-view.json"),
        JSON.stringify({ kind: "unknown" }),
      );
      expect(
        (await reader.refresh({ ...f.project, configVersion: 2 })).source,
      ).toBe("unavailable");
      await expect(
        stableRead(
          path.join(
            f.root,
            ".workflow-system/runtime/support/task-management.mjs",
          ),
          16,
        ),
      ).rejects.toThrow("budget");
    } finally {
      runtimeBudgets.pageSize = savedPageSize;
      await f.cleanup();
    }
  }, 30000);
  it("drops late refreshes after config changes or removal and merges identical requests", async () => {
    const f = await fixture();
    try {
      const registry = new ProjectRegistry(path.join(f.directory, "registry"));
      await registry.load();
      const project = await registry.add({ name: "A", root: f.root, config });
      let finish!: (value: any) => void;
      const builder = () => new Promise<any>((resolve) => (finish = resolve));
      const store = new SnapshotStore(registry, builder);
      const a = store.refresh(project.id);
      expect(store.refresh(project.id)).toBe(a);
      await registry.update(project.id, {
        name: "A",
        config: { ...config, excludes: ["blocked/**"] },
      });
      finish({
        id: "old",
        projectId: project.id,
        configVersion: 1,
        outcome: "success",
        completedAt: new Date().toISOString(),
      });
      await a;
      expect(store.view(project.id).snapshot).toBeNull();
      const b = store.refresh(project.id);
      await registry.remove(project.id);
      store.remove(project.id);
      finish({
        id: "removed",
        projectId: project.id,
        configVersion: 2,
        outcome: "success",
        completedAt: new Date().toISOString(),
      });
      await b;
      expect(() => store.view(project.id)).toThrow();
    } finally {
      await f.cleanup();
    }
  });
  it("late old scan cannot invalidate a newer configuration's successful memory fallback", async () => {
    const f = await fixture();
    const originalScan = scanner.scanFiles;
    let release!: () => void, scanned!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (scanned = resolve));
    const spy = vi
      .spyOn(scanner, "scanFiles")
      .mockImplementation(async (project, navigation) => {
        const scan = await originalScan(project, navigation);
        if (project.configVersion === 2) {
          scanned();
          await held;
        }
        return scan;
      });
    try {
      await cli(f.root, {
        action: "prepare",
        plan: { title: "Retained fact", steps: [] },
      });
      await rm(path.join(f.root, ".workflow-system/records/task-view.json"));
      const registry = new ProjectRegistry(path.join(f.directory, "registry"));
      await registry.load();
      const project = await registry.add({ name: "A", root: f.root, config });
      await registry.selectRuntime(project.id, {
        ...f.project.runtimeTrust,
        accept: true,
      });
      const store = new SnapshotStore(registry);
      const obsolete = store.refresh(project.id);
      await started;
      await registry.update(project.id, {
        name: "A",
        config: { ...config, excludes: ["unused/**"] },
      });
      const published = await store.refresh(project.id);
      expect(published.snapshot?.configVersion).toBe(3);
      expect(published.snapshot?.runtime?.source).toBe("runtime-query");
      release();
      await obsolete;
      expect(store.view(project.id).snapshot?.id).toBe(published.snapshot?.id);
      await writeFile(
        path.join(f.root, ".workflow-system/runtime/support/assistance.mjs"),
        "throw new Error('must not execute');",
      );
      const fallback = await store.refresh(project.id);
      expect(fallback.snapshot?.configVersion).toBe(3);
      expect(fallback.snapshot?.runtime?.source).toBe("memory-snapshot");
      expect(fallback.snapshot?.runtime?.tasks[0].task_id).toBe(
        published.snapshot?.runtime?.tasks[0].task_id,
      );
      expect(fallback.snapshot?.runtime?.queryReadAt).toBe(
        published.snapshot?.runtime?.readAt,
      );
    } finally {
      release();
      spy.mockRestore();
      await f.cleanup();
    }
  }, 30000);
});
