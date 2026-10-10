import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createApp } from "../dist/server/app.js";
import {
  inspectProductEnvelope,
  parseProductDocument,
  parseProductManifest,
} from "../dist/server/product-parser.js";
import { scopeGroups } from "../dist/shared/product-scope.js";
import { chromium } from "playwright";

const root = process.env.TRACELENS_REAL_PROJECT;
const upstream = process.env.TRACELENS_VNEXT_ROOT;
assert.ok(
  root && path.isAbsolute(root),
  "TRACELENS_REAL_PROJECT must be an absolute project path",
);
assert.ok(
  upstream && path.isAbsolute(upstream),
  "TRACELENS_VNEXT_ROOT must be the current vNext checkout",
);
const output = path.resolve("output/playwright");
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, "vnext-corpus-"));
const copy = path.join(run, "read-only-corpus");
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink()) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await files(directory, relative)));
    else result.push(relative);
  }
  return result;
}
const manifest = [];
const selected = new Set([
  ".workflow-system/PROJECT_PROFILE.yaml",
  ".workflow-system/PRODUCT.yaml",
]);
for (const directory of ["docs", "TASKS"]) {
  try {
    for (const file of await files(path.join(root, directory)))
      if (/\.(md|markdown|yaml|yml)$/i.test(file))
        selected.add(`${directory}/${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const entry of await readdir(root, { withFileTypes: true }))
  if (entry.isFile() && /\.md$/i.test(entry.name)) selected.add(entry.name);
function sources(value) {
  if (!value || typeof value !== "object") return;
  if (
    value.kind === "file" &&
    typeof value.path === "string" &&
    !path.isAbsolute(value.path) &&
    !value.path.includes("..") &&
    !value.path.includes("\\")
  )
    selected.add(value.path);
  for (const child of Object.values(value)) sources(child);
}
for (const file of [...selected]) {
  if (!/\.md$/i.test(file)) continue;
  const raw = await readFile(path.join(root, file), "utf8");
  if (!inspectProductEnvelope(raw).isProduct) continue;
  sources(
    parseProductDocument("corpus", "corpus", {
      path: file,
      raw,
      digest: hash(raw),
      bytes: Buffer.byteLength(raw),
      kind: "unclassified",
      modifiedAt: "corpus",
    }).items.map((item) => item.metadata),
  );
}
const absent = [];
for (const file of selected) {
  let bytes;
  try {
    bytes = await readFile(path.join(root, file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    absent.push(file);
    continue;
  }
  const destination = path.join(copy, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  manifest.push({ path: file, sha256: hash(bytes) });
}
const contract = path.join(
  upstream,
  "runtime/vnext/support/product-maintenance",
);
const schemas = [];
for (const name of [
  "product-manifest-v1.json",
  "product-manifest-v2.json",
  "product-doc-v1.json",
  "product-doc-v2.json",
]) {
  const actual = await readFile(path.join(contract, "schemas", name));
  const bundled = await readFile(
    path.resolve("src/server/product-assets", name),
  );
  assert.deepEqual(
    JSON.parse(bundled),
    JSON.parse(actual),
    `Current production schema changed: ${name}`,
  );
  schemas.push({
    name,
    currentSha256: hash(actual),
    bundledSha256: hash(bundled),
  });
}
const upstreamDocuments = [];
const types = new Set();
for (const directory of ["templates", "examples"]) {
  for (const relative of await files(path.join(contract, directory))) {
    const file = `${directory}/${relative}`;
    const raw = await readFile(path.join(contract, file), "utf8");
    if (relative === "PRODUCT.yaml")
      assert.ok(parseProductManifest(raw, file).manifest);
    if (!inspectProductEnvelope(raw).isProduct) continue;
    const parsed = parseProductDocument("current-upstream", "upstream", {
      path: file,
      raw,
      digest: hash(raw),
      bytes: Buffer.byteLength(raw),
      kind: "unclassified",
      modifiedAt: "corpus",
    });
    assert.ok(parsed.items.length, `${file}: no items`);
    assert.ok(
      parsed.items.every((item) => item.usable),
      `${file}: ${JSON.stringify(parsed.diagnostics)}`,
    );
    parsed.items.forEach((item) => types.add(item.type));
    upstreamDocuments.push({
      path: file,
      items: parsed.items.length,
      sha256: hash(raw),
    });
  }
}
assert.equal(types.size, 9, "All nine current vNext business types must parse");
const runtime = await createApp({ dataDir: path.join(run, "tool-data") });
let browser;
try {
  const project = await runtime.registry.add({
    name: "TermLink full corpus",
    root: copy,
    config: {
      rules: { management: [], requirements: [], design: [], planning: [] },
      excludes: [],
    },
  });
  const { snapshot } = await runtime.store.refresh(project.id);
  assert.ok(snapshot);
  const standard = manifest.filter((entry) =>
    /^(docs|TASKS)\/.*\.(md|markdown|yaml|yml)$/i.test(entry.path),
  );
  const byPath = new Map(
    snapshot.documents.map((document) => [
      document.path.toLowerCase(),
      document,
    ]),
  );
  for (const file of standard) {
    const document = byPath.get(file.path.toLowerCase());
    assert.ok(document, `Unread standard document: ${file.path}`);
    assert.equal(document.digest, file.sha256, `Bytes lost: ${file.path}`);
    assert.equal(
      hash(document.raw),
      file.sha256,
      `Original text changed: ${file.path}`,
    );
  }
  const parseFailures = snapshot.warnings.filter((warning) =>
    ["parse", "metadata", "navigation-metadata", "json", "yaml"].includes(
      warning.code,
    ),
  );
  assert.deepEqual(
    parseFailures,
    [],
    "No document parse failures in the full corpus",
  );
  assert.equal(snapshot.product.status, "ready");
  assert.equal(snapshot.product.coverage.complete, true);
  assert.equal(snapshot.product.items.filter((item) => !item.usable).length, 0);
  const requirements = snapshot.product.items.filter(
    (item) => item.type === "requirement",
  );
  const scope = scopeGroups(snapshot.product, requirements);
  for (const entry of manifest) {
    assert.equal(
      hash(await readFile(path.join(root, entry.path))),
      entry.sha256,
      `Original changed: ${entry.path}`,
    );
    assert.equal(
      hash(await readFile(path.join(copy, entry.path))),
      entry.sha256,
      `Copy changed: ${entry.path}`,
    );
  }
  const result = {
    result: "passed",
    standardDocuments: standard.length,
    snapshotDocuments: snapshot.documents.length,
    parseFailures: 0,
    productStatus: snapshot.product.status,
    managedDocuments: snapshot.product.coverage.paths.length,
    productItems: snapshot.product.items.length,
    types: [...types],
    upstreamDocuments: upstreamDocuments.length,
    pendingBusiness: snapshot.product.diagnostics.filter((entry) =>
      ["DEFINITION_UNKNOWN", "PENDING_SOURCES"].includes(entry.code),
    ).length,
    unavailableSources: [
      ...new Set(
        snapshot.product.sources
          .filter((entry) => entry.readState === "unavailable")
          .map((entry) => entry.reference.path),
      ),
    ],
    metadataConflicts: snapshot.warnings
      .filter((entry) => entry.code === "metadata-conflict")
      .map(({ path, message }) => ({ path, message })),
    goalGroups: scope.groups.map((entry) => ({
      id: entry.group.id,
      requirements: entry.requirements.length,
    })),
    ungroupedRequirements: scope.ungrouped.length,
    absent,
    schemas,
    upstreamDocumentsManifest: upstreamDocuments,
    manifest,
  };
  const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({
    executablePath: process.env.TRACELENS_BROWSER_EXECUTABLE || undefined,
    channel:
      process.env.TRACELENS_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(base);
  await page
    .getByRole("heading", { name: "需求路线图", exact: true })
    .waitFor();
  await page.locator(".overview-reading-details > summary").click();
  assert.ok(
    await page
      .getByRole("heading", { name: "PRODUCT 已读取", exact: true })
      .isVisible(),
  );
  await page.screenshot({ path: path.join(run, "termlink-overview.png") });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "需求", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "目标与需求全景", exact: true })
    .waitFor();
  const visibleRequirements = await page
    .locator(".product-requirement-summary")
    .evaluateAll((elements) => [
      ...new Set(elements.map((element) => element.dataset.requirementId)),
    ]);
  assert.deepEqual(
    visibleRequirements.sort(),
    requirements.map((item) => item.id).sort(),
  );
  assert.equal(
    await page.locator(".product-browser .document-item").count(),
    requirements.length,
  );
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Horizontal overflow at ${width}`,
    );
    await page.screenshot({
      path: path.join(run, `${width}-termlink-requirements.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator(".product-browser .document-item")
    .filter({ hasText: requirements[0].id })
    .click();
  const detail = page.locator(
    `.product-detail[data-product-id="${requirements[0].id}"]`,
  );
  await detail.waitFor();
  const selectedAssessment = snapshot.product.assessments.find(
    (entry) => entry.requirementKey === requirements[0].key,
  );
  if (selectedAssessment?.state === "selected") {
    const report = snapshot.product.items.find(
      (item) => item.key === selectedAssessment.assessmentKey,
    );
    await detail.locator(".product-delivery .product-assessment").waitFor();
    await detail
      .getByRole("button", {
        name: `${report.id} · ${report.title}`,
        exact: true,
      })
      .waitFor();
    assert.equal(
      await detail.locator(".product-delivery .product-assessment").count(),
      1,
    );
  } else {
    assert.equal(
      await detail.locator(".product-delivery .product-assessment").count(),
      0,
    );
  }
  await page.screenshot({
    path: path.join(run, "termlink-requirement-report.png"),
  });
  assert.deepEqual(pageErrors, []);
  result.browserErrors = pageErrors;
  result.browserRequirements = visibleRequirements.length;
  result.browserWidths = [1440, 1024, 390];
  await writeFile(
    path.join(run, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...result,
        schemas: undefined,
        manifest: undefined,
        upstreamDocumentsManifest: undefined,
        artifacts: run,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await runtime.app.close();
}
