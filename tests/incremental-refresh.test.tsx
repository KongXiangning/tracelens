import { assessmentGroups } from "../src/shared/overview-model";
import { mergeProjectView } from "../src/web/view-state";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  writeFile,
  rm,
  rename,
  readFile,
} from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createApp } from "../src/server/app.js";
import { limits } from "../src/server/scanner.js";
import { SnapshotStore } from "../src/server/snapshot.js";
import { buildSnapshot } from "../src/server/snapshot.js";
import { SnapshotCache } from "../src/server/snapshot-cache.js";
import { FileIndex } from "../src/server/file-index.js";
import { ScanReadSession } from "../src/server/scanner.js";
import { RuntimeReader } from "../src/server/runtime-reader.js";
import { AssessmentOverview } from "../src/web/assessment-overview.js";
import type { ProductItem } from "../src/shared/product-types.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "tracelens-incremental-"),
  );
  directories.push(directory);
  const root = path.join(directory, "project"),
    dataDir = path.join(directory, "cache");
  for (const dir of [".workflow-system", "docs", "evidence"])
    await mkdir(path.join(root, dir), { recursive: true });
  const sources = [];
  for (let i = 0; i < 7; i++) {
    const content = `Evidence ${i}`;
    await writeFile(path.join(root, `evidence/${i}.txt`), content);
    sources.push({
      kind: "file",
      path: `evidence/${i}.txt`,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  const manifest = {
    schema: "vnext-product-manifest/v2",
    project_id: "incremental",
    entry: "docs/PROJECT.md",
    managed_paths: ["docs/PROJECT.md"],
    source_paths: ["evidence/**"],
    exclude_paths: [],
    maintenance: "enabled",
  };
  await writeFile(
    path.join(root, ".workflow-system/PRODUCT.yaml"),
    JSON.stringify(manifest),
  );
  const metadata = {
    schema: "vnext-product-doc/v2",
    items: [
      {
        type: "project",
        id: "PROJECT",
        inventory: {
          state: "partial",
          checked_sources: [],
          unreviewed_sources: [],
        },
      },
      { type: "requirement", id: "REQ", scope: "current", sources },
    ],
  };
  await writeFile(
    path.join(root, "docs/PROJECT.md"),
    `---\n${JSON.stringify(metadata)}\n---\n# Test\n\n## [PROJECT] 项目\n### 项目定位\n测试\n### 盘点范围与未核对项\n局部\n\n## [REQ] 需求\n### 需求内容\n内容\n### 范围边界\n边界\n### 验收要求\n要求\n`,
  );
  const runtime = await createApp({ dataDir });
  const project = await runtime.registry.add({
    name: "Test",
    root,
    config: {
      readingMode: "vnext",
      autoDiscover: true,
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
      product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
    },
  });
  return { directory, root, dataDir, runtime, project };
}

it("restores persisted content after restart, detects new/changed/deleted files, and reuses unchanged parses", async () => {
  const f = await fixture();
  try {
    const first = (await f.runtime.store.refresh(f.project.id)).snapshot!;
    expect(first.phase).toBe("complete");
    const restarted = new SnapshotStore(f.runtime.registry);
    await restarted.restore(f.project.id);
    expect(restarted.view(f.project.id)).toMatchObject({
      restored: true,
      snapshot: { id: first.id },
    });
    const unchanged = (await restarted.refresh(f.project.id)).snapshot!;
    expect(unchanged.metrics).toMatchObject({ filesRead: 0, parsed: 0 });
    await writeFile(path.join(f.root, "evidence/0.txt"), "Changed evidence");
    await writeFile(path.join(f.root, "docs/new.md"), "# 新增文件\n");
    const definitionFile = path.join(f.root, "docs/PROJECT.md");
    await writeFile(
      definitionFile,
      (await readFile(definitionFile, "utf8")).replace(
        "### 需求内容\n内容",
        "### 需求内容\n新的需求内容",
      ),
    );
    await rename(
      path.join(f.root, "evidence/1.txt"),
      path.join(f.root, "evidence/moved.txt"),
    );
    const changed = (await restarted.refresh(f.project.id)).snapshot!;
    expect(
      changed.product!.items.find((item) => item.id === "REQ")!
        .definitionSha256,
    ).not.toBe(
      first.product!.items.find((item) => item.id === "REQ")!.definitionSha256,
    );
    expect(changed.metrics!.filesRead).toBeLessThan(first.metrics!.filesRead);
    expect(changed.documents.some((d) => d.path === "docs/new.md")).toBe(true);
    expect(changed.documents.some((d) => d.path === "evidence/1.txt")).toBe(
      false,
    );
    expect(
      changed.product!.sources.find(
        (s) =>
          s.reference.kind === "file" && s.reference.path === "evidence/0.txt",
      )?.byteState,
    ).toBe("changed");
    expect(
      changed.product!.sources.find(
        (s) =>
          s.reference.kind === "file" && s.reference.path === "evidence/1.txt",
      )?.readState,
    ).toBe("unavailable");
    const summary = restarted.summary(f.project.id);
    expect(
      summary.snapshot!.documents.find((d) => d.path === "docs/new.md"),
    ).toMatchObject({ contentOmitted: true, raw: "" });
    const document = changed.documents.find((d) => d.path === "docs/new.md")!;
    expect(
      restarted.document(f.project.id, document.id, changed.id).document.raw,
    ).toContain("新增文件");
    expect(restarted.summary(f.project.id, changed.id)).toMatchObject({
      snapshot: null,
      unchanged: true,
    });
    await f.runtime.registry.update(f.project.id, {
      name: "Test",
      config: { ...f.project.config, excludes: ["evidence/**"] },
    });
    const differentConfig = new SnapshotStore(f.runtime.registry);
    await differentConfig.restore(f.project.id);
    expect(differentConfig.view(f.project.id).snapshot).toBeNull();
    const excluded = (await differentConfig.refresh(f.project.id)).snapshot!;
    expect(
      excluded.product!.sources.every((s) => s.readState === "excluded"),
    ).toBe(true);
  } finally {
    await f.runtime.app.close();
  }
});

it("resumes an interrupted core checkpoint and reuses already captured evidence", async () => {
  const f = await fixture();
  try {
    const index = new FileIndex();
    const core = await buildSnapshot(
      f.project,
      new Date().toISOString(),
      undefined,
      {
        reader: new RuntimeReader(),
        isCurrent: () => true,
        scan: { index, batched: true, coreOnly: true },
      },
    );
    await new ScanReadSession(f.root, f.project.config, { index }).read(
      "evidence/0.txt",
    );
    await new SnapshotCache(f.dataDir).save(
      f.project,
      { snapshot: core, files: index.entries() },
      () => true,
    );
    const restored = new SnapshotStore(f.runtime.registry);
    await restored.restore(f.project.id);
    expect(restored.view(f.project.id).snapshot?.phase).toBe("core");
    const finished = (await restored.refresh(f.project.id)).snapshot!;
    expect(finished.phase).toBe("complete");
    expect(
      finished.product!.sources.every((source) => source.readState === "read"),
    ).toBe(true);
    expect(finished.metrics!.filesReused).toBeGreaterThanOrEqual(3);
  } finally {
    await f.runtime.app.close();
  }
});

it("invalidates the index when a previously missing linked file appears outside docs", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.root, "docs/links.md"),
      "# Links\n[Outside](../outside.md)\n",
    );
    await f.runtime.store.refresh(f.project.id);
    // Establish the complete navigation scope before checking its missing paths.
    const baseline = (await f.runtime.store.refresh(f.project.id)).snapshot!;
    expect(baseline.treeFingerprint).toBeTruthy();
    await writeFile(path.join(f.root, "outside.md"), "# Previously missing\n");
    const next = (await f.runtime.store.refresh(f.project.id)).snapshot!;
    expect(next.metrics!.filesRead).toBeGreaterThan(0);
    expect(
      next.documents.some((document) => document.path === "outside.md"),
    ).toBe(true);
  } finally {
    await f.runtime.app.close();
  }
});

it("publishes core data first and finishes evidence spanning several file-budget batches", async () => {
  const f = await fixture(),
    previousLimit = limits.files;
  limits.files = 3;
  try {
    const running = f.runtime.store.refresh(f.project.id);
    await expect
      .poll(() => f.runtime.store.view(f.project.id).snapshot?.phase, {
        interval: 1,
      })
      .toBe("core");
    expect(
      f.runtime.store
        .view(f.project.id)
        .snapshot!.product!.items.some((i) => i.id === "REQ"),
    ).toBe(true);
    const final = (await running).snapshot!;
    expect(final.product!.sources).toHaveLength(7);
    expect(
      final.product!.sources.every(
        (s) => s.readState === "read" && s.byteState === "same-bytes",
      ),
    ).toBe(true);
    const restored = new SnapshotStore(f.runtime.registry);
    await restored.restore(f.project.id);
    expect(restored.view(f.project.id).snapshot!.id).toBe(final.id);
  } finally {
    limits.files = previousLimit;
    await f.runtime.app.close();
  }
});

it("ignores damaged checkpoints and exposes background progress without returning document bodies repeatedly", async () => {
  const f = await fixture();
  try {
    const { token } = (
      await f.runtime.app.inject({
        url: "/api/session",
        headers: { host: "127.0.0.1:4317" },
      })
    ).json();
    const response = await f.runtime.app.inject({
      method: "POST",
      url: `/api/projects/${f.project.id}/refresh`,
      headers: {
        host: "127.0.0.1:4317",
        "x-tracelens-token": token,
        "content-type": "application/json",
      },
      payload: { background: true },
    });
    expect(response.json().attempt.state).toBe("scanning");
    await f.runtime.store.refresh(f.project.id);
    const filename = path.join(
      f.dataDir,
      "snapshots",
      `${f.project.id}.json.gz`,
    );
    expect((await readFile(filename)).length).toBeGreaterThan(0);
    await writeFile(filename, "interrupted bytes");
    const restored = new SnapshotStore(f.runtime.registry);
    await restored.restore(f.project.id);
    expect(restored.view(f.project.id).snapshot).toBeNull();
    expect(
      (await restored.refresh(f.project.id)).snapshot?.product?.items.length,
    ).toBe(2);
  } finally {
    await f.runtime.app.close();
  }
});

it("shows each report scope and subject separately without turning task status into acceptance", async () => {
  const f = await fixture();
  try {
    const snapshot = (await f.runtime.store.refresh(f.project.id)).snapshot!;
    const base = snapshot.product!.items[1];
    snapshot.product!.items.push(
      ...["satisfied", "partially-satisfied"].map(
        (conclusion, i) =>
          ({
            ...base,
            id: `A${i}`,
            key: `a${i}`,
            type: "assessment",
            title: `场景 ${i}`,
            source: { ...base.source, path: "docs/ANDROID.md" },
            metadata: {
              id: `A${i}`,
              type: "assessment",
              target: "REQ",
              conclusion,
              applicability: {
                goal_id: "GOAL",
                scope_id: `scope-${i}`,
                coverage: "limited",
              },
              subject: { kind: "commit", value: "abc" },
              extensions: { scenario_verdict: i ? "fail" : "pass" },
            },
          }) as ProductItem,
      ),
    );
    const html = renderToStaticMarkup(
      <AssessmentOverview
        context={{
          snapshot,
          open: () => {},
          openTask: () => {},
          openProduct: () => {},
          relations: () => {},
        }}
      />,
    );
    expect(html).toContain("验收记录");
    expect(html).not.toContain("scope-0");
    const group = assessmentGroups(snapshot.product!).find(
      (g) => g.path === "docs/ANDROID.md",
    )!;
    expect([group.passed, group.failed]).toEqual([1, 1]);
    expect(
      group.reports.map((r) => r.metadata.applicability?.scope_id),
    ).toEqual(["scope-0", "scope-1"]);
    expect(group.subject).toContain("abc");
  } finally {
    await f.runtime.app.close();
  }
});

it("serves overview projections, reuses unchanged content and rejects stale detail reads", async () => {
  const f = await fixture();
  try {
    const headers = { host: "127.0.0.1:4317" };
    const snapshot = (await f.runtime.store.refresh(f.project.id)).snapshot!;
    const url = `/api/projects/${f.project.id}`;
    const response = await f.runtime.app.inject({
      url: `${url}/overview`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const first = response.json();
    expect(first.snapshot.overview.counts.documents).toBe(
      snapshot.documents.length,
    );
    expect(first.snapshot.documents).toBeUndefined();
    expect(first.snapshot.product).toBeUndefined();
    expect(first.snapshot.overview.unordered[0].id).toBe("REQ");
    expect(first.snapshot.overview.unordered[0].body).toBeUndefined();
    const cached = (
      await f.runtime.app.inject({
        url: `${url}/overview?knownRevision=${first.snapshot.revision}`,
        headers,
      })
    ).json();
    expect(cached.unchanged).toBe(true);
    expect(cached.snapshot.overview).toBeUndefined();
    expect(mergeProjectView(first, cached)).toBe(first);
    expect(mergeProjectView(first, f.runtime.store.status(f.project.id))).toBe(
      first,
    );
    await f.runtime.store.refresh(f.project.id);
    const next = f.runtime.store.overview(
      f.project.id,
      first.snapshot.revision,
    );
    expect(next.snapshot!.id).not.toBe(snapshot.id);
    expect(next.unchanged).toBe(true);
    expect(next.snapshot!.overview).toBeUndefined();
    const merged = mergeProjectView(first, next);
    expect(merged).not.toBe(first);
    expect(merged.snapshot!.id).toBe(next.snapshot!.id);
    expect((merged.snapshot as typeof first.snapshot).overview).toBe(
      first.snapshot.overview,
    );
    const stale = await f.runtime.app.inject({
      url: `${url}/snapshot?snapshotId=${snapshot.id}`,
      headers,
    });
    expect(stale.statusCode).toBe(409);
    const current = await f.runtime.app.inject({
      url: `${url}/snapshot?snapshotId=${next.snapshot!.id}`,
      headers,
    });
    expect(current.json().snapshot.documents.length).toBe(
      snapshot.documents.length,
    );
    const filename = path.join(f.root, "docs/PROJECT.md");
    await writeFile(
      filename,
      (await readFile(filename, "utf8")).replace("REQ", "REQ-CHANGED"),
    );
    await f.runtime.store.refresh(f.project.id);
    const changed = f.runtime.store.overview(
      f.project.id,
      first.snapshot.revision,
    );
    expect(changed.unchanged).not.toBe(true);
    expect(changed.snapshot!.revision).not.toBe(first.snapshot.revision);
    expect(changed.snapshot!.overview).toBeDefined();
    const token = (
      await f.runtime.app.inject({ url: "/api/session", headers })
    ).json().token;
    const status = await f.runtime.app.inject({
      method: "POST",
      url: `${url}/refresh`,
      headers: { ...headers, "x-tracelens-token": token },
      payload: { background: true, statusOnly: true },
    });
    expect(status.json().snapshot).toBeNull();
    expect(status.json().unchanged).toBe(true);
    await f.runtime.store.refresh(f.project.id);
  } finally {
    await f.runtime.app.close();
  }
});
