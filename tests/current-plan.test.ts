import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildSnapshot } from "../src/server/snapshot.js";
import type { Project } from "../src/shared/types.js";

let root: string;
let project: Project;
const originals = new Map<string, string>();
const recordPath = ".workflow-system/records/events/plan.json";
const planPath = "docs/plan.md";
async function file(filename: string, raw: string) {
  await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  await writeFile(path.join(root, filename), raw);
  originals.set(filename, raw);
}
const record = (documentRef = planPath) =>
  JSON.stringify(
    {
      kind: "workflow-observation",
      payload: {
        kind: "task-event",
        request: {
          plan: {
            document_ref: documentRef,
            steps: [{ id: "P4", title: "开发库仅重试11份并核对" }],
          },
        },
      },
    },
    null,
    2,
  );
beforeEach(async () => {
  originals.clear();
  root = await mkdtemp(path.join(os.tmpdir(), "tracelens-current-plan-"));
  project = {
    id: "test",
    root,
    name: "test",
    configVersion: 1,
    config: {
      autoDiscover: false,
      rules: {
        management: ["docs/workflow/CURRENT_TASK.md"],
        requirements: [],
        design: [],
        planning: [],
      },
      excludes: [],
    },
  };
  await file(
    "docs/workflow/CURRENT_TASK.md",
    `<!-- vnext-task-view/v1 -->
# CURRENT_TASK
## Current work
- Task: TASK-811 (task-abc) — 法规导入修复
- Adopted plan: ${recordPath}
- Step: P4
`,
  );
  await file(recordPath, record());
  await file(
    planPath,
    "# 修复计划\n\n### P4 开发库定向重试与结果核对\n\n仅重试失败的11份。\n",
  );
});
afterEach(async () => {
  for (const [filename, raw] of originals)
    expect(await readFile(path.join(root, filename), "utf8")).toBe(raw);
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^tracelens-current-plan-/);
  await rm(root, { recursive: true, force: true });
});
const snapshot = () => buildSnapshot(project, new Date().toISOString());
it("follows the explicit plan record to the exact step chapter without reading other records or changing config", async () => {
  await file(".workflow-system/records/events/unrelated.json", "not JSON");
  const before = JSON.stringify(project.config);
  const result = await snapshot();
  const step = result.statements.find((s) => s.kind === "currentStep")!;
  expect(step.link).toMatchObject({
    label: "P4 · 开发库仅重试11份并核对",
    target: { path: planPath, line: 3, section: "P4 开发库定向重试与结果核对" },
  });
  expect(result.tasks.find((t) => t.current)?.steps[0].link).toEqual(step.link);
  expect(result.relations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ raw: recordPath, state: "resolved" }),
      expect.objectContaining({
        raw: planPath,
        label: "计划文档",
        state: "resolved",
      }),
      expect.objectContaining({
        raw: planPath,
        label: step.link?.label,
        state: "resolved",
        targetLine: 3,
      }),
    ]),
  );
  expect(result.documents.some((d) => d.path.endsWith("unrelated.json"))).toBe(
    false,
  );
  expect(JSON.stringify(project.config)).toBe(before);
});
it("respects explicit exclusions and keeps an explanation instead of a fabricated jump", async () => {
  project.config.excludes = [".workflow-system/records/**"];
  const result = await snapshot();
  expect(
    result.statements.find((s) => s.kind === "currentStep")?.link,
  ).toMatchObject({
    target: null,
    detail: expect.stringContaining("显式排除"),
  });
  expect(result.documents.some((d) => d.path === recordPath)).toBe(false);
});
it("rejects unsafe document_ref and preserves a readable step definition in the explicit record", async () => {
  await file(recordPath, record("../../outside.md"));
  const result = await snapshot();
  expect(
    result.statements.find((s) => s.kind === "currentStep")?.link,
  ).toMatchObject({
    target: { path: recordPath },
    detail: expect.stringContaining("路径"),
  });
  expect(result.documents.some((d) => d.path.includes("outside"))).toBe(false);
});
it("does not guess between duplicate chapter headings", async () => {
  await file(planPath, "# 计划\n## P4 第一处\n## P4 第二处\n");
  const result = await snapshot();
  expect(
    result.statements.find((s) => s.kind === "currentStep")?.link,
  ).toMatchObject({
    target: { path: recordPath },
    detail: expect.stringContaining("无法唯一定位"),
  });
});
it("reports malformed records without losing current task and step", async () => {
  await file(recordPath, "invalid JSON");
  const result = await snapshot();
  expect(result.tasks.find((t) => t.current)?.number).toBe("TASK-811");
  expect(result.statements.find((s) => s.kind === "currentStep")).toMatchObject(
    { text: "P4", link: { target: null, detail: expect.any(String) } },
  );
});
it("opens the embedded step definition when an adopted plan has no standalone document_ref", async () => {
  const embedded = JSON.parse(record());
  delete embedded.payload.request.plan.document_ref;
  await file(recordPath, JSON.stringify(embedded, null, 2));
  const result = await snapshot();
  const step = result.statements.find((s) => s.kind === "currentStep")!;
  expect(step.link).toMatchObject({
    label: "P4 · 开发库仅重试11份并核对",
    target: { path: recordPath },
    detail: expect.stringContaining("未声明独立计划文档"),
  });
  expect(
    result.documents.find((d) => d.path === recordPath)?.raw.split("\n")[
      (step.link?.target?.line || 1) - 1
    ],
  ).toContain('"id": "P4"');
  expect(result.warnings.some((w) => w.code === "current-plan")).toBe(false);
});
