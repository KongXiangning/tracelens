import { describe, expect, it } from "vitest";
import { parseInput } from "../src/server/parser.js";
import type { InputFile } from "../src/server/scanner.js";

function parse(raw: string, filename = "docs/workflow/CURRENT_TASK.md") {
  const input: InputFile = {
    path: filename,
    kind: "management",
    raw,
    digest: "digest-at-scan",
    bytes: raw.length,
    modifiedAt: "2026-10-02T00:00:00Z",
  };
  return parseInput("project-a", input);
}
describe("document extraction with provenance", () => {
  it("reads generated task focus and step instead of historical table rows", () => {
    const result = parse(`---
kind: vnext-task-view
---
<!-- vnext-task-view/v1 -->
# CURRENT_TASK
## Current work
- Task: TASK-811 (task-abc) — 法规导入修复
- Step: P4
## Tasks
| Task | Lifecycle | Plan | Step |
| --- | --- | --- | --- |
| TASK-810 | closed | adopted | none |
| TASK-811 | active | adopted | P4 |
## 当前步骤
- 历史内容
`);
    expect(result.task).toMatchObject({
      number: "TASK-811",
      title: "法规导入修复",
      current: true,
      source: { line: 7 },
    });
    expect(result.task?.statuses.map((s) => s.text)).toEqual(["active"]);
    expect(
      result.statements.filter((s) => s.kind === "currentStep"),
    ).toMatchObject([
      { text: "P4", taskNumber: "TASK-811", source: { line: 8 } },
    ]);
  });
  it("does not infer generated focus from active table rows when Current work has no focus", () => {
    const result = parse(`<!-- vnext-task-view/v1 -->
# CURRENT_TASK
## Current work
- No unambiguous active work focus.
- Step: none
## Tasks
| Task | Lifecycle | Plan | Step |
| --- | --- | --- | --- |
| TASK-811 | active | adopted | P4 |
`);
    expect(result.task).toBeNull();
    expect(
      result.statements.filter((s) =>
        ["currentTask", "currentStep"].includes(s.kind),
      ),
    ).toEqual([]);
  });
  it("recognizes date-based generated task numbers without a serial suffix", () => {
    const result = parse(
      "<!-- vnext-task-view/v1 -->\n# CURRENT_TASK\n## Current work\n- Task: TASK-20260831 (task-abc) — 历史全链路验证\n- Step: S2\n",
    );
    expect(result.task).toMatchObject({
      number: "TASK-20260831",
      title: "历史全链路验证",
    });
    expect(result.statements.find((s) => s.kind === "currentStep")?.text).toBe(
      "S2",
    );
  });
  it("extracts known Chinese fields, steps, checklists and references from AST positions", () => {
    const result = parse(
      '# Task\n\n## 任务信息\n\n- 任务 ID：20261002-001\n- 任务标题：中文任务\n- 当前状态：paused\n- 任务目标：只读\n\n## 实施步骤\n\n1. [x] 第一步\n2. [ ] 第二步\n\n## 验收清单\n\n- [x] 范围\n- [ ] 刷新\n\n### Project documents\n\n```json\n{"sources":[{"path":"docs/design.md","section":"恢复策略","revision":"vNext-draft"}]}\n```\n\n[设计](../design.md#恢复策略)',
    );
    expect(result.task).toMatchObject({
      number: "20261002-001",
      title: "中文任务",
      current: true,
    });
    expect(result.task?.statuses.map((s) => s.text)).toEqual(["paused"]);
    expect(result.task?.goals[0]).toMatchObject({
      text: "只读",
      source: {
        path: "docs/workflow/CURRENT_TASK.md",
        line: 8,
        digest: "digest-at-scan",
      },
    });
    expect(result.task?.steps.map((s) => s.checked)).toEqual([true, false]);
    expect(result.task?.checks.map((s) => s.checked)).toEqual([true, false]);
    expect(
      result.references.filter((r) => r.method === "structured")[0],
    ).toMatchObject({
      target: "docs/design.md",
      section: "恢复策略",
      revision: "vNext-draft",
      source: { line: 22 },
    });
    expect(result.references.some((r) => r.method === "markdown")).toBe(true);
  });
  it("retains unknown format, invalid JSON and invalid YAML without inventing status", () => {
    const raw = "# 自定义\n\n```text\nstate::secret-format\n```";
    expect(parse(raw, "docs/design.md")).toMatchObject({
      task: null,
      statements: [],
      document: { raw, recognized: false },
    });
    const broken = parse(
      '# 内容\n\n### Project documents\n\n```json\n{"sources": broken}\n```',
      "docs/info.md",
    );
    expect(broken.warnings[0].code).toBe("structured");
    const yaml = parse("paths: [broken", "profile.yaml");
    expect(yaml.document.raw).toBe("paths: [broken");
    expect(yaml.warnings[0].code).toBe("yaml");
  });
  it("does not turn placeholders into an active task or issue statuses into task statuses", () => {
    expect(
      parse(
        "# 模板\n\n## 任务信息\n\n- 任务 ID：{{TASK_ID}}\n- 当前状态：draft",
      ).task,
    ).toBeNull();
    const result = parse(
      "# 任务\n\n## 任务信息\n\n- 任务 ID：20261002-001\n- 当前状态：skipped\n\n## 审查问题队列\n\n- Status：resolved",
    );
    expect(result.task?.statuses.map((s) => s.text)).toEqual(["skipped"]);
    expect(result.task?.issues[0].text).toBe("Status：resolved");
  });
  it("supports table metadata, unique heading anchors, reference links and number mentions", () => {
    const result = parse(
      "# 内容\n\n## Task information\n\n| Field | Value |\n| --- | --- |\n| Task ID | TASK-001 |\n| Task title | Read docs |\n| Status | mystery |\n\n## Goal\n\nRead [design][doc] and TASK-002.\n\n[doc]: ../design.md#recovery\n\n## Same\n\n## Same",
    );
    expect(result.task?.number).toBe("TASK-001");
    expect(result.task?.statuses[0].text).toBe("mystery");
    expect(result.document.headings.slice(-2).map((h) => h.anchor)).toEqual([
      "same",
      "same-1",
    ]);
    expect(result.references.map((r) => r.method)).toContain("task-number");
    expect(result.references.map((r) => r.target)).toContain(
      "../design.md#recovery",
    );
  });
});
