import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { toString } from "mdast-util-to-string";
import type { Project, ScanConfig, SourceRef } from "../shared/types.js";
import type {
  ProductDiagnostic,
  ProductItem,
  ProductManifest,
  ProductPreview,
  ProductSnapshot,
  ProductSource,
  ProductSourceCheck,
} from "../shared/product-types.js";
import { assertNoLinks, documentPathKey, safePattern } from "./config.js";
import {
  blockedPath,
  limits,
  matches,
  ScanReadSession,
  type InputFile,
  type ScanResult,
} from "./scanner.js";
import { parseMarkdown, stableId } from "./parser.js";
import {
  inspectProductEnvelope,
  isSafeProductPath,
  matchesProductPath,
  parseProductDocument,
  parseProductManifest,
} from "./product-parser.js";

export const defaultManifestPath = ".workflow-system/PRODUCT.yaml";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const sourceOf = (
  projectId: string,
  input: Omit<InputFile, "kind">,
  line = 1,
): SourceRef => ({
  documentId: stableId(projectId, input.path),
  path: input.path,
  line,
  section: null,
  digest: input.digest,
});
const productPath = isSafeProductPath;
export function productMatches(value: string, pattern: string): boolean {
  return matchesProductPath(value, [pattern]);
}
// Prefix pruning adapted from the pinned upstream paths.ts (MIT).
function mayContainMatch(directory: string, pattern: string): boolean {
  const prefix = directory ? `${directory}/` : "";
  const memo = new Map<string, boolean>();
  function extend(p: number, o: number): boolean {
    if (o === prefix.length) return true;
    if (p === pattern.length) return false;
    const key = `${p}:${o}`;
    if (memo.has(key)) return memo.get(key)!;
    let result: boolean;
    const char = pattern[p];
    if (char === "*" && pattern[p + 1] === "*") {
      if (pattern[p + 2] === "/") {
        const slash = prefix.indexOf("/", o);
        result = extend(p + 3, o) || (slash > o && extend(p, slash + 1));
      } else result = extend(p + 2, o) || extend(p, o + 1);
    } else if (char === "*")
      result = extend(p + 1, o) || (prefix[o] !== "/" && extend(p, o + 1));
    else
      result =
        (char === "?" ? prefix[o] !== "/" : char === prefix[o]) &&
        extend(p + 1, o + 1);
    memo.set(key, result);
    return result;
  }
  return extend(0, 0);
}
const productBlocked = (filename: string, source = false) =>
  blockedPath(filename, source) ||
  /(^|\/)\.next(\/|$)/.test(filename) ||
  /^\.workflow-system\/runtime(?:\/|$)/.test(filename);
function excluded(
  filename: string,
  config: ScanConfig,
  manifest?: ProductManifest,
  source = false,
): string | null {
  if (productBlocked(filename, source))
    return "安全边界排除（不扫描 Runtime、journal、依赖或构建目录）";
  if (
    config.excludes.some(
      (p) => matches(filename, p) || matches(`${filename}/`, p),
    )
  )
    return "用户显式排除";
  if (
    manifest?.exclude_paths.some(
      (p) => productMatches(filename, p) || productMatches(`${filename}/`, p),
    )
  )
    return "PRODUCT exclude_paths 排除";
  return null;
}
function validateManifestPaths(manifest: ProductManifest): string[] {
  const invalid = [
    ...manifest.managed_paths,
    ...manifest.source_paths,
    ...manifest.exclude_paths,
    ...(manifest.capture_paths || []),
  ].filter((p) => !productPath(p, true));
  if (!productPath(manifest.entry)) invalid.push(manifest.entry);
  return invalid;
}
export async function previewProduct(
  root: string,
  config: ScanConfig,
  session = new ScanReadSession(root),
): Promise<ProductPreview> {
  const filename = config.product?.manifestPath || defaultManifestPath;
  const result: ProductPreview = {
    path: filename,
    status: "missing",
    managedPaths: [],
    sourcePaths: [],
    diagnostics: [],
  };
  const reason = excluded(filename, config);
  if (reason) {
    result.status = "excluded";
    result.diagnostics.push({
      code: "PRODUCT_EXCLUDED",
      severity: "warning",
      path: filename,
      message: reason,
    });
    return result;
  }
  try {
    const input = await session.read(filename);
    const parsed = parseProductManifest(input.raw, filename);
    result.status = parsed.status;
    result.diagnostics = parsed.diagnostics;
    if (parsed.manifest) {
      const invalid = validateManifestPaths(parsed.manifest);
      if (invalid.length) {
        result.status = "unavailable";
        result.diagnostics.push({
          code: "UNSAFE_MANIFEST_PATH",
          severity: "error",
          path: filename,
          message: `入口包含不安全或不支持的路径：${invalid.join("、")}`,
        });
      }
      result.projectId = parsed.manifest.project_id;
      result.managedPaths = parsed.manifest.managed_paths;
      result.sourcePaths = parsed.manifest.source_paths;
      result.maintenance = parsed.manifest.maintenance;
    }
  } catch (error) {
    result.status =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "missing"
        : "unavailable";
    result.diagnostics.push({
      code: "PRODUCT_READ",
      severity: "warning",
      path: filename,
      message: String(error),
    });
  }
  return result;
}
function references(
  item: ProductItem,
): { role: string; reference: ProductSource }[] {
  const m = item.metadata;
  const out: { role: string; reference: ProductSource }[] = [];
  const one = (role: string, reference: ProductSource | undefined) => {
    if (reference) out.push({ role, reference });
  };
  const many = (role: string, values?: ProductSource[]) =>
    values?.forEach((v, i) => one(`${role}[${i}]`, v));
  many("sources", m.sources);
  many("pending_sources", m.pending_sources);
  one("target_basis", m.target_basis);
  one("raw_ref", m.raw_ref);
  many("inventory.checked_sources", m.inventory?.checked_sources);
  many("inventory.unreviewed_sources", m.inventory?.unreviewed_sources);
  many("basis.sources", m.basis?.sources);
  m.links?.forEach((l, i) => many(`links[${i}].sources`, l.sources));
  m.work_items?.forEach((w, i) => many(`work_items[${i}].sources`, w.sources));
  m.task_bindings?.forEach((b, i) => {
    one(`task_bindings[${i}].task.source`, b.task.source);
    many(`task_bindings[${i}].sources`, b.sources);
    b.repairs?.forEach((r, j) => {
      one(`task_bindings[${i}].repairs[${j}].task.source`, r.task.source);
      many(`task_bindings[${i}].repairs[${j}].sources`, r.sources);
    });
  });
  return out;
}
function sourceLayout(input: InputFile) {
  const envelope = inspectProductEnvelope(input.raw);
  const masked =
    input.raw.slice(0, envelope.bodyStart).replace(/[^\r\n]/g, " ") +
    input.raw.slice(envelope.bodyStart);
  return {
    headings: parseMarkdown(masked).children.filter(
      (n) => n.type === "heading",
    ),
    items: envelope.isProduct
      ? parseProductDocument("source-locator", "source-locator", input).items
      : [],
  };
}
function located(
  input: InputFile,
  layout: ReturnType<typeof sourceLayout>,
  reference: Extract<ProductSource, { kind: "file" }>,
): {
  line: number;
  endLine: number;
  state: ProductSourceCheck["locationState"];
  detail: string;
  definitionSha256?: string | null;
} {
  const raw = input.raw;
  const lines = raw.split(/\r\n|\r|\n/);
  let start = 1,
    end = lines.length;
  const headings = layout.headings;
  let definitionSha256: string | null = null;
  if (reference.item_id) {
    const found = layout.items.filter(
      (item) => item.id === reference.item_id && Boolean(item.body),
    );
    const headingMatches = layout.headings.filter(
      (heading) =>
        heading.depth === 2 &&
        new RegExp(
          `^\\[${reference.item_id!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s+`,
        ).test(toString(heading)),
    );
    if (found.length !== 1 || headingMatches.length !== 1)
      return {
        line: 1,
        endLine: end,
        state:
          found.length > 1 || headingMatches.length > 1
            ? "ambiguous"
            : "unlocated",
        detail: "item_id 无法唯一定位",
      };
    start = found[0].source.line;
    end = found[0].endLine;
    definitionSha256 = found[0].usable ? found[0].definitionSha256 : null;
  }
  if (reference.section) {
    const found = headings.filter(
      (n) =>
        n.position!.start.line >= start &&
        n.position!.start.line <= end &&
        toString(n) === reference.section,
    );
    if (found.length !== 1)
      return {
        line: start,
        endLine: end,
        state: found.length ? "ambiguous" : "unlocated",
        detail: "章节无法唯一定位",
      };
    start = found[0].position!.start.line;
    end = Math.min(
      end,
      (headings.find(
        (n) => n.position!.start.line > start && n.depth <= found[0].depth,
      )?.position?.start.line || end + 1) - 1,
    );
  }
  if (reference.lines) {
    if (
      reference.lines.start < start ||
      reference.lines.end > end ||
      reference.lines.end < reference.lines.start
    )
      return {
        line: start,
        endLine: end,
        state: "unlocated",
        detail: "行号超出文件或声明的条目/章节范围",
      };
    start = reference.lines.start;
    end = reference.lines.end;
  }
  return {
    line: start,
    endLine: end,
    state: "located",
    definitionSha256,
    detail: "已在同次快照定位；读取并不证明来源内容已采纳或报告适用",
  };
}
export async function readProduct(
  project: Project,
  scan: ScanResult,
): Promise<void> {
  const filename = project.config.product?.manifestPath || defaultManifestPath;
  const product: ProductSnapshot = {
    status: "disabled",
    manifestPath: filename,
    manifest: null,
    manifestSource: null,
    items: [],
    relations: [],
    bindings: [],
    assessments: [],
    sources: [],
    diagnostics: [],
    coverage: { complete: true, paths: [], omitted: [], excluded: [] },
    workingCopy: project.root,
  };
  scan.product = product;
  scan.productPaths = new Set();
  if (!project.config.product?.enabled) return;
  const session = scan.readSession || new ScanReadSession(project.root);
  const diagnostic = (
    code: string,
    message: string,
    relative?: string,
    item?: ProductItem,
    severity: ProductDiagnostic["severity"] = "warning",
  ) =>
    product.diagnostics.push({
      code,
      message,
      severity,
      path: relative,
      itemId: item?.id,
      source: item?.source,
    });
  const omit = (relative: string, reason: string) => {
    product.coverage.complete = false;
    product.coverage.omitted.push({ path: relative, reason });
    diagnostic("PRODUCT_READ_OMITTED", reason, relative);
  };
  const addInput = (input: Omit<InputFile, "kind">, managed = false) => {
    const key = documentPathKey(input.path);
    if (managed) scan.productPaths!.add(key);
    if (!scan.inputs.some((v) => documentPathKey(v.path) === key))
      scan.inputs.push({ ...input, kind: "unclassified" });
    if (
      !scan.files.some(
        (v) => documentPathKey(v.path) === key && v.status === "read",
      )
    )
      scan.files.push({
        path: input.path,
        kind: "unclassified",
        status: "read",
      });
    if (scan.navigation.inventory)
      scan.navigation.inventory.candidates =
        scan.navigation.inventory.candidates.filter(
          (p) => documentPathKey(p) !== key,
        );
    return { ...input, kind: "unclassified" as const };
  };
  const reason = excluded(filename, project.config);
  if (reason) {
    product.status = "excluded";
    diagnostic("PRODUCT_EXCLUDED", reason, filename);
    return;
  }
  if (!productPath(filename)) {
    product.status = "unavailable";
    diagnostic(
      "UNSAFE_MANIFEST_PATH",
      "PRODUCT 入口必须为单个安全的相对路径",
      filename,
    );
    return;
  }
  try {
    const input = await session.read(filename);
    addInput(input, true);
    product.manifestSource = sourceOf(project.id, input);
    const parsed = parseProductManifest(input.raw, filename);
    product.diagnostics.push(...parsed.diagnostics);
    product.status = parsed.status;
    if (!parsed.manifest) return;
    product.manifest = parsed.manifest;
  } catch (error) {
    product.status =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "missing"
        : "unavailable";
    diagnostic("PRODUCT_READ", String(error), filename);
    return;
  }
  const manifest = product.manifest!;
  const invalid = validateManifestPaths(manifest);
  if (invalid.length) {
    product.status = "unavailable";
    diagnostic(
      "UNSAFE_MANIFEST_PATH",
      `入口包含不安全或不支持的路径：${invalid.join("、")}`,
      filename,
    );
    return;
  }
  const selected = new Set<string>();
  let visits = 0;
  let stopped = false;
  const visited = new Set<string>();
  const excludedCurrent = (p: string) =>
    excluded(p, project.config, manifest) ||
    (/(^|\/)(history|raw)(\/|$)/i.test(p) ||
    (manifest.capture_paths || []).some((pattern) => productMatches(p, pattern))
      ? "历史/原文只作明确来源，不进入当前定义"
      : null);
  async function walk(
    relative: string,
    pattern: string,
    depth = 0,
    globPrefix = false,
  ): Promise<void> {
    const key = `${pattern}\0${relative}`;
    if (visited.has(key) || stopped) return;
    visited.add(key);
    const exclude = relative && excludedCurrent(relative);
    if (exclude) {
      product.coverage.excluded.push({ path: relative, reason: exclude });
      return;
    }
    if (++visits > limits.entries || depth > limits.depth) {
      stopped = true;
      omit(pattern, "达到 PRODUCT 枚举数量或深度预算");
      return;
    }
    const absolute = path.resolve(project.root, relative);
    try {
      await assertNoLinks(absolute);
      const stat = await lstat(absolute);
      if (globPrefix && !stat.isDirectory()) {
        omit(pattern, "glob 的固定目录前缀不是目录");
        return;
      }
      if (stat.isDirectory()) {
        if (!/[*?]/.test(pattern)) {
          omit(relative, "登记文件实际是目录");
          return;
        }
        const entries = await readdir(absolute, { withFileTypes: true });
        for (const entry of entries.sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          const child = relative ? `${relative}/${entry.name}` : entry.name;
          if (productMatches(child, pattern) || mayContainMatch(child, pattern))
            await walk(child, pattern, depth + 1);
          if (stopped) break;
        }
      } else if (stat.isFile() && productMatches(relative, pattern)) {
        if (selected.size >= limits.files) {
          stopped = true;
          omit(pattern, "达到 PRODUCT 文件预算");
          return;
        }
        selected.add(relative);
      } else if (productMatches(relative, pattern))
        omit(relative, "登记路径不是普通文件");
    } catch (error) {
      omit(relative || pattern, String(error));
    }
  }
  for (const pattern of manifest.managed_paths) {
    const wildcard = pattern.search(/[*?]/);
    const prefix =
      wildcard < 0
        ? pattern
        : pattern
            .slice(0, pattern.lastIndexOf("/", wildcard) + 1)
            .replace(/\/$/, "");
    await walk(prefix, pattern, 0, wildcard >= 0);
    if (stopped) omit(pattern, "枚举预算中断，剩余范围未读取");
  }
  if (!manifest.managed_paths.some((p) => productMatches(manifest.entry, p)))
    diagnostic(
      "ENTRY_OUTSIDE_MANAGED",
      "entry 未被 managed_paths 登记",
      manifest.entry,
    );
  else if (!selected.has(manifest.entry) && !excludedCurrent(manifest.entry))
    await walk(manifest.entry, manifest.entry);
  const namespace = `product:${hash(`${project.root}\0${manifest.project_id}`)}`;
  for (const relative of selected) {
    try {
      if (!/\.(md|markdown)$/i.test(relative)) {
        omit(relative, "标准条目只支持 Markdown；保留登记，未作为当前定义解析");
        continue;
      }
      const input = addInput(await session.read(relative), true);
      product.coverage.paths.push(relative);
      const parsed = parseProductDocument(project.id, namespace, input);
      product.items.push(...parsed.items);
      product.diagnostics.push(...parsed.diagnostics);
    } catch (error) {
      omit(relative, String(error));
    }
  }
  const definitions = new Map<string, ProductItem[]>();
  for (const item of product.items)
    if (item.id)
      definitions.set(item.id, [...(definitions.get(item.id) || []), item]);
  for (const group of definitions.values())
    if (group.length > 1)
      group.forEach((item, index) => {
        item.key += `:definition:${encodeURIComponent(item.source.path)}:${item.source.line}:${index}`;
        item.usable = false;
      });
  const sourceLayouts = new Map<string, ReturnType<typeof sourceLayout>>();
  for (const item of product.items.filter((i) => i.usable)) {
    for (const { role, reference } of references(item)) {
      const check: ProductSourceCheck = {
        id: `source:${hash(`${item.key}\0${role}\0${JSON.stringify(reference)}`)}`,
        ownerKey: item.key,
        role,
        reference,
        readState: "not-read",
        locationState: "not-applicable",
        byteState: "unknown",
        source: null,
        detail: "",
      };
      product.sources.push(check);
      if (reference.kind === "text") {
        check.readState = "text";
        check.detail = "文字依据，未取得独立原件";
        continue;
      }
      if (reference.kind === "uri") {
        check.readState = "external";
        check.detail = /^https?:\/\//i.test(reference.uri)
          ? "外部 URI 仅保留，未联网读取"
          : "URI 协议不支持导航，原引用保留";
        continue;
      }
      const relative = reference.path;
      if (!productPath(relative)) {
        check.readState = "outside";
        check.detail = "不安全或越界来源路径";
      } else {
        const sourceExcluded = excluded(
          relative,
          project.config,
          manifest,
          true,
        );
        if (sourceExcluded) {
          check.readState = "excluded";
          check.detail = sourceExcluded;
        } else if (
          ![...manifest.managed_paths, ...manifest.source_paths].some((p) =>
            productMatches(relative, p),
          )
        ) {
          check.readState = "outside";
          check.detail = "来源未在 managed_paths 或 source_paths 有效范围内";
        } else if (!/\.(md|markdown|ya?ml|json|txt)$/i.test(relative)) {
          check.readState = "unsupported";
          check.detail = "只支持明确引用的 Markdown、YAML、JSON、TXT 来源";
        } else
          try {
            const input = addInput(await session.read(relative, true));
            check.readState = "read";
            check.byteState = reference.sha256
              ? reference.sha256 === input.digest
                ? "same-bytes"
                : "changed"
              : "unknown";
            const sourceKey = documentPathKey(input.path);
            let layout = sourceLayouts.get(sourceKey);
            if (!layout) {
              layout = sourceLayout(input);
              sourceLayouts.set(sourceKey, layout);
            }
            const location = located(input, layout, reference);
            check.definitionSha256 = location.definitionSha256 ?? null;
            check.locationState = location.state;
            check.detail = location.detail;
            check.endLine = location.endLine;
            check.source = {
              ...sourceOf(project.id, input, location.line),
              section: reference.section || null,
            };
            if (location.state !== "located" || check.byteState === "changed")
              diagnostic(
                "SOURCE_CHECK",
                check.byteState === "changed"
                  ? "来源字节已变化；不自动更新既有报告"
                  : location.detail,
                relative,
                item,
              );
          } catch (error) {
            check.readState = /预算|上限/.test(String(error))
              ? "not-read"
              : "unavailable";
            check.byteState = "unavailable";
            check.detail = String(error);
          }
      }
      if (check.readState !== "read") {
        check.locationState = "unlocated";
        check.byteState = "unavailable";
        diagnostic(
          "SOURCE_UNAVAILABLE",
          `${role}：${check.detail}`,
          relative,
          item,
        );
      }
    }
  }
  product.status =
    product.diagnostics.some((d) => d.severity !== "info") ||
    product.items.some((i) => !i.usable) ||
    !product.coverage.complete
      ? "partial"
      : product.items.length
        ? "ready"
        : "empty";
}
