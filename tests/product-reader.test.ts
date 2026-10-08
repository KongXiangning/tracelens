import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { buildSnapshot } from "../src/server/snapshot.js";
import { discover, limits, ScanReadSession } from "../src/server/scanner.js";
import { configFingerprint, configSchema } from "../src/server/config.js";
import type { Project } from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";

let directory: string, root: string, project: Project;
const doc = (items: unknown[], body: string) =>
  `---\n${stringify({ schema: "vnext-product-doc/v2", items })}---\n# 合成资料\n\n${body}`;
const projectItem = {
  id: "PROJECT",
  type: "project",
  inventory: { state: "partial", checked_sources: [], unreviewed_sources: [] },
};
const projectBody =
  "## [PROJECT] 合成项目\n### 项目定位\n读取测试。\n### 盘点范围与未核对项\n不是实际项目。\n";
const reqBody =
  "## [REQ] 完整需求\n### 需求内容\n保留内容。\n### 范围边界\n明确范围。\n### 验收要求\n核对来源。\n";
async function file(relative: string, raw: string | Buffer) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), raw);
}
async function manifest(extra: Record<string, unknown> = {}) {
  await file(
    ".workflow-system/PRODUCT.yaml",
    stringify({
      schema: "vnext-product-manifest/v2",
      project_id: "synthetic-reader",
      entry: "docs/product.md",
      managed_paths: ["docs/product.md"],
      source_paths: [
        "evidence/**",
        "docs/history/**",
        ".workflow-system/records/**",
      ],
      capture_paths: ["docs/history/**"],
      exclude_paths: [],
      maintenance: "enabled",
      ...extra,
    }),
  );
}
const snapshot = () => buildSnapshot(project, new Date().toISOString());
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "tracelens-product-中文 "));
  root = path.join(directory, "项目 副本");
  await mkdir(root);
  project = {
    id: "reader-test",
    name: "合成",
    root,
    configVersion: 1,
    config: {
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
      product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
    },
  };
  await manifest();
  await file(
    "docs/product.md",
    doc(
      [projectItem, { id: "REQ", type: "requirement", scope: "current" }],
      projectBody + reqBody,
    ),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("controlled PRODUCT read and snapshot integration", () => {
  it("requires explicit opt-in and previews one entry without widening old configuration", async () => {
    project.config.product = undefined;
    expect((await snapshot()).product?.status).toBe("disabled");
    const preview = await discover(root, path.join(directory, "data"));
    expect(preview.product?.status).toBe("ready");
    expect(preview.product?.managedPaths).toEqual(["docs/product.md"]);
    expect(preview.config.product?.enabled).not.toBe(true);
    expect(configFingerprint(project.config)).not.toBe(
      configFingerprint({
        ...project.config,
        product: {
          enabled: true,
          manifestPath: ".workflow-system/PRODUCT.yaml",
        },
      }),
    );
    expect(
      configSchema.safeParse({
        ...project.config,
        product: { enabled: true, manifestPath: "../bad.yaml" },
      }).success,
    ).toBe(false);
  });
  it("reads the synthetic all-nine fixture with source roles and no fake generic tasks", async () => {
    await cp(path.resolve("examples/product-comprehensive"), root, {
      recursive: true,
    });
    const before = await readFile(path.join(root, "docs/product/PROJECT.md"));
    const scan = await snapshot();
    expect(scan.product?.items.filter((i) => i.usable)).toHaveLength(12);
    expect(
      new Set(scan.product?.items.filter((i) => i.usable).map((i) => i.type))
        .size,
    ).toBe(9);
    expect(scan.tasks).toHaveLength(0);
    expect(
      scan.product?.sources.some(
        (s) => s.reference.kind === "file" && s.readState === "read",
      ),
    ).toBe(true);
    expect(scan.product?.assessments.some((a) => a.state === "selected")).toBe(
      true,
    );
    expect(
      scan.product?.items.find((i) => i.type === "assessment")?.metadata
        .pending_sources?.length,
    ).toBeGreaterThan(0);
    expect(await readFile(path.join(root, "docs/product/PROJECT.md"))).toEqual(
      before,
    );
    for (const item of scan.product!.items) {
      expect(
        scan.documents.find((d) => d.id === item.source.documentId)?.digest,
      ).toBe(item.source.digest);
      expect(
        scan.documents
          .find((d) => d.id === item.source.documentId)
          ?.raw.split("\n")[item.source.line - 1],
      ).toContain(`[${item.id}]`);
    }
  });
  it("keeps exact TXT/JSON/history reads, URI and raw byte checks separate from current definitions", async () => {
    const raw = Buffer.from("\ufeff反馈\r\n第二行\r\n");
    await file("evidence/反馈.txt", raw);
    await file(
      ".workflow-system/records/report.json",
      '{"task_id":"real-record-task","status":"paused"}',
    );
    await file(
      "docs/history/old.md",
      doc(
        [{ id: "OLD", type: "requirement", scope: "retired" }],
        reqBody.replaceAll("REQ", "OLD"),
      ),
    );
    const sha = createHash("sha256").update(raw).digest("hex");
    await file(
      "docs/product.md",
      doc(
        [
          projectItem,
          {
            id: "REQ",
            type: "requirement",
            scope: "current",
            sources: [
              {
                kind: "file",
                path: "evidence/反馈.txt",
                sha256: sha,
                lines: { start: 1, end: 2 },
              },
              { kind: "file", path: ".workflow-system/records/report.json" },
              {
                kind: "file",
                path: "docs/history/old.md",
                item_id: "OLD",
                section: "需求内容",
              },
              { kind: "uri", uri: "https://example.invalid/do-not-fetch" },
            ],
          },
        ],
        projectBody + reqBody,
      ),
    );
    const scan = await snapshot();
    expect(scan.product?.items.map((i) => i.id)).toEqual(["PROJECT", "REQ"]);
    expect(scan.product?.sources.map((s) => s.readState)).toEqual([
      "read",
      "read",
      "read",
      "external",
    ]);
    expect(scan.product?.sources[0].byteState).toBe("same-bytes");
    expect(scan.documents.some((d) => d.path.endsWith("report.json"))).toBe(
      true,
    );
    expect(
      scan.tasks.find((t) => t.realTaskId === "real-record-task")?.statuses[0]
        .text,
    ).toBe("paused");
    expect(scan.product?.sources[2].locationState).toBe("located");
    expect(scan.product?.sources[2].source?.line).toBeGreaterThan(1);
  });
  it("does not expand source_paths or read capture paths without a direct source", async () => {
    await file("evidence/unreferenced.txt", "never included");
    await file(
      "docs/history/hidden.md",
      doc(
        [{ id: "HIDDEN", type: "goal", scope: "current" }],
        "## [HIDDEN] History\n### 目标说明\nX\n### 范围边界\nX\n",
      ),
    );
    await manifest({ managed_paths: ["docs/**/*.md"] });
    const scan = await snapshot();
    expect(scan.documents.map((d) => d.path)).not.toContain(
      "evidence/unreferenced.txt",
    );
    expect(scan.product?.items.some((i) => i.id === "HIDDEN")).toBe(false);
    expect(
      scan.product?.coverage.excluded.some((e) => e.path.includes("history")),
    ).toBe(true);
  });
  it("preserves explicit exclusion, out-of-range, unsafe, unlocated, unsupported and link failures", async () => {
    await file("evidence/read.txt", "line");
    await file("evidence/excluded.txt", "secret");
    await file("evidence/unsupported.pdf", "not parsed");
    await symlink(
      path.join(root, "evidence/read.txt"),
      path.join(root, "evidence/link.txt"),
    );
    project.config.excludes = ["evidence/excluded.txt"];
    const sources = [
      { kind: "file", path: "evidence/excluded.txt" },
      { kind: "file", path: "outside.txt" },
      { kind: "file", path: "evidence/link.txt" },
      { kind: "file", path: "evidence/unsupported.pdf" },
      { kind: "file", path: "evidence/read.txt", lines: { start: 1, end: 99 } },
    ];
    await file(
      "docs/product.md",
      doc(
        [
          projectItem,
          { id: "REQ", type: "requirement", scope: "current", sources },
        ],
        projectBody + reqBody,
      ),
    );
    const scan = await snapshot();
    expect(scan.product?.sources.map((s) => s.readState)).toEqual([
      "excluded",
      "outside",
      "unavailable",
      "unsupported",
      "read",
    ]);
    expect(scan.product?.sources.at(-1)?.locationState).toBe("unlocated");
    expect(scan.product?.diagnostics.length).toBeGreaterThan(0);
  });
  it("shows unavailable/unsupported/empty/paused distinctly and never recovers withdrawn product definitions", async () => {
    const old = await snapshot();
    await manifest({
      managed_paths: ["docs/empty/*.md"],
      entry: "docs/empty/project.md",
    });
    await mkdir(path.join(root, "docs/empty"));
    const withdrawn = await buildSnapshot(
      project,
      new Date().toISOString(),
      old,
    );
    expect(withdrawn.product?.items).toHaveLength(0);
    expect(withdrawn.product?.coverage.complete).toBe(false);
    await file(
      ".workflow-system/PRODUCT.yaml",
      "schema: vnext-product-manifest/v99\n",
    );
    expect((await snapshot()).product?.status).toBe("unsupported");
    await file(".workflow-system/PRODUCT.yaml", "schema: [ broken");
    expect((await snapshot()).product?.status).toBe("unavailable");
    await manifest({ maintenance: "paused" });
    expect((await snapshot()).product?.manifest?.maintenance).toBe("paused");
  });
  it("uses one byte cache and preserves first-read bytes across channels and failures", async () => {
    const session = new ScanReadSession(root);
    const first = await session.read("docs/product.md");
    await file("docs/product.md", "newer bytes");
    expect(await session.read("docs/product.md")).toBe(first);
    await expect(session.read("evidence/later.txt")).rejects.toThrow();
    await file("evidence/later.txt", "later");
    await expect(session.read("evidence/later.txt")).rejects.toThrow();
  });
  it("reports budget omission without hiding available content or silently reading on later navigation", async () => {
    const old = limits.files;
    limits.files = 2;
    try {
      await file("evidence/extra.txt", "a source");
      await file(
        "docs/product.md",
        doc(
          [
            projectItem,
            {
              id: "REQ",
              type: "requirement",
              scope: "current",
              sources: [{ kind: "file", path: "evidence/extra.txt" }],
            },
          ],
          projectBody + reqBody,
        ),
      );
      const scan = await snapshot();
      expect(scan.product?.items.filter((i) => i.usable)).toHaveLength(2);
      expect(scan.product?.sources[0].readState).toBe("not-read");
      expect(scan.documents.some((d) => d.path === "evidence/extra.txt")).toBe(
        false,
      );
    } finally {
      limits.files = old;
    }
  });
  it("keeps case-sensitive item identity stable when moved and isolates worktree roots", async () => {
    const first = await snapshot();
    const key = first.product!.items.find((i) => i.id === "REQ")!.key;
    await file(
      "docs/moved.md",
      await readFile(path.join(root, "docs/product.md")),
    );
    await manifest({
      entry: "docs/moved.md",
      managed_paths: ["docs/moved.md"],
    });
    expect(
      (await snapshot()).product!.items.find((i) => i.id === "REQ")!.key,
    ).toBe(key);
    const other = path.join(directory, "other");
    await cp(root, other, { recursive: true });
    expect(
      (
        await buildSnapshot(
          { ...project, root: other },
          new Date().toISOString(),
        )
      ).product!.items.find((i) => i.id === "REQ")!.key,
    ).not.toBe(key);
  });
  it("serves source documents from the snapshot and returns 409 for stale product source requests", async () => {
    const runtime = await createApp({ dataDir: path.join(directory, "data") });
    try {
      const p = await runtime.registry.add({
        name: project.name,
        root,
        config: project.config,
      });
      const first = (await runtime.store.refresh(p.id)).snapshot!;
      const source = first.product!.items[0].source;
      await file("docs/product.md", "changed after scan");
      expect(
        runtime.store.document(p.id, source.documentId, first.id).document.raw,
      ).toContain("合成项目");
      await runtime.store.refresh(p.id);
      expect(() =>
        runtime.store.document(p.id, source.documentId, first.id),
      ).toThrow(/快照/);
    } finally {
      await runtime.app.close();
    }
  });
  it.each(["quoted-schema", "spaced-delimiters"])(
    "never interprets standard historical product prose as task metadata (%s)",
    async (variant) => {
      let history = doc(
        [{ id: "OLD", type: "requirement", scope: "retired" }],
        reqBody.replaceAll("REQ", "OLD"),
      );
      history = history.replace(
        "# 合成资料",
        "# History product\n- Task ID: product-prose-id",
      );
      if (variant === "quoted-schema")
        history = history.replace("schema:", '"schema":');
      else history = history.replaceAll("---\n", "---  \n");
      await file("docs/history/old.md", history);
      await file(
        "docs/product.md",
        doc(
          [
            projectItem,
            {
              id: "REQ",
              type: "requirement",
              scope: "current",
              sources: [
                {
                  kind: "file",
                  path: "docs/history/old.md",
                  item_id: "OLD",
                  section: "需求内容",
                },
              ],
            },
          ],
          projectBody + reqBody,
        ),
      );
      const scan = await snapshot();
      expect(
        scan.tasks.some((task) => task.realTaskId === "product-prose-id"),
      ).toBe(false);
      expect(scan.product?.sources[0].locationState).toBe("located");
      const source = scan.product?.sources[0].source!;
      expect(
        scan.documents.find((d) => d.id === source.documentId)?.raw.split("\n")[
          source.line - 1
        ],
      ).toBe("### 需求内容");
    },
  );
  it("checks historical definition independently of matching current definition and original bytes", async () => {
    const current = (await snapshot()).product!.items.find(
      (item) => item.id === "REQ",
    )!;
    const old = doc(
      [{ id: "REQ", type: "requirement", scope: "current" }],
      reqBody.replace("保留内容。", "旧需求范围。"),
    );
    await file("docs/history/old.md", old);
    const bytesHash = createHash("sha256").update(old).digest("hex");
    await file(
      "docs/product.md",
      doc(
        [
          projectItem,
          {
            id: "REQ",
            type: "requirement",
            scope: "current",
            assessment_id: "ASSESS",
          },
          {
            id: "ASSESS",
            type: "assessment",
            target: "REQ",
            target_basis: {
              kind: "file",
              path: "docs/history/old.md",
              item_id: "REQ",
              sha256: bytesHash,
            },
            target_definition_sha256: current.definitionSha256,
            checked_at: "2026-10-08",
            subject: { kind: "unknown", value: null },
            implementation: "unknown",
            verification: "unknown",
          },
        ],
        projectBody +
          reqBody +
          "## [ASSESS] 合成报告\n### 覆盖范围\n只读测试\n### 交付与验证依据\n未知\n### 剩余与待核对\n未核对\n",
      ),
    );
    const scan = await snapshot();
    expect(scan.product!.assessments[0]).toMatchObject({
      definitionState: "same",
      historicalState: "verified",
      basisDefinitionState: "changed",
    });
    expect(
      scan.product?.diagnostics.some(
        (d) => d.code === "BASIS_DEFINITION_MISMATCH",
      ),
    ).toBe(true);
  });
  it("retains duplicate current definitions under separate inspectable occurrence keys", async () => {
    await file(
      "docs/other.md",
      doc([{ id: "REQ", type: "requirement", scope: "planned" }], reqBody),
    );
    await manifest({ managed_paths: ["docs/*.md"] });
    const scan = await snapshot();
    const duplicates = scan.product!.items.filter((item) => item.id === "REQ");
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((item) => !item.usable)).toBe(true);
    expect(new Set(duplicates.map((item) => item.key)).size).toBe(2);
    expect(new Set(duplicates.map((item) => item.source.documentId)).size).toBe(
      2,
    );
  });
  it("rechecks actual task identity when the same CURRENT_TASK source changes focus", async () => {
    const current = "docs/workflow/CURRENT_TASK.md";
    const view = (id: string) =>
      `---\nkind: vnext-task-view\n---\n# Current task\n## Current work\n- Task: TASK-811 (${id}) — 当前任务\n- Step: step-1\n`;
    await manifest({ source_paths: ["docs/workflow/*.md"] });
    await file(current, view("real-A"));
    await file(
      "docs/product.md",
      doc(
        [
          projectItem,
          {
            id: "REQ",
            type: "requirement",
            scope: "current",
            task_bindings: [
              {
                id: "binding",
                task: {
                  task_id: "real-A",
                  source: { kind: "file", path: current },
                },
                role: "implementation",
                coverage: "明确范围",
                origin: "declared",
                state: "active",
              },
            ],
          },
        ],
        projectBody + reqBody,
      ),
    );
    const first = await snapshot();
    expect(first.product!.bindings[0].match.state).toBe("matched");
    await file(current, view("real-B"));
    const second = await buildSnapshot(
      project,
      new Date().toISOString(),
      first,
    );
    expect(second.tasks[0].id).toBe(first.tasks[0].id);
    expect(second.tasks[0].realTaskId).toBe("real-B");
    expect(second.product!.bindings[0].match.state).toBe("conflict");
    expect(second.product!.bindings[0].match.taskIds).toEqual([]);
  });
  it("does not choose the first duplicated heading in a historical item source", async () => {
    await file(
      "docs/history/old.md",
      doc(
        [{ id: "REQ", type: "requirement", scope: "retired" }],
        reqBody + reqBody,
      ),
    );
    await file(
      "docs/product.md",
      doc(
        [
          projectItem,
          {
            id: "REQ",
            type: "requirement",
            scope: "current",
            sources: [
              { kind: "file", path: "docs/history/old.md", item_id: "REQ" },
            ],
          },
        ],
        projectBody + reqBody,
      ),
    );
    const scan = await snapshot();
    expect(scan.product!.sources[0].locationState).toBe("ambiguous");
    expect(
      scan.product?.diagnostics.some((d) => d.code === "SOURCE_CHECK"),
    ).toBe(true);
  });
});
