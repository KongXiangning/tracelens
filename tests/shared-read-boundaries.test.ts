import { afterEach, beforeEach, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { appendFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { buildSnapshot } from "../src/server/snapshot.js";
import {
  discover,
  limits,
  readBounded,
  ScanReadSession,
} from "../src/server/scanner.js";
import type { Project } from "../src/shared/types.js";

let root: string, temporary: string, project: Project;
const originalLimits = { ...limits };
const record = ".workflow-system/records/events/plan.json";
const report = "docs/evidence/baseline-report.md";
async function file(relative: string, content: string | Buffer) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content);
}
async function manifest(
  excludes: string[],
  filename = ".workflow-system/PRODUCT.yaml",
) {
  const m = parse(
    await readFile(path.join(root, ".workflow-system/PRODUCT.yaml"), "utf8"),
  );
  m.exclude_paths = excludes;
  await file(filename, stringify(m));
}
const scan = () => buildSnapshot(project, "2026-10-08T14:00:00Z");
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "tracelens-boundaries-"));
  root = path.join(temporary, "合成观察项目");
  await cp(path.resolve("examples/product-comprehensive"), root, {
    recursive: true,
  });
  await file(
    "docs/workflow/CURRENT_TASK.md",
    `<!-- vnext-task-view/v1 -->\n# CURRENT_TASK\n## Current work\n- Task: TASK-811 (task-abc) — 合成任务\n- Adopted plan: ${record}\n- Step: P4\n`,
  );
  await file(
    record,
    JSON.stringify(
      {
        kind: "workflow-observation",
        payload: {
          kind: "task-event",
          request: { plan: { steps: [{ id: "P4", title: "明确步骤" }] } },
        },
      },
      null,
      2,
    ),
  );
  await file(
    "docs/README.md",
    `# 文档中心\n\n[报告](evidence/baseline-report.md)\n[当前任务](workflow/CURRENT_TASK.md)\n`,
  );
  project = {
    id: "shared-boundaries",
    name: "合成读取边界",
    root,
    configVersion: 1,
    config: {
      autoDiscover: false,
      product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
      rules: {
        management: [report, "docs/workflow/CURRENT_TASK.md"],
        requirements: [],
        design: [],
        planning: [],
      },
      excludes: [],
    },
  };
});
afterEach(async () => {
  Object.assign(limits, originalLimits);
  await rm(temporary, { recursive: true, force: true });
});

it.each([false, true])(
  "applies PRODUCT excludes before manual/navigation/adopted-plan reads (auto=%s)",
  async (auto) => {
    project.config.autoDiscover = auto;
    project.config.includeRecords = true;
    await manifest([report, ".workflow-system/records/**"]);
    const snapshot = await scan();
    expect(
      snapshot.documents.some((d) => d.path === report || d.path === record),
    ).toBe(false);
    expect(
      snapshot
        .product!.sources.filter(
          (s) => s.reference.kind === "file" && s.reference.path === report,
        )
        .every((s) => s.readState === "excluded"),
    ).toBe(true);
    expect(
      snapshot.statements.find((s) => s.kind === "currentStep")?.link?.target,
    ).toBeNull();
    expect(
      snapshot.warnings.some(
        (w) =>
          w.code === "current-plan" &&
          w.message.includes("PRODUCT exclude_paths"),
      ),
    ).toBe(true);
    if (auto) {
      expect(
        snapshot.navigation.entries.find((e) => e.path === report)
          ?.availability,
      ).toBe("excluded");
      expect(snapshot.navigation.inventory?.candidates.includes(report)).toBe(
        false,
      );
      expect(
        snapshot.relations.some(
          (r) => r.targetPath === report && r.state === "excluded",
        ),
      ).toBe(true);
    }
  },
);
it("retains allowed normal documents and exact adopted-plan records as positive controls", async () => {
  const snapshot = await scan();
  expect(snapshot.documents.some((d) => d.path === report)).toBe(true);
  expect(snapshot.documents.some((d) => d.path === record)).toBe(true);
  expect(
    snapshot.statements.find((s) => s.kind === "currentStep")?.link?.target
      ?.path,
  ).toBe(record);
  expect(snapshot.warnings.filter((w) => w.code === "current-plan")).toEqual(
    [],
  );
});
it("does not apply an unenabled manifest or reuse exclusions after withdrawal/invalid refresh", async () => {
  await manifest([report, ".workflow-system/records/**"]);
  project.config.product!.enabled = false;
  expect((await scan()).documents.some((d) => d.path === report)).toBe(true);
  project.config.product!.enabled = true;
  const excluded = await scan();
  expect(excluded.documents.some((d) => d.path === report)).toBe(false);
  await manifest([]);
  const restored = await buildSnapshot(project, "now", excluded);
  expect(restored.documents.some((d) => d.path === report)).toBe(true);
  await file(".workflow-system/PRODUCT.yaml", "schema: [ damaged");
  const invalid = await buildSnapshot(project, "later", excluded);
  expect(invalid.product!.status).toBe("unavailable");
  expect(invalid.product!.items).toEqual([]);
  expect(invalid.documents.some((d) => d.path === report)).toBe(true);
});
it("uses only the selected alternate manifest for both preview and snapshot exclusions", async () => {
  await manifest([], ".workflow-system/ALTERNATE.yaml");
  await manifest([report]);
  project.config.product!.manifestPath = ".workflow-system/ALTERNATE.yaml";
  project.config.autoDiscover = true;
  const preview = await discover(
    root,
    path.join(temporary, "data"),
    project.config,
  );
  expect(preview.product!.path).toBe(".workflow-system/ALTERNATE.yaml");
  expect(
    preview.navigation.entries.find((e) => e.path === report)?.availability,
  ).toBe("read");
  expect((await scan()).documents.some((d) => d.path === report)).toBe(true);
  await manifest([report], ".workflow-system/ALTERNATE.yaml");
  const excludedPreview = await discover(
    root,
    path.join(temporary, "data"),
    project.config,
  );
  expect(
    excludedPreview.navigation.entries.find((e) => e.path === report)
      ?.availability,
  ).toBe("excluded");
  expect((await scan()).documents.some((d) => d.path === report)).toBe(false);
});
it("applies PRODUCT exclusions to adopted-plan document_ref while retaining the allowed record fallback", async () => {
  await file("docs/private-plan.md", "# Plan\n## P4: Private plan\n");
  await file(
    record,
    JSON.stringify(
      {
        kind: "workflow-observation",
        payload: {
          kind: "task-event",
          request: {
            plan: {
              document_ref: "docs/private-plan.md",
              steps: [{ id: "P4", title: "明确步骤" }],
            },
          },
        },
      },
      null,
      2,
    ),
  );
  await manifest(["docs/private-plan.md"]);
  const snapshot = await scan();
  expect(
    snapshot.documents.some((d) => d.path === "docs/private-plan.md"),
  ).toBe(false);
  expect(snapshot.documents.some((d) => d.path === record)).toBe(true);
  expect(
    snapshot.statements.find((s) => s.kind === "currentStep")?.link?.target
      ?.path,
  ).toBe(record);
  expect(
    snapshot.warnings.some(
      (w) =>
        w.code === "current-plan" &&
        w.message.includes("PRODUCT exclude_paths"),
    ),
  ).toBe(true);
});
it("keeps PRODUCT glob syntax literal instead of broadening it through generic extglob", async () => {
  const literal = "docs/evidence/@(public|secret).md";
  const secret = "docs/evidence/secret.md";
  await file(literal, "# literal");
  await file(secret, "# allowed literal contract");
  await manifest([literal]);
  project.config.rules.management.push(literal, secret);
  const snapshot = await scan();
  expect(snapshot.documents.some((d) => d.path === literal)).toBe(false);
  expect(snapshot.documents.some((d) => d.path === secret)).toBe(true);
});
it("checks effective exclusions before cached bytes and rejects traversal aliases before cache lookup", async () => {
  const session = new ScanReadSession(root, project.config);
  const input = await session.read(report);
  const bytes = session.bytes;
  expect(await session.read(report)).toBe(input);
  expect(session.bytes).toBe(bytes);
  session.setProductExclusions([report]);
  await expect(session.read(report)).rejects.toThrow(/PRODUCT exclude_paths/);
  expect(session.bytes).toBe(bytes);
  session.setProductExclusions([]);
  await expect(
    session.read("docs/evidence/../evidence/baseline-report.md"),
  ).rejects.toThrow(/范围/);
});
it("counts failed UTF-8 bytes and refuses later reads once the actual shared budget is spent", async () => {
  Object.assign(limits, { totalBytes: 4096, fileBytes: 2048 });
  const session = new ScanReadSession(root);
  for (let i = 0; i < 8; i++) {
    const name = `bad-${i}.txt`;
    await file(name, Buffer.alloc(1024, 255));
    await expect(session.read(name)).rejects.toThrow();
    expect(session.bytes).toBe(Math.min(i + 1, 4) * 1024);
  }
  await file("valid.txt", "v".repeat(1024));
  await expect(session.read("valid.txt")).rejects.toThrow(/上限/);
  expect(session.bytes).toBe(4096);
  await expect(session.read("bad-0.txt")).rejects.toThrow(/encoding|编码|utf/i);
  expect(session.bytes).toBe(4096);
});
it("charges invalid binary content, preflights remaining size, and keeps successful cached reads free", async () => {
  Object.assign(limits, { totalBytes: 1500, fileBytes: 2048 });
  const session = new ScanReadSession(root);
  await file("binary.txt", Buffer.alloc(1024));
  await expect(session.read("binary.txt")).rejects.toThrow(/二进制/);
  expect(session.bytes).toBe(1024);
  await file("large.txt", "x".repeat(1024));
  await expect(session.read("large.txt")).rejects.toThrow(/字节预算/);
  expect(session.bytes).toBe(1024);
  await file("small.txt", "s".repeat(476));
  const small = await session.read("small.txt");
  expect(session.bytes).toBe(1500);
  expect(await session.read("small.txt")).toBe(small);
  expect(session.bytes).toBe(1500);
});
it("serializes concurrent physical reads and coalesces requests without overspending the budget", async () => {
  Object.assign(limits, { totalBytes: 4096, fileBytes: 2048 });
  const session = new ScanReadSession(root);
  for (let i = 0; i < 8; i++)
    await file(`concurrent-${i}.txt`, Buffer.alloc(1024, 255));
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) => session.read(`concurrent-${i}.txt`)),
  );
  expect(results.every((r) => r.status === "rejected")).toBe(true);
  expect(session.bytes).toBe(4096);
  const next = new ScanReadSession(root);
  await file("good.txt", "g".repeat(1024));
  const [a, b] = await Promise.all([
    next.read("good.txt"),
    next.read("good.txt"),
  ]);
  expect(a).toBe(b);
  expect(next.bytes).toBe(1024);
});
it("does not erase charged bytes when post-read file-change checks reject the content", async () => {
  const data = "x".repeat(128 * 1024);
  await file("changing.txt", data);
  let charged = 0;
  let changed = false;
  await expect(
    readBounded(root, "changing.txt", false, {
      remainingBytes: () => 256 * 1024 - charged,
      onBytesRead: (count) => {
        charged += count;
        if (!changed) {
          changed = true;
          appendFileSync(path.join(root, "changing.txt"), "changed");
        }
      },
    }),
  ).rejects.toThrow(/变化/);
  expect(charged).toBe(Buffer.byteLength(data));
});

it("does not let an unread local navigation allowance poison a later globally permitted PRODUCT read", async () => {
  await file("shared.md", "x".repeat(1024));
  const session = new ScanReadSession(root);
  await expect(
    session.read("shared.md", false, { remainingBytes: () => 512 }),
  ).rejects.toThrow(/字节预算/);
  expect(session.bytes).toBe(0);
  expect((await session.read("shared.md")).bytes).toBe(1024);
  expect(session.bytes).toBe(1024);
});
it("lets a coalesced broader reader recover only a zero-byte local allowance rejection", async () => {
  await file("shared.md", "x".repeat(1024));
  const session = new ScanReadSession(root);
  const [local, global] = await Promise.allSettled([
    session.read("shared.md", false, { remainingBytes: () => 512 }),
    session.read("shared.md"),
  ]);
  expect(local.status).toBe("rejected");
  expect(global.status).toBe("fulfilled");
  expect(session.bytes).toBe(1024);
});
it("cannot bypass exhausted global or unique-file budgets with a broader local allowance", async () => {
  Object.assign(limits, { totalBytes: 1024, fileBytes: 2048, files: 2 });
  await file("filled.txt", "f".repeat(1024));
  await file("later.txt", "l".repeat(1024));
  const session = new ScanReadSession(root);
  await session.read("filled.txt");
  await expect(
    session.read("later.txt", false, { remainingBytes: () => 512 }),
  ).rejects.toThrow(/上限/);
  await expect(
    session.read("later.txt", false, { remainingBytes: () => 99999 }),
  ).rejects.toThrow(/上限/);
  expect(session.bytes).toBe(1024);
  limits.totalBytes = 4096;
  limits.files = 1;
  const limited = new ScanReadSession(root);
  await expect(
    limited.read("filled.txt", false, { remainingBytes: () => 512 }),
  ).rejects.toThrow(/字节预算/);
  expect((await limited.read("filled.txt")).bytes).toBe(1024);
  await expect(limited.read("later.txt")).rejects.toThrow(/文件读取上限/);
});
