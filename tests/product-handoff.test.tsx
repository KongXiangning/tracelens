import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { stringify } from "yaml";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildSnapshot } from "../src/server/snapshot.js";
import type { Project } from "../src/shared/types.js";
import { ProductOverview } from "../src/web/product.js";
import { renderToStaticMarkup } from "react-dom/server";

const oracle = path.resolve(
  "tests/product-oracle/handoff-20261010/offline-reader.mjs",
);
let temporary: string, root: string, project: Project;
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const productDocument = (items: unknown[], body: string) =>
  `---\n${stringify({ schema: "vnext-product-doc/v2", items })}---\n${body}`;
const projectBody =
  "## [P] Project\n### 项目定位\nSynthetic.\n### 盘点范围与未核对项\nPartial.\n";
const requirementBody = (id: string) =>
  `## [${id}] Requirement\n### 需求内容\nFull text.\n### 范围边界\nScope.\n### 验收要求\nAcceptance.\n`;
async function put(relative: string, raw: string) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), raw);
}
async function configure(selected: string[], excluded: string[] = []) {
  await put(
    ".workflow-system/PRODUCT.yaml",
    stringify({
      schema: "vnext-product-manifest/v2",
      project_id: "handoff",
      entry: "docs/PROJECT.md",
      managed_paths: ["docs/PROJECT.md", ...selected],
      source_paths: [],
      capture_paths: [],
      exclude_paths: excluded,
      maintenance: "enabled",
    }),
  );
}
async function tree(
  directory: string,
  prefix = "",
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  })) {
    const file = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await tree(directory, file));
    else if (entry.isFile())
      result[file] = hash(await readFile(path.join(directory, file)));
  }
  return result;
}
async function official() {
  const before = await tree(root);
  const result = spawnSync(process.execPath, [oracle, root], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(await tree(root)).toEqual(before);
  return JSON.parse(result.stdout);
}
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "tracelens-handoff-"));
  root = path.join(temporary, "project");
  await mkdir(root);
  project = {
    id: randomUUID(),
    name: "handoff",
    root,
    configVersion: 1,
    config: {
      readingMode: "custom",
      autoDiscover: false,
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
      product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
    },
  };
  await put(
    "docs/PROJECT.md",
    productDocument(
      [
        {
          id: "P",
          type: "project",
          inventory: {
            state: "partial",
            checked_sources: [],
            unreviewed_sources: [],
          },
        },
      ],
      projectBody,
    ),
  );
});
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

it("pins the current handoff oracle bytes rather than running an observed project's helper", async () => {
  expect(hash(await readFile(oracle))).toBe(
    "76110a5cc9b23d560e8135893cf4fd75b2dcb9b5cb600ec05d88dd24d6bf5eaa",
  );
});

it.each([
  "product-comprehensive",
  "product-e6",
  "product-planning/no-plan",
  "product-planning/multiple-plans",
  "product-planning/reordered",
])(
  "matches current vNext full metadata, body, locations and definition digest for %s",
  async (fixture) => {
    await cp(path.resolve("examples", fixture), root, { recursive: true });
    const before = await tree(root);
    const expected = await official();
    const snapshot = await buildSnapshot(project, "handoff");
    const product = snapshot.product!;
    const actual = product.items
      .filter((item) => item.usable)
      .map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        metadata: item.metadata,
        body: item.body,
        path: item.source.path,
        line: item.source.line,
        definition_sha256: item.definitionSha256,
      }));
    expect(actual.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      expected.items.sort((a: { id: string }, b: { id: string }) =>
        a.id.localeCompare(b.id),
      ),
    );
    expect(product.coverage.complete).toBe(expected.coverage.complete);
    const usable = product.items.filter((item) => item.usable);
    const idByKey = new Map(usable.map((item) => [item.key, item.id]));
    const reverse = usable.flatMap((item) => [
      ...product.relations
        .filter(
          (relation) =>
            relation.ownerKey === item.key && relation.link.state === "active",
        )
        .map((relation) => ({ owner: item.id, ...relation.link })),
      ...(item.type === "plan"
        ? item.metadata.targets!.map((target) => ({
            owner: item.id,
            relation: "plan-target",
            ...target,
          }))
        : []),
      ...(item.type === "assessment"
        ? [
            {
              owner: item.id,
              relation: "assessment-target",
              target: item.metadata.target,
            },
          ]
        : []),
    ]);
    expect(reverse).toEqual(expected.reverse_relations);
    const planTasks = usable
      .filter((item) => item.type === "plan")
      .map((plan) => ({
        plan_id: plan.id,
        work_items: plan.metadata.work_items!.map((work) => ({
          work_item_id: work.id,
          bindings: product.bindings
            .filter(
              (view) =>
                view.binding.state === "active" &&
                view.planItems.some(
                  (ref) =>
                    ref.planId === plan.id &&
                    ref.workItemId === work.id &&
                    ref.state === "resolved",
                ),
            )
            .map((view) => ({
              owner: idByKey.get(view.ownerKey),
              binding_id: view.binding.id,
              task: view.binding.task,
              role: view.binding.role,
              coverage: view.binding.coverage,
            })),
        })),
      }));
    expect(planTasks).toEqual(expected.plan_tasks);
    const codes = [
      "TASK_ID_UNCONFIRMED",
      "DEFINITION_UNKNOWN",
      "PENDING_SOURCES",
    ];
    expect(
      product.diagnostics
        .filter((entry) => codes.includes(entry.code))
        .map((entry) => `${entry.code}:${entry.itemId}`)
        .sort(),
    ).toEqual(
      expected.diagnostics
        .filter((entry: { code: string }) => codes.includes(entry.code))
        .map(
          (entry: { code: string; item_id: string }) =>
            `${entry.code}:${entry.item_id}`,
        )
        .sort(),
    );
    if (fixture.endsWith("reordered")) {
      const plan = product.items.find((item) => item.id === "PLAN-LOCAL")!;
      expect(plan.metadata.work_items?.map((item) => item.id)).toEqual([
        "B",
        "A",
        "C",
      ]);
      const report = product.items.find((item) => item.id === "AS-BASE")!;
      expect(report.metadata.verification).toBe("pass-reported");
      expect(report.metadata.implementation).toBe("partial-reported");
      expect(report.metadata.pending_sources?.length).toBeGreaterThan(0);
      expect(
        product.assessments.find((view) => view.assessmentKey === report.key)
          ?.definitionState,
      ).toBe("unknown");
      expect(
        product.bindings.filter((entry) =>
          entry.planItems.some(
            (ref) => ref.planId === "PLAN-LOCAL" && ref.workItemId === "B",
          ),
        ),
      ).toHaveLength(1);
      expect(
        product.bindings.some((entry) =>
          entry.planItems.some(
            (ref) =>
              ref.planId === "PLAN-LOCAL" &&
              ["A", "C"].includes(ref.workItemId),
          ),
        ),
      ).toBe(false);
      expect(snapshot.tasks).toEqual([]);
    }
    expect(await tree(root)).toEqual(before);
  },
);

it.each([
  [["docs/dist/*.md"], ["docs/dist/*.md"], true],
  [["docs/dist/P*.md"], ["docs/dist/*.md"], true],
  [["docs/dist/P?.md"], ["docs/dist/*.md"], true],
  [["docs/dist/**/PLAN.md"], ["docs/dist/**/*.md"], true],
  [["docs/dist/*/PLAN.md"], ["docs/dist/**/PLAN.md"], true],
  [["docs/*/*.md"], ["docs/dist/*.md"], true],
  [
    ["docs/dist/P*.md", "docs/dist/Q*.md"],
    ["docs/dist/P*.md", "docs/dist/Q*.md"],
    true,
  ],
  [["docs/dist/P*.md"], ["docs/dist/P.md", "docs/dist/P?*.md"], true],
  [["docs/dist/*.md"], ["docs/dist/PLAN.md"], false],
  [["docs/dist/P*.md"], ["docs/dist/P?.md"], false],
  [["docs/dist/P**.md"], ["docs/dist/P*.md"], false],
  [["docs/dist/**/*.md"], ["docs/dist/*.md"], false],
  [["docs/dist/*.md", "docs/dist/*.txt"], ["docs/dist/*.md"], false],
] as [string[], string[], boolean][])(
  "matches default/exclusion coverage for selected %j excluded %j",
  async (selected, excluded, complete) => {
    await put(
      "docs/dist/PLAN.md",
      productDocument(
        [{ id: "BLOCKED", type: "requirement", scope: "current" }],
        requirementBody("BLOCKED"),
      ),
    );
    await configure(selected, excluded);
    const expected = await official();
    const { product } = await buildSnapshot(project, "handoff");
    expect(product?.coverage.complete).toBe(complete);
    expect(product?.coverage.complete).toBe(expected.coverage.complete);
    expect(product?.coverage.omitted.map((entry) => entry.path)).toEqual(
      expected.coverage.omitted,
    );
    expect(
      product?.diagnostics.some(
        (entry) => entry.code === "IMPLICIT_PATH_EXCLUDED",
      ),
    ).toBe(!complete);
    expect(product?.items.map((item) => item.id)).toEqual(["P"]);
  },
);

it.each([
  "docs/dist/blocked.md",
  "node_modules/blocked.md",
  ".next/blocked.md",
  ".workflow-system/runtime/blocked.md",
  ".workflow-system/records/blocked.md",
])(
  "reports unread selected default exclusion %s instead of complete coverage",
  async (blocked) => {
    await configure([blocked]);
    const expected = await official();
    const snapshot = await buildSnapshot(project, "handoff");
    expect(snapshot.product?.coverage.complete).toBe(false);
    expect(
      snapshot.product?.coverage.omitted.map((entry) => entry.path),
    ).toEqual(expected.coverage.omitted);
    expect(snapshot.product?.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IMPLICIT_PATH_EXCLUDED",
        path: blocked,
      }),
    );
    expect(snapshot.product?.items.map((item) => item.id)).toEqual(["P"]);
  },
);

it("retains a readable file that is also an unavailable glob prefix and names the independent range gap", async () => {
  await configure(["docs/REQ.md", "docs/REQ.md/**/*.md"]);
  await put(
    "docs/REQ.md",
    productDocument(
      [{ id: "R", type: "requirement", scope: "current" }],
      requirementBody("R"),
    ),
  );
  const expected = await official();
  const snapshot = await buildSnapshot(project, "handoff");
  expect(snapshot.product?.items.map((item) => item.id)).toEqual(["P", "R"]);
  expect(snapshot.product?.coverage.omitted.map((entry) => entry.path)).toEqual(
    expected.coverage.omitted,
  );
  expect(snapshot.product?.coverage.complete).toBe(false);
});

it("does not render missing product input as zero business requirements", async () => {
  const snapshot = await buildSnapshot(project, "handoff");
  expect(snapshot.product?.status).toBe("missing");
  const html = renderToStaticMarkup(
    <ProductOverview
      context={{
        snapshot,
        open: () => {},
        openProduct: () => {},
        openTask: () => {},
        relations: () => {},
      }}
      configure={() => {}}
      requirements={() => {}}
      planning={() => {}}
    />,
  );
  expect(html).not.toContain("目标与需求全景");
  expect(html).not.toContain("项目计划 · 0");
  expect(html).toContain("未发现 PRODUCT 入口");
});
