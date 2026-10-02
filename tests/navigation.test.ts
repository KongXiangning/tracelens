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
