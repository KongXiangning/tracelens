import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../dist/server/app.js";
import { defaultConfig } from "../dist/server/config.js";
import { buildOverviewData } from "../dist/shared/overview-data.js";

await mkdir("output/playwright", { recursive: true });
const run = await mkdtemp(path.resolve("output/playwright/graph-drag-"));
const root = path.join(run, "example");
await cp("examples/product-scoped", root, { recursive: true });
const runtime = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const project = await runtime.registry.add({
  name: "临时图布局验收",
  root,
  config: defaultConfig(),
});
const view = structuredClone(await runtime.store.refresh(project.id));
const snapshot = view.snapshot;
const requirement = snapshot.product.items.find(
  (item) => item.id === "R-IMPORT",
);
snapshot.tasks = ["a", "b"].map((id) => ({
  id,
  title: `拖动测试 ${id}`,
  current: false,
  source: requirement.source,
  statuses: [],
  goals: [],
  steps: [],
  checks: [],
  issues: [],
}));
snapshot.relations = [
  {
    id: "drag-reference",
    from: "a",
    to: "b",
    type: "reference",
    state: "resolved",
    label: "引用",
    source: requirement.source,
    targetPath: requirement.source.path,
  },
];
const overview = {
  ...snapshot,
  revision: "drag-fixture",
  overview: buildOverviewData(snapshot),
};
delete overview.product;
delete overview.documents;
const errors = [];
let browser;
try {
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/projects/*/overview*", (route) =>
    route.fulfill({ json: { ...view, snapshot: overview } }),
  );
  await page.route("**/api/projects/*/snapshot?*", (route) =>
    route.fulfill({ json: view }),
  );
  async function drag(graph, node) {
    await node.waitFor();
    await node.scrollIntoViewIfNeeded();
    const original = await node.getAttribute("style");
    const edges = await graph
      .locator(".react-flow__edge-path")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("d")),
      );
    const bounds = await node.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 70,
      bounds.y + bounds.height / 2 + 55,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForFunction(
      ({ selector, original }) =>
        document.querySelector(selector)?.getAttribute("style") !== original,
      {
        selector: await node.evaluate(
          (element) => `[data-id="${element.dataset.id}"]`,
        ),
        original,
      },
    );
    assert.notEqual(await node.getAttribute("style"), original);
    if (edges.length)
      assert.notDeepEqual(
        await graph
          .locator(".react-flow__edge-path")
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("d")),
          ),
        edges,
      );
    return original;
  }
  await page.goto(base);
  await page.getByRole("button", { name: "需求视图", exact: true }).click();
  const structure = page.locator(".requirements-v3-graph");
  const requirementNode = structure.locator(".react-flow__node").first();
  const original = await drag(structure, requirementNode);
  assert.equal(
    await page.locator('[data-product-id="R-IMPORT"]').count(),
    0,
    "Dragging a node must not open its inspector",
  );
  await page.reload();
  await requirementNode.waitFor();
  assert.equal(
    await requirementNode.getAttribute("style"),
    original,
    "Temporary positions reset on reload",
  );
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const center = page.getByRole("combobox", { name: "关联中心" });
  await center.selectOption(requirement.key);
  const productGraph = page.locator(".product-graph-container");
  await drag(
    productGraph,
    productGraph.locator(".react-flow__node.focus-node"),
  );
  assert.equal(await center.inputValue(), requirement.key);
  await center.selectOption("a");
  const referenceGraph = page.locator(
    ".graph-container:not(.product-graph-container)",
  );
  const target = referenceGraph.locator('.react-flow__node[data-id="b"]');
  const defaultPosition = await drag(referenceGraph, target);
  assert.equal(
    await center.inputValue(),
    "a",
    "Dragging a Task must not navigate to its detail",
  );
  await center.selectOption("b");
  await center.selectOption("a");
  await target.waitFor();
  assert.equal(
    await target.getAttribute("style"),
    defaultPosition,
    "Switching graph centers resets temporary positions",
  );
  await target.click();
  await page.locator(".tasks-page").waitFor();
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        checks: [
          "all three graphs drag",
          "edges follow nodes",
          "drag does not navigate",
          "reload and graph switch reset",
          "click still navigates",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ result: "passed", artifacts: run }));
} finally {
  await browser?.close();
  await runtime.app.close();
}
