import { expect, it } from "vitest";
import {
  requirementBindings,
  requirementHierarchy,
} from "../src/shared/product-hierarchy.js";
import { overviewTaskStates } from "../src/shared/overview-model.js";
import { sectionExcerpts } from "../src/shared/product-excerpts.js";
import type {
  ProductItem,
  ProductSnapshot,
  ProductBindingView,
} from "../src/shared/product-types.js";
import type { Snapshot, Task } from "../src/shared/types.js";
import { renderToStaticMarkup } from "react-dom/server";
import { CompactTasks } from "../src/web/product.js";
import { OverviewV3 } from "../src/web/product-v3.js";

const source = {
  documentId: "doc",
  path: "docs/product/PROJECT.md",
  line: 10,
  section: null,
  digest: "a",
};
const item = (
  id: string,
  scope: "current" | "retired" = "current",
): ProductItem => ({
  key: id,
  id,
  type: "requirement",
  version: 3,
  title: id,
  metadata: { id, type: "requirement", scope },
  usable: true,
  body: "",
  source,
  endLine: 10,
  metadataLine: 1,
  definitionSha256: null,
  diagnostics: [],
});
function graph() {
  const items = [
    item("A"),
    item("B"),
    item("SHARED"),
    item("LEAF"),
    item("ORPHAN"),
    item("OLD", "retired"),
  ];
  const links = [
    ["SHARED", "A"],
    ["SHARED", "B"],
    ["LEAF", "SHARED"],
    ["ORPHAN", "MISSING"],
    ["OLD", "A"],
  ];
  const product = {
    items,
    relations: links.map(([owner, parent], n) => ({
      key: "link" + n,
      ownerKey: owner,
      targetKey: parent === "MISSING" ? null : parent,
      resolution: parent === "MISSING" ? "missing" : "resolved",
      link: {
        id: "link" + n,
        target: parent,
        relation: "part_of",
        state: "active",
        origin: "declared",
      },
    })),
    bindings: [],
    assessments: [],
    sources: [],
    diagnostics: [],
  } as unknown as ProductSnapshot;
  return { product, items };
}
it("keeps one shared identity via either expanded path and preserves orphan/order entries", () => {
  const { product, items } = graph();
  const visible = (expanded: string[]) =>
    requirementHierarchy(product, items, new Set(expanded)).visible.map(
      (i) => i.id,
    );
  expect(visible([])).toEqual(["A", "B", "ORPHAN"]);
  expect(visible(["A", "B"])).toEqual(["A", "B", "SHARED", "ORPHAN"]);
  expect(visible(["B", "SHARED"])).toEqual([
    "A",
    "B",
    "SHARED",
    "LEAF",
    "ORPHAN",
  ]);
  expect(
    requirementHierarchy(
      product,
      items.filter((i) => !["A", "B"].includes(i.id)),
      new Set(),
    ).visible.map((i) => i.id),
  ).toEqual(["SHARED", "ORPHAN"]);
});
it("reveals a folded search/gap/direct target with all ancestors without exposing unrelated roots", () => {
  const { product, items } = graph();
  expect(
    requirementHierarchy(
      product,
      items,
      new Set(["A"]),
      new Set(["LEAF"]),
      true,
    ).visible.map((i) => i.id),
  ).toEqual(["A", "B", "SHARED", "LEAF"]);
});
const binding = (
  key: string,
  owner: string,
  id: string | null,
  state: ProductBindingView["match"]["state"] = "matched",
): ProductBindingView => ({
  key,
  ownerKey: owner,
  binding: {
    id: key,
    task: {
      task_id: id,
      source: { kind: "text", text: "synthetic source " + key, label: key },
    },
    role: key === "b2" ? "repair" : "implementation",
    coverage: "coverage " + key,
    state: "active",
    origin: "declared",
  },
  match: {
    task: { task_id: id, source: { kind: "text", text: key, label: key } },
    state,
    taskIds: id ? ["ui-" + id] : [],
    detail: state,
  },
  planItems: [],
  repairs: [],
});
it("collects only current composition bindings once, retaining scope/role/unknown identities", () => {
  const { product, items } = graph();
  product.bindings = [
    binding("b1", "A", "one"),
    binding("b2", "SHARED", "one", "conflict"),
    binding("b3", "LEAF", null, "identity-unknown"),
    binding("b4", "OLD", "old"),
  ];
  product.relations.push({
    key: "dep",
    ownerKey: "ORPHAN",
    targetKey: "A",
    resolution: "resolved",
    link: {
      id: "dep",
      target: "A",
      relation: "depends_on",
      origin: "declared",
      state: "active",
    },
  });
  product.bindings.push(binding("b5", "ORPHAN", "dependency"));
  const rows = requirementBindings(product, items[0]);
  expect(rows.map((b) => b.key)).toEqual(["b1", "b2", "b3"]);
  expect(rows.map((b) => [b.binding.role, b.binding.coverage])).toEqual([
    ["implementation", "coverage b1"],
    ["repair", "coverage b2"],
    ["implementation", "coverage b3"],
  ]);
});
it("keeps trusted Task lifecycle/navigation when another row conflicts, and retains two null rows", () => {
  const { product } = graph();
  const rows = [
    binding("b1", "A", "one"),
    binding("b2", "SHARED", "one", "conflict"),
    binding("b3", "LEAF", null, "identity-unknown"),
    binding("b6", "A", null, "identity-unknown"),
  ];
  const tasks = [
    {
      id: "ui-one",
      realTaskId: "one",
      runtimeLifecycle: "closed",
      title: "Actual task",
      statuses: [],
    },
  ] as unknown as Task[];
  const snapshot = {
    tasks,
    product,
    documents: [],
    warnings: [],
  } as unknown as Snapshot;
  const result = overviewTaskStates(snapshot, rows);
  expect(result.total).toBe(1);
  expect(result.unconfirmed).toBe(2);
  expect(result.states.map((s) => [s.label, s.count])).toEqual([
    ["已关闭", 1],
    ["身份未确认", 2],
  ]);
  expect(result.associationPending).toBe(3);
  const html = renderToStaticMarkup(
    <CompactTasks
      bindings={rows}
      context={{
        snapshot,
        open: () => {},
        openTask: () => {},
        openProduct: () => {},
        relations: () => {},
      }}
    />,
  );
  expect(html).toContain("Actual task");
  expect(html).toContain("已关闭");
  expect(html).toContain("关联待核对");
  expect(html).toContain("查看 Task / Step");
  expect(html).toContain("coverage b2");
  expect(html).toContain("来源需求：");
  product.items.unshift({
    ...item("PROJECT"),
    type: "project",
    metadata: { id: "PROJECT", type: "project", requirement_order: ["A", "B"] },
  });
  product.manifest = { entry: source.path } as ProductSnapshot["manifest"];
  product.bindings = rows;
  const overview = renderToStaticMarkup(
    <OverviewV3
      context={{
        snapshot,
        open: () => {},
        openTask: () => {},
        openProduct: () => {},
        relations: () => {},
      }}
      requirements={() => {}}
    />,
  );
  const parentCard = overview.match(
    /<article[^>]*data-overview-card="A"[^>]*>[\s\S]*?<\/article>/,
  )![0];
  expect(parentCard).toContain("共 3 个 Task，已关闭 1，身份未确认 2");
  expect(parentCard).not.toContain("已完成");
  expect(parentCard).toContain("已关闭</span><b>1</b>");
  expect(parentCard).toContain("身份未确认</span><b>2</b>");
  expect(parentCard).toContain("关联待核对 · 3");
});
it("extracts literal report sections with exact source lines, ignoring quoted/code headings", () => {
  const report = {
    ...item("REPORT"),
    body: "## [REPORT] 原报告\n### 覆盖范围\n直接集成场景。\n> ### 剩余与待核对\n> 引用里的标题不是章节。\n```md\n### 剩余与待核对\n```\n### 剩余与待核对\n新义务未核对。\n",
  };
  const excerpts = sectionExcerpts(report, ["覆盖范围", "剩余与待核对"]);
  expect(excerpts.map((e) => [e.title, e.source.line])).toEqual([
    ["覆盖范围", 11],
    ["剩余与待核对", 18],
  ]);
  expect(excerpts[1].text).toBe("新义务未核对。");
});
