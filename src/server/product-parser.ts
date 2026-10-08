/**
 * Pure PRODUCT parsing, adapted from vibe-coding-workflow-system@813d3146561c974c1437fc4d116144dc800bc1ad.
 * See product-assets/PROVENANCE.md and LICENSE. No Runtime or project code is executed.
 */
import { createHash } from "node:crypto";
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toString } from "mdast-util-to-string";
import type { Heading } from "mdast";
import type {
  ProductDiagnostic,
  ProductItem,
  ProductManifest,
  ProductMetadata,
  ProductType,
} from "../shared/product-types.js";
import type { InputFile } from "./scanner.js";
import { stableId } from "./parser.js";
import manifestV1 from "./product-assets/product-manifest-v1.json" with { type: "json" };
import manifestV2 from "./product-assets/product-manifest-v2.json" with { type: "json" };
import documentV1 from "./product-assets/product-doc-v1.json" with { type: "json" };
import documentV2 from "./product-assets/product-doc-v2.json" with { type: "json" };

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function lineLocator(text: string) {
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\n|\r/g))
    starts.push(match.index! + match[0].length);
  return (offset: number) => {
    let low = 0,
      high = starts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sectionsByType: Record<ProductType, string[]> = {
  project: ["项目定位", "盘点范围与未核对项"],
  goal: ["目标说明", "范围边界"],
  module: ["业务能力", "范围边界"],
  requirement: ["需求内容", "范围边界", "验收要求"],
  design: ["设计方案", "约束与取舍", "实际实现与差异"],
  change: ["变更说明", "影响与未同步项"],
  assessment: ["覆盖范围", "交付与验证依据", "剩余与待核对"],
  discussion: ["整理摘要", "议题与未决问题"],
  plan: ["实施策略", "阶段与工作项说明", "调整与未决事项"],
};
// Exact JSON-compatible built-in tag allowlist from the pinned upstream parser.
const jsonYamlTags = new Set(
  ["str", "int", "float", "bool", "null", "seq", "map"].map(
    (tag) => `tag:yaml.org,2002:${tag}`,
  ),
);
const processor = unified().use(remarkParse);
// The pinned production schemas use draft 2020-12, including sibling $ref constraints.
// strict:false permits their deliberately implicit object types in conditional rules.
const ajv = new Ajv2020({ allErrors: true, strict: false });
function validators(
  schema: typeof documentV1 | typeof documentV2,
  version: number,
) {
  const root = ajv.compile({
    ...schema,
    $id: `urn:tracelens:product-envelope:${version}`,
    properties: { ...schema.properties, items: { type: "array" } },
  });
  const compile = (item: object, suffix: string) =>
    ajv.compile({
      $schema: schema.$schema,
      $id: `urn:tracelens:product-item:${version}:${suffix}`,
      $defs: schema.$defs,
      ...item,
    });
  return {
    root,
    all: compile(schema.properties.items.items, "all"),
    // Selecting the explicit discriminator yields useful errors without changing a rule.
    byType: new Map(
      schema.properties.items.items.oneOf.map((item) => [
        item.properties.type.const,
        compile(item, item.properties.type.const),
      ]),
    ),
  };
}
const documentValidators = {
  1: validators(documentV1, 1),
  2: validators(documentV2, 2),
};
const manifestValidators = {
  1: ajv.compile(manifestV1),
  2: ajv.compile(manifestV2),
};

function diagnostic(
  code: string,
  path: string,
  message: string,
  extras: Partial<ProductDiagnostic> = {},
): ProductDiagnostic {
  return { code, path, message, severity: "error", ...extras };
}
function schemaProblems(
  validate: ValidateFunction,
  value: unknown,
): ErrorObject[] {
  return validate(value) ? [] : [...(validate.errors ?? [])];
}
function schemaMessage(error: ErrorObject, prefix = "") {
  const missing =
    error.keyword === "required" ? `/${error.params.missingProperty}` : "";
  const additional =
    error.keyword === "additionalProperties"
      ? `/${error.params.additionalProperty}`
      : "";
  return `${prefix}${error.instancePath}${missing}${additional || ""}: ${error.message ?? "Invalid metadata"}`;
}

/** JSON-compatible YAML only. Any syntax or forbidden-feature error rejects the whole value. */
function strictYaml(text: string, path: string, lineOffset = 0) {
  const lineAt = lineLocator(text);
  const doc = parseDocument(text, {
    schema: "core",
    uniqueKeys: true,
    strict: true,
    prettyErrors: false,
  });
  const diagnostics: ProductDiagnostic[] = [];
  const problem = (code: string, message: string, offset = 0) =>
    diagnostics.push(
      diagnostic(code, path, message, {
        line: lineOffset + lineAt(offset),
      }),
    );
  for (const issue of [...doc.errors, ...doc.warnings]) {
    problem(`YAML_${issue.code}`, issue.message, issue.pos?.[0] ?? 0);
  }
  const convert = (node: unknown): unknown => {
    if (node === null) return null;
    if (isNode(node)) {
      if ("anchor" in node && node.anchor)
        problem("YAML_ANCHOR", "Anchors are not permitted", node.range?.[0]);
      if ("tag" in node && node.tag && !jsonYamlTags.has(node.tag))
        problem(
          "YAML_TAG",
          "Custom/non-JSON tags are not permitted",
          node.range?.[0],
        );
    }
    if (isAlias(node)) {
      problem("YAML_ALIAS", "Aliases are not permitted", node.range?.[0]);
      return null;
    }
    if (isMap(node)) {
      const value: Record<string, unknown> = Object.create(null);
      for (const pair of node.items) {
        const key = convert(pair.key);
        if (typeof key !== "string") {
          problem(
            "YAML_KEY",
            "JSON object keys must be strings",
            isNode(pair.key) ? pair.key.range?.[0] : 0,
          );
          continue;
        }
        if (key === "<<")
          problem(
            "YAML_MERGE",
            "Merge keys are not permitted",
            isNode(pair.key) ? pair.key.range?.[0] : 0,
          );
        value[key] = convert(pair.value);
      }
      return value;
    }
    if (isSeq(node)) return node.items.map(convert);
    if (isScalar(node)) {
      const value: unknown = node.value;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      )
        return value;
      problem(
        "YAML_JSON_VALUE",
        "Only finite JSON-compatible values are permitted",
        node.range?.[0],
      );
      return null;
    }
    problem("YAML_NODE", "Unsupported YAML node");
    return null;
  };
  return { doc, value: convert(doc.contents), diagnostics };
}

/** Contract path syntax, separate from filesystem checks performed by the scanner. */
export function isSafeProductPath(value: string, glob = false): boolean {
  if (
    !value ||
    /[\u0000-\u001f\\:]/.test(value) ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (part) => part === ".." || part === "." || !part || /[. ]$/.test(part),
      )
  )
    return false;
  return glob ? !/[\[\]{}]/.test(value) : !/[*?\[\]]/.test(value);
}
/** Exactly the PRODUCT *, **, ? matching language (case-sensitive on every host). */
export function matchesProductPath(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (!isSafeProductPath(pattern, true)) return false;
    let expression = "^";
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index];
      if (char === "*" && pattern[index + 1] === "*") {
        index++;
        if (pattern[index + 1] === "/") {
          expression += "(?:[^/]+/)*";
          index++;
        } else expression += ".*";
      } else if (char === "*") expression += "[^/]*";
      else if (char === "?") expression += "[^/]";
      else expression += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`${expression}$`).test(value);
  });
}

export function parseProductManifest(
  raw: string,
  path: string,
): {
  manifest: ProductManifest | null;
  status: "ready" | "unsupported" | "unavailable";
  diagnostics: ProductDiagnostic[];
} {
  try {
    const parsed = strictYaml(raw, path);
    if (parsed.diagnostics.length)
      return {
        manifest: null,
        status: "unavailable",
        diagnostics: parsed.diagnostics,
      };
    const schema = record(parsed.value) ? parsed.value.schema : undefined;
    const version =
      schema === "vnext-product-manifest/v2"
        ? 2
        : schema === "vnext-product-manifest/v1"
          ? 1
          : null;
    if (!version)
      return {
        manifest: null,
        status: "unsupported",
        diagnostics: [
          diagnostic(
            "UNSUPPORTED_VERSION",
            path,
            `Unsupported manifest schema ${JSON.stringify(schema)}; raw content is retained`,
          ),
        ],
      };
    const diagnostics = schemaProblems(
      manifestValidators[version],
      parsed.value,
    ).map((error) =>
      diagnostic("MANIFEST_METADATA", path, schemaMessage(error), { line: 1 }),
    );
    if (diagnostics.length)
      return { manifest: null, status: "unavailable", diagnostics };
    const manifest = parsed.value as ProductManifest;
    if (
      !isSafeProductPath(manifest.entry) ||
      [
        ...manifest.managed_paths,
        ...manifest.source_paths,
        ...manifest.exclude_paths,
        ...(manifest.capture_paths ?? []),
      ].some((value) => !isSafeProductPath(value, true))
    ) {
      diagnostics.push(
        diagnostic(
          "MANIFEST_PATH",
          path,
          "Expected relative /-separated paths without traversal, alternate streams or ambiguous Windows segments; PRODUCT globs support only *, ** and ?",
        ),
      );
    } else if (
      !matchesProductPath(manifest.entry, manifest.managed_paths) ||
      matchesProductPath(manifest.entry, manifest.exclude_paths) ||
      manifest.entry.startsWith(".git/")
    ) {
      diagnostics.push(
        diagnostic(
          "MANIFEST_PATH",
          path,
          "Manifest entry must be within managed_paths and not excluded",
        ),
      );
    }
    return {
      manifest: diagnostics.length ? null : manifest,
      status: diagnostics.length ? "unavailable" : "ready",
      diagnostics,
    };
  } catch (error) {
    return {
      manifest: null,
      status: "unavailable",
      diagnostics: [
        diagnostic(
          "MANIFEST_METADATA",
          path,
          error instanceof Error ? error.message : String(error),
        ),
      ],
    };
  }
}

/** One delimiter grammar for classification, parsing, and metadata masking. */
function productEnvelope(raw: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/.exec(raw);
  if (!opening) return null;
  const frontmatterStart = opening[0].length;
  const closing = /^---[ \t]*(?:\r\n|\n|\r|$)/m.exec(
    raw.slice(frontmatterStart),
  );
  if (!closing)
    return {
      frontmatterStart,
      frontmatterEnd: raw.length,
      bodyStart: raw.length,
      closed: false,
    };
  const frontmatterEnd = frontmatterStart + closing.index;
  return {
    frontmatterStart,
    frontmatterEnd,
    bodyStart: frontmatterEnd + closing[0].length,
    closed: true,
  };
}

/**
 * Classifies a PRODUCT envelope without trusting its metadata or inferring tasks.
 * Unsupported versions and even damaged YAML remain PRODUCT when a root schema
 * declaration identifies them. An unclosed envelope has no safely known body.
 * bodyStart is also returned for non-PRODUCT frontmatter so callers can mask it
 * with equal-length whitespace while retaining the original source positions.
 */
export function inspectProductEnvelope(raw: string): {
  isProduct: boolean;
  bodyStart: number;
} {
  const envelope = productEnvelope(raw);
  if (!envelope) return { isProduct: false, bodyStart: 0 };
  let isProduct = false;
  try {
    const yaml = parseDocument(
      raw.slice(envelope.frontmatterStart, envelope.frontmatterEnd),
      { schema: "core", uniqueKeys: true, strict: true, prettyErrors: false },
    );
    // Examine every declaration rather than choosing a winner for duplicate keys.
    // Do not expand aliases or decode unrelated, potentially broken item metadata.
    if (isMap(yaml.contents)) {
      isProduct = yaml.contents.items.some(
        (pair) =>
          isScalar(pair.key) &&
          pair.key.value === "schema" &&
          isScalar(pair.value) &&
          typeof pair.value.value === "string" &&
          /^vnext-product-(?:doc|manifest)(?:\/|$)/.test(pair.value.value),
      );
    }
  } catch {
    // Parsing failure cannot provide a trusted root schema declaration.
  }
  return { isProduct, bodyStart: envelope.bodyStart };
}

/** Item IDs are case-sensitive; do not apply the file-path identity normalizer. */
export function productItemKey(namespace: string, id: string): string {
  return `product:${hash(JSON.stringify([namespace, id])).slice(0, 24)}`;
}

export function parseProductDocument(
  projectId: string,
  namespace: string,
  input: InputFile,
): {
  items: ProductItem[];
  diagnostics: ProductDiagnostic[];
} {
  const { raw: text, path } = input;
  const lineAt = lineLocator(text);
  const documentId = stableId(projectId, path);
  const items: ProductItem[] = [];
  const diagnostics: ProductDiagnostic[] = [];
  const fail = (code: string, message: string, line = 1) => {
    diagnostics.push(diagnostic(code, path, message, { line }));
    return { items, diagnostics };
  };
  try {
    const envelope = productEnvelope(text);
    if (!envelope)
      return fail(
        "FRONTMATTER_MISSING",
        "Expected YAML frontmatter at the beginning",
      );
    if (!envelope.closed)
      return fail(
        "FRONTMATTER_UNCLOSED",
        "Missing frontmatter closing delimiter",
      );
    const { frontmatterStart, frontmatterEnd, bodyStart } = envelope;
    const yaml = strictYaml(
      text.slice(frontmatterStart, frontmatterEnd),
      path,
      1,
    );
    // Do not trust even apparently valid members of a syntactically damaged document.
    diagnostics.push(...yaml.diagnostics);
    if (diagnostics.length) return { items, diagnostics };
    const schema = record(yaml.value) ? yaml.value.schema : undefined;
    const version =
      schema === "vnext-product-doc/v2"
        ? 2
        : schema === "vnext-product-doc/v1"
          ? 1
          : null;
    if (!version)
      return fail(
        "UNSUPPORTED_VERSION",
        `Unsupported schema ${JSON.stringify(schema)}; raw content is retained`,
        2,
      );
    const validator = documentValidators[version];
    diagnostics.push(
      ...schemaProblems(validator.root, yaml.value).map((error) =>
        diagnostic("DOCUMENT_METADATA", path, schemaMessage(error), {
          line: 2,
        }),
      ),
    );
    if (
      diagnostics.length ||
      !record(yaml.value) ||
      !Array.isArray(yaml.value.items)
    )
      return { items, diagnostics };
    const metadataItems = yaml.value.items;
    const sequence = yaml.doc.get("items", true);
    const itemNodes = isSeq(sequence) ? sequence.items : [];
    const ast = processor.parse(text.slice(bodyStart));
    const headings = ast.children.filter(
      (node): node is Heading => node.type === "heading" && node.depth === 2,
    );
    const identified = headings.map((node, index) => {
      const match = /^\[([A-Za-z0-9][A-Za-z0-9._-]{0,95})\]\s+(.+)$/.exec(
        toString(node, { includeImageAlt: false }),
      );
      const start = bodyStart + node.position!.start.offset!;
      const end =
        index + 1 < headings.length
          ? bodyStart + headings[index + 1].position!.start.offset!
          : text.length;
      return {
        id: match?.[1],
        title: match?.[2],
        start,
        end,
        line: lineAt(start),
        sections: [] as string[],
      };
    });
    const headingsById = new Map<string, typeof identified>();
    for (const heading of identified) {
      if (heading.id) {
        const matching = headingsById.get(heading.id) ?? [];
        matching.push(heading);
        headingsById.set(heading.id, matching);
      }
    }
    let headingIndex = -1;
    for (const child of ast.children) {
      if (child.type !== "heading") continue;
      if (child.depth === 2) headingIndex++;
      else if (child.depth === 3 && headingIndex >= 0)
        identified[headingIndex].sections.push(
          toString(child, { includeImageAlt: false }),
        );
    }
    const metadataCounts = new Map<string, number>();
    for (const member of metadataItems)
      if (record(member) && typeof member.id === "string")
        metadataCounts.set(member.id, (metadataCounts.get(member.id) ?? 0) + 1);
    for (const [index, rawMetadata] of metadataItems.entries()) {
      const metadata = record(rawMetadata) ? rawMetadata : {};
      const id = typeof metadata.id === "string" ? metadata.id : "";
      const type =
        typeof metadata.type === "string" ? metadata.type : "unknown";
      const node = itemNodes[index];
      const metadataLine = lineAt(
        frontmatterStart + (isNode(node) ? (node.range?.[0] ?? 0) : 0),
      );
      const matches = id ? (headingsById.get(id) ?? []) : [];
      const location = matches[0];
      const itemDiagnostics = schemaProblems(
        validator.byType.get(type) ?? validator.all,
        rawMetadata,
      ).map((error) =>
        diagnostic(
          "ITEM_METADATA",
          path,
          schemaMessage(error, `/items/${index}`),
          { itemId: id || undefined, line: metadataLine },
        ),
      );
      if (matches.length !== 1)
        itemDiagnostics.push(
          diagnostic(
            "ITEM_HEADING",
            path,
            `Expected exactly one root level ## [${id || "unknown"}] heading; found ${matches.length}`,
            { itemId: id || undefined, line: location?.line ?? metadataLine },
          ),
        );
      if (id && metadataCounts.get(id) !== 1)
        itemDiagnostics.push(
          diagnostic("DUPLICATE_ID", path, "Metadata ID is not unique", {
            itemId: id,
            line: metadataLine,
          }),
        );
      const sections = location?.sections ?? [];
      const requiredSections = Object.hasOwn(sectionsByType, type)
        ? sectionsByType[type as ProductType]
        : [];
      for (const section of requiredSections) {
        if (sections.filter((name) => name === section).length !== 1)
          itemDiagnostics.push(
            diagnostic(
              "REQUIRED_SECTION",
              path,
              `Expected exactly one ### ${section}`,
              { itemId: id || undefined, line: location?.line ?? metadataLine },
            ),
          );
      }
      const source = {
        documentId,
        path,
        line: location?.line ?? metadataLine,
        section: location ? `[${id}] ${location.title}` : null,
        digest: input.digest,
      };
      for (const entry of itemDiagnostics)
        entry.source = { ...source, line: entry.line ?? source.line };
      const item: ProductItem = {
        key:
          id && itemDiagnostics.length === 0
            ? productItemKey(namespace, id)
            : `product-invalid:${hash(JSON.stringify([namespace, path, index])).slice(0, 24)}`,
        id,
        type: Object.hasOwn(sectionsByType, type)
          ? (type as ProductType)
          : "unknown",
        ...(itemDiagnostics.length ? { rawMetadata } : {}),
        title: location?.title ?? "",
        metadata: (itemDiagnostics.length
          ? { id, type: Object.hasOwn(sectionsByType, type) ? type : "unknown" }
          : metadata) as unknown as ProductMetadata,
        body: location ? text.slice(location.start, location.end) : "",
        source,
        endLine: location
          ? Math.max(
              location.line,
              lineAt(location.end) -
                (/\r|\n/.test(text[location.end - 1] ?? "") ? 1 : 0),
            )
          : metadataLine,
        metadataLine,
        usable: itemDiagnostics.length === 0,
        definitionSha256: null,
        diagnostics: itemDiagnostics,
      };
      if (item.usable && item.type === "requirement")
        item.definitionSha256 = requirementDefinitionDigest(item);
      items.push(item);
    }
    for (const heading of identified) {
      if (heading.id && !metadataCounts.has(heading.id))
        diagnostics.push(
          diagnostic(
            "UNREGISTERED_HEADING",
            path,
            `Heading ${heading.id} is not registered in items`,
            { line: heading.line },
          ),
        );
    }
    diagnostics.push(...items.flatMap((item) => item.diagnostics));
    return { items, diagnostics };
  } catch (error) {
    // A parser failure cannot yield trusted partial frontmatter or AST results.
    return {
      items: [],
      diagnostics: [
        ...diagnostics,
        diagnostic(
          "DOCUMENT_PARSE",
          path,
          error instanceof Error ? error.message : String(error),
        ),
      ],
    };
  }
}

/** Exact vnext-requirement-definition/v1 algorithm; deliberately excludes task/report/source metadata. */
export function requirementDefinitionDigest(item: ProductItem): string {
  const relations = [
    ...new Map(
      (item.metadata.links ?? [])
        .filter(
          (link) =>
            link.origin === "declared" &&
            link.state === "active" &&
            [
              "part_of",
              "supports",
              "depends_on",
              "replaces",
              "derived_from",
            ].includes(link.relation),
        )
        .map((link) => [
          [link.relation, link.target].join("\u0000"),
          [link.relation, link.target],
        ]),
    ).values(),
  ];
  relations.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  const definition = {
    type: item.type,
    id: item.id,
    scope: item.metadata.scope,
    relations,
    body: item.body.replace(/\r\n|\r/g, "\n").replace(/\n+$/, ""),
  };
  return hash(`vnext-requirement-definition/v1\n${JSON.stringify(definition)}`);
}
