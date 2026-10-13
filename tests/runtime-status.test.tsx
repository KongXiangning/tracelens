import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RuntimeStatus } from "../src/web/runtime.js";
import type { RuntimeView } from "../src/shared/runtime-types.js";

const view: RuntimeView = {
  source: "runtime-query",
  workflowHome: "docs/workflow",
  viewRevision: "revision",
  readAt: "2026-10-13T06:22:45.044Z",
  freshness: "queried",
  complete: true,
  total: 2,
  tasks: [
    { task_id: "a", lifecycle: "active" },
    { task_id: "b", lifecycle: "closed" },
  ],
  issues: [],
  diagnostics: [],
  batchId: "batch",
};
function summary(input: RuntimeView) {
  return renderToStaticMarkup(<RuntimeStatus view={input} />).split(
    "<details>",
  )[0];
}
it("keeps the healthy summary compact and the technical evidence in a closed details section", () => {
  const html = renderToStaticMarkup(<RuntimeStatus view={view} />);
  expect(summary(view)).toContain("任务已更新");
  expect(summary(view)).toContain("共 2 个");
  expect(summary(view)).not.toContain("Runtime");
  expect(summary(view)).not.toContain("列表完整");
  expect(summary(view)).not.toContain("2026-10-13T");
  expect(html).toContain("<details><summary>数据详情</summary>");
  expect(html).toContain("Runtime 只读查询");
});
it("highlights partial lists and stale snapshots without implying current complete data", () => {
  const partial = summary({ ...view, complete: false, total: 3 });
  expect(partial).toContain("runtime-status-warning");
  expect(partial).toContain("任务尚未读全");
  expect(partial).toContain("已读取 2/3 个");
  const stale = summary({
    ...view,
    source: "file-snapshot",
    freshness: "stale-or-unknown",
  });
  expect(stale).toContain("正在显示旧任务数据");
  expect(stale).toContain("更新时间未知");
  expect(stale).not.toContain("任务已更新");
});
it("distinguishes unavailable data and unresolved empty results from zero tasks", () => {
  const unavailable = summary({
    ...view,
    source: "unavailable",
    tasks: [],
    total: null,
  });
  expect(unavailable).toContain("runtime-status-error");
  expect(unavailable).toContain("产品文档仍可查看");
  expect(unavailable).not.toContain("共 0 个");
  const unresolved = summary({
    ...view,
    tasks: [],
    total: 0,
    issues: ["missing association"],
  });
  expect(unresolved).toContain("不能确认零任务");
  expect(unresolved).not.toContain("任务已更新");
});
