import path from "node:path";
import { createHash } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import type {
  Root,
  RootContent,
  ListItem,
  Heading as MdHeading,
  Link,
  Definition,
} from "mdast";
import { parseDocument } from "yaml";
import type {
  Document,
  Entry,
  SourceRef,
  Statement,
  StatementKind,
  Task,
  Warning,
} from "../shared/types.js";
import type { InputFile } from "./scanner.js";
import { documentPathKey } from "./config.js";
import {
  metadataReferenceFields,
  metadataTargets,
} from "./document-metadata.js";
import { maskFrontmatter } from "../shared/markdown-source.js";

export function stableId(projectId: string, value: string): string {
  return `${projectId}:${createHash("sha256").update(documentPathKey(value)).digest("hex").slice(0, 20)}`;
}
export function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[\s_\-：:]/g, "");
}
export function anchor(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}
export function taskNumberKey(value: string): string {
  return value.trim().replace(/^TASK-(?=\d{8}-\d{3}$)/, "");
}
export function taskNumbers(value: string): string[] {
  return [
    ...new Set(
      value.match(
        /(?<![\w-])(?:TASK-)?(?:\d{8}-\d{3}|[A-Z]{2,10}-\d{2,10})(?![\w-])/g,
      ) || [],
    ),
  ];
}
export function stateKey(value: string): string | null {
  const text = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    done: "completed",
    complete: "completed",
    completed: "completed",
    已完成: "completed",
    完成: "completed",
    active: "active",
    in_progress: "active",
    "in-progress": "active",
    进行中: "active",
    执行中: "active",
    paused: "paused",
    暂停: "paused",
    已暂停: "paused",
    terminated: "terminated",
    cancelled: "terminated",
    已终止: "terminated",
    终止: "terminated",
    skipped: "skipped",
    跳过: "skipped",
    已跳过: "skipped",
    draft: "draft",
    草稿: "draft",
    archived: "archived",
    已归档: "archived",
    blocked: "blocked",
    阻塞: "blocked",
    pending: "pending",
    待开始: "pending",
  };
  return aliases[text] || null;
}
export interface PendingReference {
  raw: string;
  target: string;
  section: string | null;
  revision: string | null;
  label: string;
  method: "markdown" | "structured" | "task-number";
  source: SourceRef;
}
export interface Parsed {
  document: Document;
  task: Task | null;
  statements: Statement[];
  references: PendingReference[];
  warnings: Warning[];
  adoptedPlan?: { path: string; step: string; source: SourceRef };
}
const processor = unified().use(remarkParse).use(remarkGfm);
export function parseMarkdown(raw: string): Root {
  return processor.parse(raw) as Root;
}
export function hasProductFrontmatter(raw: string): boolean {
  const front =
    /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)([\s\S]*?)^---[ \t]*(?:\r\n|\n|\r|$)/m.exec(
      raw,
    );
  if (!front || front.index !== 0) return false;
  const metadata = parseDocument(front[1]);
  const schema = metadata.get("schema");
  return typeof schema === "string" && schema.startsWith("vnext-product-doc/");
}
export function parsePassiveDocument(
  projectId: string,
  input: InputFile,
): Parsed {
  const id = stableId(projectId, input.path);
  const document: Document = {
    ...input,
    id,
    title: path.posix.basename(input.path),
    headings: [],
    recognized: true,
  };
  const references: PendingReference[] = [];
  if (/\.(md|markdown)$/i.test(input.path)) {
    const tree = parseMarkdown(maskFrontmatter(input.raw));
    visit(tree, "heading", (node) => {
      const title = toString(node);
      document.headings.push({
        title,
        depth: node.depth,
        line: node.position!.start.line,
        anchor: anchor(title),
      });
      if (
        node.depth === 1 &&
        document.title === path.posix.basename(input.path)
      )
        document.title = title;
    });
    const definitions = new Map<string, string>();
    visit(tree, "definition", (node) => {
      definitions.set(node.identifier.toLowerCase(), node.url);
    });
    function add(url: string, label: string, line: number) {
      references.push({
        raw: url,
        target: url,
        section: null,
        revision: null,
        label,
        method: "markdown",
        source: {
          documentId: id,
          path: input.path,
          line,
          section: null,
          digest: input.digest,
        },
      });
    }
    visit(tree, "link", (node) =>
      add(node.url, toString(node), node.position!.start.line),
    );
    visit(tree, "linkReference", (node) => {
      const url = definitions.get(node.identifier.toLowerCase());
      if (url) add(url, toString(node), node.position!.start.line);
    });
  }
  return { document, task: null, statements: [], references, warnings: [] };
}
const categoryPatterns: [StatementKind, RegExp][] = [
  ["currentStep", /^(当前步骤|currentstep|currentphase)$/],
  ["todo", /^(待办.*|待处理.*|下一步.*|todos?|nextsteps?|pendingitems)$/],
  ["risk", /^(.*风险.*|risks?|风险与问题)$/],
  ["planning", /^(.*规划.*|路线图|roadmap|plans?|planned|未来.*)$/],
  ["achievement", /^(已完成.*|.*成果.*|交付摘要|achievements?|completed.*)$/],
];
const taskGroups: [
  keyof Pick<Task, "goals" | "steps" | "checks" | "issues">,
  RegExp,
][] = [
  ["goals", /^(任务目标|目标|goals?|objective|背景与上下文)$/],
  ["steps", /^(实施步骤|执行步骤|步骤|steps?|implementationsteps)$/],
  ["checks", /^(验收.*|回归检查项|acceptance.*|checklist|definitionofdone)$/],
  [
    "issues",
    /^(问题.*|待确认问题|审查问题队列|阻塞.*|issues?|questions?|blockers?)$/,
  ],
];
export function parseInput(projectId: string, input: InputFile): Parsed {
  if (hasProductFrontmatter(input.raw))
    return parsePassiveDocument(projectId, input);
  const id = stableId(projectId, input.path);
  const document: Document = {
    ...input,
    id,
    title: path.posix.basename(input.path),
    headings: [],
    recognized: false,
  };
  const warnings: Warning[] = [];
  const statements: Statement[] = [];
  const references: PendingReference[] = [];
  let adoptedPlan: Parsed["adoptedPlan"];
  function source(line: number): SourceRef {
    return {
      documentId: id,
      path: input.path,
      line,
      digest: input.digest,
      section:
        document.headings.filter((h) => h.line <= line).at(-1)?.title || null,
    };
  }
  if (/\.ya?ml$/i.test(input.path)) {
    try {
      const parsed = parseDocument(input.raw);
      if (parsed.errors.length)
        throw new Error(parsed.errors.map((e) => e.message).join("; "));
      parsed.toJS({ maxAliasCount: 20 });
      document.recognized = true;
      for (const warning of parsed.warnings)
        warnings.push({
          code: "yaml-warning",
          path: input.path,
          message: warning.message,
        });
    } catch (error) {
      warnings.push({
        code: "yaml",
        path: input.path,
        line: 1,
        message: `YAML 解析失败，原文保留：${String(error)}`,
      });
    }
    return { document, task: null, statements, references, warnings };
  }
  const frontmatter = input.raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let taskViewMetadata = false;
  const identitySources: NonNullable<Task["identitySources"]> = [];
  if (frontmatter) {
    try {
      const metadata = parseDocument(frontmatter[1]);
      if (metadata.errors.length) throw new Error(metadata.errors[0].message);
      const value = metadata.toJS({ maxAliasCount: 20 });
      taskViewMetadata = value?.kind === "vnext-task-view";
      if (
        typeof value?.task_id === "string" &&
        value.task_id.trim() &&
        !/[{}]/.test(value.task_id)
      )
        identitySources.push({
          value: value.task_id,
          source: source(
            input.raw.split("\n").findIndex((s) => /^task_id:/.test(s)) + 1 ||
              1,
          ),
        });
      for (const field of metadataReferenceFields) {
        const targets = metadataTargets(
          value && typeof value === "object" ? value : {},
          field,
        );
        const line =
          input.raw
            .split("\n")
            .findIndex((text) => new RegExp(`^\\s*${field}:`).test(text)) + 1;
        for (const target of targets.slice(0, 64)) {
          if (typeof target !== "string") continue;
          const [filename, section] = target.split("#");
          references.push({
            raw: target,
            target: filename,
            section: section || null,
            revision: null,
            label: field,
            method: "structured",
            source: source(line || 1),
          });
        }
        if (targets.length > 64)
          warnings.push({
            code: "metadata-limit",
            path: input.path,
            line,
            message: `${field} 引用超过 64 项，关系提取不完整`,
          });
      }
    } catch (error) {
      warnings.push({
        code: "metadata",
        path: input.path,
        line: 1,
        message: `文档元数据解析失败，原文保留：${String(error)}`,
      });
    }
  }
  const tree = processor.parse(input.raw) as Root;
  const duplicates = new Map<string, number>();
  visit(tree, "heading", (node: MdHeading) => {
    const title = toString(node);
    const slug = anchor(title);
    const count = duplicates.get(slug) || 0;
    duplicates.set(slug, count + 1);
    document.headings.push({
      title,
      depth: node.depth,
      line: node.position!.start.line,
      anchor: count ? `${slug}-${count}` : slug,
    });
  });
  document.title =
    document.headings.find((h) => h.depth === 1)?.title || document.title;
  const fields: {
    label: string;
    rawLabel?: string;
    value: string;
    entry: Entry;
    headings: string[];
  }[] = [];
  const entries: { entry: Entry; headings: string[] }[] = [];
  let stack: { depth: number; title: string }[] = [];
  function addEntry(
    node: RootContent | ListItem,
    checked: boolean | null = null,
  ): void {
    let text = toString(node).trim();
    if (node.type === "listItem")
      text = node.children
        .filter((c) => c.type !== "list")
        .map((c) => toString(c))
        .join("\n")
        .trim();
    if (!text) return;
    const entry: Entry = {
      text,
      checked,
      source: source(node.position!.start.line),
    };
    const headings = stack.map((s) => normalizeHeading(s.title));
    entries.push({ entry, headings });
    const field = text.match(/^([^：:\n]{1,50})\s*[：:]\s*([^\n]*)/);
    if (field)
      fields.push({
        label: normalizeHeading(field[1]),
        rawLabel: field[1].trim(),
        value: field[2].trim(),
        entry,
        headings,
      });
  }
  for (const node of tree.children) {
    if (node.type === "heading") {
      stack = stack.filter((h) => h.depth < node.depth);
      stack.push({ depth: node.depth, title: toString(node) });
    } else if (node.type === "list")
      visit(node, "listItem", (item: ListItem) =>
        addEntry(item, typeof item.checked === "boolean" ? item.checked : null),
      );
    else if (node.type === "paragraph" || node.type === "blockquote")
      addEntry(node);
    else if (node.type === "table") {
      for (const row of node.children.slice(1)) {
        const [key, ...rest] = row.children.map((c) => toString(c));
        const entry: Entry = {
          text: `${key}：${rest.join(" | ")}`,
          checked: null,
          source: source(row.position!.start.line),
        };
        const headings = stack.map((s) => normalizeHeading(s.title));
        entries.push({ entry, headings });
        fields.push({
          label: normalizeHeading(key),
          rawLabel: key.trim(),
          value: rest.join(" | "),
          entry,
          headings,
        });
      }
    } else if (
      node.type === "code" &&
      stack.some((h) => normalizeHeading(h.title) === "projectdocuments")
    ) {
      if (node.lang !== "json") {
        warnings.push({
          code: "structured",
          path: input.path,
          line: node.position!.start.line,
          message: "Project documents 中非 JSON 引用未识别，原文保留",
        });
        continue;
      }
      try {
        const parsed = JSON.parse(node.value);
        if (!Array.isArray(parsed.sources))
          throw new Error("缺少 sources 数组");
        for (const item of parsed.sources) {
          if (
            !item ||
            typeof item.path !== "string" ||
            !item.path.trim() ||
            (item.section != null && typeof item.section !== "string") ||
            (item.revision != null && typeof item.revision !== "string")
          ) {
            warnings.push({
              code: "structured",
              path: input.path,
              line: node.position!.start.line,
              message: "结构化引用条目未识别，原文保留",
            });
            continue;
          }
          references.push({
            raw: JSON.stringify(item),
            target: item.path,
            section: item.section || null,
            revision: item.revision || null,
            label: typeof item.purpose === "string" ? item.purpose : item.path,
            method: "structured",
            source: source(node.position!.start.line),
          });
        }
        document.recognized = true;
      } catch (error) {
        warnings.push({
          code: "structured",
          path: input.path,
          line: node.position!.start.line,
          message: `结构化引用解析失败，原文保留：${String(error)}`,
        });
      }
    }
  }
  const metadata = (field: (typeof fields)[number]) =>
    field.headings.length <= 1 ||
    field.headings.some((h) =>
      /^(任务信息|taskinfo|taskinformation|metadata)$/.test(h),
    );
  const numberField =
    fields.find(
      (f) => /^(任务编号|tasknumber)$/.test(f.label) && metadata(f),
    ) ||
    fields.find(
      (f) =>
        /^(任务id|任务编号|taskid|tasknumber)$/.test(f.label) && metadata(f),
    );
  for (const field of fields.filter(
    (f) =>
      metadata(f) &&
      /^(task_id|task\s+id|任务\s*id|真实任务\s*id)$/i.test(f.rawLabel || "") &&
      !taskNumbers(f.value).includes(f.value),
  )) {
    if (
      field.value &&
      !/^(null|none|未记录)$/i.test(field.value) &&
      !/[{}]/.test(field.value)
    )
      identitySources.push({ value: field.value, source: field.entry.source });
  }
  const validNumber =
    numberField && !/[{}]/.test(numberField.value) ? numberField.value : null;
  const filenameNumber =
    taskNumberKey(taskNumbers(path.posix.basename(input.path))[0] || "") ||
    null;
  const isCurrentFile = /(^|\/)CURRENT_TASK\.md$/i.test(input.path);
  const isTask = Boolean(
    numberField ||
    identitySources.length ||
    isCurrentFile ||
    /(^|\/)TASKS\//i.test(input.path),
  );
  const titleField = fields.find(
    (f) => /^(任务标题|tasktitle|title)$/.test(f.label) && metadata(f),
  );
  let task: Task | null = null;
  // Placeholder templates remain readable documents, not invented active tasks.
  if (
    isTask &&
    !(numberField && !validNumber && /[{}]/.test(numberField.value))
  ) {
    const number = identitySources.some(
      (s) => s.source.line === numberField?.entry.source.line,
    )
      ? filenameNumber
      : validNumber || filenameNumber;
    task = {
      id: stableId(projectId, `task:${input.path}`),
      number,
      title: titleField?.value || document.title,
      current: isCurrentFile,
      source: numberField?.entry.source || source(1),
      statuses: [],
      goals: [],
      steps: [],
      checks: [],
      issues: [],
    };
    for (const f of fields) {
      if (
        /^(当前状态|生命周期状态|任务状态|status|state|lifecyclestatus)$/.test(
          f.label,
        ) &&
        metadata(f) &&
        f.value
      )
        task.statuses.push({ ...f.entry, text: f.value });
      if (/^(任务目标|goal|objective)$/.test(f.label) && f.value)
        task.goals.push({ ...f.entry, text: f.value });
    }
    for (const { entry, headings } of entries) {
      if (headings.includes("projectdocuments")) continue;
      for (const [group, expression] of taskGroups)
        if (headings.some((h) => expression.test(h))) task[group].push(entry);
    }
    if (task.current)
      statements.push({
        kind: "currentTask",
        text: `${number ? `${number} · ` : ""}${task.title}`,
        checked: null,
        source: task.source,
        taskNumber: number,
      });
    document.recognized = true;
  }
  for (const f of fields) {
    if (
      /^(当前状态|项目状态|任务状态|status|state)$/.test(f.label) &&
      (metadata(f) || /STATUS\.md$/i.test(input.path)) &&
      f.value
    ) {
      const currentDeclaration = fields.find(
        (item) =>
          /^(当前任务|currenttask)$/.test(item.label) &&
          JSON.stringify(item.headings) === JSON.stringify(f.headings),
      );
      const numbers = currentDeclaration
        ? taskNumbers(currentDeclaration.value)
        : [];
      const number =
        f.label === "项目状态"
          ? null
          : task?.number || (numbers.length === 1 ? numbers[0] : null);
      statements.push({
        kind: "status",
        text: f.value,
        checked: null,
        source: f.entry.source,
        taskNumber: number,
      });
      document.recognized = true;
    }
    if (
      /^(当前任务|currenttask|当前步骤|currentstep)$/.test(f.label) &&
      f.value
    ) {
      statements.push({
        kind: /步骤|step/.test(f.label) ? "currentStep" : "currentTask",
        text: f.value,
        checked: null,
        source: f.entry.source,
        taskNumber: taskNumbers(f.value)[0] || null,
      });
      document.recognized = true;
    }
  }
  for (const { entry, headings } of entries) {
    for (const [kind, expression] of categoryPatterns) {
      if (headings.some((h) => expression.test(h))) {
        statements.push({
          ...entry,
          kind,
          taskNumber: taskNumbers(entry.text)[0] || null,
        });
        document.recognized = true;
        break;
      }
    }
    // Task numbers in prose and inline code are mentions; fenced code is intentionally excluded.
    for (const number of taskNumbers(entry.text))
      if (taskNumberKey(number) !== taskNumberKey(task?.number || ""))
        references.push({
          raw: number,
          target: taskNumberKey(number),
          section: null,
          revision: null,
          label: number,
          method: "task-number",
          source: entry.source,
        });
  }
  // Generated views declare their focus in Current work, not in the Tasks history table.
  const isTaskView =
    /<!--\s*vnext-task-view\/v1\s*-->/.test(input.raw) || taskViewMetadata;
  if (
    isTaskView &&
    (isCurrentFile || fields.some((f) => f.headings.includes("currentwork")))
  ) {
    const focusFields = fields.filter((f) =>
      f.headings.includes("currentwork"),
    );
    const focuses = focusFields.filter((f) => f.label === "task");
    const focus = focuses.length === 1 ? focuses[0] : null;
    const number = focus
      ? taskNumbers(focus.value).find((n) => focus.value.startsWith(n))
      : null;
    const step = focusFields.find((f) => f.label === "step");
    const plan = focusFields.find((f) => f.label === "adoptedplan");
    for (let i = statements.length - 1; i >= 0; i--)
      if (["currentTask", "currentStep"].includes(statements[i].kind))
        statements.splice(i, 1);
    task = null;
    if (focus && number) {
      const identity = focus.value
        .slice(number.length)
        .match(/^\s+\(([^()]+)\)(?:\s*[—–]|$)/)?.[1]
        ?.trim();
      if (identity && !/^(none|null|未记录)$/i.test(identity))
        identitySources.push({ value: identity, source: focus.entry.source });
      const title = focus.value.match(/\s[—–]\s(.+)$/)?.[1] || number;
      const lifecycle = fields.find(
        (f) =>
          f.headings.includes("tasks") && f.label === normalizeHeading(number),
      );
      const stepEntry =
        step && !/^(none|null|n\/a|无)$/i.test(step.value)
          ? { ...step.entry, text: step.value }
          : null;
      if (plan && stepEntry && !/^(none|null|n\/a|无)$/i.test(plan.value))
        adoptedPlan = {
          path: plan.value,
          step: stepEntry.text,
          source: plan.entry.source,
        };
      task = {
        id: stableId(projectId, `task:${input.path}`),
        number,
        title,
        current: isCurrentFile,
        source: focus.entry.source,
        statuses: lifecycle
          ? [{ ...lifecycle.entry, text: lifecycle.value.split("|")[0].trim() }]
          : [],
        goals: [],
        steps: stepEntry ? [stepEntry] : [],
        checks: [],
        issues: [],
      };
      statements.push({
        ...focus.entry,
        text: `${number} · ${title}`,
        kind: "currentTask",
        taskNumber: number,
      });
      if (stepEntry)
        statements.push({
          ...stepEntry,
          kind: "currentStep",
          taskNumber: number,
        });
    }
    document.recognized = true;
  }
  const definitions = new Map<string, Definition>();
  visit(tree, "definition", (node) => {
    definitions.set(node.identifier.toLowerCase(), node);
  });
  function addLink(node: Link | RootContent, url: string, label: string): void {
    references.push({
      raw: url,
      target: url,
      section: null,
      revision: null,
      label,
      method: "markdown",
      source: source(node.position!.start.line),
    });
    document.recognized = true;
  }
  visit(tree, "link", (node) => addLink(node, node.url, toString(node)));
  visit(tree, "linkReference", (node) => {
    const definition = definitions.get(node.identifier.toLowerCase());
    if (definition) addLink(node, definition.url, toString(node));
  });
  if (task) {
    task.identitySources = identitySources;
    const identities = [...new Set(identitySources.map((s) => s.value))];
    task.taskId = identities.length === 1 ? identities[0] : null;
    task.identityConflict = identities.length > 1;
    if (task.identityConflict)
      warnings.push({
        code: "task-identity-conflict",
        path: input.path,
        line: task.source.line,
        message: `真实任务身份声明冲突：${identities.join(" / ")}`,
      });
  }
  return { document, task, statements, references, warnings, adoptedPlan };
}
