import path from "node:path";
import os from "node:os";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { defaultConfig } from "../src/server/config.js";

let directory: string;
let root: string;
let codexHome: string;
let stateFile: string;
let runtime: Awaited<ReturnType<typeof createApp>>;
let token: string;
async function post(url: string, body: unknown = {}) {
  return runtime.app.inject({
    method: "POST",
    url,
    payload: JSON.stringify(body),
    headers: {
      host: "127.0.0.1:4317",
      "content-type": "application/json",
      "x-tracelens-token": token,
    },
  });
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "tracelens-sources-"));
  root = path.join(directory, "中文 项目");
  codexHome = path.join(directory, "codex");
  stateFile = path.join(codexHome, ".codex-global-state.json");
  await mkdir(root);
  await mkdir(codexHome);
  runtime = await createApp({
    dataDir: path.join(directory, "tool-data"),
    codexHome,
  });
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
  expect(path.basename(directory)).toMatch(/^tracelens-sources-/);
  await rm(directory, { recursive: true, force: true });
});
it("reads Codex current and legacy registrations without changing metadata or implicitly scanning", async () => {
  const missing = path.join(directory, "missing");
  const legacy = path.join(directory, "legacy");
  await mkdir(legacy);
  const content = JSON.stringify({
    "local-projects": {
      a: { name: "我的项目", rootPaths: [root, missing, 4] },
      remote: { name: "远程", hostId: "other", rootPaths: ["/remote/root"] },
    },
    "electron-saved-workspace-roots": [root, legacy],
    "electron-workspace-root-labels": { [legacy]: "旧版名称" },
    "thread-workspace-root-hints": { ignored: directory },
    private: "never returned",
  });
  await writeFile(stateFile, content);
  let response = await post("/api/project-sources/codex");
  expect(response.statusCode).toBe(200);
  expect(response.json().projects).toHaveLength(3);
  expect(response.json().projects).toContainEqual({ name: "我的项目", root });
  expect(
    response.json().projects.find((p: { root: string }) => p.root === missing)
      .reason,
  ).toMatch(/不存在|不可读/);
  expect(response.body).not.toContain("never returned");
  const project = (
    await post("/api/projects", {
      name: "已登记",
      root,
      config: defaultConfig(),
    })
  ).json();
  response = await post("/api/project-sources/codex");
  expect(
    response.json().projects.find((p: { root: string }) => p.root === root)
      .reason,
  ).toBe("已添加");
  expect(runtime.store.view(project.id).snapshot).toBeNull();
  expect(await readFile(stateFile, "utf8")).toBe(content);
});
it("keeps the directory route usable when Codex is absent or malformed and reloads fresh metadata", async () => {
  expect((await post("/api/project-sources/codex")).json().notice).toMatch(
    /未找到/,
  );
  await writeFile(stateFile, "{bad");
  expect((await post("/api/project-sources/codex")).json().notice).toMatch(
    /无法读取/,
  );
  expect(
    (await post("/api/project-sources/directories", { path: root })).statusCode,
  ).toBe(200);
  await writeFile(
    stateFile,
    JSON.stringify({
      "local-projects": { a: { name: "新登记", rootPaths: [root] } },
    }),
  );
  expect(
    (await post("/api/project-sources/codex")).json().projects[0].name,
  ).toBe("新登记");
});
it("browses only immediate directories, handles parent and drive roots, rejects linked paths and blocks unsafe selection", async () => {
  const child = path.join(root, "子目录");
  await mkdir(child);
  await mkdir(path.join(child, "深层目录"));
  await writeFile(path.join(root, "private.txt"), "not a directory");
  const link = path.join(root, "目录联接");
  await symlink(child, link, process.platform === "win32" ? "junction" : "dir");
  const listing = (
    await post("/api/project-sources/directories", { path: root })
  ).json();
  expect(listing.current).toBe(root);
  expect(listing.parent).toBe(directory);
  expect(listing.directories).toEqual([{ name: "子目录", path: child }]);
  expect(listing.selectable).toBe(true);
  expect(
    (await post("/api/project-sources/directories", { path: link })).statusCode,
  ).toBe(400);
  expect(
    (await post("/api/project-sources/directories", { path: "relative" }))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await post("/api/project-sources/directories", {
        path: path.join(directory, "missing"),
      })
    ).statusCode,
  ).toBe(400);
  const ancestor = (
    await post("/api/project-sources/directories", { path: directory })
  ).json();
  expect(ancestor.selectable).toBe(false);
  expect(ancestor.reason).toMatch(/配置目录/);
  const drive = (
    await post("/api/project-sources/directories", {
      path: path.parse(root).root,
    })
  ).json();
  expect(drive.parent).toBeNull();
  const unauthenticated = await runtime.app.inject({
    method: "POST",
    url: "/api/project-sources/directories",
    payload: {},
    headers: { host: "127.0.0.1:4317" },
  });
  expect(unauthenticated.statusCode).toBe(403);
});
it("reports bounded directory listings rather than returning unlimited entries", async () => {
  for (let i = 0; i < 502; i++) await mkdir(path.join(root, `folder-${i}`));
  const listing = (
    await post("/api/project-sources/directories", { path: root })
  ).json();
  expect(listing.directories).toHaveLength(500);
  expect(listing.truncated).toBe(true);
});
