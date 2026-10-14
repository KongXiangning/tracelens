import path from "node:path";
import os from "node:os";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectRegistry } from "../src/server/registry.js";
import { buildSnapshot } from "../src/server/snapshot.js";
import { discover } from "../src/server/scanner.js";
import { documentIssues } from "../src/shared/document-health.js";
import { organizationPrompt } from "../src/shared/organization-prompt.js";
import { DocumentSummary } from "../src/web/navigation-audit.js";
import { productDiagnosticArea } from "../src/shared/product-health.js";
import { ProductOverview, RequirementsPage } from "../src/web/product.js";
import { scopeGroups } from "../src/shared/product-scope.js";
import type { ScanConfig } from "../src/shared/types.js";

let temporary: string, root: string, data: string;
const emptyConfig = (): ScanConfig => ({
  rules: { management: [], requirements: [], design: [], planning: [] },
  excludes: [],
});
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "tracelens-vnext-"));
  root = path.join(temporary, "项目");
  data = path.join(temporary, "tool-data");
  await mkdir(root);
});
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

it("adds a vNext project with standard product reading and never changes its documents", async () => {
  await cp(path.resolve("examples/product-comprehensive"), root, {
    recursive: true,
  });
  const manifest = path.join(root, ".workflow-system/PRODUCT.yaml");
  const document = path.join(root, "docs/product/PROJECT.md");
  const before = await Promise.all([readFile(manifest), readFile(document)]);
  const preview = await discover(root, data);
  const registry = new ProjectRegistry(data);
  const project = await registry.add({
    name: "自动读取",
    root,
    config: preview.config,
  });
  const snapshot = await buildSnapshot(project, new Date().toISOString());
  expect(project.config.readingMode).toBe("vnext");
  expect(
    preview.productRead?.items.some(
      (item) => item.type === "requirement" && item.usable,
    ),
  ).toBe(true);
  expect(
    snapshot.product?.items.some(
      (item) => item.type === "requirement" && item.usable,
    ),
  ).toBe(true);
  expect(await Promise.all([readFile(manifest), readFile(document)])).toEqual(
    before,
  );
  // Structured requirements/designs are not missing merely because the generic
  // document navigator could not classify their containing Markdown file.
  expect(
    documentIssues(snapshot.navigation, snapshot.product).some((issue) =>
      issue.message.includes("需求文档"),
    ),
  ).toBe(false);
});

it("automatically reads disconnected standard documents and document records without promoting them to product definitions", async () => {
  for (const relative of [
    "docs/deep/a/b/c/d/req.md",
    "docs/changes/records/change.md",
    "docs/unknown.md",
  ]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(
      path.join(root, relative),
      "\uFEFF---\nowner: @maintainer\n---\n# Existing document\n\nEntire body stays readable.\n",
    );
  }
  await mkdir(path.join(root, ".workflow-system/records/events"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, ".workflow-system/records/events/event.json"),
    '{"hidden":true}',
  );
  const registry = new ProjectRegistry(data);
  const project = await registry.add({
    name: "完整文档目录",
    root,
    config: emptyConfig(),
  });
  const snapshot = await buildSnapshot(project, new Date().toISOString());
  expect(
    snapshot.documents.filter((d) => d.path.startsWith("docs/")).length,
  ).toBe(3);
  expect(snapshot.documents.some((d) => d.path.includes("event.json"))).toBe(
    false,
  );
  expect(
    snapshot.navigation.entries.every((e) => e.classification !== "declared"),
  ).toBe(true);
  expect(
    snapshot.warnings.some((w) =>
      ["metadata", "navigation-metadata", "parse"].includes(w.code),
    ),
  ).toBe(false);
  expect(snapshot.product?.items).toEqual([]);
  for (const document of snapshot.documents) {
    expect(createHash("sha256").update(document.raw).digest("hex")).toBe(
      document.digest,
    );
    expect(document.headings[0].line).toBe(4);
  }
});

it("separates pending business states and unavailable evidence from readable product definitions and shows the business scope", async () => {
  await cp(path.resolve("examples/product-comprehensive"), root, {
    recursive: true,
  });
  const registry = new ProjectRegistry(data);
  const project = await registry.add({
    name: "业务视图",
    root,
    config: emptyConfig(),
  });
  const snapshot = await buildSnapshot(project, new Date().toISOString());
  const product = snapshot.product!;
  expect(
    productDiagnosticArea({
      code: "DEFINITION_UNKNOWN",
      severity: "info",
      message: "pending",
    }),
  ).toBe("pending");
  expect(
    productDiagnosticArea({
      code: "SOURCE_UNAVAILABLE",
      severity: "warning",
      message: "missing",
    }),
  ).toBe("evidence");
  const context = {
    snapshot,
    open: () => {},
    openProduct: () => {},
    openTask: () => {},
    relations: () => {},
  };
  const html = renderToStaticMarkup(
    <ProductOverview
      context={context}
      configure={() => {}}
      requirements={() => {}}
      planning={() => {}}
    />,
  );
  expect(html).toContain("需求全景");
  expect(html).toContain("overview-reading-details");
  expect(html).not.toContain("项目需求总纲与完整正文");
  expect(html).toContain("查看全部需求");
  expect(html).not.toContain("data-overview-card");
  expect(html).not.toContain("已报告交付与待核对");
  expect(html).not.toContain("对象：unknown");
  const page = renderToStaticMarkup(
    <RequirementsPage {...context} configure={() => {}} select={() => {}} />,
  );
  expect(page).toContain("目标与需求图");
  expect(page).not.toContain("含无 scope 条目");
  const goal = product.items.find((item) => item.type === "goal")!;
  const requirement = product.items.find(
    (item) => item.type === "requirement",
  )!;
  const child = { ...requirement, key: "child", id: "REQ-CHILD" };
  const isolated = { ...requirement, key: "isolated", id: "REQ-ISOLATED" };
  const secondGoal = { ...goal, key: "goal-two", id: "GOAL-TWO" };
  const module = product.items.find((item) => item.type === "module")!;
  const secondModule = { ...module, key: "module-two", id: "MODULE-TWO" };
  product.items.push(child, isolated, secondGoal, secondModule);
  const edge = (
    ownerKey: string,
    targetKey: string,
    relation: string,
    origin: "declared" | "inferred" = "declared",
  ) => ({
    key: `${ownerKey}/${targetKey}`,
    ownerKey,
    targetKey,
    resolution: "resolved" as const,
    link: {
      id: `${ownerKey}/${targetKey}`,
      target: targetKey,
      relation,
      origin,
      state: "active" as const,
    },
  });
  product.relations = [
    edge(requirement.key, module.key, "part_of"),
    edge(child.key, secondModule.key, "part_of"),
    edge(module.key, secondModule.key, "part_of"),
    edge(secondModule.key, module.key, "part_of"), // A module cycle must not hang traversal.
    edge(module.key, goal.key, "supports"),
    edge(module.key, secondGoal.key, "supports", "inferred"),
    {
      ...edge(isolated.key, goal.key, "supports"),
      link: {
        ...edge(isolated.key, goal.key, "supports").link,
        state: "dismissed",
      },
    },
  ];
  const grouped = scopeGroups(product, [requirement, child, isolated]);
  expect(
    grouped.groups
      .find((row) => row.group.key === goal.key)
      ?.requirements.map((entry) => entry.item.key),
  ).toEqual([requirement.key, child.key]);
  expect(
    grouped.groups
      .find((row) => row.group.key === secondGoal.key)
      ?.requirements.find((entry) => entry.item.key === child.key),
  ).toMatchObject({ inferred: true, indirect: true });
  expect(grouped.ungrouped.map((item) => item.key)).toEqual([isolated.key]);
  product.relations = [
    edge(child.key, requirement.key, "part_of"),
    edge(requirement.key, goal.key, "supports"),
  ];
  expect(scopeGroups(product, [child]).ungrouped).toEqual([child]);
});

it("upgrades an old unchecked project once, preserving identity and exclusions", async () => {
  await mkdir(data);
  const id = randomUUID();
  await writeFile(
    path.join(data, "projects.json"),
    JSON.stringify([
      {
        id,
        name: "旧项目",
        root,
        configVersion: 4,
        config: {
          ...emptyConfig(),
          excludes: ["docs/private/**"],
          product: {
            enabled: false,
            manifestPath: ".workflow-system/PRODUCT.yaml",
          },
        },
      },
    ]),
  );
  const registry = new ProjectRegistry(data);
  await registry.load();
  expect(registry.get(id)).toMatchObject({
    id,
    root,
    configVersion: 5,
    config: {
      readingMode: "vnext",
      autoDiscover: true,
      product: { enabled: true },
      excludes: ["docs/private/**"],
    },
  });
  const restarted = new ProjectRegistry(data);
  await restarted.load();
  expect(restarted.get(id)).toEqual(registry.get(id));
});

it("keeps custom scope explicit and supports returning to automatic vNext reading", async () => {
  const registry = new ProjectRegistry(data);
  const config: ScanConfig = {
    ...emptyConfig(),
    readingMode: "custom",
    autoDiscover: false,
    product: { enabled: false, manifestPath: "docs/alternate.yaml" },
  };
  const project = await registry.add({ name: "兼容项目", root, config });
  expect(project.config).toEqual(config);
  const updated = await registry.update(project.id, {
    name: project.name,
    config: { ...config, readingMode: "vnext" },
  });
  expect(updated.config.product).toEqual({
    enabled: true,
    manifestPath: ".workflow-system/PRODUCT.yaml",
  });
  expect(updated.config.autoDiscover).toBe(true);
  expect(updated.configVersion).toBe(project.configVersion + 1);
});

it("shows missing registered files and includes product gaps in a vNext discussion prompt", async () => {
  await mkdir(path.join(root, "docs"));
  await writeFile(
    path.join(root, "docs/README.md"),
    "# 文档中心\n\n## 需求\n[需求](product/missing.md)\n",
  );
  const preview = await discover(root, data);
  const issues = documentIssues(preview.navigation, preview.product);
  expect(issues).toContainEqual(
    expect.objectContaining({
      path: "docs/product/missing.md",
      message: expect.stringContaining("文件缺失"),
    }),
  );
  expect(issues).toContainEqual(
    expect.objectContaining({
      path: ".workflow-system/PRODUCT.yaml",
      message: expect.stringContaining("未找到"),
    }),
  );
  const prompt = organizationPrompt(
    "缺口项目",
    root,
    preview.navigation,
    preview.product,
  );
  expect(prompt).toContain("maintain-project");
  expect(prompt).toContain("docs/product/missing.md");
  expect(prompt).toContain("不要求用户上传、选择缺失文件");
  expect(prompt).toContain("不要补造");
  const html = renderToStaticMarkup(
    <DocumentSummary
      report={preview.navigation}
      product={preview.product}
      projectName="缺口项目"
      root={root}
    />,
  );
  expect(html).toContain("交给 vNext 整理");
  expect(html).toContain("文件缺失");
  expect(html).not.toContain("textarea");
  expect(html).not.toContain("registration-row");
});
