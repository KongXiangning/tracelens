// Read-only browser checks over supplied before / helper-saved after / isolated
// incremental inputs. This script never creates product definitions or tasks.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../dist/server/app.js";
import { productStructure } from "../dist/shared/product-structure.js";
import { requirementHierarchy } from "../dist/shared/product-hierarchy.js";
import { productView } from "../dist/shared/product-view.js";
import { runtimeHashes } from "../dist/server/runtime-reader.js";
import { assertNoLinks, validateRoot, within } from "../dist/server/config.js";

const inputFile = process.env.TRACELENS_STRUCTURE_INPUTS;
if (!inputFile)
  throw new Error(
    "Set TRACELENS_STRUCTURE_INPUTS to a JSON array of {name, kind, root}; inputs must already be saved.",
  );
const inputs = JSON.parse(await readFile(inputFile, "utf8"));
assert.ok(
  Array.isArray(inputs) && inputs.length,
  "At least one supplied input is required",
);
const output = path.resolve(
  process.env.TRACELENS_STRUCTURE_OUTPUT || "output/playwright",
);
// Validate every observed root before creating output or registry files. Resolve
// the nearest existing output ancestor so aliases cannot bypass containment;
// the existing consumer path rules reject symlinks / junctions and use native
// Windows case-insensitive path boundaries.
const roots = await Promise.all(
  inputs.map((input) => validateRoot(input.root)),
);
await assertNoLinks(output).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
let ancestor = output;
const suffix = [];
let realOutput;
for (;;) {
  try {
    realOutput = path.join(await realpath(ancestor), ...suffix);
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    assert.notEqual(parent, ancestor, "Output ancestor must resolve");
    ancestor = parent;
  }
}
assert.ok(
  roots.every((root) => !within(root, realOutput)),
  "TRACELENS_STRUCTURE_OUTPUT must be outside every observed input root",
);
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, "structure-"));
const { app, registry, store } = await createApp({
  dataDir: path.join(run, "registry"),
  webRoot: path.resolve("dist/web"),
});
const config = {
  readingMode: "custom",
  autoDiscover: false,
  rules: {
    management: ["TASKS/**/*.md", "docs/workflow/**/*.md"],
    requirements: [],
    design: [],
    planning: [],
  },
  excludes: [],
  product: { enabled: true, manifestPath: ".workflow-system/PRODUCT.yaml" },
};
async function tree(root) {
  const hashes = {};
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(e.name)) continue;
      const p = path.join(dir, e.name),
        key = path.relative(root, p);
      if (e.isDirectory()) await walk(p);
      else if (e.isSymbolicLink()) hashes[key] = `symlink:${await readlink(p)}`;
      else if (e.isFile())
        hashes[key] = createHash("sha256")
          .update(await readFile(p))
          .digest("hex");
    }
  }
  await walk(root);
  return hashes;
}
const prepared = [];
for (const input of inputs) {
  assert.ok(
    path.isAbsolute(input.root),
    "Input roots use the host platform's absolute paths",
  );
  const before = await tree(input.root);
  const project = await registry.add({
    name: input.name,
    root: input.root,
    config,
  });
  if (input.trustRuntime) {
    const support = path.join(input.root, ".workflow-system/runtime/support");
    assert.ok(
      input.runtimeHashes && input.runtimeBaseline,
      "Explicit Runtime trust requires the verified baseline and four module hashes",
    );
    assert.deepEqual(
      await runtimeHashes(support),
      input.runtimeHashes,
      "Copied Runtime modules match the supplied verified baseline bytes",
    );
    await registry.selectRuntime(project.id, {
      sourceDirectory: support,
      moduleHashes: input.runtimeHashes,
      workflowHome: "docs/workflow",
      accept: true,
    });
  }
  const snapshot = (await store.refresh(project.id)).snapshot;
  assert.ok(
    snapshot?.product?.items.length,
    "Supplied product remains readable",
  );
  await writeFile(
    path.join(run, `${prepared.length}-snapshot.json`),
    JSON.stringify(snapshot, null, 2),
  );
  prepared.push({ input, project, snapshot, before });
  await writeFile(
    path.join(run, `${prepared.length - 1}-input-before-sha256.json`),
    JSON.stringify(before, null, 2),
  );
}
const checks = [],
  errors = [],
  requests = [];
let browser, page;
const record = (kind, name, observed) => checks.push({ kind, name, observed });
async function shot(name) {
  await page.screenshot({
    path: path.join(run, name + ".png"),
    fullPage: false,
  });
  await writeFile(
    path.join(run, name + ".txt"),
    await page.locator("body").innerText(),
  );
}
const nodeIds = () =>
  page
    .locator(".goal-requirement-graph [data-node-id]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-node-id")));
try {
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/"))
      requests.push({ method: r.method(), path: u.pathname });
  });
  await page.goto(base);
  for (const [index, { input, project, snapshot }] of prepared.entries()) {
    await page.getByRole("button", { name: "概览", exact: true }).click();
    await page.locator(`[data-project-id="${project.id}"]`).click();
    await page.getByRole("button", { name: "需求视图", exact: true }).click();
    await page
      .getByRole("heading", { name: "目标与需求图", exact: true })
      .waitFor();
    const product = snapshot.product,
      model = productView(product),
      goal = model.rootGoal;
    if (input.rootIssue) {
      assert.equal(
        goal,
        null,
        "Supplied missing / invalid root is not promoted to a valid goal",
      );
      const currentRequirement = product.items.find(
        (i) =>
          i.usable &&
          i.type === "requirement" &&
          i.metadata.scope === "current" &&
          !(i.metadata.links || []).some((r) => r.relation === "part_of"),
      );
      const node = page.locator(
        `.goal-requirement-graph [data-node-id="${currentRequirement.id}"]`,
      );
      assert.equal(
        await node.getAttribute("data-node-conclusion"),
        "undetermined",
      );
      assert.ok((await node.innerText()).includes("尚未判定 · 未明确所选目标"));
      assert.ok(!(await node.innerText()).includes("分类节点"));
      await node.click();
      const detail = page.locator(".product-selected-detail");
      assert.ok(
        (await detail.innerText()).includes("尚未判定 · 未明确所选目标"),
      );
      record(
        input.kind,
        "requirement without valid selected goal remains unknown in node and detail",
        { rootReason: model.rootReason, requirement: currentRequirement.id },
      );
      await shot(`${index}-root-issue`);
      continue;
    }
    assert.ok(goal, "Root goal resolves in supplied input");
    const explanation = productStructure(product, goal.key);
    const reqs = explanation.formal.filter(
      (i) => i.metadata.scope === "current",
    );
    const scrollValue = () =>
      page.evaluate(() => {
        const content = document.querySelector(".page-content");
        const container =
          content &&
          ["auto", "scroll"].includes(getComputedStyle(content).overflowY)
            ? content
            : document.scrollingElement;
        return container?.scrollTop || 0;
      });
    async function restoredScroll(expected) {
      try {
        await page.waitForFunction((value) => {
          const content = document.querySelector(".page-content");
          const container =
            content &&
            ["auto", "scroll"].includes(getComputedStyle(content).overflowY)
              ? content
              : document.scrollingElement;
          return Math.abs((container?.scrollTop || 0) - value) < 2;
        }, expected);
      } catch (error) {
        throw new Error(
          `Scroll restore expected ${expected}, actual ${await scrollValue()}: ${String(error)}`,
        );
      }
    }
    const hierarchy = requirementHierarchy(product, reqs, new Set());
    async function expandAncestors(item) {
      const ancestors = [],
        seen = new Set();
      let key = item.key;
      while ((hierarchy.parents.get(key) || []).length && !seen.has(key)) {
        seen.add(key);
        key = hierarchy.parents.get(key)[0];
        ancestors.unshift(product.items.find((i) => i.key === key));
      }
      for (const [ancestorIndex, ancestor] of ancestors.entries()) {
        await page
          .locator(`.goal-requirement-graph [data-node-id="${ancestor.id}"]`)
          .waitFor();
        const expand = page.getByRole("button", {
          name: `展开子需求 · ${ancestor.id}`,
          exact: true,
        });
        if (await expand.count()) await expand.click();
        const next = ancestors[ancestorIndex + 1] || item;
        await page
          .locator(`.goal-requirement-graph [data-node-id="${next.id}"]`)
          .waitFor();
      }
      return ancestors;
    }
    const actual = await nodeIds();
    assert.deepEqual(
      actual.filter((id) => reqs.some((i) => i.id === id)),
      hierarchy.visible.map((i) => i.id),
    );
    record(
      input.kind,
      "formal graph uses recorded declared paths and folded current hierarchy",
      {
        formalRequirements: reqs.length,
        visibleRequirements: hierarchy.visible.map((i) => i.id),
        displayedNodes: actual,
      },
    );
    await shot(`${index}-formal`);

    await page
      .getByRole("button", { name: "查看候选关系", exact: true })
      .click();
    const candidatePanel = page.getByRole("region", {
      name: "候选结构关系",
      exact: true,
    });
    assert.match(
      await candidatePanel.innerText(),
      new RegExp(
        `已记录候选结构关系 · ${explanation.relatedCandidates.length} 条`,
      ),
    );
    if (explanation.relatedCandidates.length) {
      const reason = explanation.relatedCandidates.find(
        (r) =>
          r.ownerKey === explanation.relatedCandidates[0].ownerKey &&
          r.link.reason,
      )?.link.reason;
      if (reason)
        assert.ok((await candidatePanel.innerText()).includes(reason));
      if (
        explanation.relatedCandidates.some(
          (r) =>
            r.resolution === "resolved" &&
            r.ownerKey === explanation.relatedCandidates[0].ownerKey,
        )
      )
        assert.ok(
          await candidatePanel
            .locator('.react-flow__edge-path[style*="stroke-dasharray"]')
            .count(),
          "Recorded inference is dashed in the existing local graph",
        );
    }
    await page
      .getByRole("checkbox", {
        name: "查看本次已读取内容中的全部候选",
        exact: true,
      })
      .check();
    assert.match(
      await candidatePanel.innerText(),
      new RegExp(`已记录候选结构关系 · ${explanation.candidates.length} 条`),
    );
    assert.deepEqual(
      await nodeIds(),
      actual,
      "Candidate entry does not change formal membership",
    );
    record(
      input.kind,
      "context / all candidate entry with recorded reasons and unchanged formal graph",
      {
        related: explanation.relatedCandidates.length,
        all: explanation.candidates.length,
      },
    );
    await shot(`${index}-candidates`);
    if (await candidatePanel.locator(".product-graph-container").count())
      await candidatePanel
        .locator(".product-graph-container")
        .screenshot({ path: path.join(run, `${index}-candidate-local.png`) });

    await page
      .getByRole("button", { name: "查看未连入需求", exact: true })
      .click();
    const unlinkedPanel = page.getByRole("region", {
      name: "未连入需求",
      exact: true,
    });
    assert.equal(
      await unlinkedPanel.locator("[data-unlinked-id]").count(),
      explanation.unlinked.length,
    );
    const unlinked = explanation.unlinked[0];
    if (unlinked) {
      await page
        .getByRole("textbox", { name: "搜索未连入需求", exact: true })
        .fill(unlinked.item.id);
      const row = unlinkedPanel.locator(
        `[data-unlinked-id="${unlinked.item.id}"]`,
      );
      for (const reason of unlinked.reasons)
        assert.ok((await row.innerText()).includes(reason));
      await row
        .getByRole("button", {
          name: `${unlinked.item.id} · ${unlinked.item.title}`,
          exact: true,
        })
        .click();
      await page.locator(`[data-product-id="${unlinked.item.id}"]`).waitFor();
      await page
        .getByRole("button", { name: "返回需求图", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("textbox", { name: "搜索未连入需求", exact: true })
          .inputValue(),
        unlinked.item.id,
      );
    }
    record(
      input.kind,
      "unlinked requirements are searchable with separate reasons and full original details",
      {
        readRequirements:
          explanation.unlinked.length + explanation.formal.length,
        unlinkedRequirements: explanation.unlinked.length,
        sample: unlinked?.item.id,
        reasons: unlinked?.reasons,
      },
    );
    await shot(`${index}-unlinked`);
    await page
      .getByRole("button", { name: "查看未连入需求", exact: true })
      .click();

    const parent = hierarchy.visible.find(
      (i) => hierarchy.children.get(i.key)?.length,
    );
    if (parent) {
      await page
        .getByRole("button", { name: `展开子需求 · ${parent.id}`, exact: true })
        .click();
      const children = hierarchy.children
        .get(parent.key)
        .map((key) => product.items.find((i) => i.key === key));
      for (const child of children)
        assert.equal(
          await page
            .locator(`.goal-requirement-graph [data-node-id="${child.id}"]`)
            .count(),
          1,
        );
      const child = children[0];
      await page
        .getByRole("button", { name: `收起子需求 · ${parent.id}`, exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "搜索需求图", exact: true })
        .fill(child.id);
      assert.equal(
        await page
          .locator(`.goal-requirement-graph [data-node-id="${child.id}"]`)
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator(`.goal-requirement-graph [data-node-id="${parent.id}"]`)
          .count(),
        1,
      );
      record(
        input.kind,
        "expansion and search reach independent child with necessary ancestor",
        {
          parent: parent.id,
          child: child.id,
          children: children.map((i) => i.id),
        },
      );
      await shot(`${index}-child`);
      await page
        .getByRole("textbox", { name: "搜索需求图", exact: true })
        .fill("");
    }
    if (input.shared) {
      const { child, parents } = input.shared;
      for (const id of parents) {
        const parent = reqs.find((i) => i.id === id);
        assert.ok(
          parent,
          "Selected shared parent is in the actual formal hierarchy",
        );
        await expandAncestors(parent);
        await page
          .getByRole("button", { name: `展开子需求 · ${id}`, exact: true })
          .click();
      }
      assert.equal(
        await page
          .locator(`.goal-requirement-graph [data-node-id="${child}"]`)
          .count(),
        1,
      );
      await page
        .getByRole("button", {
          name: `收起子需求 · ${parents[0]}`,
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .locator(`.goal-requirement-graph [data-node-id="${child}"]`)
          .count(),
        1,
        "Another expanded parent keeps the shared identity visible",
      );
      await page
        .getByRole("button", {
          name: `收起子需求 · ${parents[1]}`,
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .locator(`.goal-requirement-graph [data-node-id="${child}"]`)
          .count(),
        0,
        "Folding all paths folds the shared child",
      );
      record(
        input.kind,
        "shared child has one identity and survives either expanded parent path",
        input.shared,
      );
      await shot(`${index}-shared`);
    }
    if (input.scopedGap) {
      const goalItem = product.items.find((i) => i.id === "G-LIVE");
      await page
        .getByRole("combobox", { name: "所选目标", exact: true })
        .selectOption(goalItem.key);
      await page
        .getByRole("combobox", { name: "被评估对象", exact: true })
        .selectOption({
          label: "working-copy · sample-copy-a @sample-baseline",
        });
      await page
        .getByRole("combobox", { name: "结论筛选", exact: true })
        .selectOption("gaps");
      const ids = await nodeIds();
      assert.ok(
        ids.includes("R-IMPORT") && ids.includes("R-PIPELINE"),
        "Gap filtering reveals folded child with its ancestor",
      );
      assert.ok(!ids.includes("R-DELTA"), "Unknown does not become a gap");
      record(
        input.kind,
        "gap selection retains necessary ancestors without turning unknown into failure",
        { visible: ids },
      );
      await shot(`${index}-gaps`);
      await page
        .getByRole("combobox", { name: "结论筛选", exact: true })
        .selectOption("all");
      await page
        .getByRole("combobox", { name: "所选目标", exact: true })
        .selectOption(goal.key);
    }
    if (input.deepChild) {
      const child = reqs.find((i) => i.id === input.deepChild);
      assert.ok(
        child,
        "Selected helper-saved independent child is formally reachable",
      );
      const ancestors = await expandAncestors(child);
      const node = page.locator(
        `.goal-requirement-graph [data-node-id="${child.id}"]`,
      );
      assert.equal(await node.count(), 1);
      await node.click();
      await page.locator(`[data-product-id="${child.id}"]`).waitFor();
      assert.equal(
        await page
          .locator(".scoped-conclusion")
          .getAttribute("data-conclusion"),
        "undetermined",
        "Unassessed child is readable without inheriting the parent report",
      );
      record(
        input.kind,
        "helper-saved independent child expands through actual multi-level composition and stays unassessed",
        { child: child.id, ancestors: ancestors.map((i) => i.id) },
      );
      await page.locator(".product-selected-detail").scrollIntoViewIfNeeded();
      await shot(`${index}-deep-child`);
      await page
        .getByRole("button", { name: "返回需求图", exact: true })
        .click();
    }
    for (const id of await nodeIds()) {
      const i = product.items.find((i) => i.id === id);
      const node = page.locator(
        `.goal-requirement-graph [data-node-id="${id}"]`,
      );
      if (i?.type === "module") {
        assert.ok((await node.innerText()).includes("模块 / 分类"));
        assert.equal(await node.getAttribute("data-node-conclusion"), null);
        record(
          input.kind,
          "module is a classification node without assessment",
          { id },
        );
      } else if (i?.type === "goal") {
        assert.equal(await node.getAttribute("data-node-goal"), i.id);
      }
    }
    record(input.kind, "goal graph nodes use their own assessment goal", {
      goals: (await nodeIds()).filter(
        (id) => product.items.find((i) => i.id === id)?.type === "goal",
      ),
    });
    // Existing Task / Step and source routes: preserve the selected requirement,
    // panel and filter through application navigation. No Runtime writes.
    const readableReqs = [...reqs, ...explanation.unlinked.map((r) => r.item)];
    const bound = readableReqs.find((i) =>
      product.bindings.some(
        (b) =>
          b.ownerKey === i.key &&
          b.match.state === "matched" &&
          b.match.taskIds.some((id) => snapshot.tasks.some((t) => t.id === id)),
      ),
    );
    const detailItem =
      (input.taskRequirement
        ? readableReqs.find((i) => i.id === input.taskRequirement)
        : bound) ||
      reqs[0] ||
      explanation.unlinked[0]?.item;
    if (detailItem) {
      await page
        .getByRole("textbox", { name: "搜索需求图", exact: true })
        .fill("");
      // Inventory navigation also reaches an unlinked item without adding it to the graph.
      await page
        .getByText("搜索与条目导航（含历史/旧格式）", { exact: true })
        .click();
      await page
        .locator(".product-page > details")
        .first()
        .getByRole("button", {
          name: `${detailItem.id} · ${detailItem.title}`,
          exact: true,
        })
        .click();
      await page.locator(`[data-product-id="${detailItem.id}"]`).waitFor();
      await page
        .getByRole("button", { name: "查看候选关系", exact: true })
        .click();
      await page
        .getByRole("checkbox", {
          name: "查看本次已读取内容中的全部候选",
          exact: true,
        })
        .check();
      const selectedGoal = await page
        .getByRole("combobox", { name: "所选目标", exact: true })
        .inputValue();
      let taskButton = page
        .locator(".product-selected-detail")
        .getByRole("button", { name: "查看 Task / Step", exact: true })
        .first();
      if (!(await taskButton.count()))
        taskButton = page
          .locator(".product-selected-detail .product-task-observation button")
          .first();
      if (await taskButton.count()) {
        await taskButton.scrollIntoViewIfNeeded();
        const taskScroll = await scrollValue();
        const taskResponse = page
          .waitForResponse(
            (r) =>
              r.url().includes("/task-detail") &&
              r.request().method() === "POST",
          )
          .catch(() => undefined);
        await taskButton.click();
        await page.locator(".navigation-back").waitFor();
        if (snapshot.runtime?.source === "runtime-query") {
          const response = await taskResponse;
          assert.ok(
            response?.ok(),
            "Read-only real Task detail query succeeds",
          );
          await page.locator(".runtime-task-detail").waitFor();
          const stepButton = page
            .locator(".runtime-task-detail > ul > li > button")
            .first();
          if (await stepButton.count()) {
            const stepResponse = page.waitForResponse(
              (r) =>
                r.url().includes("/task-detail") &&
                r.request().method() === "POST",
            );
            await stepButton.click();
            assert.ok(
              (await stepResponse).ok(),
              "Read-only real Step detail query succeeds",
            );
            await page.locator(".runtime-task-detail h4").waitFor();
            await page
              .locator(".runtime-task-detail section > p")
              .filter({ hasText: /^读取中…$/ })
              .waitFor({ state: "hidden" });
          }
          record(
            input.kind,
            "trusted Runtime Task / Step remains independent from structure",
            {
              source: snapshot.runtime.source,
              detail: await page.locator(".runtime-task-detail").innerText(),
            },
          );
          await shot(`${index}-task-step`);
          if (input.probePaused) {
            const paused = snapshot.tasks.find(
              (t) => t.runtimeLifecycle === "paused",
            );
            assert.ok(
              paused,
              "Supplied original Runtime includes a paused Task",
            );
            const pausedResponse = page.waitForResponse(
              (r) =>
                r.url().includes("/task-detail") &&
                r.request().method() === "POST",
            );
            await page
              .locator(".task-item")
              .filter({ hasText: paused.title })
              .first()
              .click();
            assert.ok((await pausedResponse).ok());
            await page
              .locator(".runtime-task-detail h3")
              .filter({ hasText: "Task 生命周期：已暂停" })
              .waitFor();
            record(
              input.kind,
              "original paused Task remains paused independently from closed Task",
              { taskId: paused.realTaskId, lifecycle: paused.runtimeLifecycle },
            );
            await shot(`${index}-paused-task`);
            await page.goBack();
            await page
              .locator(".runtime-task-detail h3")
              .filter({ hasText: "Task 生命周期：已关闭" })
              .waitFor();
          }
        }
        await page.goBack();
        await page.locator(`[data-product-id="${detailItem.id}"]`).waitFor();
        assert.equal(
          await page
            .getByRole("combobox", { name: "所选目标", exact: true })
            .inputValue(),
          selectedGoal,
        );
        assert.equal(
          await page
            .getByRole("checkbox", {
              name: "查看本次已读取内容中的全部候选",
              exact: true,
            })
            .isChecked(),
          true,
        );
        await restoredScroll(taskScroll);
        record(
          input.kind,
          "existing Task / Step route returns to selected requirement and candidate context",
          { requirement: detailItem.id, restoredScroll: taskScroll },
        );
      } else
        record(
          input.kind,
          "Task / Step navigation not exercised in this input",
          {
            reason:
              "No matched readable Task bound to selected requirement; no identity fabricated",
          },
        );
      const sourceButton = page
        .locator(`[data-product-id="${detailItem.id}"] > .product-inline`)
        .getByRole("button")
        .first();
      await sourceButton.scrollIntoViewIfNeeded();
      const sourceScroll = await scrollValue();
      await sourceButton.click();
      await page.goBack();
      await page.locator(`[data-product-id="${detailItem.id}"]`).waitFor();
      assert.equal(
        await page
          .getByRole("checkbox", {
            name: "查看本次已读取内容中的全部候选",
            exact: true,
          })
          .isChecked(),
        true,
      );
      await restoredScroll(sourceScroll);
      record(
        input.kind,
        "source navigation returns to the same selected requirement and panel",
        { requirement: detailItem.id, restoredScroll: sourceScroll },
      );
      await shot(`${index}-return`);
    }
  }
  assert.deepEqual(errors, [], "No browser runtime errors");
  for (const [index, { input, before }] of prepared.entries()) {
    const after = await tree(input.root);
    assert.deepEqual(
      after,
      before,
      `Observed ${input.kind} input bytes remain unchanged`,
    );
    await writeFile(
      path.join(run, `${index}-input-after-sha256.json`),
      JSON.stringify(after, null, 2),
    );
  }
  await writeFile(
    path.join(run, "report.json"),
    JSON.stringify(
      {
        status: "passed",
        platform: process.platform,
        browser: await browser.version(),
        viewport: { width: 1440, height: 1080 },
        inputs,
        checks,
        errors,
        requests,
        unchangedInputBytes: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "passed", run, checks: checks.length }));
} catch (error) {
  await shot("failure").catch(() => {});
  await writeFile(
    path.join(run, "failure.json"),
    JSON.stringify(
      { status: "failed", error: String(error), checks, errors, requests },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await app.close();
}
