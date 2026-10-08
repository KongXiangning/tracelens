import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import { buildSnapshot } from "../src/server/snapshot.js";
import type { Snapshot } from "../src/shared/types.js";
import {
  ProductDetail,
  ProductStatusPanel,
  RequirementsPage,
  PlanningPage,
  TaskProductLinks,
} from "../src/web/product.js";
import { RelationsPage } from "../src/web/relations.js";
import { TasksPage } from "../src/web/pages.js";
import { SnapshotMarkdown } from "../src/web/reader.js";
import {
  buildProductGraph,
  productRelationsForFocus,
  ProductRelationPanel,
} from "../src/web/product-graph.js";

let comprehensive: Snapshot, e6: Snapshot, noPlan: Snapshot, multi: Snapshot;
const config = {
  rules: { management: [], requirements: [], design: [], planning: [] },
  excludes: [],
  product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
};
const context = (snapshot: Snapshot) => ({
  snapshot,
  open: () => {},
  openProduct: () => {},
  openTask: () => {},
  relations: () => {},
});
beforeAll(async () => {
  [comprehensive, e6, noPlan, multi] = await Promise.all(
    [
      "product-comprehensive",
      "product-e6",
      "product-planning/no-plan",
      "product-planning/multiple-plans",
    ].map((folder) =>
      buildSnapshot(
        {
          id: folder,
          name: "Synthetic UI fixture",
          root: path.resolve("examples", folder),
          config,
          configVersion: 1,
        },
        new Date().toISOString(),
      ),
    ),
  );
});

describe("PRODUCT UI interpretation and source rendering", () => {
  it("renders every type with complete metadata and absolute body line numbers", () => {
    const items = comprehensive.product!.items.filter((item) => item.usable);
    expect(new Set(items.map((item) => item.type)).size).toBe(9);
    for (const item of items) {
      const html = renderToStaticMarkup(
        <ProductDetail item={item} context={context(comprehensive)} />,
      );
      expect(html).toContain(item.id);
      expect(html).toContain(`data-line="${item.source.line}"`);
      expect(html).toContain("完整原始元数据");
      expect(html).toContain("完整业务正文");
    }
  });
  it("shows selected old report alongside pending evidence without adopting a latest report", () => {
    const view = comprehensive.product!.assessments.find(
      (entry) => entry.state === "selected",
    )!;
    const item = comprehensive.product!.items.find(
      (entry) => entry.key === view.requirementKey,
    )!;
    const html = renderToStaticMarkup(
      <ProductDetail item={item} context={context(comprehensive)} />,
    );
    expect(html).toContain("报告通过");
    expect(html).toContain("待对账新材料");
    expect(html).toContain("当前实现适用性仍需核对");
    const unselected = structuredClone(comprehensive);
    unselected.product!.assessments.find(
      (entry) => entry.requirementKey === item.key,
    )!.state = "unselected";
    const unselectedHtml = renderToStaticMarkup(
      <ProductDetail item={item} context={context(unselected)} />,
    );
    expect(unselectedHtml).toContain("未选择交付摘要");
    expect(unselectedHtml).not.toContain("报告通过");
  });
  it("distinguishes all product states and invalidates removed selection", () => {
    const states = [
      "disabled",
      "missing",
      "excluded",
      "unavailable",
      "unsupported",
      "partial",
      "ready",
      "empty",
    ] as const;
    const rendered = states.map((status) =>
      renderToStaticMarkup(
        <ProductStatusPanel
          product={{ ...comprehensive.product!, status }}
          open={() => {}}
        />,
      ),
    );
    expect(new Set(rendered).size).toBe(8);
    for (const [index, status] of states.entries()) {
      const expectedCoverage =
        status === "disabled"
          ? "未启用"
          : ["ready", "partial", "empty"].includes(status)
            ? "完整"
            : "未核对";
      expect(rendered[index]).toContain(
        `本次托管范围字节读取：${expectedCoverage}`,
      );
    }
    const invalidManifest = renderToStaticMarkup(
      <ProductStatusPanel
        product={{
          ...comprehensive.product!,
          status: "partial",
          manifest: null,
        }}
        open={() => {}}
      />,
    );
    expect(invalidManifest).toContain("本次托管范围字节读取：未核对");
    const incompleteRead = renderToStaticMarkup(
      <ProductStatusPanel
        product={{
          ...comprehensive.product!,
          status: "partial",
          coverage: { ...comprehensive.product!.coverage, complete: false },
        }}
        open={() => {}}
      />,
    );
    expect(incompleteRead).toContain("本次托管范围字节读取：存在未读范围");
    const html = renderToStaticMarkup(
      <RequirementsPage
        {...context(comprehensive)}
        selected="removed-stable-key"
        select={() => {}}
        configure={() => {}}
      />,
    );
    expect(html).toContain("所选条目已退出本次范围");
    expect(html).not.toContain('class="product-detail"');
  });
  it("keeps no-plan business scope and multi-plan selection explicit", () => {
    const noHtml = renderToStaticMarkup(
      <PlanningPage
        {...context(noPlan)}
        select={() => {}}
        configure={() => {}}
      />,
    );
    expect(noHtml).toContain("未记录项目计划");
    expect(noHtml).toContain("完整已知业务范围");
    for (const item of noPlan.product!.items.filter(
      (entry) => entry.type === "requirement",
    ))
      expect(noHtml).toContain(item.id);
    const html = renderToStaticMarkup(
      <PlanningPage
        {...context(multi)}
        select={() => {}}
        configure={() => {}}
      />,
    );
    expect(html).toContain("请选择要查看的计划");
    expect(html).not.toContain('class="product-detail"');
    for (const item of multi.product!.items.filter(
      (entry) => entry.type === "plan",
    ))
      expect(html).toContain(item.id);
  });
  it("preserves E6 original work order, scoped repair and task reverse navigation", () => {
    const plan = e6.product!.items.find(
      (item) => item.type === "plan" && item.usable,
    )!;
    const html = renderToStaticMarkup(
      <PlanningPage
        {...context(e6)}
        selected={plan.key}
        select={() => {}}
        configure={() => {}}
      />,
    );
    const ids = plan.metadata.work_items!.map((item) => item.id);
    const offsets = ids.map((id) => html.indexOf(`data-work-item-id="${id}"`));
    expect(offsets.every((value) => value >= 0)).toBe(true);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(html).toContain("修复的历史工作与范围");
    expect(html).toContain("后加工作");
    expect(html).not.toContain("完成率");
    // Explicit synthetic UI observation: the pinned E6 only contains text task references.
    const observed = structuredClone(e6);
    const match = observed.product!.bindings[0];
    const owner = observed.product!.items.find(
      (item) => item.key === match.ownerKey,
    )!;
    const task = {
      id: "synthetic-ui-task",
      realTaskId: match.binding.task.task_id,
      number: "TASK-SYNTHETIC",
      title: "合成任务观察",
      current: false,
      source: owner.source,
      statuses: [],
      goals: [],
      steps: [],
      checks: [],
      issues: [],
    };
    observed.tasks.push(task);
    match.match.taskIds = [task.id];
    match.match.state = "matched";
    const taskHtml = renderToStaticMarkup(
      <TaskProductLinks task={task} context={context(observed)} />,
    );
    expect(taskHtml).toContain("产品业务与计划反查");
    expect(taskHtml).toContain(match.binding.coverage);
  });
  it("preserves each semantic graph edge and full evidence beyond displayed nodes", () => {
    const model = buildProductGraph(e6);
    expect(model.relations.some((relation) => relation.kind === "repair")).toBe(
      true,
    );
    expect(
      model.relations.some((relation) => relation.kind === "work-binding"),
    ).toBe(true);
    expect(new Set(model.relations.map((relation) => relation.id)).size).toBe(
      model.relations.length,
    );
    const maximumEvidence = Math.max(
      ...[...model.nodes.keys()].map(
        (key) => productRelationsForFocus(model, key).length,
      ),
    );
    expect(maximumEvidence).toBeGreaterThan(12);
  });
  it("keeps duplicate work occurrences distinct and refuses ambiguous jumps", () => {
    const duplicate = structuredClone(e6);
    const plan = duplicate.product!.items.find(
      (item) => item.type === "plan" && item.usable,
    )!;
    const original = plan.metadata.work_items![0];
    plan.metadata.work_items!.push(structuredClone(original));
    const html = renderToStaticMarkup(
      <PlanningPage
        {...context(duplicate)}
        selected={plan.key}
        selectedWork={original.id}
        select={() => {}}
        configure={() => {}}
      />,
    );
    expect(html).toContain("所选工作项身份有歧义");
    const ids = [...html.matchAll(/id="(product-work-[^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).not.toContain('class="product-work-card source-highlight"');
  });
  it("preserves task selection identity when a current file changes its real focus", () => {
    const snapshot = structuredClone(comprehensive);
    const item = snapshot.product!.items[0];
    snapshot.tasks = [
      {
        id: "stable-file-ui-id",
        realTaskId: "task-new",
        number: "TASK-NEW",
        title: "New focus",
        current: true,
        source: item.source,
        statuses: [],
        goals: [],
        steps: [],
        checks: [],
        issues: [],
      },
    ];
    const html = renderToStaticMarkup(
      <TasksPage
        snapshot={snapshot}
        selected="stable-file-ui-id"
        selectedRealTaskId="task-old"
        select={() => {}}
        open={() => {}}
        openProduct={() => {}}
        relations={() => {}}
      />,
    );
    expect(html).toContain("所选任务真实身份已变化");
    expect(html).not.toContain('class="task-detail"');
  });
  it("invalidates a task-centred relation view on same-file real identity change and allows explicit reselection", () => {
    const snapshot = structuredClone(comprehensive);
    const source = snapshot.product!.items[0].source;
    snapshot.tasks = [
      {
        id: "stable-current-file-ui-id",
        realTaskId: "task-B",
        number: "TASK-B",
        title: "New task B",
        current: true,
        source,
        statuses: [],
        goals: [],
        steps: [],
        checks: [],
        issues: [],
      },
    ];
    const props = {
      snapshot,
      selected: "stable-current-file-ui-id",
      select: () => {},
      open: () => {},
      openTask: () => {},
      openProduct: () => {},
    };
    const stale = renderToStaticMarkup(
      <RelationsPage {...props} selectedRealTaskId="task-A" />,
    );
    expect(stale).toContain("所选关联中心的任务真实身份已变化");
    expect(stale).not.toContain('class="graph-container"');
    expect(stale).toContain(
      '<option value="" disabled="" selected="">所选任务身份已变化，请重新选择</option>',
    );
    expect(stale).toContain(
      '<option value="stable-current-file-ui-id">TASK-B · New task B</option>',
    );
    const reselected = renderToStaticMarkup(
      <RelationsPage {...props} selectedRealTaskId="task-B" />,
    );
    expect(reselected).not.toContain("所选关联中心的任务真实身份已变化");
    expect(reselected).toContain('class="graph-container"');
    const documentCentre = renderToStaticMarkup(
      <RelationsPage {...props} selected={source.documentId} />,
    );
    expect(documentCentre).not.toContain("所选关联中心的任务真实身份已变化");
    expect(documentCentre).toContain('class="graph-container"');
  });
  it("renders all graph evidence after limiting the visible graph", () => {
    const model = buildProductGraph(e6);
    const focus = [...model.nodes.keys()].sort(
      (a, b) =>
        productRelationsForFocus(model, b).length -
        productRelationsForFocus(model, a).length,
    )[0];
    const evidence = productRelationsForFocus(model, focus);
    const html = renderToStaticMarkup(
      <ProductRelationPanel
        snapshot={e6}
        model={model}
        focus={focus}
        open={() => {}}
        openProduct={() => {}}
        openTask={() => {}}
      />,
    );
    expect([...html.matchAll(/data-product-relation-kind=/g)]).toHaveLength(
      evidence.length,
    );
    expect(html).toContain("完整产品关联依据");
  });
  it("does not execute HTML or fetch remote images and annotates source offsets", () => {
    const html = renderToStaticMarkup(
      <SnapshotMarkdown
        text={
          "## Source\n<script>alert(1)</script>\n\n![remote](https://example.com/image.png)\n\n[unsafe](javascript:alert(1))"
        }
        documentId="synthetic"
        path="docs/synthetic.md"
        startLine={42}
        snapshot={comprehensive}
        open={() => {}}
      />,
    );
    expect(html).toContain('data-line="42"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
  });
});
