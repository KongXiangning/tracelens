import path from "node:path";
import { lstat, readdir, realpath } from "node:fs/promises";
import { toString } from "mdast-util-to-string";
import type { Project, SourceRef } from "../shared/types.js";
import type {
  ProductDiagnostic,
  ProductItem,
  ProductManifest,
  ProductMetadata,
  ProductSource,
  ProductSourceCheck,
  ProductView,
} from "../shared/product-types.js";
import {
  assertNoLinks,
  documentPathKey,
  safePattern,
  within,
} from "./config.js";
import {
  blockedPath,
  limits,
  matches,
  type InputFile,
  type SnapshotReader,
} from "./scanner.js";
import { anchor, parseMarkdown, stableId } from "./parser.js";
import { maskFrontmatter } from "../shared/markdown-source.js";
import {
  manifestValidators,
  object,
  parseProductDocument,
  strictProductYaml,
} from "./product-parser.js";

export interface ProductRead {
  view: ProductView;
  inputs: InputFile[];
  roles: Map<
    string,
    NonNullable<import("../shared/types.js").Document["roles"]>
  >;
}
export function safeProductPath(value: string, glob = false): boolean {
  return (
    safePattern(value) &&
    !value.split("/").some((s) => !s || /[. ]$/.test(s)) &&
    !(glob ? /[\[\]{}]/ : /[*?\[\]{}]/).test(value)
  );
}
function excludedBy(filename: string, patterns: string[]): boolean {
  const segments = filename.split("/");
  return patterns.some(
    (pattern) =>
      matches(filename, pattern) ||
      segments.some(
        (_s, i) =>
          matches(segments.slice(0, i + 1).join("/"), pattern) ||
          matches(`${segments.slice(0, i + 1).join("/")}/`, pattern),
      ),
  );
}
export function productExcluded(
  project: Project,
  manifest: ProductManifest | null,
  filename: string,
): boolean {
  return (
    blockedPath(filename, true) ||
    /(^|\/)\.workflow-system\/runtime(\/|$)|(^|\/)runtime\/vnext(\/|$)/i.test(
      filename,
    ) ||
    excludedBy(filename, [
      ...project.config.excludes,
      ...(manifest?.exclude_paths || []),
    ])
  );
}
export function collectProductSources(
  metadata: ProductMetadata,
): { ref: ProductSource; pointer: string; role: string }[] {
  const result: { ref: ProductSource; pointer: string; role: string }[] = [];
  function collect(value: unknown, pointer: string): void {
    if (Array.isArray(value)) {
      value.forEach((v, i) => collect(v, `${pointer}/${i}`));
      return;
    }
    const m = object(value);
    if (["file", "uri", "text"].includes(String(m.kind))) {
      const role = pointer.includes("pending_sources")
        ? "待核对材料"
        : pointer.includes("target_basis")
          ? "历史需求依据"
          : pointer.includes("raw_ref")
            ? "讨论原文"
            : pointer.includes("unreviewed_sources")
              ? "未盘点来源"
              : pointer.includes("checked_sources")
                ? "已盘点来源"
                : pointer.includes("repairs")
                  ? "修复依据"
                  : pointer.includes("/task/")
                    ? "任务来源"
                    : "关联依据";
      result.push({ ref: value as ProductSource, pointer, role });
      return;
    }
    for (const [key, child] of Object.entries(m))
      if (key !== "extensions") collect(child, `${pointer}/${key}`);
  }
  collect(metadata, "");
  return result;
}
export async function readProduct(
  project: Project,
  reader: SnapshotReader,
  preflight = false,
): Promise<ProductRead> {
  const view: ProductView = {
    status: "disabled",
    manifestPath:
      project.config.product?.manifestPath || ".workflow-system/PRODUCT.yaml",
    manifestSource: null,
    manifest: null,
    root: project.root,
    items: [],
    relations: [],
    bindings: [],
    workItems: [],
    sources: [],
    assessments: [],
    diagnostics: [],
    coverage: {
      paths: [],
      read: [],
      omitted: [],
      excluded: [],
      complete: false,
    },
  };
  const inputs: InputFile[] = [];
  const roles: ProductRead["roles"] = new Map();
  const result = { view, inputs, roles };
  if (!project.config.product?.enabled && !preflight) return result;
  const report = (
    code: string,
    filename: string,
    message: string,
    item?: ProductItem,
    severity: ProductDiagnostic["severity"] = "error",
  ) =>
    view.diagnostics.push({
      code,
      path: filename,
      message,
      severity,
      itemId: item?.id,
      line: item?.source.line,
    });
  function register(
    input: Omit<InputFile, "kind">,
    role: NonNullable<import("../shared/types.js").Document["roles"]>[number],
  ) {
    const key = documentPathKey(input.path);
    if (!inputs.some((i) => documentPathKey(i.path) === key))
      inputs.push({ ...input, kind: "unclassified" });
    const current = roles.get(key) || [];
    if (!current.includes(role)) current.push(role);
    roles.set(key, current);
  }
  function source(
    input: Omit<InputFile, "kind">,
    line = 1,
    section: string | null = null,
  ): SourceRef {
    return {
      documentId: stableId(project.id, input.path),
      path: input.path,
      line,
      section,
      digest: input.digest,
    };
  }
  if (
    !safeProductPath(view.manifestPath) ||
    productExcluded(project, null, view.manifestPath)
  ) {
    view.status = "excluded";
    report(
      "MANIFEST_EXCLUDED",
      view.manifestPath,
      "PRODUCT 入口被排除或路径不安全",
    );
    return result;
  }
  let manifestInput: Omit<InputFile, "kind">;
  try {
    manifestInput = await reader.read(view.manifestPath);
    register(manifestInput, "product-manifest");
    view.manifestSource = source(manifestInput);
  } catch (error) {
    view.status =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "missing"
        : "unavailable";
    report("MANIFEST_UNAVAILABLE", view.manifestPath, String(error));
    return result;
  }
  const yaml = strictProductYaml(manifestInput.raw);
  if (yaml.problems.length) {
    view.status = "unavailable";
    for (const p of yaml.problems) report(p.code, view.manifestPath, p.message);
    return result;
  }
  const m = object(yaml.value);
  const version =
    m.schema === "vnext-product-manifest/v2"
      ? 2
      : m.schema === "vnext-product-manifest/v1"
        ? 1
        : null;
  if (!version) {
    view.status = "unsupported";
    report(
      "UNSUPPORTED_VERSION",
      view.manifestPath,
      `不支持入口版本 ${String(m.schema)}`,
    );
    return result;
  }
  const validator = manifestValidators[version];
  if (!validator(m)) {
    view.status = "unavailable";
    for (const e of validator.errors || [])
      report(
        "MANIFEST_METADATA",
        view.manifestPath,
        `${e.instancePath} ${e.message}`,
      );
    return result;
  }
  const manifest = m as unknown as ProductManifest;
  const patterns = [
    ...manifest.managed_paths,
    ...manifest.source_paths,
    ...manifest.exclude_paths,
    ...(manifest.capture_paths || []),
  ];
  if (
    !safeProductPath(manifest.entry) ||
    patterns.some((p) => !safeProductPath(p, true)) ||
    !manifest.managed_paths.some((p) => matches(manifest.entry, p))
  ) {
    view.status = "unavailable";
    report(
      "MANIFEST_PATH",
      view.manifestPath,
      "入口或登记范围存在不安全路径、非契约 glob，或 entry 不在 managed_paths",
    );
    return result;
  }
  view.manifest = manifest;
  reader.setExcluded((filename) =>
    productExcluded(project, manifest, filename),
  );
  if (
    productExcluded(project, manifest, view.manifestPath) ||
    productExcluded(project, manifest, manifest.entry)
  ) {
    view.status = "excluded";
    report(
      "MANIFEST_EXCLUDED",
      view.manifestPath,
      "PRODUCT 入口或 entry 被显式排除",
    );
    return result;
  }
  view.status = "available";
  view.coverage.paths = manifest.managed_paths;
  view.coverage.excluded = [
    ...project.config.excludes,
    ...manifest.exclude_paths,
  ];
  const selected = new Map<string, string>();
  let visited = 0;
  function omit(filename: string, reason: string) {
    if (
      !view.coverage.omitted.some(
        (o) => o.path === filename && o.reason === reason,
      )
    )
      view.coverage.omitted.push({ path: filename, reason });
    report("MANAGED_OMITTED", filename, reason);
  }
  function select(filename: string) {
    if (productExcluded(project, manifest, filename)) return;
    if (selected.size >= limits.files) {
      omit(filename, "达到文件数量上限");
      return;
    }
    selected.set(documentPathKey(filename), filename);
  }
  // Walk only segments that can match the selected glob, not unrelated repository directories.
  async function enumerate(
    pattern: string,
    relative = "",
    index = 0,
    depth = 0,
  ): Promise<void> {
    if (relative && productExcluded(project, manifest, relative)) return;
    if (relative && blockedPath(relative)) {
      omit(relative, "当前托管范围不能枚举 records；仅允许精确来源引用");
      return;
    }
    if (visited >= limits.entries || depth > limits.depth) {
      omit(relative || pattern, "达到目录枚举数量或深度上限");
      return;
    }
    const segments = pattern.split("/");
    if (index === segments.length) {
      select(relative);
      return;
    }
    const segment = segments[index];
    if (!/[*?]/.test(segment)) {
      await enumerate(
        pattern,
        relative ? `${relative}/${segment}` : segment,
        index + 1,
        depth + 1,
      );
      return;
    }
    const absolute = path.resolve(project.root, relative);
    try {
      await assertNoLinks(absolute);
      if (!within(project.root, await realpath(absolute)))
        throw new Error("目录真实路径越界");
      if (!(await lstat(absolute)).isDirectory())
        throw new Error("glob 的静态前缀不是目录");
      const entries = await readdir(absolute, { withFileTypes: true });
      if (segment === "**" && index + 1 < segments.length)
        await enumerate(pattern, relative, index + 1, depth);
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (++visited > limits.entries) {
          omit(relative || pattern, "达到目录枚举上限");
          break;
        }
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (productExcluded(project, manifest, child)) continue;
        const relevant = segment === "**" || matches(entry.name, segment);
        if (!relevant) continue;
        if (blockedPath(child)) {
          omit(child, "当前托管范围不能枚举 records；仅允许精确来源引用");
          continue;
        }
        if (entry.isSymbolicLink()) {
          omit(child, "跳过符号链接或目录联接");
          continue;
        }
        if (segment === "**") {
          if (entry.isDirectory())
            await enumerate(pattern, child, index, depth + 1);
          else if (index === segments.length - 1 && entry.isFile())
            select(child);
        } else if (index === segments.length - 1 && entry.isFile())
          select(child);
        else if (entry.isDirectory())
          await enumerate(pattern, child, index + 1, depth + 1);
      }
    } catch (error) {
      omit(relative || pattern, `不能枚举登记范围：${String(error)}`);
    }
  }
  select(manifest.entry);
  for (const pattern of manifest.managed_paths) {
    if (productExcluded(project, manifest, pattern)) continue;
    if (!/[*?]/.test(pattern)) select(pattern);
    else await enumerate(pattern);
  }
  for (const filename of selected.values()) {
    if (
      blockedPath(filename) ||
      (manifest.capture_paths || []).some((p) => matches(filename, p)) ||
      /(^|\/)(history|raw|archives?)(\/|$)/i.test(filename)
    ) {
      omit(filename, "历史、原文或 Runtime 记录不能登记为当前定义");
      continue;
    }
    if (!/\.(md|markdown)$/i.test(filename)) {
      omit(filename, "当前托管文档只支持 Markdown");
      continue;
    }
    try {
      const input = await reader.read(filename);
      register(input, "product-managed");
      view.coverage.read.push(input.path);
      const parsed = parseProductDocument(
        project.root,
        manifest.project_id,
        project.id,
        { ...input, kind: "unclassified" },
      );
      view.items.push(...parsed.items);
      view.diagnostics.push(...parsed.diagnostics);
    } catch (error) {
      omit(filename, `托管文件未读取：${String(error)}`);
    }
  }
  for (const item of view.items) {
    if (view.items.filter((i) => i.id === item.id).length > 1) {
      item.usable = false;
      item.metadata = null;
      report(
        "AMBIGUOUS_ID",
        item.source.path,
        `当前 ID ${item.id} 存在多个定义；不选择最新文件`,
        item,
      );
      // Keep each conflicting location addressable; the business ID remains unchanged.
      item.key += `:conflict:${item.source.documentId}:${item.metadataLine}`;
    }
  }
  const projects = view.items.filter((i) => i.usable && i.type === "project");
  if (
    projects.length !== 1 ||
    documentPathKey(projects[0].source.path) !== documentPathKey(manifest.entry)
  )
    report(
      "PROJECT_ENTRY",
      view.manifestPath,
      "entry 必须包含本次范围内唯一可用 project 条目",
    );
  view.coverage.complete = view.coverage.omitted.length === 0;
  for (const item of view.items.filter((i) => i.usable)) {
    for (const declaration of collectProductSources(item.metadata!)) {
      const check: ProductSourceCheck = {
        key: `${item.key}:${declaration.pointer}`,
        ownerKey: item.key,
        ...declaration,
        readState: "not-read",
        locationState: "not-located",
        digestState: "unknown",
        actualDigest: null,
        target: null,
        endLine: null,
      };
      view.sources.push(check);
      const ref = check.ref;
      if (ref.kind === "text") {
        check.readState = "text";
        continue;
      }
      if (ref.kind === "uri") {
        check.readState = "external";
        check.detail = "外部 URI 只保留引用，不自动获取正文";
        if (!/^(https?:|mailto:)/i.test(ref.uri))
          check.detail = "未知或不安全协议，保留文字且禁止打开";
        continue;
      }
      if (!safeProductPath(ref.path)) {
        check.readState = "unsafe";
        check.detail = "来源路径不安全";
      } else if (productExcluded(project, manifest, ref.path)) {
        check.readState = "excluded";
        check.detail = "来源被 PRODUCT 或用户排除";
      } else if (
        ![...manifest.managed_paths, ...manifest.source_paths].some((p) =>
          matches(ref.path, p),
        )
      ) {
        check.readState = "outside";
        check.detail = "来源未登记在读取许可范围；capture_paths 不授予读取";
      } else if (!/\.(md|markdown|ya?ml|json|txt)$/i.test(ref.path)) {
        check.readState = "unsupported";
        check.detail = "不支持的来源类型";
      } else if (preflight) {
        check.detail = "预览未读取来源，添加并刷新后核对";
      } else {
        try {
          const input = await reader.read(ref.path, true);
          register(input, "product-source");
          check.readState = "read";
          check.actualDigest = input.digest;
          check.digestState = ref.sha256
            ? ref.sha256 === input.digest
              ? "same-bytes"
              : "changed"
            : "unknown";
          locateProductSource(check, input, source(input));
        } catch (error) {
          const detail = String(error);
          check.readState = /上限|未读取/.test(detail)
            ? "not-read"
            : "unavailable";
          check.digestState = "unavailable";
          check.detail = detail;
        }
      }
      if (
        !preflight &&
        (check.readState !== "read" ||
          check.locationState !== "located" ||
          check.digestState === "changed")
      )
        report(
          "SOURCE_CHECK",
          ref.path,
          check.detail ||
            `${check.role}：${check.readState} / ${check.locationState} / ${check.digestState}`,
          item,
          "warning",
        );
    }
  }
  if (view.diagnostics.length) view.status = "partial";
  return result;
}

export function locateProductSource(
  check: ProductSourceCheck,
  input: Omit<InputFile, "kind">,
  base: SourceRef,
): void {
  const ref = check.ref;
  if (ref.kind !== "file") return;
  const raw = input.raw;
  const lineCount = raw.split(/\r\n|\r|\n/).length;
  const tree = /\.(md|markdown)$/i.test(input.path)
    ? parseMarkdown(maskFrontmatter(raw))
    : null;
  const headings = (tree?.children || []).filter((n) => n.type === "heading");
  let start = 1;
  let end = lineCount;
  if (ref.item_id) {
    const found = headings.filter(
      (h) =>
        h.depth === 2 &&
        toString(h).match(/^\[([^\]]+)\]/)?.[1] === ref.item_id,
    );
    if (found.length !== 1) {
      check.detail = "来源 item_id 无法唯一定位";
      return;
    }
    start = found[0].position!.start.line;
    end =
      (headings.find((h) => h.depth === 2 && h.position!.start.line > start)
        ?.position!.start.line || lineCount + 1) - 1;
  }
  if (ref.section) {
    const candidates = headings.filter(
      (h) => h.position!.start.line >= start && h.position!.start.line <= end,
    );
    const exact = candidates.filter((h) => toString(h) === ref.section);
    const found = exact.length
      ? exact
      : candidates.filter((h) => anchor(toString(h)) === anchor(ref.section!));
    if (found.length !== 1) {
      check.detail = "来源章节缺失或重复";
      return;
    }
    start = found[0].position!.start.line;
    end = Math.min(
      end,
      (headings.find(
        (h) => h.position!.start.line > start && h.depth <= found[0].depth,
      )?.position!.start.line || lineCount + 1) - 1,
    );
  }
  if (ref.lines) {
    if (
      ref.lines.start < start ||
      ref.lines.end < ref.lines.start ||
      ref.lines.end > end
    ) {
      check.detail = "来源行号越界或与条目/章节冲突";
      return;
    }
    start = ref.lines.start;
    end = ref.lines.end;
  }
  check.locationState = "located";
  check.target = {
    ...base,
    line: start,
    section: ref.section || ref.item_id || null,
  };
  check.endLine = end;
  if (check.digestState === "changed")
    check.detail = "当前文件字节与声明 SHA-256 不同；仍可查看本快照内容";
}
