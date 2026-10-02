import path from "node:path";
import { parseDocument } from "yaml";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import type { ListItem, TableRow } from "mdast";
import { defaultConfig, safePattern, within } from "./config.js";
import {
  blockedPath,
  matches,
  readBounded,
  type InputFile,
} from "./scanner.js";
import { parseInput, parseMarkdown } from "./parser.js";
import {
  kinds,
  type ConfiguredKind,
  type DocumentKind,
  type DocumentRegistration,
  type NavigationReport,
  type ScanConfig,
  type Warning,
} from "../shared/types.js";

const profilePath = ".workflow-system/PROJECT_PROFILE.yaml";
const navigationLimits = {
  reads: 120,
  bytes: 10 * 1024 * 1024,
  paths: 500,
  depth: 3,
};
type Evidence = DocumentRegistration["sources"][number];
function category(value: string): ConfiguredKind | null {
  if (
    /workflow-(?:governance|catalog|registry|reference)|^(?:management|管理|治理)$/i.test(
      value,
    )
  )
    return "management";
  if (/规划|路线图|实施计划|计划|\b(?:roadmap|plans?|planning)\b/i.test(value))
    return "planning";
  if (
    /设计|架构|技术方案|数据库|\b(?:architecture|design|technical|database|domain.model|api.contracts)\b/i.test(
      value,
    )
  )
    return "design";
  if (/需求|\brequirements?\b|\bREQ-\d/i.test(value)) return "requirements";
  if (/治理|管理|workflow-(?:governance|catalog|registry)/i.test(value))
    return "management";
  return null;
}
function suggestedKind(filename: string, title = ""): DocumentKind {
  return (
    category(`${title} ${filename.replace(/[_/.-]/g, " ")}`) || "unclassified"
  );
}
function indexFile(filename: string): boolean {
  return /(?:^|\/)(?:README|INDEX|DOCUMENT_CATALOG|REQUIREMENTS_BACKLOG|文档目录|文档中心|需求池|需求索引)\.md$/i.test(
    filename,
  );
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export class DocumentNavigation {
  readonly inputs = new Map<string, Omit<InputFile, "kind">>();
  readonly warnings: Warning[] = [];
  readonly entries = new Map<string, DocumentRegistration>();
  rules = defaultConfig().rules;
  profileUsed = false;
  incomplete = false;
  bytes = 0;
  private reads = 0;
  private depths = new Map<string, number>();
  private processed = new Set<string>();
  private classificationConflicts = new Set<string>();
  private queue: string[] = [];
  private profileUnavailable = false;
  constructor(
    private root: string,
    private config: ScanConfig,
  ) {}
  private key(filename: string): string {
    return process.platform === "win32" ? filename.toLowerCase() : filename;
  }
  private excluded(filename: string): boolean {
    return (
      blockedPath(filename) ||
      this.config.excludes.some(
        (p) => matches(filename, p) || matches(`${filename}/`, p),
      )
    );
  }
  private limit(): void {
    if (!this.incomplete)
      this.warnings.push({
        code: "navigation-limit",
        message: "文档导航达到读取数量、字节、路径或深度上限，登记核对不完整",
      });
    this.incomplete = true;
  }
  private target(
    from: string,
    raw: string,
    rootRelative: boolean,
  ): string | null {
    if (/^(?:https?:|mailto:|tel:|#)/i.test(raw)) return null;
    try {
      const value = decodeURIComponent(raw.split(/[?#]/)[0].trim());
      if (!value || /[\\:\x00-\x1f]/.test(value) || value.startsWith("/"))
        throw new Error("不是项目内相对路径");
      const filename = path.posix.normalize(
        rootRelative ? value : path.posix.join(path.posix.dirname(from), value),
      );
      if (
        !safePattern(filename) ||
        /[*?{[\]]/.test(filename) ||
        !within(this.root, path.resolve(this.root, filename))
      )
        throw new Error("路径越界或包含匹配规则");
      if (!/\.(?:md|markdown|ya?ml)$/i.test(filename)) return null;
      return filename;
    } catch {
      this.warnings.push({
        code: "navigation-path",
        path: from,
        message: `导航中的不安全或未知路径已跳过：${raw.slice(0, 300)}`,
      });
      return null;
    }
  }
  private add(
    filename: string,
    kind: DocumentKind,
    classification: DocumentRegistration["classification"],
    source: Evidence,
    depth = 0,
  ): void {
    const key = this.key(filename);
    const existing = this.entries.get(key);
    if (existing) {
      if (
        !existing.sources.some(
          (s) =>
            s.path === source.path &&
            s.line === source.line &&
            s.label === source.label,
        )
      ) {
        if (existing.sources.length < 16) existing.sources.push(source);
        else this.limit();
      }
      if (classification === "manual") this.classificationConflicts.delete(key);
      if (this.classificationConflicts.has(key)) return;
      if (
        classification === "declared" &&
        existing.classification === "declared" &&
        existing.kind !== kind
      ) {
        existing.kind = "unclassified";
        existing.classification = "unclassified";
        this.classificationConflicts.add(key);
        this.warnings.push({
          code: "navigation-classification",
          path: filename,
          message: "文档的明确分类声明冲突，保留待分类",
        });
      } else if (
        classification === "manual" ||
        (existing.classification !== "manual" &&
          classification === "declared" &&
          existing.classification !== "declared")
      ) {
        existing.kind = kind;
        existing.classification = classification;
      }
      return;
    }
    if (this.entries.size >= navigationLimits.paths) {
      this.limit();
      return;
    }
    const excluded = this.excluded(filename);
    this.entries.set(key, {
      path: filename,
      kind,
      classification,
      sources: [source],
      status: null,
      availability: excluded ? "excluded" : "pending",
    });
    this.depths.set(key, depth);
    if (!excluded) this.queue.push(key);
  }
  private reference(
    from: string,
    raw: string,
    label: string,
    line: number,
    kind: ConfiguredKind | null,
    rootRelative: boolean,
    depth: number,
  ): void {
    const filename = this.target(from, raw, rootRelative);
    if (!filename) return;
    if (
      /(?:^|\/)(?:README|INDEX|DOCUMENT_CATALOG)\.md$/i.test(filename) &&
      !kind
    ) {
      this.add(
        filename,
        "management",
        "declared",
        { path: from, line, label: `${label}（文档导航入口）` },
        depth,
      );
      return;
    }
    const chosen = kind || suggestedKind(filename);
    this.add(
      filename,
      chosen,
      kind
        ? "declared"
        : chosen === "unclassified"
          ? "unclassified"
          : "suggested",
      { path: from, line, label },
      depth,
    );
  }
  async initialize(): Promise<void> {
    let home = "docs/workflow";
    if (!this.excluded(profilePath)) {
      try {
        const input = await this.read(profilePath);
        const doc = parseDocument(input.raw);
        if (doc.errors.length)
          throw new Error(doc.errors.map((e) => e.message).join("; "));
        const paths = record(record(doc.toJS({ maxAliasCount: 20 })).paths);
        if (
          typeof paths.workflow_home === "string" &&
          safePattern(paths.workflow_home) &&
          !/[*?{[\]]/.test(paths.workflow_home)
        )
          home = paths.workflow_home.replace(/\/$/, "");
        this.profileUsed = true;
        this.rules = defaultConfig(home).rules;
        this.add(profilePath, "management", "declared", {
          path: profilePath,
          line: 1,
          label: "vNext Profile",
        });
        for (const [field, kind] of [
          ["requirements_files", "requirements"],
          ["design_files", "design"],
          ["planning_files", "planning"],
        ] as const) {
          if (Array.isArray(paths[field])) {
            const valid = paths[field].filter(
              (p): p is string => typeof p === "string" && safePattern(p),
            );
            if (valid.length !== paths[field].length)
              this.warnings.push({
                code: "profile-path",
                path: profilePath,
                message: `${field} 包含不安全或未知路径，已跳过`,
              });
            this.rules[kind] = valid.slice(0, 64);
            for (const filename of valid.filter((p) => !/[*?{[\]]/.test(p)))
              this.add(filename, kind, "declared", {
                path: profilePath,
                line: this.fieldLine(input.raw, field),
                label: `兼容 Profile 分类扩展：${field}`,
              });
          }
        }
        if (Array.isArray(paths.documentation_files))
          for (const value of paths.documentation_files) {
            if (typeof value === "string")
              this.reference(
                profilePath,
                value,
                "Profile 文档入口",
                this.fieldLine(input.raw, "documentation_files"),
                null,
                true,
                0,
              );
          }
      } catch (error) {
        this.profileUnavailable = true;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          this.warnings.push({
            code: "profile",
            path: profilePath,
            message: `Profile 无法提取，保留默认入口：${String(error)}`,
          });
      }
    }
    // Optional conventional entry points supplement declared seeds without searching the repository.
    for (const filename of [
      `${home}/DOCUMENT_CATALOG.md`,
      "README.md",
      "docs/README.md",
    ]) {
      if (this.excluded(filename) || this.entries.has(this.key(filename)))
        continue;
      try {
        await this.read(filename);
        this.add(filename, "management", "declared", {
          path: filename,
          line: 1,
          label: "文档导航入口",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          this.warnings.push({
            code: "navigation-read",
            path: filename,
            message: `文档入口不可读：${String(error)}`,
          });
      }
    }
    // Missing default governance files remain scan diagnostics; their task references are followed after enumeration.
    await this.drain();
  }
  async recoverUnavailableSources(previous?: NavigationReport): Promise<void> {
    if (!previous?.enabled) return;
    for (const entry of previous.entries) {
      const unavailable = entry.sources.some(
        (s) =>
          (s.path === profilePath &&
            this.profileUnavailable &&
            !this.excluded(profilePath)) ||
          ["missing", "error"].includes(
            this.entries.get(this.key(s.path))?.availability || "",
          ) ||
          this.warnings.some(
            (w) =>
              w.path === s.path &&
              ["navigation-read", "navigation-metadata"].includes(w.code),
          ),
      );
      if (!unavailable || entry.availability === "excluded") continue;
      this.incomplete = true;
      this.add(
        entry.path,
        entry.kind,
        entry.classification === "manual" ? "manual" : "suggested",
        {
          ...entry.sources[0],
          label: "上次登记范围（入口不可用，本次重新读取）",
        },
      );
    }
    await this.drain();
  }
  private fieldLine(raw: string, field: string): number {
    const index = raw
      .split("\n")
      .findIndex((line) => new RegExp(`^\\s*${field}:`).test(line));
    return index < 0 ? 1 : index + 1;
  }
  private async read(filename: string): Promise<Omit<InputFile, "kind">> {
    const cached = this.inputs.get(this.key(filename));
    if (cached) return cached;
    if (
      this.reads >= navigationLimits.reads ||
      this.bytes >= navigationLimits.bytes
    ) {
      this.limit();
      throw new Error("文档导航读取上限");
    }
    this.reads++;
    const input = await readBounded(this.root, filename);
    if (this.bytes + input.bytes > navigationLimits.bytes) {
      this.limit();
      throw new Error("文档导航总读取量超过 10 MiB");
    }
    this.bytes += input.bytes;
    this.inputs.set(this.key(filename), input);
    return input;
  }
  private async drain(): Promise<void> {
    while (this.queue.length) {
      const key = this.queue.shift()!;
      const entry = this.entries.get(key)!;
      const depth = this.depths.get(key) || 0;
      if (this.processed.has(key)) continue;
      this.processed.add(key);
      if (depth > navigationLimits.depth) {
        this.limit();
        continue;
      }
      try {
        const input = await this.read(entry.path);
        entry.availability = "read";
        this.inspect(input, entry, depth);
      } catch (error) {
        entry.availability =
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "missing"
            : "error";
        this.warnings.push({
          code: "navigation-read",
          path: entry.path,
          message: `已登记文档${entry.availability === "missing" ? "缺失" : "不可读"}：${String(error)}`,
        });
      }
    }
  }
  private inspect(
    input: Omit<InputFile, "kind">,
    entry: DocumentRegistration,
    depth: number,
  ): void {
    if (!/\.(md|markdown)$/i.test(input.path)) return;
    let raw = input.raw;
    let offset = 0;
    const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (front) {
      try {
        const doc = parseDocument(front[1]);
        if (doc.errors.length) throw new Error(doc.errors[0].message);
        const metadata = record(doc.toJS({ maxAliasCount: 20 }));
        if (typeof metadata.status === "string")
          entry.status = metadata.status.slice(0, 120);
        if (
          typeof metadata.superseded_by === "string" &&
          metadata.superseded_by
        ) {
          entry.supersededBy = metadata.superseded_by.slice(0, 400);
          this.reference(
            input.path,
            metadata.superseded_by,
            "替代文档 superseded_by",
            this.fieldLine(raw, "superseded_by"),
            null,
            true,
            depth + 1,
          );
        }
        for (const field of ["document_type", "doc_type", "type"]) {
          if (typeof metadata[field] === "string") {
            const kind = category(metadata[field]);
            if (kind)
              this.add(entry.path, kind, "declared", {
                path: entry.path,
                line: this.fieldLine(raw, field),
                label: `文档元数据 ${field}`,
              });
          }
        }
        if (Array.isArray(metadata.related_docs))
          for (const related of metadata.related_docs)
            if (typeof related === "string")
              this.reference(
                input.path,
                related,
                "related_docs",
                this.fieldLine(raw, "related_docs"),
                null,
                true,
                depth + 1,
              );
      } catch (error) {
        this.warnings.push({
          code: "navigation-metadata",
          path: entry.path,
          line: 1,
          message: `文档元数据无法读取，原文保留：${String(error)}`,
        });
      }
      offset = front[0].split("\n").length - 1;
      raw = raw.slice(front[0].length);
    }
    const tree = parseMarkdown(raw);
    const title = tree.children.find(
      (n) => n.type === "heading" && n.depth === 1,
    );
    if (
      !this.classificationConflicts.has(this.key(entry.path)) &&
      (entry.classification === "suggested" ||
        entry.classification === "unclassified")
    ) {
      const kind = suggestedKind(entry.path, title ? toString(title) : "");
      if (kind !== "unclassified") {
        entry.kind = kind;
        entry.classification = "suggested";
      }
    }
    if (/template|模板|示例/i.test(path.posix.basename(entry.path)))
      entry.status ||= "template";
    if (/(?:^|\/)archive(?:\/|$)|归档/i.test(entry.path))
      entry.status ||= "archived";
    if (
      indexFile(entry.path) ||
      (title &&
        /(?:文档中心|文档目录|需求池|需求清单|需求索引|requirements backlog|document catalog)$/i.test(
          toString(title),
        ))
    ) {
      const headings: string[] = [];
      const definitions = new Map<string, string>();
      visit(tree, "definition", (node) => {
        definitions.set(node.identifier.toLowerCase(), node.url);
      });
      const register = (node: ListItem | TableRow, context: string) => {
        const text = toString(node);
        const codes: string[] = [];
        visit(node, "inlineCode", (code) => {
          codes.push(code.value);
        });
        const label = codes
          .reduce((value, code) => value.replaceAll(code, ""), text)
          .replace(/[^\s]*\.(?:md|markdown|ya?ml)(?:#[^\s]*)?/gi, "");
        const specific = category(label);
        const kind = specific || category(context);
        const line = (node.position?.start.line || 1) + offset;
        visit(node, "link", (link) =>
          this.reference(
            entry.path,
            link.url,
            text.slice(0, 180),
            line,
            kind,
            false,
            depth + 1,
          ),
        );
        visit(node, "linkReference", (link) => {
          const target = definitions.get(link.identifier.toLowerCase());
          if (target)
            this.reference(
              entry.path,
              target,
              text.slice(0, 180),
              line,
              kind,
              false,
              depth + 1,
            );
        });
        for (const code of codes)
          if (/\.(?:md|markdown|ya?ml)(?:#.*)?$/i.test(code))
            this.reference(
              entry.path,
              code,
              text.slice(0, 180),
              line,
              kind,
              !code.startsWith("."),
              depth + 1,
            );
      };
      for (const node of tree.children) {
        if (node.type === "heading") {
          headings.length = node.depth;
          headings[node.depth - 1] = toString(node);
        } else if (node.type === "list")
          for (const item of node.children)
            register(item, headings.slice(1).join(" "));
        else if (node.type === "table")
          for (const row of node.children.slice(1)) register(row, "");
      }
      visit(tree, "link", (link) =>
        this.reference(
          entry.path,
          link.url,
          toString(link).slice(0, 180),
          (link.position?.start.line || 1) + offset,
          null,
          false,
          depth + 1,
        ),
      );
    }
    if (entry.kind === "management") {
      const parsed = parseInput("navigation", { ...input, kind: entry.kind });
      if (
        parsed.task ||
        /CURRENT_TASK|TASK_ARCHIVE|TASK_SUMMARY/i.test(entry.path)
      )
        for (const ref of parsed.references) {
          if (ref.method === "task-number") continue;
          this.reference(
            entry.path,
            ref.target,
            `任务依据：${ref.label}`,
            ref.source.line,
            null,
            ref.method === "structured",
            depth + 1,
          );
        }
    }
  }
  async includeScanned(inputs: InputFile[]): Promise<void> {
    for (const input of inputs) {
      const key = this.key(input.path);
      if (!this.inputs.has(key)) this.inputs.set(key, input);
      const manual = kinds.find((kind) =>
        this.config.rules[kind].some((p) => matches(input.path, p)),
      );
      if (!this.entries.has(key))
        this.add(input.path, input.kind, manual ? "manual" : "declared", {
          path: manual ? "TraceLens 配置" : profilePath,
          line: 1,
          label: manual ? "手动分类规则" : "管理文档默认范围／Profile 分类扩展",
        });
      else if (manual)
        this.add(input.path, manual, "manual", {
          path: "TraceLens 配置",
          line: 1,
          label: "手动分类规则",
        });
      const entry = this.entries.get(key);
      if (!entry) continue;
      entry.availability = "read";
      if (!this.processed.has(key)) {
        this.processed.add(key);
        this.inspect(input, entry, 0);
      }
    }
    await this.drain();
  }
  report(): NavigationReport {
    const entries = [...this.entries.values()];
    const gaps: string[] = [];
    for (const [kind, label] of [
      ["requirements", "需求"],
      ["design", "设计"],
      ["planning", "规划"],
    ] as const) {
      if (
        !entries.some(
          (e) =>
            e.kind === kind &&
            ["declared", "manual"].includes(e.classification) &&
            e.availability === "read" &&
            !e.supersededBy &&
            !/draft|archiv|template|supersed|deprecat|inactive|草稿|草案|归档|模板|已替代|废弃/i.test(
              e.status || "",
            ),
        )
      )
        gaps.push(
          `未发现明确登记且可读的${label}文档（草案、模板、归档不计入）`,
        );
    }
    if (
      entries.some(
        (e) =>
          e.classification === "suggested" ||
          e.classification === "unclassified",
      )
    )
      gaps.push("部分文档分类尚未明确，请核对登记来源");
    if (
      entries.some(
        (e) => e.availability === "missing" || e.availability === "error",
      )
    )
      gaps.push("已登记的文档中存在缺失或不可读项");
    if (this.incomplete) gaps.push("本次导航核对不完整，请查看读取限制提示");
    return {
      enabled: true,
      profileUsed: this.profileUsed,
      entries,
      incomplete: this.incomplete,
      gaps,
    };
  }
}
