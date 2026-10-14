import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { readHistoricalWork } from "../src/server/historical-work.js";
import { requirementWork } from "../src/shared/overview-progress.js";
import { createApp } from "../src/server/app.js";
import { defaultConfig } from "../src/server/config.js";
import { SnapshotCache } from "../src/server/snapshot-cache.js";
import { SnapshotStore } from "../src/server/snapshot.js";
import type { Document, Snapshot } from "../src/shared/types.js";
import type {
  ProductBindingView,
  ProductSnapshot,
  ProductSourceCheck,
} from "../src/shared/product-types.js";

function fixture(
  section = "## 实际改动摘要\n\n- actual_changes:\n  - 新增已保存的实际实现记录。\n",
) {
  const raw = `# TASK_ARCHIVE.md\n\n## 任务元数据\n\n- task_id: old-task\n- workflow_status: closed\n\n${section}`;
  const digest = createHash("sha256").update(raw).digest("hex");
  const source = {
    documentId: "archive",
    path: "TASKS/archive.md",
    line: 1,
    section: null,
    digest,
  };
  const reference = {
    kind: "file" as const,
    path: source.path,
    sha256: digest,
  };
  const task = { task_id: "old-task", source: reference };
  const row: ProductBindingView = {
    key: "binding",
    ownerKey: "REQ",
    binding: {
      id: "B",
      task,
      role: "implementation",
      contribution: "direct",
      origin: "declared",
      state: "active",
      coverage: "局部交付范围",
      reason: "已核对历史实际工作范围",
      sources: [reference],
    },
    match: { task, state: "matched", taskIds: ["task-key"], detail: "matched" },
    planItems: [],
    repairs: [],
  };
  const check: ProductSourceCheck = {
    id: "source-check",
    ownerKey: "REQ",
    role: "task_bindings[0].task.source",
    reference,
    readState: "read",
    locationState: "located",
    byteState: "same-bytes",
    source,
    detail: "same bytes",
  };
  const product = { bindings: [row], sources: [check] } as ProductSnapshot;
  const document = {
    id: "archive",
    path: source.path,
    raw,
    digest,
    title: "archive",
  } as Document;
  return { product, row, check, document };
}
it.each([
  "## 实际改动摘要\n\n- actual_changes:\n  - 局部修改已实际保存。\n",
  "## 实际交付\n\n- 新增局部数据库约束及实现。\n",
])(
  "consumes an explicit hashed archive result without requiring modern step refs",
  (section) => {
    const f = fixture(section);
    const historical = readHistoricalWork(f.product, [f.document]);
    expect(historical).toHaveLength(1);
    expect(historical[0]).toMatchObject({
      bindingKey: f.row.key,
      taskId: "old-task",
      source: { documentId: "archive", path: "TASKS/archive.md" },
    });
    const value = {
      product: f.product,
      historicalWork: historical,
      tasks: [],
    } as unknown as Snapshot;
    expect(requirementWork(value, [f.row])).toMatchObject({
      recorded: true,
      current: false,
      pending: false,
    });
    expect(f.row.binding.task).not.toHaveProperty("step_id");
  },
);
it.each([
  "## 验收记录\n\n- status: closed\n- acceptance_satisfied: true\n",
  "## 实际交付\n\n- 暂无实际交付。\n",
  "## 实际改动摘要\n\n- actual_changes: []\n",
  "## 计划\n\n> ## 实际交付\n> - 伪造引用中的已实现结果。\n",
  "## 计划\n\n```md\n## 实际交付\n- 代码中的伪造交付。\n```\n",
])(
  "does not turn status, empty results or quoted/code headings into execution facts",
  (section) => {
    const f = fixture(section);
    expect(readHistoricalWork(f.product, [f.document])).toEqual([]);
  },
);
it.each([
  "inferred",
  "supporting",
  "changed",
  "unread",
  "hash-missing",
  "identity-mismatch",
  "source-missing",
])("keeps %s historical evidence pending", (condition) => {
  const f = fixture();
  if (condition === "inferred") f.row.binding.origin = "inferred";
  if (condition === "supporting") f.row.binding.contribution = "supporting";
  if (condition === "changed") f.check.byteState = "changed";
  if (condition === "unread") f.check.readState = "not-read";
  if (condition === "hash-missing" && f.row.binding.task.source.kind === "file")
    delete f.row.binding.task.source.sha256;
  if (condition === "identity-mismatch")
    f.row.binding.task.task_id = "different-task";
  if (condition === "source-missing") f.product.sources = [];
  expect(readHistoricalWork(f.product, [f.document])).toEqual([]);
});

it("restores historical work for full cached views without scanning the observed project", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "tracelens-historical-"),
  );
  const root = path.join(directory, "project");
  const dataDir = path.join(directory, "cache");
  await mkdir(root);
  const app = await createApp({ dataDir });
  try {
    const project = await app.registry.add({
      name: "saved history",
      root,
      config: defaultConfig(),
    });
    const f = fixture();
    const saved = {
      id: "saved-snapshot",
      projectId: project.id,
      configVersion: project.configVersion,
      product: f.product,
      documents: [f.document],
      tasks: [],
    } as unknown as Snapshot;
    await new SnapshotCache(dataDir).save(
      project,
      { snapshot: saved, files: [] },
      () => true,
    );
    const store = new SnapshotStore(app.registry, async () => {
      throw new Error("must not rescan saved history");
    });
    await store.restore(project.id);
    const restored = store.view(project.id);
    expect(restored.restored).toBe(true);
    expect(restored.snapshot!.historicalWork).toHaveLength(1);
    expect(requirementWork(restored.snapshot!, [f.row])).toMatchObject({
      recorded: true,
      current: false,
      pending: false,
    });
    // The archive exists only in the persisted capture, not on the project filesystem.
    expect(restored.snapshot!.documents[0].raw).toBe(f.document.raw);
  } finally {
    await app.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
