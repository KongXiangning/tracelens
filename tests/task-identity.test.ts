import { describe, expect, it } from "vitest";
import { parseInput } from "../src/server/parser.js";

function parse(raw: string, path = "docs/workflow/CURRENT_TASK.md") {
  return parseInput("project", {
    path,
    raw,
    kind: "management",
    bytes: Buffer.byteLength(raw),
    digest: "snapshot-digest",
    modifiedAt: "now",
  });
}
const focus = (identity = "opaque-real-id") =>
  `<!-- vnext-task-view/v1 -->\n# CURRENT_TASK\n## Current work\n- Task: TASK-811 (${identity}) — Current title\n- Step: S1\n## Tasks\n| Task | Lifecycle |\n| --- | --- |\n| TASK-810 | closed |\n| TASK-811 | active |\n`;

describe("explicit real task identity", () => {
  it("distinguishes UI identity, display number and opaque real ID, without splitting steps or history", () => {
    const result = parse(focus("opaque:not-a-uuid"));
    expect(result.task).toMatchObject({
      number: "TASK-811",
      realTaskId: "opaque:not-a-uuid",
      identitySources: [{ line: 4, path: "docs/workflow/CURRENT_TASK.md" }],
    });
    expect(result.task!.id).not.toBe(result.task!.realTaskId);
    expect(result.task!.steps).toHaveLength(1);
    expect(parse(focus("another-real-id")).task!.id).toBe(result.task!.id);
    expect(parse(focus("another-real-id")).task!.realTaskId).toBe(
      "another-real-id",
    );
  });
  it("supports explicitly named root task_id metadata, never nested history arrays or event payloads", () => {
    expect(
      parse(
        "task_id: arbitrary-service-id\ntask_number: TASK-811\n",
        "TASKS/task.yaml",
      ).task,
    ).toMatchObject({
      realTaskId: "arbitrary-service-id",
      number: "TASK-811",
      current: false,
    });
    expect(
      parse(
        '{"task_id":"json-real", "task_number":"TASK-811"}',
        "reports/task.json",
      ).task,
    ).toMatchObject({ realTaskId: "json-real", current: false });
    expect(
      parse('{"payload":{"task_id":"json-real"}}', "reports/event.json").task,
    ).toBeNull();
    expect(
      parse("tasks:\n  - task_id: history-real\n", "reports/history.yaml").task,
    ).toBeNull();
    expect(
      parse("---\ntask_id: explicit-real\n---\n# task\n", "docs/task.md").task,
    ).toMatchObject({ realTaskId: "explicit-real", number: null });
  });
  it("locates root identities and explicit status observations rather than similarly named nested fields", () => {
    const result = parse(
      `{
  "payload": {"task_id": "nested", "status": "done"},
  "task_id": "root-id",
  "status": "paused",
  "state": "active"
}`,
      "reports/task.json",
    );
    expect(result.task?.identitySources).toMatchObject([{ line: 3 }]);
    expect(result.task?.statuses).toMatchObject([
      { text: "paused", source: { line: 4 } },
      { text: "active", source: { line: 5 } },
    ]);
    expect(
      parse('{"task_id":"one","task_id":"two"}', "reports/duplicate.json").task,
    ).toBeNull();
  });
  it("preserves all explicit identity sources and diagnoses incompatible identities", () => {
    const same = parse(`---\ntask_id: opaque-real-id\n---\n${focus()}`);
    expect(same.task?.realTaskId).toBe("opaque-real-id");
    expect(same.task?.identitySources).toHaveLength(2);
    const conflict = parse(`---\ntask_id: wrong-id\n---\n${focus()}`);
    expect(conflict.task?.realTaskId).toBeNull();
    expect(conflict.task?.identitySources).toHaveLength(2);
    expect(conflict.warnings.map((warning) => warning.code)).toContain(
      "task-identity-conflict",
    );
  });
  it("does not promote display-number-only fields, unknown focus forms or guessed prose IDs", () => {
    const old = parse(
      "# Task\n## Task information\n- Task ID: TASK-811\n- Status: active\n",
    );
    expect(old.task).toMatchObject({ realTaskId: null, number: "TASK-811" });
    const real = parse(
      "# Task\n## Task information\n- Task ID: opaque-real-id\n- Task number: TASK-811\n",
    );
    expect(real.task).toMatchObject({
      realTaskId: "opaque-real-id",
      number: "TASK-811",
    });
    expect(
      parse(focus().replace("(opaque-real-id)", "opaque-real-id")).task
        ?.realTaskId,
    ).toBeNull();
    expect(
      parse("# Notes\nMention task_id: fake-id in prose", "docs/readme.md")
        .task,
    ).toBeNull();
  });
  it("does not treat quoted or nested example declarations as identity", () => {
    expect(
      parse("# Task\n## Task information\n> Task ID: example-id\n").task
        ?.realTaskId,
    ).toBeNull();
    expect(
      parse(
        "# Task\n## Task information\n- Example:\n  - Task ID: example-id\n",
      ).task?.realTaskId,
    ).toBeNull();
    expect(parse(focus().replace("- Task:", "> Task:")).task).toBeNull();
  });
  it("rejects ambiguous focus and broken identity metadata without inventing history tasks", () => {
    const conflict = parse(
      focus().replace(
        "- Step: S1",
        "- Task: TASK-812 (second-id) — Other\n- Step: S1",
      ),
    );
    expect(conflict.task).toBeNull();
    expect(conflict.warnings.map((warning) => warning.code)).toContain(
      "task-focus-conflict",
    );
    expect(parse("task_id: one\ntask_id: two", "task.yaml").task).toBeNull();
    expect(parse(focus("null")).task?.realTaskId).toBeNull();
    expect(
      parse(
        focus().replace(
          "- Task: TASK-811 (opaque-real-id) — Current title",
          "- No unambiguous active work focus.",
        ),
      ).task,
    ).toBeNull();
  });
});
