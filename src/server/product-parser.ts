import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Node as YamlNode,
} from "yaml";
import { toString } from "mdast-util-to-string";
import type { Heading } from "mdast";
import docV1 from "./product-schemas/product-doc-v1.json" with { type: "json" };
import docV2 from "./product-schemas/product-doc-v2.json" with { type: "json" };
import manifestV1 from "./product-schemas/product-manifest-v1.json" with { type: "json" };
import manifestV2 from "./product-schemas/product-manifest-v2.json" with { type: "json" };
import {
  productTypes,
  type ProductDiagnostic,
  type ProductItem,
  type ProductMetadata,
  type ProductType,
} from "../shared/product-types.js";
import type { InputFile } from "./scanner.js";
import { parseMarkdown, stableId } from "./parser.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const schema of [docV1, docV2, manifestV1, manifestV2])
  ajv.addSchema(schema);
export const manifestValidators = {
  1: ajv.getSchema(manifestV1.$id)!,
  2: ajv.getSchema(manifestV2.$id)!,
};
const docValidators = {
  1: ajv.getSchema(docV1.$id)!,
  2: ajv.getSchema(docV2.$id)!,
};
const itemValidators = {
  1: ajv.compile({ $ref: `${docV1.$id}#/properties/items/items` }),
  2: ajv.compile({ $ref: `${docV2.$id}#/properties/items/items` }),
};
export const requiredSections: Record<ProductType, string[]> = {
  project: ["项目定位", "盘点范围与未核对项"],
  goal: ["目标说明", "范围边界"],
  module: ["业务能力", "范围边界"],
  requirement: ["需求内容", "范围边界", "验收要求"],
  design: ["设计方案", "约束与取舍", "实际实现与差异"],
  plan: ["实施策略", "阶段与工作项说明", "调整与未决事项"],
  change: ["变更说明", "影响与未同步项"],
  assessment: ["覆盖范围", "交付与验证依据", "剩余与待核对"],
  discussion: ["整理摘要", "议题与未决问题"],
};
export function productKey(
  root: string,
  projectId: string,
  ...parts: string[]
): string {
  return `product:${createHash("sha256")
    .update(JSON.stringify([root, projectId, ...parts]))
    .digest("hex")}`;
}
function lineAt(raw: string, offset: number): number {
  return raw.slice(0, offset).split(/\r\n|\r|\n/).length;
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Convert the YAML AST ourselves so aliases and non-JSON nodes never reach a validator.
export function strictProductYaml(raw: string) {
  const doc = parseDocument(raw, {
    schema: "core",
    uniqueKeys: true,
    strict: true,
    prettyErrors: false,
  });
  const problems: { code: string; message: string; offset: number }[] = [];
  const problem = (code: string, message: string, offset = 0) =>
    problems.push({ code, message, offset });
  for (const issue of [...doc.errors, ...doc.warnings])
    problem(`YAML_${issue.code}`, issue.message, issue.pos?.[0]);
  const syntaxDamaged = doc.errors.some((e) => e.code !== "DUPLICATE_KEY");
  const tags = new Set(
    ["str", "int", "float", "bool", "null", "seq", "map"].map(
      (name) => `tag:yaml.org,2002:${name}`,
    ),
  );
  function convert(node: unknown): unknown {
    if (node === null) return null;
    const n = node as YamlNode;
    const offset = n?.range?.[0] || 0;
    if (n && "anchor" in n && n.anchor)
      problem("YAML_ANCHOR", "禁止 YAML 锚点", offset);
    if (n && "tag" in n && n.tag && !tags.has(n.tag))
      problem("YAML_TAG", "禁止自定义或非 JSON 标签", offset);
    if (isAlias(n)) {
      problem("YAML_ALIAS", "禁止 YAML 别名", offset);
      return null;
    }
    if (isMap(n)) {
      const result: Record<string, unknown> = Object.create(null);
      for (const pair of n.items) {
        const key = convert(pair.key);
        if (typeof key !== "string") {
          problem("YAML_KEY", "JSON 对象键须为字符串", offset);
          continue;
        }
        if (key === "<<") problem("YAML_MERGE", "禁止 YAML 合并键", offset);
        result[key] = convert(pair.value);
      }
      return result;
    }
    if (isSeq(n)) return n.items.map(convert);
    if (isScalar(n)) {
      const value = n.value;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      )
        return value;
      problem("YAML_JSON_VALUE", "只允许有限、JSON 兼容的值", offset);
      return null;
    }
    problem("YAML_NODE", "无法解释的 YAML 节点", offset);
    return null;
  }
  const value = syntaxDamaged ? null : convert(doc.contents);
  return { value, doc, problems, syntaxDamaged };
}
export function requirementDefinitionDigest(
  item: Pick<ProductItem, "id" | "type" | "metadata" | "body">,
): string {
  const metadata = item.metadata!;
  const pairs = new Map<string, [string, string]>();
  for (const link of metadata.links || []) {
    if (
      link.origin === "declared" &&
      link.state === "active" &&
      [
        "part_of",
        "supports",
        "depends_on",
        "replaces",
        "derived_from",
      ].includes(link.relation)
    )
      pairs.set(JSON.stringify([link.relation, link.target]), [
        link.relation,
        link.target,
      ]);
  }
  const relations = [...pairs.values()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  const definition = {
    type: item.type,
    id: item.id,
    scope: metadata.scope,
    relations,
    body: item.body.replace(/\r\n|\r/g, "\n").replace(/\n+$/, ""),
  };
  return createHash("sha256")
    .update(`vnext-requirement-definition/v1\n${JSON.stringify(definition)}`)
    .digest("hex");
}
export function parseProductDocument(
  root: string,
  projectId: string,
  registryId: string,
  input: InputFile,
): { items: ProductItem[]; diagnostics: ProductDiagnostic[] } {
  const items: ProductItem[] = [];
  const diagnostics: ProductDiagnostic[] = [];
  const report = (
    code: string,
    message: string,
    line = 1,
    itemId?: string,
    pointer?: string,
  ) =>
    diagnostics.push({
      code,
      message,
      path: input.path,
      line,
      itemId,
      pointer,
      severity: "error",
    });
  const raw = input.raw.replace(/^\uFEFF/, "");
  const opening = /^---[ \t]*(?:\r\n|\n|\r)/.exec(raw);
  if (!opening) {
    report(
      "FRONTMATTER_MISSING",
      "托管文件缺少起始 YAML frontmatter；保留原文",
    );
    return { items, diagnostics };
  }
  const rest = raw.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r\n|\n|\r|$)/m.exec(rest);
  if (!closing) {
    report("FRONTMATTER_UNCLOSED", "frontmatter 未闭合；不使用残缺对象");
    return { items, diagnostics };
  }
  const bodyStart = opening[0].length + closing.index + closing[0].length;
  const yaml = strictProductYaml(rest.slice(0, closing.index));
  if (yaml.syntaxDamaged) {
    for (const p of yaml.problems)
      report(p.code, p.message, lineAt(raw, opening[0].length + p.offset));
    return { items, diagnostics };
  }
  const rootValue = object(yaml.value);
  const version =
    rootValue.schema === "vnext-product-doc/v2"
      ? 2
      : rootValue.schema === "vnext-product-doc/v1"
        ? 1
        : null;
  if (!version) {
    report(
      "UNSUPPORTED_VERSION",
      `不支持文档版本 ${String(rootValue.schema)}；保留原文`,
    );
    return { items, diagnostics };
  }
  const itemNode = yaml.doc.get("items", true);
  const itemNodes = (
    isSeq(itemNode) ? itemNode.items : []
  ) as (YamlNode | null)[];
  function withinItem(offset: number, index: number): boolean {
    const node = itemNodes[index];
    return Boolean(
      node?.range && offset >= node.range[0] && offset < node.range[2],
    );
  }
  for (const p of yaml.problems.filter(
    (p) => !itemNodes.some((_n, i) => withinItem(p.offset, i)),
  ))
    report(p.code, p.message, lineAt(raw, opening[0].length + p.offset));
  const rootValidator = docValidators[version];
  if (
    !Array.isArray(rootValue.items) ||
    !rootValidator({ ...rootValue, items: [] })
  ) {
    report(
      "DOCUMENT_METADATA",
      "文档根级字段不符合固定 Schema，不能可靠枚举条目",
    );
    return { items, diagnostics };
  }
  if (diagnostics.length) return { items, diagnostics };
  const tree = parseMarkdown(raw.slice(bodyStart));
  const headings = tree.children.filter(
    (n): n is Heading => n.type === "heading" && n.depth === 2,
  );
  const identified = headings.map((node, index) => {
    const match = /^\[([A-Za-z0-9][A-Za-z0-9._-]{0,95})\]\s+(.+)$/.exec(
      toString(node),
    );
    const start = bodyStart + node.position!.start.offset!;
    const end =
      index + 1 < headings.length
        ? bodyStart + headings[index + 1].position!.start.offset!
        : raw.length;
    return {
      id: match?.[1],
      title: match?.[2] || "",
      start,
      end,
      line: lineAt(raw, start),
    };
  });
  for (const [index, rawMetadata] of rootValue.items.entries()) {
    const m = object(rawMetadata);
    const id = typeof m.id === "string" ? m.id : `(invalid-${index + 1})`;
    const type = productTypes.includes(m.type as ProductType)
      ? (m.type as ProductType)
      : null;
    const locations = identified.filter((h) => h.id === m.id);
    const location = locations[0];
    const metadataLine = lineAt(
      raw,
      opening[0].length + (itemNodes[index]?.range?.[0] || 0),
    );
    const before = diagnostics.length;
    const validator = itemValidators[version];
    if (!validator(rawMetadata)) {
      // Prefer the branch for this type, keeping actionable errors instead of every failed oneOf branch.
      const errors = validator.errors || [];
      const schema = version === 1 ? docV1 : docV2;
      const branch = schema.properties.items.items.oneOf.findIndex(
        (s) => s.properties.type.const === m.type,
      );
      const relevant = errors.filter(
        (e) =>
          branch < 0 ||
          e.schemaPath.includes(`/oneOf/${branch}/`) ||
          e.schemaPath.startsWith(`#/properties/items/items/oneOf/${branch}/`),
      );
      const selected = relevant.length
        ? relevant
        : errors.filter((e) => e.keyword === "oneOf");
      for (const e of selected)
        report(
          "ITEM_METADATA",
          `${e.instancePath || "/"} ${e.message}${e.keyword === "additionalProperties" ? ` (${e.params.additionalProperty})` : ""}`,
          metadataLine,
          id,
          `/items/${index}${e.instancePath}`,
        );
    }
    for (const p of yaml.problems.filter((p) => withinItem(p.offset, index)))
      report(p.code, p.message, lineAt(raw, opening[0].length + p.offset), id);
    if (locations.length !== 1)
      report(
        "ITEM_HEADING",
        `条目 ${id} 须对应一个根级二级标题，实际 ${locations.length} 个`,
        location?.line || metadataLine,
        id,
      );
    if (
      rootValue.items.filter((other) => object(other).id === m.id).length !== 1
    )
      report(
        "DUPLICATE_ID",
        `条目 ID ${id} 重复，禁止歧义连接`,
        metadataLine,
        id,
      );
    const internal = location
      ? tree.children.filter(
          (n): n is Heading =>
            n.type === "heading" &&
            bodyStart + n.position!.start.offset! >= location.start &&
            bodyStart + n.position!.start.offset! < location.end,
        )
      : [];
    for (const section of type ? requiredSections[type] : []) {
      if (
        internal.filter((h) => h.depth === 3 && toString(h) === section)
          .length !== 1
      )
        report(
          "REQUIRED_SECTION",
          `须有且仅有一个三级章节：${section}`,
          location?.line || metadataLine,
          id,
        );
    }
    const usable = diagnostics.length === before;
    const metadataLocations: Record<string, number> = {};
    function locateMetadata(node: unknown, pointer: string): void {
      const n = node as YamlNode;
      if (n?.range)
        metadataLocations[pointer] = lineAt(
          raw,
          opening![0].length + n.range[0],
        );
      if (isMap(n))
        for (const pair of n.items) {
          const name = isScalar(pair.key) ? String(pair.key.value) : "";
          locateMetadata(pair.value, `${pointer}/${name}`);
        }
      else if (isSeq(n))
        n.items.forEach((child, i) => locateMetadata(child, `${pointer}/${i}`));
    }
    locateMetadata(itemNodes[index], "");
    const item: ProductItem = {
      key: productKey(root, projectId, id),
      id,
      type,
      title: location?.title || id,
      usable,
      version,
      metadata: usable ? (rawMetadata as ProductMetadata) : null,
      rawMetadata,
      body: location ? raw.slice(location.start, location.end) : "",
      source: {
        documentId: stableId(registryId, input.path),
        path: input.path,
        line: location?.line || metadataLine,
        section: location?.title || null,
        digest: input.digest,
      },
      endLine: location
        ? lineAt(raw, Math.max(location.start, location.end - 1))
        : metadataLine,
      metadataLine,
      metadataLocations,
      headings: internal.map((h) => ({
        title: toString(h),
        depth: h.depth,
        line: lineAt(raw, bodyStart + h.position!.start.offset!),
      })),
      definitionSha256: null,
    };
    if (usable && type === "requirement")
      item.definitionSha256 = requirementDefinitionDigest(item);
    items.push(item);
  }
  for (const h of identified)
    if (h.id && !items.some((i) => i.id === h.id))
      report(
        "UNREGISTERED_HEADING",
        `二级标题 ${h.id} 未在 items 登记`,
        h.line,
        h.id,
      );
  return { items, diagnostics };
}
