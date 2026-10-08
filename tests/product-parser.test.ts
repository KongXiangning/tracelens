import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { InputFile } from "../src/server/scanner.js";
import type {
  ProductItem,
  ProductMetadata,
} from "../src/shared/product-types.js";
import {
  inspectProductEnvelope,
  isSafeProductPath,
  matchesProductPath,
  parseProductDocument,
  parseProductManifest,
  productItemKey,
  requirementDefinitionDigest,
} from "../src/server/product-parser.js";

const oraclePath = path.resolve("tests/product-oracle/offline-reader.mjs");
const fixtureRoot = path.resolve("examples");
const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function input(raw: string, relative = "docs/product/PROJECT.md"): InputFile {
  return {
    path: relative,
    raw,
    digest: digest(raw),
    bytes: Buffer.byteLength(raw),
    kind: "requirements",
    modifiedAt: "2026-10-08T00:00:00.000Z",
  };
}
function document(metadata: unknown[], body: string, version = 2): string {
  return `---\n${stringify({ schema: `vnext-product-doc/v${version}`, items: metadata })}---\n# Synthetic PRODUCT input\n\n${body}`;
}
const requirement = (id = "REQ-A") => ({
  id,
  type: "requirement",
  scope: "current",
});
const requirementBody = (id = "REQ-A", title = "完整需求") =>
  `## [${id}] ${title}\n### 需求内容\n明确内容。\n### 范围边界\n明确边界。\n### 验收要求\n明确验收。\n`;
function parse(raw: string) {
  return parseProductDocument(
    "registered-project",
    "working-copy/product-id",
    input(raw),
  );
}
function walk(root: string, prefix = ""): string[] {
  return fs
    .readdirSync(path.join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? walk(root, relative) : [relative];
    })
    .sort();
}
function fixtureItems(root: string) {
  const manifest = parseProductManifest(
    fs.readFileSync(path.join(root, ".workflow-system/PRODUCT.yaml"), "utf8"),
    ".workflow-system/PRODUCT.yaml",
  );
  expect(manifest.status).toBe("ready");
  return walk(root)
    .filter(
      (relative) =>
        matchesProductPath(relative, manifest.manifest!.managed_paths) &&
        !matchesProductPath(relative, manifest.manifest!.exclude_paths),
    )
    .flatMap((relative) => {
      const raw = fs.readFileSync(path.join(root, relative), "utf8");
      return parseProductDocument(
        "registered-project",
        `${root}/${manifest.manifest!.project_id}`,
        input(raw, relative),
      ).items;
    });
}
interface OracleItem {
  id: string;
  type: string;
  title: string;
  metadata: ProductMetadata;
  body: string;
  path: string;
  line: number;
  definition_sha256: string | null;
}
interface Oracle {
  items: OracleItem[];
  reverse_relations: unknown[];
  plan_tasks: unknown[];
  diagnostics: { code: string; item_id?: string }[];
  status: string;
}
function runOracle(root: string): Oracle {
  // Only the pinned test asset executes; no project helper or Runtime is invoked.
  const before = Object.fromEntries(
    walk(root).map((relative) => [
      relative,
      digest(fs.readFileSync(path.join(root, relative))),
    ]),
  );
  const result = spawnSync(process.execPath, [oraclePath, root], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  const after = Object.fromEntries(
    walk(root).map((relative) => [
      relative,
      digest(fs.readFileSync(path.join(root, relative))),
    ]),
  );
  expect(after).toEqual(before);
  return JSON.parse(result.stdout) as Oracle;
}
function compareItems(items: ProductItem[], oracle: Oracle) {
  const projection = items
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
  const sort = (values: OracleItem[]) =>
    [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  expect(sort(projection)).toEqual(sort(oracle.items));
  const reverse = items
    .filter((item) => item.usable)
    .flatMap((item) => [
      ...(item.metadata.links ?? [])
        .filter((link) => link.state === "active")
        .map((link) => ({ owner: item.id, ...link })),
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
  expect(reverse).toEqual(oracle.reverse_relations);
  const planTasks = items
    .filter((item) => item.usable && item.type === "plan")
    .map((plan) => ({
      plan_id: plan.id,
      work_items: plan.metadata.work_items!.map((work) => ({
        work_item_id: work.id,
        bindings: items
          .filter((item) => item.usable)
          .flatMap((owner) =>
            (owner.metadata.task_bindings ?? [])
              .filter(
                (binding) =>
                  binding.state === "active" &&
                  binding.plan_items?.some(
                    (ref) =>
                      ref.plan_id === plan.id && ref.work_item_id === work.id,
                  ),
              )
              .map((binding) => ({
                owner: owner.id,
                binding_id: binding.id,
                task: binding.task,
                role: binding.role,
                coverage: binding.coverage,
              })),
          ),
      })),
    }));
  expect(planTasks).toEqual(oracle.plan_tasks);
}
function isolated(raw: string, version = 2) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "tracelens-product-parser-"),
  );
  temporary.push(root);
  fs.mkdirSync(path.join(root, ".workflow-system"));
  fs.mkdirSync(path.join(root, "docs/product"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".workflow-system/PRODUCT.yaml"),
    stringify({
      schema: `vnext-product-manifest/v${version}`,
      project_id: "synthetic-test",
      entry: "docs/product/PROJECT.md",
      managed_paths: ["docs/product/PROJECT.md"],
      source_paths: [],
      exclude_paths: [],
      maintenance: "enabled",
    }),
  );
  fs.writeFileSync(path.join(root, "docs/product/PROJECT.md"), raw);
  return root;
}

describe("pinned PRODUCT parser differential fixtures", () => {
  it.each([
    "product-comprehensive",
    "product-e6",
    "product-planning/no-plan",
    "product-planning/multiple-plans",
  ])("matches the official oracle without changing %s", (name) => {
    const root = path.join(fixtureRoot, name);
    const items = fixtureItems(root);
    expect(items.every((item) => item.usable)).toBe(true);
    compareItems(items, runOracle(root));
    if (name === "product-comprehensive") {
      expect(items).toHaveLength(12);
      expect(new Set(items.map((item) => item.type)).size).toBe(9);
      expect(
        new Set(
          items
            .filter((item) => item.type === "requirement")
            .map((item) => item.metadata.scope),
        ),
      ).toEqual(new Set(["current", "planned", "candidate", "retired"]));
      expect(
        items.find((item) => item.id === "AS-BASE")!.metadata.pending_sources,
      ).toHaveLength(1);
      expect(
        items.find((item) => item.id === "REQ-IMPORT")!.metadata
          .task_bindings![0].task.task_id,
      ).toBeNull();
    }
    if (name === "product-e6") {
      expect(
        items
          .find((item) => item.type === "plan")!
          .metadata.work_items!.map((work) => work.id),
      ).toEqual(["E6A", "E6B", "E6R", "E6C"]);
      const bindings = items.flatMap(
        (item) => item.metadata.task_bindings ?? [],
      );
      expect(
        bindings.some(
          (binding) => binding.role === "repair" && binding.repairs?.length,
        ),
      ).toBe(true);
      // The pinned baseline explicitly describes C as created but not started.
      expect(
        bindings.find((binding) => binding.id === "B-C")!.task.task_id,
      ).toBe("example-task-C");
    }
  });

  it("preserves the E6C work item without inventing a task when C has not been created", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "tracelens-e6-uncreated-"),
    );
    temporary.push(root);
    fs.cpSync(path.join(fixtureRoot, "product-e6"), root, { recursive: true });
    const requirementPath = "docs/product/REQUIREMENTS.md";
    const raw = fs.readFileSync(path.join(root, requirementPath), "utf8");
    const original = parseProductDocument(
      "test",
      "e6",
      input(raw, requirementPath),
    ).items[0];
    const metadata = structuredClone(original.metadata);
    metadata.task_bindings = metadata.task_bindings!.filter(
      (binding) => binding.id !== "B-C",
    );
    fs.writeFileSync(
      path.join(root, requirementPath),
      document([metadata], original.body),
    );
    const items = fixtureItems(root);
    const oracle = runOracle(root);
    compareItems(items, oracle);
    expect(
      items
        .find((item) => item.type === "plan")!
        .metadata.work_items!.map((work) => work.id),
    ).toEqual(["E6A", "E6B", "E6R", "E6C"]);
    expect(
      items
        .flatMap((item) => item.metadata.task_bindings ?? [])
        .some((binding) =>
          binding.plan_items?.some((ref) => ref.work_item_id === "E6C"),
        ),
    ).toBe(false);
    expect(oracle.plan_tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          work_items: expect.arrayContaining([
            { work_item_id: "E6C", bindings: [] },
          ]),
        }),
      ]),
    );
  });

  it("reads all eight v1 types under their actual schemas without silently enabling v2 fields", () => {
    const original = fixtureItems(
      path.join(fixtureRoot, "product-comprehensive"),
    ).filter((item) => item.type !== "plan");
    const metadata = original.map((item) => {
      const result = structuredClone(item.metadata);
      delete result.task_bindings;
      delete result.pending_sources;
      return result;
    });
    const raw = document(
      metadata,
      original.map((item) => item.body).join("\n"),
      1,
    );
    const parsed = parse(raw);
    expect(parsed.items.every((item) => item.usable)).toBe(true);
    expect(new Set(parsed.items.map((item) => item.type)).size).toBe(8);
    compareItems(parsed.items, runOracle(isolated(raw, 1)));
    const incompatible = document(
      [{ ...requirement(), task_bindings: [] }],
      requirementBody(),
      1,
    );
    expect(parse(incompatible).items[0].usable).toBe(false);
  });

  it("retains good neighbors and matches oracle degradation for safely parsed bad items", () => {
    const raw = document(
      [{ ...requirement("REQ-BAD"), scope: "done" }, requirement("REQ-GOOD")],
      requirementBody("REQ-BAD") + "\n" + requirementBody("REQ-GOOD"),
    );
    const parsed = parse(raw);
    const oracle = runOracle(isolated(raw));
    compareItems(parsed.items, oracle);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].rawMetadata).toMatchObject({ scope: "done" });
    expect(
      parsed.diagnostics.some(
        (entry) => entry.code === "ITEM_METADATA" && entry.itemId === "REQ-BAD",
      ),
    ).toBe(true);
    expect(
      oracle.diagnostics.some(
        (entry) =>
          entry.code === "ITEM_METADATA" && entry.item_id === "REQ-BAD",
      ),
    ).toBe(true);
  });

  it("matches oracle section and duplicate-ID degradation while retaining invalid source locations", () => {
    for (const raw of [
      document(
        [requirement()],
        requirementBody().replace("### 验收要求", "### 尚未记录"),
      ),
      document([requirement(), requirement()], requirementBody()),
      document([requirement()], requirementBody() + "\n" + requirementBody()),
    ]) {
      const parsed = parse(raw);
      const oracle = runOracle(isolated(raw));
      compareItems(parsed.items, oracle);
      expect(
        parsed.items.every(
          (item) =>
            !item.usable && item.source.line > 1 && item.metadataLine > 1,
        ),
      ).toBe(true);
      for (const code of new Set(parsed.diagnostics.map((entry) => entry.code)))
        expect(oracle.diagnostics.some((entry) => entry.code === code)).toBe(
          true,
        );
    }
  });
});

describe("PRODUCT envelope classification", () => {
  it.each(["schema", '"schema"', "'schema'"])(
    "recognizes %s with BOM and space/tab suffixed delimiters using the parser's body offset",
    (key) => {
      const body = requirementBody();
      const raw =
        "\uFEFF---  \t\r\n" +
        `${key}: !!str vnext-product-doc/v2\r\nitems: [{id: REQ-A, type: requirement, scope: current}]\r\n--- \t\r\n` +
        body;
      const inspected = inspectProductEnvelope(raw);
      expect(inspected).toEqual({
        isProduct: true,
        bodyStart: raw.indexOf(body),
      });
      const parsed = parse(raw);
      expect(parsed.items[0].usable).toBe(true);
      expect(parsed.items[0].body).toBe(raw.slice(inspected.bodyStart));
      expect(parsed.items[0].source.line).toBe(
        raw.slice(0, inspected.bodyStart).split(/\r\n|\n|\r/).length,
      );
    },
  );

  it("classifies unsupported and damaged PRODUCT metadata without exposing it to generic task inference", () => {
    for (const metadata of [
      '"schema": vnext-product-doc/v99\nitems: []\n',
      "schema: vnext-product-doc/v2\nitems: [broken\n",
      "schema: vnext-product-doc/v2\nschema: unrelated\nitems: []\n",
      "schema: !custom vnext-product-doc/v2\nitems: []\n",
      "schema: >-\n  vnext-product-doc/v2\nitems: []\n",
    ]) {
      const raw = `---  \n${metadata}---  \n# Historical Task: TASK-99\nStatus: done\n`;
      expect(inspectProductEnvelope(raw)).toEqual({
        isProduct: true,
        bodyStart: raw.indexOf("# Historical"),
      });
    }
    const unclosed = '---\n"schema": vnext-product-doc/v2\nitems: [\n';
    expect(inspectProductEnvelope(unclosed)).toEqual({
      isProduct: true,
      bodyStart: unclosed.length,
    });
  });

  it("does not classify examples in prose or nested YAML values as a root PRODUCT schema", () => {
    for (const raw of [
      "# Ordinary document\n\n```yaml\nschema: vnext-product-doc/v2\n```\n",
      "---\ntitle: Example\nexample: {schema: vnext-product-doc/v2}\n---\n# Document\n",
      "---\nschema: unrelated\nexample: |\n  schema: vnext-product-doc/v2\n---\n# Document\n",
    ])
      expect(inspectProductEnvelope(raw).isProduct).toBe(false);
    expect(inspectProductEnvelope("# No frontmatter\n")).toEqual({
      isProduct: false,
      bodyStart: 0,
    });
  });
});

describe("PRODUCT Markdown source boundaries", () => {
  it.each(["\n", "\r\n"])(
    "preserves complete bodies and absolute locations with BOM and %j",
    (newline) => {
      const body =
        requirementBody("REQ-A", "中文 **长标题**") +
        "\n| 字段 | 内容 |\n| --- | --- |\n| 一 | 二 |\n\n```markdown\n## [FAKE-CODE] not an item\n### 验收要求\n```\n\n> ## [FAKE-QUOTE] not an item\n\n- list\n\n  ## [FAKE-LIST] not an item\n\n### 额外章节\n保留末尾。\n\n";
      const raw =
        "\uFEFF" +
        document(
          [requirement()],
          body + "## 普通附录\n附录不属于需求。\n",
        ).replaceAll("\n", newline);
      const parsed = parse(raw);
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.items).toHaveLength(1);
      const item = parsed.items[0];
      expect(item.body).toBe(body.replaceAll("\n", newline));
      expect(item.title).toBe("中文 长标题");
      const lines = raw.split(/\r\n|\n|\r/);
      expect(item.source.line).toBe(
        lines.findIndex((line) => line.startsWith("## [REQ-A]")) + 1,
      );
      expect(item.metadataLine).toBe(
        lines.findIndex((line) => /- id: REQ-A/.test(line)) + 1,
      );
      expect(item.endLine).toBe(
        lines.findIndex((line) => line === "## 普通附录"),
      );
      compareItems(parsed.items, runOracle(isolated(raw)));
    },
  );

  it("requires root-level unique business sections, not headings in fenced or quoted content", () => {
    const body = requirementBody().replace("### 验收要求", "> ### 验收要求");
    expect(
      parse(document([requirement()], body)).diagnostics.some(
        (entry) => entry.code === "REQUIRED_SECTION",
      ),
    ).toBe(true);
    const duplicate = requirementBody() + "\n### 验收要求\n第二份。\n";
    expect(parse(document([requirement()], duplicate)).items[0].usable).toBe(
      false,
    );
  });

  it("keeps unregistered headings as a file diagnostic without swallowing good entries", () => {
    const parsed = parse(
      document(
        [requirement()],
        requirementBody() + "\n## [ORPHAN] Missing metadata\nText\n",
      ),
    );
    expect(parsed.items[0].usable).toBe(true);
    expect(parsed.items[0].body).not.toContain("Missing metadata");
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNREGISTERED_HEADING" }),
    );
  });

  it("rejects unsupported versions and damaged root shapes, retaining a file diagnostic", () => {
    for (const raw of [
      "# No metadata\n",
      "---\nschema: vnext-product-doc/v2\n",
      "---\nschema: vnext-product-doc/v99\nitems: []\n---\n",
      "---\nschema: vnext-product-doc/v2\nitems: null\n---\n",
      "---\nschema: vnext-product-doc/v2\nitems: []\nstatus: done\n---\n",
    ]) {
      const result = parse(raw);
      expect(result.items).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("isolates null/scalar/unknown item metadata, retaining its exact value for inspection", () => {
    const result = parse(
      document(
        [null, "bad item", { id: "X", type: "future" }, requirement()],
        requirementBody(),
      ),
    );
    expect(
      result.items.filter((item) => item.usable).map((item) => item.id),
    ).toEqual(["REQ-A"]);
    expect(result.items[0].rawMetadata).toBeNull();
    expect(result.items[1].rawMetadata).toBe("bad item");
    expect(result.items[2].type).toBe("unknown");
    expect(result.items.every((item) => item.metadata !== null)).toBe(true);
    expect(new Set(result.items.map((item) => item.key)).size).toBe(4);
  });
});

describe("strict JSON-compatible PRODUCT YAML", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "isolates unknown type %s instead of treating inherited object properties as section lists",
    (type) => {
      const result = parse(
        document([{ id: "BAD", type }, requirement()], requirementBody()),
      );
      expect(result.items).toHaveLength(2);
      expect(result.items[0].usable).toBe(false);
      expect(result.items[0].rawMetadata).toEqual({ id: "BAD", type });
      expect(result.items[1].usable).toBe(true);
    },
  );
  it.each([
    [
      "duplicate key",
      "    scope: planned\n    scope: current\n",
      "YAML_DUPLICATE_KEY",
    ],
    ["anchor", "    scope: &scope current\n", "YAML_ANCHOR"],
    ["alias", "    scope: *undefined\n", "YAML_ALIAS"],
    ["custom tag", "    scope: !custom current\n", "YAML_TAG"],
    ["merge", "    scope: current\n    <<: {scope: planned}\n", "YAML_MERGE"],
    [
      "nonfinite number",
      "    scope: current\n    extensions: {value: .inf}\n",
      "YAML_JSON_VALUE",
    ],
    [
      "non-string mapping key",
      "    scope: current\n    extensions: {1: value}\n",
      "YAML_KEY",
    ],
    ["unclosed flow", "    scope: [current\n", "YAML_"],
  ])(
    "rejects the entire frontmatter for %s, without salvaging a plausible neighbor",
    (_name, fragment, code) => {
      const raw = `---\nschema: vnext-product-doc/v2\nitems:\n  - id: REQ-BAD\n    type: requirement\n${fragment}  - id: REQ-GOOD\n    type: requirement\n    scope: current\n---\n${requirementBody("REQ-BAD")}\n${requirementBody("REQ-GOOD")}`;
      const result = parse(raw);
      expect(result.items).toEqual([]);
      expect(
        result.diagnostics.some((entry) => entry.code.startsWith(code)),
      ).toBe(true);
      expect(result.diagnostics.every((entry) => (entry.line ?? 0) >= 2)).toBe(
        true,
      );
    },
  );

  it("accepts exactly the JSON-compatible built-in YAML tags supported by the pinned parser", () => {
    const raw = `---
schema: !!str vnext-product-doc/v2
items: !!seq
  - !!map
    id: REQ-A
    type: requirement
    scope: !!str current
    extensions:
      integer: !!int 7
      float: !!float 2.5
      boolean: !!bool true
      empty: !!null null
      sequence: !!seq [one, two]
      mapping: !!map {key: value}
---
${requirementBody()}`;
    const parsed = parse(raw);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.items[0].usable).toBe(true);
    expect(parsed.items[0].metadata.extensions).toEqual({
      integer: 7,
      float: 2.5,
      boolean: true,
      empty: null,
      sequence: ["one", "two"],
      mapping: { key: "value" },
    });
    compareItems(parsed.items, runOracle(isolated(raw)));
    const manifest = `schema: !!str vnext-product-manifest/v2
project_id: tagged-example
entry: docs/PROJECT.md
managed_paths: [docs/*.md]
source_paths: []
exclude_paths: []
maintenance: enabled
`;
    expect(parseProductManifest(manifest, "PRODUCT.yaml")).toMatchObject({
      status: "ready",
      manifest: { schema: "vnext-product-manifest/v2" },
      diagnostics: [],
    });
    expect(
      parseProductManifest(
        manifest.replace("!!str", "!custom"),
        "PRODUCT.yaml",
      ),
    ).toMatchObject({ status: "unavailable", manifest: null });
    // Safe tag spelling does not bypass JSON value or mapping-key constraints.
    expect(parse(raw.replace("!!float 2.5", "!!float .inf")).items).toEqual([]);
    expect(
      parse(raw.replace("!!map {key: value}", "!!map {1: value}")).items,
    ).toEqual([]);
  });

  it("documents the safer whole-YAML failure when the official oracle salvages item-range duplicate keys", () => {
    const raw = `---\nschema: vnext-product-doc/v2\nitems:\n  - id: REQ-BAD\n    type: requirement\n    scope: current\n    scope: planned\n  - id: REQ-GOOD\n    type: requirement\n    scope: current\n---\n${requirementBody("REQ-BAD")}\n${requirementBody("REQ-GOOD")}`;
    expect(runOracle(isolated(raw)).items.map((item) => item.id)).toEqual([
      "REQ-GOOD",
    ]);
    expect(parse(raw).items).toEqual([]);
  });

  it("uses the complete production schema for conditional provenance and closed nested fields", () => {
    for (const extra of [
      {
        links: [
          {
            id: "L",
            relation: "references",
            target: "REQ-X",
            origin: "inferred",
            state: "active",
            reason: "because",
            sources: [],
          },
        ],
      },
      {
        links: [
          {
            id: "L",
            relation: "references",
            target: "REQ-X",
            origin: "declared",
            state: "dismissed",
          },
        ],
      },
      { sources: [{ kind: "text", text: "words" }] },
      {
        sources: [
          {
            kind: "file",
            path: "docs/source.md",
            lines: { start: 1, end: 2, unknown: true },
          },
        ],
      },
      {
        task_bindings: [
          {
            id: "B",
            task: {
              task_id: null,
              source: { kind: "text", text: "Legacy", label: "Record" },
            },
            role: "implementation",
            coverage: "scope",
            origin: "inferred",
            state: "active",
          },
        ],
      },
    ])
      expect(
        parse(document([{ ...requirement(), ...extra }], requirementBody()))
          .items[0].usable,
      ).toBe(false);
    const project = {
      id: "P",
      type: "project",
      inventory: {
        state: "reconciled",
        checked_sources: [],
        unreviewed_sources: [],
      },
    };
    expect(
      parse(
        document(
          [project],
          "## [P] Project\n### 项目定位\nKnown\n### 盘点范围与未核对项\nKnown\n",
        ),
      ).items[0].usable,
    ).toBe(false);
  });
});

describe("PRODUCT identity, definition hashes, and manifests", () => {
  it("keeps IDs case-sensitive and moves stable within a working-copy namespace", () => {
    const raw = document(
      [requirement("REQ-A"), requirement("req-a")],
      requirementBody("REQ-A") + "\n" + requirementBody("req-a"),
    );
    const result = parse(raw);
    expect(result.items.every((item) => item.usable)).toBe(true);
    expect(result.items[0].key).not.toBe(result.items[1].key);
    expect(productItemKey("worktree-a/project", "REQ-A")).not.toBe(
      productItemKey("worktree-b/project", "REQ-A"),
    );
    const moved = parseProductDocument(
      "registered-project",
      "working-copy/product-id",
      input(raw, "docs/moved.md"),
    );
    expect(moved.items.map((item) => item.key)).toEqual(
      result.items.map((item) => item.key),
    );
    expect(moved.items[0].source.documentId).not.toBe(
      result.items[0].source.documentId,
    );
  });

  it("uses the exact normalized-body and declared-active relation digest, independent of bindings and reports", () => {
    const link = {
      id: "L",
      relation: "supports",
      target: "GOAL-Z",
      origin: "declared",
      state: "active",
    };
    const raw = document(
      [{ ...requirement(), links: [link] }],
      requirementBody(),
    );
    const item = parse(raw).items[0];
    const expected = digest(
      `vnext-requirement-definition/v1\n${JSON.stringify({ type: "requirement", id: "REQ-A", scope: "current", relations: [["supports", "GOAL-Z"]], body: requirementBody().replace(/\n+$/, "") })}`,
    );
    expect(item.definitionSha256).toBe(expected);
    const modified = structuredClone(item);
    modified.metadata.assessment_id = "AS-NEW";
    modified.metadata.sources = [
      { kind: "text", text: "New evidence", label: "Synthetic evidence" },
    ];
    modified.metadata.task_bindings = [];
    modified.metadata.links!.push(
      { ...modified.metadata.links![0], id: "L-DUP" },
      {
        id: "L-IGNORE",
        relation: "references",
        target: "REQ-B",
        origin: "declared",
        state: "active",
      },
      {
        id: "L-INFERRED",
        relation: "supports",
        target: "GOAL-Q",
        origin: "inferred",
        state: "active",
        reason: "synthetic",
        sources: modified.metadata.sources,
      },
    );
    modified.body = modified.body.replaceAll("\n", "\r\n") + "\r\n";
    expect(requirementDefinitionDigest(modified)).toBe(expected);
    modified.metadata.links!.push({
      id: "L-NEW",
      relation: "depends_on",
      target: "REQ-C",
      origin: "declared",
      state: "active",
    });
    expect(requirementDefinitionDigest(modified)).not.toBe(expected);
    expect(item.source.digest).not.toBe(expected);
  });

  it("validates manifests by version and distinguishes paused, unsupported and unavailable", () => {
    const manifest = {
      schema: "vnext-product-manifest/v2",
      project_id: "example",
      entry: "docs/PROJECT.md",
      managed_paths: ["docs/*.md"],
      source_paths: [],
      exclude_paths: [],
      maintenance: "paused",
    };
    expect(
      parseProductManifest(
        "\uFEFF" + stringify(manifest).replaceAll("\n", "\r\n"),
        "PRODUCT.yaml",
      ),
    ).toMatchObject({ status: "ready", manifest: { maintenance: "paused" } });
    expect(
      parseProductManifest(
        stringify({ ...manifest, schema: "future" }),
        "PRODUCT.yaml",
      ).status,
    ).toBe("unsupported");
    expect(
      parseProductManifest(
        stringify({
          ...manifest,
          schema: "vnext-product-manifest/v1",
          capture_paths: [],
        }),
        "PRODUCT.yaml",
      ).status,
    ).toBe("unavailable");
    expect(
      parseProductManifest(
        stringify(manifest) + "project_id: duplicate\n",
        "PRODUCT.yaml",
      ).status,
    ).toBe("unavailable");
    expect(
      parseProductManifest(
        stringify({ ...manifest, exclude_paths: ["docs/**"] }),
        "PRODUCT.yaml",
      ).status,
    ).toBe("unavailable");
    expect(
      parseProductManifest(
        stringify({ ...manifest, entry: "other/PROJECT.md" }),
        "PRODUCT.yaml",
      ).status,
    ).toBe("unavailable");
    expect(
      parseProductManifest(
        stringify({ ...manifest, source_paths: ["../secret/**"] }),
        "PRODUCT.yaml",
      ).status,
    ).toBe("unavailable");
  });

  it("uses the bounded PRODUCT path grammar and matching semantics", () => {
    for (const value of [
      "../x",
      "a/../x",
      "C:/x",
      "a\\x",
      "/abs",
      "a//b",
      "a/./b",
      "a/space ",
      "a/nul\0",
      "a/stream:secret",
    ])
      expect(isSafeProductPath(value, true)).toBe(false);
    expect(isSafeProductPath("中文 空格/文档.md")).toBe(true);
    expect(isSafeProductPath("docs/{a,b}.md", true)).toBe(false);
    expect(matchesProductPath("docs/PROJECT.md", ["docs/**/PROJECT.md"])).toBe(
      true,
    );
    expect(matchesProductPath("docs/a/PROJECT.md", ["docs/*.md"])).toBe(false);
    expect(matchesProductPath("docs/.hidden/PROJECT.md", ["docs/**"])).toBe(
      true,
    );
    expect(matchesProductPath("docs/PROJECT.md", ["docs/project.md"])).toBe(
      false,
    );
    expect(matchesProductPath("docs/a.b.md", ["docs/a?b.md"])).toBe(true);
  });
});
