import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";

// Called by the existing production browser runner: real service, no mocked product data.
export async function verifyProductBrowser({
  page,
  workspace,
  run,
  base,
  nav,
  screenshot,
  refresh,
  noOverflow,
}) {
  const roots = {};
  for (const [name, example] of [
    ["comprehensive", "product-comprehensive"],
    ["e6", "product-e6"],
    ["none", "product-planning/no-plan"],
    ["multiple", "product-planning/multiple-plans"],
  ]) {
    roots[name] = path.join(run, `标准产品 中文 ${name} with spaces`);
    await cp(path.join(workspace, "examples", example), roots[name], {
      recursive: true,
    });
  }
  const e6Requirements = path.join(roots.e6, "docs/product/REQUIREMENTS.md");
  const mixedFilename = path.join(
    roots.comprehensive,
    "docs/product/PROJECT.md",
  );
  const mixedRaw = await readFile(mixedFilename, "utf8");
  const mixedFront = /^---\n([\s\S]*?)\n---/.exec(mixedRaw);
  const mixedMetadata = parse(mixedFront[1]);
  mixedMetadata.items
    .find((i) => i.id === "DES-IMPORT")
    .links.push({
      id: "L-REJECTED",
      relation: "references",
      target: "REQ-EXPORT",
      origin: "declared",
      state: "dismissed",
      reason: "合成复核明确否定此关联，保留原因",
    });
  await writeFile(
    mixedFilename,
    `---\n${stringify(mixedMetadata)}---${mixedRaw.slice(mixedFront[0].length)}`,
  );
  const raw = await readFile(e6Requirements, "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw);
  const metadata = parse(frontmatter[1]);
  metadata.items[0].task_bindings = metadata.items[0].task_bindings.filter(
    (b) => b.id !== "B-C",
  );
  await writeFile(
    e6Requirements,
    `---\n${stringify(metadata)}---${raw.slice(frontmatter[0].length)}`,
  );
  await mkdir(path.join(roots.e6, "TASKS"));
  for (const [id, status] of [
    ["A", "closed"],
    ["B", "active"],
    ["R", "closed"],
  ])
    await writeFile(
      path.join(roots.e6, "TASKS", `${id}.md`),
      `---\ntask_id: example-task-${id}\n---\n# 合成实施 ${id}\n- 任务编号: TASK-81${id === "A" ? "1" : id === "B" ? "2" : "3"}\n- 任务状态: ${status}\n`,
    );
  async function addProduct(root, name, tasks = false) {
    await page
      .getByRole("button", { name: "添加项目", exact: true })
      .first()
      .click();
    await page.getByRole("tab", { name: "浏览目录" }).click();
    await page.getByRole("textbox", { name: "服务机器目录路径" }).fill(root);
    await page.getByRole("button", { name: "前往目录", exact: true }).click();
    await page.getByRole("button", { name: "选择当前目录" }).click();
    await page
      .getByRole("textbox", { name: "项目名称", exact: true })
      .fill(name);
    await page
      .getByRole("checkbox", { name: "启用 PRODUCT 标准产品读取" })
      .check();
    await page.getByText("高级扫描设置", { exact: true }).click();
    await page
      .getByRole("checkbox", { name: "刷新时从 vNext 文档入口自动发现" })
      .uncheck();
    if (tasks)
      await page
        .getByRole("textbox", { name: "管理文档", exact: true })
        .fill("TASKS/*.md");
    const scanned = page.waitForResponse(
      (r) => r.url().endsWith("/refresh") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "添加并扫描" }).click();
    const data = await (await scanned).json();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    return data.snapshot;
  }
  async function item(id) {
    await nav("需求");
    await page
      .getByRole("combobox", { name: "产品条目类型" })
      .selectOption("all");
    await page.getByRole("combobox", { name: "需求范围" }).selectOption("all");
    await page.getByRole("textbox", { name: "搜索产品条目" }).fill(id);
    await page
      .locator(".product-page .document-item")
      .filter({ hasText: id })
      .first()
      .click();
  }
  const comprehensive = await addProduct(
    roots.comprehensive,
    "PRODUCT · 综合合成样例",
  );
  assert.equal(comprehensive.product.items.filter((i) => i.usable).length, 12);
  const idBeforeBrowse = comprehensive.id;
  await nav("需求");
  await page
    .getByRole("heading", { name: "设备数据导入", exact: true })
    .waitFor();
  for (const scope of ["current", "planned", "candidate", "retired"]) {
    await page.getByRole("combobox", { name: "需求范围" }).selectOption(scope);
    assert.equal(await page.locator(".product-page .document-item").count(), 1);
  }
  await page.getByRole("combobox", { name: "需求范围" }).selectOption("all");
  await page
    .locator(".product-page .document-item")
    .filter({ hasText: "REQ-IMPORT" })
    .click();
  await page
    .locator(".assessment-panel")
    .getByText(/报告部分实施 · 报告通过/)
    .waitFor();
  await page
    .locator(".assessment-panel")
    .getByText(/新材料待对账/)
    .waitFor();
  assert.match(
    await page.locator(".assessment-panel").textContent(),
    /版本未知/,
  );
  await page.locator(".assessment-panel").screenshot({
    path: path.join(run, "product-1440-requirement-report-pending.png"),
  });
  await page.getByRole("button", { name: "导入解析提案", exact: true }).click();
  await page
    .getByRole("heading", { name: "导入解析提案", exact: true })
    .waitFor();
  await page.getByRole("checkbox", { name: /查看已否定关联/ }).check();
  await page
    .getByText("理由：合成复核明确否定此关联，保留原因", { exact: true })
    .waitFor();
  const design = comprehensive.product.items.find((i) => i.id === "DES-IMPORT");
  await page.locator(".product-detail > .source-link").click();
  await page.getByRole("button", { name: "原文", exact: true }).click();
  await page
    .locator(`.source-highlight[data-line="${design.source.line}"]`)
    .waitFor();
  assert.match(
    await page.locator(".source-highlight").first().textContent(),
    /\[DES-IMPORT\]/,
  );
  await screenshot("product-design-original-absolute-line");
  await item("REQ-IMPORT");
  await page
    .locator(".product-detail > .detail-heading")
    .getByRole("button", { name: "关联", exact: true })
    .click();
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "DES-IMPORT" })
    .waitFor();
  await page.getByRole("heading", { name: /完整业务依据/ }).waitFor();
  await screenshot("product-requirement-local-graph");
  await item("DISC-STREAM");
  await page
    .getByText("推断关联 · 有效关联 · 目标已定位", { exact: true })
    .waitFor();
  await page
    .locator(".product-detail")
    .getByRole("button", {
      name: "docs/product/discussions/raw/stream.txt:1",
      exact: true,
    })
    .last()
    .click();
  await page.locator(".raw-document").waitFor();
  assert.match(await page.locator(".raw-document").textContent(), /流式/);
  await nav("规划");
  assert.equal(await page.locator(".work-card").count(), 3);
  const ordered = await page.locator(".work-card > h4").allTextContents();
  assert.match(ordered.join("|"), /W-CHECK.*W-BASE.*W-DUAL/);
  await screenshot("product-plan-original-order");
  const unchanged = await (
    await fetch(`${base}/api/projects/${comprehensive.projectId}/snapshot`)
  ).json();
  assert.equal(unchanged.snapshot.id, idBeforeBrowse);
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await nav("规划");
    await noOverflow();
    await screenshot(`product-${width}-planning`);
    await item("REQ-IMPORT");
    await noOverflow();
    await screenshot(`product-${width}-requirement`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Same identity at a new location after refresh; removed identities must never fall back to a namesake.
  await item("DES-IMPORT");
  await rename(
    path.join(roots.comprehensive, "docs/product/PROJECT.md"),
    path.join(roots.comprehensive, "docs/product/moved.md"),
  );
  const manifestFile = path.join(
    roots.comprehensive,
    ".workflow-system/PRODUCT.yaml",
  );
  const manifest = parse(await readFile(manifestFile, "utf8"));
  manifest.entry = "docs/product/moved.md";
  manifest.managed_paths = [manifest.entry];
  await writeFile(manifestFile, stringify(manifest));
  await refresh();
  await page
    .getByRole("heading", { name: "导入解析提案", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".product-detail > .source-link").textContent(),
    /moved.md/,
  );
  await writeFile(manifestFile, "schema: [broken\n");
  await refresh();
  await page
    .getByRole("heading", { name: "所选条目已退出本次范围", exact: true })
    .waitFor();
  await page.getByText("PRODUCT 入口不可用", { exact: true }).waitFor();
  await screenshot("product-broken-manifest-stale-selection");
  await addProduct(roots.e6, "PRODUCT · E6 合成修复", true);
  await nav("规划");
  assert.equal(await page.locator(".work-card").count(), 4);
  const repairCard = page.locator(".work-card").filter({
    has: page.getByRole("heading", {
      name: "3. E6R · 修复本次导入问题",
      exact: true,
    }),
  });
  await repairCard.getByText("新增", { exact: true }).waitFor();
  await repairCard.getByText("修复的历史交付范围", { exact: true }).waitFor();
  await page
    .locator(".work-card")
    .filter({
      has: page.getByRole("heading", {
        name: "4. E6C · 后续实施",
        exact: true,
      }),
    })
    .getByText(/未记录任务绑定/)
    .waitFor();
  await repairCard.scrollIntoViewIfNeeded();
  await screenshot("product-e6-added-repair-c-not-created");
  await repairCard
    .getByRole("button", { name: "TASK-813 · 合成实施 R", exact: true })
    .click();
  await page
    .locator(".task-detail")
    .getByRole("heading", { name: "合成实施 R", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "关联目标、需求与修复范围", exact: true })
    .waitFor();
  await page
    .locator(".task-detail")
    .getByRole("button", { name: "REQ-IMPORT · 导入行为", exact: true })
    .click();
  await page.getByRole("heading", { name: "导入行为", exact: true }).waitFor();
  await page
    .getByText("真实 task_id 一致，来源未发现矛盾", { exact: true })
    .first()
    .waitFor();
  await screenshot("product-e6-requirement-task-repair-loop");
  await addProduct(roots.none, "PRODUCT · 无计划合成样例");
  await nav("规划");
  assert.equal(await page.locator(".work-card").count(), 0);
  assert.ok((await page.locator(".known-scope > div").count()) > 3);
  await screenshot("product-no-plan-known-scope");
  const multiple = await addProduct(roots.multiple, "PRODUCT · 多计划合成样例");
  await nav("规划");
  assert.equal(await page.locator(".work-card").count(), 0);
  const plans = multiple.product.items.filter((i) => i.type === "plan");
  for (const plan of plans) {
    await page
      .getByRole("combobox", { name: "选择产品计划" })
      .selectOption(plan.key);
    assert.equal(
      await page.locator(".work-card").count(),
      plan.metadata.work_items.length,
    );
  }
  await screenshot("product-explicit-multiple-plan-selection");
  return "PRODUCT opt-in > four scopes > requirement/design/absolute source > product graph/inferred discussion/TXT > original plan order > reliable task/repair/C without task > no/multiple plan selection > moved identity/broken manifest; 1440/1024/390 layouts";
}
