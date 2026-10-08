import path from "node:path";
import os from "node:os";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  unlink,
} from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { discover } from "../src/server/scanner.js";
import { buildSnapshot } from "../src/server/snapshot.js";
import { organizationPrompt } from "../src/shared/organization-prompt.js";
import type { Project } from "../src/shared/types.js";

let directory: string;
let root: string;
let runtime: Awaited<ReturnType<typeof createApp>>;
const originals = new Map<string, string>();
async function file(relative: string, content: string) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content);
  originals.set(relative, content);
}
async function register(): Promise<Project> {
  const discovery = await discover(root, runtime.registry.dataDir);
  expect(discovery.config.autoDiscover).toBe(true);
  expect(discovery.config.rules.requirements).toEqual([]);
  return runtime.registry.add({
    name: "文档导航样本",
    root,
    config: discovery.config,
  });
}
const index = `# 文档中心

## 需求
- 主需求：[正式需求](product/REQ-1.md)
- 草案：[未确认需求](product/draft.md)

## 设计
- 当前架构：\`docs/architecture/CURRENT_STATE.md\`

## 规划
- 实施计划：[阶段计划](plans/PLAN-1.md)

## 其他
- 说明：\`docs/misc.md\`
- 不安全：[越界](../../../outside.md)
- 外部：[资料](https://example.com/info.md)
`;
beforeEach(async () => {
  originals.clear();
  directory = await mkdtemp(path.join(os.tmpdir(), "tracelens-navigation-"));
  root = path.join(directory, "观察项目 中文");
  await mkdir(root);
  await file(
    ".workflow-system/PROJECT_PROFILE.yaml",
    "paths:\n  workflow_home: notes/治理\n  documentation_files:\n    - docs/README.md\n    - docs/misc.md\n",
  );
  await file("docs/README.md", index);
  await file(
    "docs/product/REQ-1.md",
    "---\nstatus: active\nrelated_docs: [docs/plans/PLAN-1.md]\n---\n# 正式需求\n\n用户要求离线查看来源。\n",
  );
  await file(
    "docs/product/draft.md",
    "---\nstatus: draft\n---\n# 需求草案\n\n尚未确认。\n",
  );
  await file(
    "docs/architecture/CURRENT_STATE.md",
    "---\nstatus: active\n---\n# 当前架构\n\n## 存储\n\n本地只读。\n",
  );
  await file(
    "docs/plans/PLAN-1.md",
    "---\nstatus: draft\nrelated_docs: [docs/product/REQ-1.md]\n---\n# 阶段计划\n",
  );
  await file("docs/misc.md", "# 说明\n\n没有类型声明。\n");
  await file("docs/support.md", "# 背景说明\n\n任务使用的补充依据。\n");
  await file(
    "notes/治理/CURRENT_TASK.md",
    '# 当前任务\n\n- 任务 ID: 20261002-007\n- 任务标题: 核对文档\n- 当前状态: active\n\n## 背景与上下文\n\n### Project documents\n\n```json\n{"version":1,"sources":[{"path":"docs/support.md","purpose":"任务依据"},{"path":"docs/architecture/CURRENT_STATE.md","section":"存储","purpose":"设计约束"}]}\n```\n',
  );
  runtime = await createApp({ dataDir: path.join(directory, "tool-data") });
});
afterEach(async () => {
  await runtime.app.close();
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^tracelens-navigation-/);
  await rm(directory, { recursive: true, force: true });
});
it("uses the Profile current task source and never promotes archived current declarations", async () => {
  await file(
    "TASKS/legacy/CURRENT_TASK.md",
    "# 历史任务\n- 任务 ID: TASK-001\n- 当前步骤: 归档步骤\n",
  );
  await file(
    "TASKS/legacy/CURRENT_TASK-hash.md",
    "# 历史视图\n- 当前任务: TASK-002\n- 当前步骤: 另一个归档步骤\n",
  );
  await file(
    "notes/治理/CURRENT_TASK.md",
    "<!-- vnext-task-view/v1 -->\n# CURRENT_TASK\n## Current work\n- Task: TASK-811 (task-abc) — 法规导入修复\n- Step: P4\n",
  );
  const project = await register();
  const snapshot = await buildSnapshot(project, new Date().toISOString());
  expect(snapshot.navigation.currentTaskPath).toBe(
    "notes/治理/CURRENT_TASK.md",
  );
  expect(snapshot.tasks.filter((t) => t.current)).toMatchObject([
    { number: "TASK-811", title: "法规导入修复" },
  ]);
  expect(
    snapshot.statements.filter((s) => s.kind === "currentStep"),
  ).toMatchObject([
    { text: "P4", source: { path: "notes/治理/CURRENT_TASK.md", line: 5 } },
  ]);
  expect(
    snapshot.documents.some((d) => d.path === "TASKS/legacy/CURRENT_TASK.md"),
  ).toBe(true);
  await file(
    "notes/治理/CURRENT_TASK.md",
    "<!-- vnext-task-view/v1 -->\n# CURRENT_TASK\n## Current work\n- No unambiguous active work focus.\n- Step: none\n",
  );
  const noFocus = await buildSnapshot(project, new Date().toISOString());
  expect(noFocus.tasks.filter((t) => t.current)).toEqual([]);
  expect(
    noFocus.statements.filter((s) =>
      ["currentTask", "currentStep"].includes(s.kind),
    ),
  ).toEqual([]);
  await unlink(path.join(root, "notes/治理/CURRENT_TASK.md"));
  const missing = await buildSnapshot(project, new Date().toISOString());
  expect(missing.tasks.filter((t) => t.current)).toEqual([]);
  expect(
    missing.statements.filter((s) =>
      ["currentTask", "currentStep"].includes(s.kind),
    ),
  ).toEqual([]);
});
it("discovers real Profile seeds, index labels, metadata and task sources with provenance and no invented completeness", async () => {
  const project = await register();
  const snapshot = (await runtime.store.refresh(project.id)).snapshot!;
  expect(
    snapshot.documents.find((d) => d.path === "docs/product/REQ-1.md")?.kind,
  ).toBe("requirements");
  expect(
    snapshot.documents.find(
      (d) => d.path === "docs/architecture/CURRENT_STATE.md",
    )?.kind,
  ).toBe("design");
  expect(
    snapshot.documents.find((d) => d.path === "docs/plans/PLAN-1.md")?.kind,
  ).toBe("planning");
  const entry = snapshot.navigation.entries.find(
    (e) => e.path === "docs/product/REQ-1.md",
  )!;
  expect(entry.classification).toBe("declared");
  expect(entry.status).toBe("active");
  expect(entry.sources).toContainEqual({
    path: "docs/README.md",
    line: 4,
    label: "主需求：正式需求",
  });
  expect(
    snapshot.navigation.entries
      .find((e) => e.path === "docs/support.md")
      ?.sources.some((s) => s.label.startsWith("任务依据")),
  ).toBe(true);
  expect(snapshot.documents.find((d) => d.path === "docs/misc.md")?.kind).toBe(
    "unclassified",
  );
  expect(
    snapshot.navigation.entries.find((e) => e.path === "docs/product/draft.md")
      ?.status,
  ).toBe("draft");
  expect(snapshot.navigation.gaps.some((g) => g.includes("规划"))).toBe(true);
  expect(snapshot.warnings.some((w) => w.code === "navigation-path")).toBe(
    true,
  );
  expect(snapshot.documents.some((d) => /outside|https/.test(d.path))).toBe(
    false,
  );
  expect(
    snapshot.relations.find(
      (r) =>
        r.targetPath === "docs/architecture/CURRENT_STATE.md" &&
        r.section === "存储",
    )?.state,
  ).toBe("resolved");
  expect(
    snapshot.relations.find(
      (r) =>
        r.source.path === "docs/product/REQ-1.md" &&
        r.targetPath === "docs/plans/PLAN-1.md",
    )?.state,
  ).toBe("resolved");
  const prompt = organizationPrompt(project.name, root, snapshot.navigation);
  expect(prompt).toContain("docs/product/REQ-1.md");
  expect(prompt).toContain("不要补造");
  expect(prompt).toContain("不代表已读完或已确认全部用户需求");
  for (const [filename, content] of originals)
    expect(await readFile(path.join(root, filename), "utf8")).toBe(content);
});
it("refresh discovers newly registered documents, removes withdrawn registrations and honors explicit overrides and exclusions", async () => {
  const project = await register();
  const first = (await runtime.store.refresh(project.id)).snapshot!;
  await file("docs/product/new.md", "---\nstatus: active\n---\n# 新需求\n");
  await file(
    "docs/README.md",
    index.replace(
      "- 草案：[未确认需求](product/draft.md)",
      "- 新需求：[新增需求](product/new.md)",
    ),
  );
  expect(runtime.store.view(project.id).snapshot?.id).toBe(first.id);
  const second = (await runtime.store.refresh(project.id)).snapshot!;
  expect(second.documents.some((d) => d.path === "docs/product/new.md")).toBe(
    true,
  );
  expect(second.documents.some((d) => d.path === "docs/product/draft.md")).toBe(
    false,
  );
  await runtime.registry.update(project.id, {
    name: project.name,
    config: {
      ...project.config,
      rules: { ...project.config.rules, design: ["docs/misc.md"] },
      excludes: ["docs/product/new.md"],
    },
  });
  expect(runtime.store.view(project.id).configChanged).toBe(true);
  const third = (await runtime.store.refresh(project.id)).snapshot!;
  expect(third.documents.find((d) => d.path === "docs/misc.md")?.kind).toBe(
    "design",
  );
  expect(
    third.navigation.entries.find((e) => e.path === "docs/misc.md")
      ?.classification,
  ).toBe("manual");
  expect(third.documents.some((d) => d.path === "docs/product/new.md")).toBe(
    false,
  );
  expect(
    third.navigation.entries.find((e) => e.path === "docs/product/new.md")
      ?.availability,
  ).toBe("excluded");
});
it("follows paragraph full, collapsed and shortcut reference links with source positions and excludes", async () => {
  await file(
    "docs/README.md",
    "# 文档中心\n\n需求入口：[正式需求][req]\n\n[草案][]\n\n[补充说明]\n\n[req]: product/REQ-1.md\n[草案]: product/draft.md\n[补充说明]: misc.md\n",
  );
  const project = await register();
  const first = (await runtime.store.refresh(project.id)).snapshot!;
  expect(first.documents.some((d) => d.path === "docs/product/REQ-1.md")).toBe(
    true,
  );
  expect(first.documents.some((d) => d.path === "docs/product/draft.md")).toBe(
    true,
  );
  expect(
    first.navigation.entries.find((e) => e.path === "docs/product/REQ-1.md")
      ?.sources,
  ).toContainEqual({ path: "docs/README.md", line: 3, label: "正式需求" });
  expect(first.relations.find((r) => r.raw === "product/REQ-1.md")?.state).toBe(
    "resolved",
  );
  await runtime.registry.update(project.id, {
    name: project.name,
    config: { ...project.config, excludes: ["docs/product/draft.md"] },
  });
  const excluded = (await runtime.store.refresh(project.id)).snapshot!;
  expect(
    excluded.documents.some((d) => d.path === "docs/product/draft.md"),
  ).toBe(false);
});
it("recovers a deleted known optional index with fresh content but honors deliberate exclusions and later withdrawal", async () => {
  await file(
    ".workflow-system/PROJECT_PROFILE.yaml",
    "paths:\n  workflow_home: notes/治理\n  documentation_files: []\n",
  );
  const project = await register();
  const first = (await runtime.store.refresh(project.id)).snapshot!;
  expect(first.documents.some((d) => d.path === "docs/product/REQ-1.md")).toBe(
    true,
  );
  await unlink(path.join(root, "docs/README.md"));
  await file("docs/product/REQ-1.md", "# 更新的需求正文\n\n必须重新读取。\n");
  const recovered = (await runtime.store.refresh(project.id)).snapshot!;
  expect(recovered.navigation.incomplete).toBe(true);
  expect(
    recovered.documents.find((d) => d.path === "docs/product/REQ-1.md")?.raw,
  ).toContain("必须重新读取");
  expect(
    recovered.navigation.entries.find((e) => e.path === "docs/README.md")
      ?.availability,
  ).toBe("missing");
  expect(
    recovered.warnings.some(
      (w) => w.path === "docs/README.md" && w.code === "navigation-read",
    ),
  ).toBe(true);
  expect(
    recovered.navigation.entries
      .find((e) => e.path === "docs/product/REQ-1.md")
      ?.sources.some((s) => s.label.includes("上次登记范围")),
  ).toBe(true);
  await runtime.registry.update(project.id, {
    name: project.name,
    config: { ...project.config, excludes: ["docs/README.md"] },
  });
  const excluded = (await runtime.store.refresh(project.id)).snapshot!;
  expect(
    excluded.documents.some((d) => d.path === "docs/product/REQ-1.md"),
  ).toBe(false);
  expect(excluded.navigation.incomplete).toBe(false);
  await runtime.registry.update(project.id, {
    name: project.name,
    config: project.config,
  });
  await file("docs/README.md", "# 文档中心\n\n不再登记这些材料。\n");
  const withdrawn = (await runtime.store.refresh(project.id)).snapshot!;
  expect(
    withdrawn.documents.some((d) => d.path === "docs/product/REQ-1.md"),
  ).toBe(false);
  expect(withdrawn.navigation.incomplete).toBe(false);
});
it("an unreadable index rereads previously registered files while marking source uncertainty instead of dropping usable content", async () => {
  const project = await register();
  await runtime.store.refresh(project.id);
  await file("docs/README.md", "---\nstatus: [broken\n---\n# 文档中心\n");
  await file("docs/product/REQ-1.md", "# 已更新的需求正文\n\n本次重新读取。\n");
  const view = await runtime.store.refresh(project.id);
  expect(view.attempt?.state).toBe("partial");
  expect(view.snapshot?.navigation.incomplete).toBe(true);
  expect(
    view.snapshot?.documents.find((d) => d.path === "docs/product/REQ-1.md")
      ?.raw,
  ).toContain("本次重新读取");
  expect(
    view.snapshot?.navigation.entries
      .find((e) => e.path === "docs/product/REQ-1.md")
      ?.sources.some((s) => s.label.includes("上次登记范围")),
  ).toBe(true);
});
it("reports missing registrations and bounded traversal without reading junction targets", async () => {
  const outside = path.join(directory, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.md"), "OUTSIDE_SECRET");
  await symlink(
    outside,
    path.join(root, "docs/linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await file(
    "docs/README.md",
    `${index}\n## 需求\n- 缺失：\`docs/missing.md\`\n- 链接目录：\`docs/linked/secret.md\`\n`,
  );
  const project = await register();
  const snapshot = (await runtime.store.refresh(project.id)).snapshot!;
  expect(
    snapshot.navigation.entries.find((e) => e.path === "docs/missing.md")
      ?.availability,
  ).toBe("missing");
  expect(
    snapshot.navigation.entries.find((e) => e.path === "docs/linked/secret.md")
      ?.availability,
  ).toBe("error");
  expect(snapshot.documents.some((d) => d.raw.includes("OUTSIDE_SECRET"))).toBe(
    false,
  );
  for (let i = 0; i < 5; i++)
    await file(
      `docs/chain-${i}/README.md`,
      `# 文档中心\n\n[下一层](../chain-${i + 1}/README.md)\n`,
    );
  await file("docs/README.md", `${index}\n[入口](chain-0/README.md)\n`);
  const limited = (await runtime.store.refresh(project.id)).snapshot!;
  expect(limited.navigation.incomplete).toBe(true);
  expect(limited.warnings.some((w) => w.code === "navigation-limit")).toBe(
    true,
  );
});
it("keeps contradictory declarations unresolved and preserves supersession rather than treating obsolete designs as current", async () => {
  await file(
    "docs/README.md",
    `${index}\n## 需求\n- 主需求：\`docs/misc.md\`\n## 设计\n- 技术设计：\`docs/misc.md\`\n## 需求\n- 需求正文：\`docs/misc.md\`\n`,
  );
  await file(
    "docs/architecture/CURRENT_STATE.md",
    "---\nstatus: active\nsuperseded_by: docs/replacement.md\n---\n# 历史架构\n",
  );
  await file(
    "docs/replacement.md",
    "---\ndocument_type: design\nstatus: 草案\n---\n# 设计草案\n",
  );
  const project = await register();
  const snapshot = (await runtime.store.refresh(project.id)).snapshot!;
  expect(
    snapshot.navigation.entries.find((e) => e.path === "docs/misc.md")
      ?.classification,
  ).toBe("unclassified");
  expect(snapshot.documents.find((d) => d.path === "docs/misc.md")?.kind).toBe(
    "unclassified",
  );
  expect(
    snapshot.navigation.entries.find(
      (e) => e.path === "docs/architecture/CURRENT_STATE.md",
    )?.supersededBy,
  ).toBe("docs/replacement.md");
  expect(snapshot.navigation.gaps.some((g) => g.includes("设计"))).toBe(true);
  expect(
    snapshot.warnings.some((w) => w.code === "navigation-classification"),
  ).toBe(true);
});

it("inventories disconnected documents without reading or declaring them, supports explicit roots, and preserves project files", async () => {
  await file("docs/disconnected/architecture.md", "# NOT_READ_OR_CLASSIFIED\n");
  await file("docs/records/receipt.md", "# DEFAULT_EXCLUDED\n");
  await file("notes/extra.md", "# CUSTOM_CANDIDATE\n");
  const project = await register();
  const first = (await runtime.store.refresh(project.id)).snapshot!;
  expect(first.navigation.inventory?.candidates).toContain(
    "docs/disconnected/architecture.md",
  );
  expect(
    first.navigation.entries.some((e) => e.path.includes("disconnected")),
  ).toBe(false);
  expect(
    first.documents.some((d) => d.raw.includes("NOT_READ_OR_CLASSIFIED")),
  ).toBe(false);
  expect(first.navigation.inventory?.excluded).toContainEqual({
    path: "docs/records",
    reason: "默认跳过的目录",
  });
  expect(organizationPrompt(project.name, root, first.navigation)).toContain(
    "的 agent",
  );
  expect(organizationPrompt(project.name, root, first.navigation)).toContain(
    "docs/disconnected/architecture.md",
  );
  await runtime.registry.update(project.id, {
    name: project.name,
    config: {
      ...project.config,
      candidateRoots: ["notes"],
      excludes: ["notes/治理"],
    },
  });
  expect(runtime.store.view(project.id).configChanged).toBe(true);
  const second = (await runtime.store.refresh(project.id)).snapshot!;
  expect(second.navigation.inventory?.candidates).toEqual(["notes/extra.md"]);
  await runtime.registry.update(project.id, {
    name: project.name,
    config: { ...project.config, candidateRoots: [] },
  });
  expect(
    (await runtime.store.refresh(project.id)).snapshot!.navigation.inventory
      ?.candidates,
  ).toEqual([]);
  for (const [filename, content] of originals)
    expect(await readFile(path.join(root, filename), "utf8")).toBe(content);
});

it("recognizes canonical metadata and root task directories while following ordinary links without promoting reference purposes", async () => {
  await file(
    "docs/workflow/gov.md",
    "---\ndocument_kind: governance-document\npath_references:\n  - kind: repo-relative\n    raw: docs/design.md\n    normalized: docs/design.md\n  - kind: external\n    normalized: docs/ignored.md\n---\n# Canonical document\n",
  );
  await file("docs/design.md", "# Design\n\n[细节](detail.md)\n");
  await file("docs/detail.md", "# Details\n");
  await file("docs/ignored.md", "# Ignored reference kind\n");
  await file(
    "TASKS/task.md",
    "---\nkind: vnext-task-view\n---\n# Historical task\n\n- Task ID: TASK-123\n- Status: archived\n\n[治理](../docs/workflow/gov.md)\n",
  );
  const project = await register();
  const s = (await runtime.store.refresh(project.id)).snapshot!;
  expect(s.documents.find((d) => d.path === "docs/workflow/gov.md")?.kind).toBe(
    "management",
  );
  expect(s.documents.some((d) => d.path === "docs/detail.md")).toBe(true);
  expect(s.documents.some((d) => d.path === "docs/ignored.md")).toBe(false);
  expect(s.tasks.find((t) => t.number === "TASK-123")?.statuses[0].text).toBe(
    "archived",
  );
  expect(
    s.relations.find(
      (r) =>
        r.source.path === "docs/workflow/gov.md" &&
        r.targetPath === "docs/design.md",
    )?.state,
  ).toBe("resolved");
  expect(
    s.navigation.entries.find((e) => e.path === "docs/design.md")
      ?.classification,
  ).toBe("suggested");
  expect(
    s.files.some(
      (f) => f.path === "notes/治理/TASKS" && f.status === "missing",
    ),
  ).toBe(false);
});

it("keeps default governance classification when a bare catalog entry has no purpose label", async () => {
  await file(
    "notes/治理/DOCUMENT_CATALOG.md",
    "# 文档目录\n- `notes/治理/CURRENT_TASK.md`\n- `notes/治理/ROADMAP.md`\n",
  );
  await file("notes/治理/ROADMAP.md", "# Roadmap\n");
  const s = (await runtime.store.refresh((await register()).id)).snapshot!;
  expect(
    s.documents.find((d) => d.path === "notes/治理/CURRENT_TASK.md")?.kind,
  ).toBe("management");
  expect(
    s.navigation.entries.find((e) => e.path === "notes/治理/ROADMAP.md")
      ?.classification,
  ).toBe("declared");
});

it("ignores naming placeholders, resolves unique registered shorthand, and reports ambiguous shorthand without missing files", async () => {
  await file("docs/changes/CHANGELOG.md", "# Changes\n");
  await file("docs/a/NOTES.md", "# A\n");
  await file("docs/b/NOTES.md", "# B\n");
  await file(
    "docs/README.md",
    `${index}\n## 维护\n- 日志：\`docs/changes/CHANGELOG.md\`\n- 摘要：\`CHANGELOG.md\`\n- 新建 \`REQ-YYYYMMDD-<slug>.md\`\n- 示例：\`docs/{{topic}}.md\`\n- A：\`docs/a/NOTES.md\`\n- B：\`docs/b/NOTES.md\`\n- 说明：\`NOTES.md\`\n- 实际缺失：[正文](missing.md)\n`,
  );
  const s = (await runtime.store.refresh((await register()).id)).snapshot!;
  expect(
    s.files.filter((f) => f.status === "missing").map((f) => f.path),
  ).toContain("docs/missing.md");
  expect(
    s.navigation.entries.some((e) =>
      /YYYY|slug|\{\{|^CHANGELOG|^NOTES/.test(e.path),
    ),
  ).toBe(false);
  expect(
    s.navigation.entries
      .find((e) => e.path === "docs/changes/CHANGELOG.md")
      ?.sources.some((source) => source.label.startsWith("简写路径")),
  ).toBe(true);
  expect(
    s.warnings.some(
      (w) =>
        w.code === "navigation-shorthand" && w.message.includes("多个候选"),
    ),
  ).toBe(true);
  expect(s.warnings.some((w) => w.code === "navigation-example")).toBe(true);
});

it("reports evidence truncation separately from navigation limits and continues following references", async () => {
  let entries = index;
  for (let i = 0; i < 20; i++) {
    entries += `\n- [Reference ${i}](ref-${i}.md)`;
    await file(
      `docs/ref-${i}.md`,
      "---\nrelated_docs: [docs/common.md]\n---\n# Reference\n",
    );
  }
  await file("docs/README.md", entries);
  await file("docs/common.md", "# Common\n\n[Child](child.md)\n");
  await file("docs/child.md", "# Child\n");
  const s = (await runtime.store.refresh((await register()).id)).snapshot!;
  expect(
    s.navigation.entries.find((e) => e.path === "docs/common.md")
      ?.sourcesTruncated,
  ).toBe(true);
  expect(
    s.navigation.entries.find((e) => e.path === "docs/common.md")?.sources,
  ).toHaveLength(16);
  expect(s.navigation.incomplete).toBe(false);
  expect(
    s.warnings.some(
      (w) => w.code === "navigation-source-limit" && w.level === "info",
    ),
  ).toBe(true);
  expect(s.warnings.some((w) => w.code === "navigation-limit")).toBe(false);
  expect(s.documents.some((d) => d.path === "docs/child.md")).toBe(true);
});

it("can opt into document records while preserving hard exclusions and configuration snapshots", async () => {
  await file("docs/records/INDEX.md", "# Records\n\n[Change](change.md)\n");
  await file("docs/records/change.md", "# Change\n");
  await file("docs/journal/entry.md", "# JOURNAL_SECRET\n");
  await file(
    "docs/README.md",
    `${index}\n[变更记录](records/INDEX.md)\n[日志](journal/entry.md)\n`,
  );
  const p = await register();
  const first = (await runtime.store.refresh(p.id)).snapshot!;
  expect(first.documents.some((d) => d.path.includes("/records/"))).toBe(false);
  const updated = await runtime.registry.update(p.id, {
    name: p.name,
    config: { ...p.config, includeRecords: true },
  });
  expect(updated.configVersion).toBe(p.configVersion + 1);
  expect(runtime.store.view(p.id).configChanged).toBe(true);
  expect(runtime.store.view(p.id).snapshot?.id).toBe(first.id);
  const second = (await runtime.store.refresh(p.id)).snapshot!;
  expect(
    second.documents.some((d) => d.path === "docs/records/change.md"),
  ).toBe(true);
  expect(second.documents.some((d) => d.raw.includes("JOURNAL_SECRET"))).toBe(
    false,
  );
  expect(
    second.relations.find((r) => r.targetPath === "docs/journal/entry.md")
      ?.state,
  ).toBe("excluded");
});

it("preserves malformed metadata and continues explicit Markdown navigation from the readable body", async () => {
  const content =
    "---\nowner: @maintainer\nrelated_docs: [docs/untrusted-meta.md]\n---\n# Document\n\n[正文引用](body.md)\n";
  await file("docs/broken.md", content);
  await file("docs/body.md", "# Body\n");
  await file("docs/untrusted-meta.md", "# Untrusted metadata\n");
  await file("docs/README.md", `${index}\n[格式错误](broken.md)\n`);
  const s = (await runtime.store.refresh((await register()).id)).snapshot!;
  expect(s.documents.find((d) => d.path === "docs/broken.md")?.raw).toBe(
    content,
  );
  expect(
    s.warnings.some(
      (w) => w.code === "navigation-metadata" && w.path === "docs/broken.md",
    ),
  ).toBe(true);
  expect(s.documents.some((d) => d.path === "docs/body.md")).toBe(true);
  expect(s.documents.some((d) => d.path === "docs/untrusted-meta.md")).toBe(
    false,
  );
  expect(await readFile(path.join(root, "docs/broken.md"), "utf8")).toBe(
    content,
  );
});

it("checks unresolved reference existence without reading out-of-scope content", async () => {
  await file(
    "docs/refs.md",
    "# References\n\n[Exists](present.md)\n[Missing](absent.md)\n[Excluded](excluded.md)\n[Example](REQ-YYYYMMDD-example.md)\n[Unsafe](../../outside.md)\n",
  );
  await file("docs/present.md", "# OUT_OF_SCOPE_BODY\n");
  await file("docs/excluded.md", "# EXCLUDED_BODY\n");
  const p = await runtime.registry.add({
    name: "Manual references",
    root,
    config: {
      autoDiscover: false,
      rules: {
        management: [],
        requirements: [],
        design: ["docs/refs.md"],
        planning: [],
      },
      excludes: ["docs/excluded.md"],
    },
  });
  const s = (await runtime.store.refresh(p.id)).snapshot!;
  const state = (label: string) =>
    s.relations.find((r) => r.label === label)?.state;
  expect(state("Exists")).toBe("available");
  expect(state("Missing")).toBe("missing");
  expect(state("Excluded")).toBe("excluded");
  expect(state("Example")).toBe("example");
  expect(state("Unsafe")).toBe("unsafe");
  expect(s.documents.map((d) => d.path)).not.toContain("docs/present.md");
});
