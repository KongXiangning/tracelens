import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { defaultConfig } from "../src/server/config.js";
import { runtimeModules } from "../src/shared/runtime-types.js";
import type { Project } from "../src/shared/types.js";

let directory: string;
let project: Project;
let runtime: Awaited<ReturnType<typeof createApp>>;
let token = "";

async function request(method: "GET" | "POST", url: string, payload?: object) {
  return runtime.app.inject({
    method,
    url,
    headers: {
      host: "127.0.0.1:4317",
      "content-type": "application/json",
      "x-tracelens-token": token,
    },
    payload,
  });
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "tracelens-trust-"));
  const root = path.join(directory, "项目 副本");
  await mkdir(path.join(root, ".workflow-system"), { recursive: true });
  runtime = await createApp({ dataDir: path.join(directory, "registry") });
  token = (await request("GET", "/api/session")).json().token;
  project = await runtime.registry.add({
    name: "项目",
    root,
    config: defaultConfig(),
  });
});

afterEach(async () => {
  await runtime.app.close();
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^tracelens-trust-/);
  await rm(directory, { recursive: true, force: true });
});

describe("Runtime trust defaults", () => {
  it("reads a custom profile home without registering trust or requiring installed modules", async () => {
    await writeFile(
      path.join(project.root, ".workflow-system/PROJECT_PROFILE.yaml"),
      "paths:\n  workflow_home: notes/工作流\n",
    );
    const result = await request(
      "GET",
      `/api/projects/${project.id}/runtime-trust-defaults`,
    );
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      sourceDirectory: path.join(
        project.root,
        ".workflow-system/runtime/support",
      ),
      workflowHome: "notes/工作流",
    });
    expect(runtime.registry.get(project.id).runtimeTrust).toBeUndefined();
  });

  it("uses the default home for missing or out-of-project configuration", async () => {
    const url = `/api/projects/${project.id}/runtime-trust-defaults`;
    expect((await request("GET", url)).json().workflowHome).toBe(
      "docs/workflow",
    );
    await writeFile(
      path.join(project.root, ".workflow-system/PROJECT_PROFILE.yaml"),
      "paths:\n  workflow_home: ../outside\n",
    );
    expect((await request("GET", url)).json().workflowHome).toBe(
      "docs/workflow",
    );
  });

  it("preserves explicitly saved settings and rejects modules changed after preview", async () => {
    const sourceDirectory = path.join(directory, "trusted-distribution");
    await mkdir(sourceDirectory);
    for (const name of runtimeModules)
      await writeFile(path.join(sourceDirectory, name), "// trusted fixture\n");
    const preview = (
      await request("POST", "/api/runtime-source-preview", { sourceDirectory })
    ).json();
    const trust = { ...preview, workflowHome: "custom/workflow", accept: true };
    const url = `/api/projects/${project.id}/runtime-trust`;
    expect((await request("POST", url, trust)).statusCode).toBe(200);
    expect((await request("GET", `${url}-defaults`)).json()).toEqual({
      sourceDirectory,
      workflowHome: "custom/workflow",
    });
    await writeFile(
      path.join(sourceDirectory, runtimeModules[0]),
      "// changed\n",
    );
    expect((await request("POST", url, trust)).statusCode).toBe(409);
    expect(runtime.registry.get(project.id).runtimeTrust?.moduleHashes).toEqual(
      preview.moduleHashes,
    );
  });
});
