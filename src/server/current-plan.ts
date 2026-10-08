import path from "node:path";
import type { Entry, Project, SourceRef } from "../shared/types.js";
import { documentPathKey, safePattern } from "./config.js";
import { limits, matches, type ScanResult } from "./scanner.js";
import {
  parseInput,
  stableId,
  type Parsed,
  type PendingReference,
} from "./parser.js";

// Follow only the explicit adopted-plan record. Never enumerate or replay the journal.
export async function attachCurrentPlan(
  project: Project,
  scan: ScanResult,
  parsed: Parsed[],
  currentPath: string | undefined,
): Promise<void> {
  const current = parsed.find(
    (p) =>
      currentPath &&
      documentPathKey(p.document.path) === documentPathKey(currentPath),
  );
  const declaration = current?.adoptedPlan;
  if (!current || !declaration) return;
  const link: NonNullable<Entry["link"]> = {
    label: declaration.step,
    target: null,
  };
  const warn = (message: string) => {
    link.detail = message;
    scan.warnings.push({
      code: "current-plan",
      path: declaration.source.path,
      line: declaration.source.line,
      message,
    });
  };
  const reference = (
    target: string,
    source: SourceRef,
    label: string,
    section: string | null = null,
  ): PendingReference => ({
    target,
    source,
    label,
    section,
    method: "structured",
    raw: target,
    revision: null,
  });
  async function read(filename: string) {
    if (
      !safePattern(filename) ||
      /[*?{[\]]/.test(filename) ||
      path.posix.normalize(filename) !== filename
    )
      throw new Error("计划引用路径不安全");
    if (
      project.config.excludes.some(
        (p) => matches(filename, p) || matches(`${filename}/`, p),
      )
    )
      throw new Error("计划引用被显式排除");
    scan.readSession.assertAllowed(filename, true);
    const existing = parsed.find(
      (p) => documentPathKey(p.document.path) === documentPathKey(filename),
    );
    if (existing) {
      scan.readSession.assertAllowed(existing.document.path, true);
      return existing.document;
    }
    // Explicit records are bounded reads even when general historical records are disabled.
    const input = await scan.readSession.read(filename, true);
    const bytes = parsed.reduce((sum, p) => sum + p.document.bytes, 0);
    if (
      parsed.length >= limits.files ||
      bytes + input.bytes > limits.totalBytes
    )
      throw new Error("计划引用超过扫描文件或字节上限");
    return { ...input, kind: "management" as const };
  }
  function register(item: Parsed, from: SourceRef, label: string) {
    const index = parsed.findIndex((p) => p.document.id === item.document.id);
    if (index < 0) parsed.push(item);
    else parsed[index] = item;
    const file = scan.files.find(
      (f) => documentPathKey(f.path) === documentPathKey(item.document.path),
    );
    if (file) {
      file.status = "read";
      file.kind = item.document.kind;
      delete file.detail;
    } else
      scan.files.push({
        path: item.document.path,
        kind: item.document.kind,
        status: "read",
      });
    if (!scan.effectiveRules.management.includes(item.document.path))
      scan.effectiveRules.management.push(item.document.path);
    const entry = scan.navigation.entries.find(
      (e) => documentPathKey(e.path) === documentPathKey(item.document.path),
    );
    const source = { path: from.path, line: from.line, label };
    if (entry) {
      entry.availability = "read";
      entry.sources.push(source);
    } else
      scan.navigation.entries.push({
        path: item.document.path,
        kind: item.document.kind,
        classification: "declared",
        sources: [source],
        status: null,
        availability: "read",
      });
    if (scan.navigation.inventory)
      scan.navigation.inventory.candidates =
        scan.navigation.inventory.candidates.filter(
          (p) => documentPathKey(p) !== documentPathKey(item.document.path),
        );
  }
  current.references.push(
    reference(declaration.path, declaration.source, "已采用计划"),
  );
  try {
    if (!/\.json$/i.test(declaration.path))
      throw new Error("已采用计划不是支持的 JSON 记录格式");
    const input = await read(declaration.path);
    const record = JSON.parse(input.raw);
    if (
      record.kind !== "workflow-observation" ||
      record.payload?.kind !== "task-event"
    )
      throw new Error("已采用计划记录格式无法识别");
    const plan = record.payload.request?.plan;
    if (!plan || !Array.isArray(plan.steps))
      throw new Error("已采用计划没有明确的 steps");
    const steps = plan.steps.filter(
      (s: unknown) =>
        s && typeof s === "object" && "id" in s && s.id === declaration.step,
    );
    if (steps.length !== 1 || typeof steps[0].title !== "string")
      throw new Error("当前步骤在已采用计划中无法唯一定位");
    const step = steps[0];
    link.label = `${declaration.step} · ${step.title}`;
    const recordId = stableId(project.id, declaration.path);
    const lines = input.raw.split("\n");
    const recordSource = (line: number): SourceRef => ({
      documentId: recordId,
      path: declaration.path,
      line,
      section: null,
      digest: input.digest,
    });
    const documentLine =
      lines.findIndex((s) => /"document_ref"\s*:/.test(s)) + 1;
    const stepLine =
      lines.findIndex((s) =>
        s.includes(`"id": ${JSON.stringify(declaration.step)}`),
      ) + 1;
    const recordParsed: Parsed = {
      document: {
        ...input,
        id: recordId,
        title: "已采用计划记录",
        headings: [],
        recognized: true,
      },
      task: null,
      statements: [],
      warnings: [],
      references:
        typeof plan.document_ref === "string"
          ? [
              reference(
                plan.document_ref,
                recordSource(documentLine || 1),
                "计划文档",
              ),
            ]
          : [],
    };
    register(recordParsed, declaration.source, "当前任务显式采用的计划记录");
    link.target = recordSource(stepLine || 1);
    if (plan.document_ref === undefined || plan.document_ref === null) {
      link.detail = "步骤定义保存在已采用计划记录中，未声明独立计划文档。";
    } else {
      if (typeof plan.document_ref !== "string")
        throw new Error("计划 document_ref 不是文档路径");
      const planInput = await read(plan.document_ref);
      const planParsed =
        parsed.find((p) => p.document.path === plan.document_ref) ||
        parseInput(project.id, { ...planInput, kind: planInput.kind });
      register(
        planParsed,
        recordSource(documentLine || 1),
        "已采用计划的 document_ref",
      );
      const headings = planParsed.document.headings.filter((h) => {
        const title = h.title.trim();
        return (
          title === declaration.step ||
          (title.startsWith(declaration.step) &&
            /^[\s：:、.·—–-]/.test(title.slice(declaration.step.length)))
        );
      });
      if (headings.length !== 1) {
        warn(
          "计划文档中步骤章节无法唯一定位，点击步骤查看已采用计划记录中的定义。",
        );
      } else {
        const heading = headings[0];
        link.target = {
          documentId: planParsed.document.id,
          path: planParsed.document.path,
          line: heading.line,
          section: heading.title,
          digest: planParsed.document.digest,
        };
        current.references.push(
          reference(
            planParsed.document.path,
            current.statements.find((s) => s.kind === "currentStep")!.source,
            link.label,
            heading.anchor,
          ),
        );
      }
    }
  } catch (error) {
    warn(`当前步骤计划关联未完整读取：${String(error)}`);
  }
  for (const step of [
    ...(current.task?.steps || []),
    ...current.statements.filter((s) => s.kind === "currentStep"),
  ])
    step.link = link;
}
