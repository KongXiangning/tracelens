import path from "node:path";
import os from "node:os";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { defaultConfig } from "../src/server/config.js";
import { SnapshotStore, buildSnapshot } from "../src/server/snapshot.js";
import type { Project, SnapshotView } from "../src/shared/types.js";

let directory: string;
let root: string;
let runtime: Awaited<ReturnType<typeof createApp>>;
let token: string;
const headers = () => ({
  host: "127.0.0.1:4317",
  "content-type": "application/json",
  "x-tracelens-token": token,
});
async function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return runtime.app.inject({
    method,
    url,
    headers: headers(),
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}
async function add(): Promise<Project> {
  const discovery = await request("POST", "/api/discover", { root });
  expect(discovery.statusCode).toBe(200);
  const response = await request("POST", "/api/projects", {
    name: "中文 Alpha 长路径",
    root,
    config: discovery.json().config,
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}
async function refresh(id: string): Promise<SnapshotView> {
  const response = await request("POST", `/api/projects/${id}/refresh`, {});
  expect(response.statusCode).toBe(200);
  return response.json();
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "tracelens-"));
  root = path.join(directory, "中文 项目 Alpha");
  await cp(path.resolve("examples/示例项目 Alpha"), root, { recursive: true });
  runtime = await createApp({ dataDir: path.join(directory, "tool-data") });
  token = (
    await runtime.app.inject({
      method: "GET",
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    })
  ).json().token;
});
afterEach(async () => {
  await runtime.app.close();
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^tracelens-/);
  await rm(directory, { recursive: true, force: true });
});

describe("local service acceptance", () => {
  it("registers two independent projects, preserves config on restart and never implicitly scans", async () => {
    const before = await readFile(
      path.join(root, "docs/workflow/CURRENT_TASK.md"),
    );
    const a = await add();
    const secondRoot = path.join(directory, "Beta");
    await cp(path.resolve("examples/示例项目 Beta"), secondRoot, {
      recursive: true,
    });
    const discovery = (
      await request("POST", "/api/discover", { root: secondRoot })
    ).json();
    const b = (
      await request("POST", "/api/projects", {
        name: "Beta",
        root: secondRoot,
        config: discovery.config,
      })
    ).json<Project>();
    expect(
      (await request("GET", `/api/projects/${a.id}/snapshot`)).json().snapshot,
    ).toBeNull();
    const viewA = await refresh(a.id);
    const viewB = await refresh(b.id);
    expect(viewA.snapshot?.tasks.find((t) => t.current)?.number).toBe(
      "20261001-001",
    );
    expect(viewB.snapshot?.tasks.find((t) => t.current)?.number).toBe(
      "20261002-002",
    );
    expect(
      viewA.snapshot?.documents
        .map((d) => d.id)
        .some((id) => viewB.snapshot?.documents.some((d) => d.id === id)),
    ).toBe(false);
    expect(
      await readFile(path.join(root, "docs/workflow/CURRENT_TASK.md")),
    ).toEqual(before);
    await runtime.app.close();
    runtime = await createApp({ dataDir: path.join(directory, "tool-data") });
    token = (await request("GET", "/api/session")).json().token;
    const list = (await request("GET", "/api/projects")).json<Project[]>();
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.id === b.id)?.config).toEqual(b.config);
    expect(
      (await request("GET", `/api/projects/${a.id}/snapshot`)).json(),
    ).toMatchObject({ snapshot: null, attempt: null });
    await request("DELETE", `/api/projects/${a.id}`, {});
    expect(
      await readFile(path.join(root, "docs/workflow/CURRENT_TASK.md")),
    ).toEqual(before);
  });
  it("resolves sections, reports outside/broken/unsafe/ambiguous references and preserves conflicts", async () => {
    const project = await add();
    const view = await refresh(project.id);
    const snapshot = view.snapshot!;
    expect(view.attempt?.state).toBe("partial");
    expect(
      snapshot.relations.find(
        (r) => r.method === "structured" && r.section === "恢复策略",
      ),
    ).toMatchObject({
      state: "resolved",
      targetLine: 7,
      revision: "设计稿 0.2",
    });
    expect(snapshot.relations.some((r) => r.state === "section-missing")).toBe(
      true,
    );
    expect(
      snapshot.relations.find((r) => r.targetPath === "docs/unscanned.md")
        ?.state,
    ).toBe("resolved");
    expect(snapshot.relations.some((r) => r.state === "ambiguous")).toBe(true);
    expect(snapshot.relations.some((r) => r.state === "unsafe")).toBe(true);
    expect(snapshot.warnings.some((w) => w.code === "status-conflict")).toBe(
      true,
    );
    expect(
      snapshot.tasks.filter((t) => t.number === "20261001-001"),
    ).toHaveLength(2);
    expect(
      snapshot.tasks.find((t) => t.number === "20260920-002")?.statuses[0].text,
    ).toBe("paused");
    const doc = snapshot.documents.find(
      (d) => d.path === "docs/design/storage.md",
    )!;
    expect(
      (
        await request(
          "GET",
          `/api/projects/${project.id}/documents/${encodeURIComponent(doc.id)}?snapshotId=${snapshot.id}`,
        )
      ).json().document.raw,
    ).toContain("恢复策略");
    expect(
      (
        await request(
          "GET",
          `/api/projects/${project.id}/documents/unknown?snapshotId=${snapshot.id}`,
        )
      ).statusCode,
    ).toBe(404);
  });
  it("browses frozen raw content; refresh applies additions edits removals and configuration exclusions", async () => {
    const project = await add();
    const first = (await refresh(project.id)).snapshot!;
    const filename = path.join(root, "docs/design/storage.md");
    const original = await readFile(filename, "utf8");
    await writeFile(filename, original.replace("恢复策略", "更新恢复策略"));
    await writeFile(
      path.join(root, "docs/design/added.md"),
      "# 新增设计\n\n新增内容",
    );
    await rm(path.join(root, "docs/design/unknown.md"));
    const document = first.documents.find(
      (d) => d.path === "docs/design/storage.md",
    )!;
    const frozen = (
      await request(
        "GET",
        `/api/projects/${project.id}/documents/${encodeURIComponent(document.id)}?snapshotId=${first.id}`,
      )
    ).json();
    expect(frozen.document.raw).toBe(original);
    expect(
      (await request("GET", `/api/projects/${project.id}/snapshot`)).json()
        .snapshot.id,
    ).toBe(first.id);
    const second = (await refresh(project.id)).snapshot!;
    expect(second.documents.some((d) => d.path.endsWith("added.md"))).toBe(
      true,
    );
    expect(second.documents.some((d) => d.path.endsWith("unknown.md"))).toBe(
      false,
    );
    expect(second.documents.find((d) => d.id === document.id)?.raw).toContain(
      "更新恢复策略",
    );
    expect(
      (
        await request(
          "GET",
          `/api/projects/${project.id}/documents/${encodeURIComponent(document.id)}?snapshotId=${first.id}`,
        )
      ).statusCode,
    ).toBe(409);
    const nextConfig = { ...project.config, excludes: ["docs/design/**"] };
    await request("PATCH", `/api/projects/${project.id}`, {
      name: project.name,
      config: nextConfig,
    });
    expect(
      (await request("GET", `/api/projects/${project.id}/snapshot`)).json(),
    ).toMatchObject({
      configChanged: true,
      snapshot: { config: project.config, id: second.id },
    });
    const third = (await refresh(project.id)).snapshot!;
    expect(third.documents.some((d) => d.kind === "design")).toBe(false);
    expect(
      third.relations.find((r) => r.targetPath === "docs/design/storage.md")
        ?.state,
    ).toBe("outside");
  });
  it("publishes partial content with unreadable files and parse failures, retaining diagnostic evidence", async () => {
    const project = await add();
    await request("PATCH", `/api/projects/${project.id}`, {
      name: project.name,
      config: {
        ...project.config,
        rules: { ...project.config.rules, design: ["docs/design/*.md"] },
      },
    });
    await writeFile(
      path.join(root, "docs/design/binary.md"),
      Buffer.from([0xff, 0, 0x12]),
    );
    await writeFile(
      path.join(root, "docs/design/malformed.md"),
      "### Project documents\n\n```json\nnot JSON\n```",
    );
    await writeFile(
      path.join(root, ".workflow-system/PROJECT_PROFILE.yaml"),
      "paths: [broken",
    );
    const view = await refresh(project.id);
    expect(view.attempt?.state).toBe("partial");
    expect(
      view.snapshot?.documents.some((d) => d.path.endsWith("binary.md")),
    ).toBe(false);
    expect(
      view.snapshot?.documents.some((d) => d.path.endsWith("malformed.md")),
    ).toBe(true);
    expect(view.snapshot?.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["read", "structured", "yaml"]),
    );
  });
  it("retains old snapshot and time after whole-root failure and displays failure without a previous snapshot", async () => {
    const project = await add();
    const old = (await refresh(project.id)).snapshot!;
    await rename(root, `${root}-moved`);
    const failed = await refresh(project.id);
    expect(failed.attempt?.state).toBe("failed");
    expect(failed.snapshot?.id).toBe(old.id);
    expect(failed.snapshot?.completedAt).toBe(old.completedAt);
    await runtime.app.close();
    runtime = await createApp({ dataDir: path.join(directory, "tool-data") });
    token = (await request("GET", "/api/session")).json().token;
    const noOld = await refresh(project.id);
    expect(noOld.snapshot).toBeNull();
    expect(noOld.attempt?.state).toBe("failed");
  });
  it("treats all matched reads failing as whole failure and valid empty scope as empty result", async () => {
    const empty = path.join(directory, "empty");
    await mkdir(empty);
    const config = {
      ...defaultConfig(),
      rules: {
        management: ["bad.md"],
        requirements: [],
        design: [],
        planning: [],
      },
    };
    const project = (
      await request("POST", "/api/projects", {
        root: empty,
        name: "Empty",
        config,
      })
    ).json<Project>();
    await writeFile(path.join(empty, "bad.md"), Buffer.from([0xff]));
    expect((await refresh(project.id)).attempt?.state).toBe("failed");
    await request("PATCH", `/api/projects/${project.id}`, {
      name: "Empty",
      config: { ...config, rules: { ...config.rules, management: [] } },
    });
    const zero = await refresh(project.id);
    expect(zero.attempt?.state).toBe("success");
    expect(zero.snapshot?.documents).toEqual([]);
    await mkdir(path.join(empty, "docs"));
    await request("PATCH", `/api/projects/${project.id}`, {
      name: "Empty",
      config: {
        ...config,
        rules: { ...config.rules, management: ["docs/**/*.md"] },
      },
    });
    const noMatch = await refresh(project.id);
    expect(noMatch.attempt?.state).toBe("success");
    expect(noMatch.snapshot?.warnings[0]).toMatchObject({
      code: "no-match",
      level: "info",
    });
  });
  it("limits reads and skips junctions without reading external target content", async () => {
    const project = await add();
    const outside = path.join(directory, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.md"), "# OUTSIDE_SECRET");
    await symlink(
      outside,
      path.join(root, "docs/design/linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(
      path.join(root, "docs/design/huge.md"),
      "x".repeat(2 * 1024 * 1024 + 1),
    );
    const config = {
      ...project.config,
      rules: { ...project.config.rules, design: ["docs/design/**/*.md"] },
    };
    await request("PATCH", `/api/projects/${project.id}`, {
      name: project.name,
      config,
    });
    const view = await refresh(project.id);
    expect(view.snapshot?.warnings.some((w) => w.code === "symlink")).toBe(
      true,
    );
    expect(
      view.snapshot?.warnings.some((w) => w.path?.endsWith("huge.md")),
    ).toBe(true);
    expect(
      view.snapshot?.documents.some((d) => d.raw.includes("OUTSIDE_SECRET")),
    ).toBe(false);
  });
  it("rejects traversal config, missing root, external Host/Origin and unauthenticated writes", async () => {
    expect(
      (
        await request("POST", "/api/projects", {
          name: "bad",
          root,
          config: {
            ...defaultConfig(),
            rules: { ...defaultConfig().rules, design: ["../outside.md"] },
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/discover", {
          root: path.join(directory, "does-not-exist"),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await runtime.app.inject({
          method: "GET",
          url: "/api/session",
          headers: { host: "evil.example:4317" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await runtime.app.inject({
          method: "GET",
          url: "/api/projects",
          headers: { host: "127.0.0.1:4317", origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await runtime.app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { host: "127.0.0.1:4317" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await request("GET", "/api/read?path=../../outside")).statusCode,
    ).toBe(404);
    expect(
      (await request("POST", "/api/discover", { root: directory })).statusCode,
    ).toBe(400);
  });
  it("coalesces duplicate refreshes and holds start-time configuration when edited during a scan", async () => {
    const project = await add();
    let release!: () => void;
    let builds = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new SnapshotStore(runtime.registry, async (config, start) => {
      builds++;
      await gate;
      return buildSnapshot(config, start);
    });
    const first = store.refresh(project.id);
    const second = store.refresh(project.id);
    expect(first).toBe(second);
    expect(store.view(project.id).attempt?.state).toBe("scanning");
    await runtime.registry.update(project.id, {
      name: "Edited",
      config: { ...project.config, excludes: ["docs/design/**"] },
    });
    release();
    const result = await first;
    expect(builds).toBe(1);
    expect(result.configChanged).toBe(true);
    expect(result.snapshot?.config).toEqual(project.config);
  });
});
