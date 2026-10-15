import { LazyDetails, PagedItems } from "./lazy-details";
import type {
  OverviewAssessmentGroup,
  OverviewReport,
} from "../shared/overview-data";
import type { ProductContext } from "./product";
import { assessmentGroups } from "../shared/overview-model";
import { conclusionLabels } from "../shared/product-view";

export function AssessmentOverview({
  context,
  groups: supplied,
  openProduct,
}: {
  context?: ProductContext;
  groups?: OverviewAssessmentGroup[];
  openProduct?: ProductContext["openProduct"];
}) {
  const groups =
    supplied ||
    (context?.snapshot.product
      ? assessmentGroups(context.snapshot.product)
      : []);
  const open = openProduct || context!.openProduct;
  if (!groups.length) return null;
  return (
    <LazyDetails
      className="overview-assessments"
      label="范围化验收记录"
      summary={<>验收记录 · {groups.length} 组</>}
    >
      {() => (
        <>
          <p>
            按报告文件、目标与交付对象展示原报告结论；每份结论仅适用于其声明范围。
          </p>
          {groups.map((group) => (
            <LazyDetails
              key={group.key}
              className="overview-assessment-group"
              summary={
                <>
                  <strong>{group.path.split("/").at(-1)}</strong>
                  <span>{group.reports.length} 份报告</span>
                  {Object.entries(group.conclusions).map(
                    ([conclusion, count]) => (
                      <span key={conclusion}>
                        {
                          conclusionLabels[
                            conclusion as keyof typeof conclusionLabels
                          ]
                        }{" "}
                        {count}
                      </span>
                    ),
                  )}
                  {group.passed + group.failed > 0 && (
                    <span>
                      场景验收：{group.passed} 通过 · {group.failed} 未通过
                    </span>
                  )}
                </>
              }
            >
              {() => (
                <>
                  <p>
                    目标：{group.goal || "未声明"} · 对象：
                    {group.subject || "未声明"}
                  </p>
                  <p>
                    来源核对：{group.pending} 待处理 · {group.failedChecks}{" "}
                    异常。文件摘要一致不代表业务重新验收。
                  </p>
                  <PagedItems<OverviewReport> items={group.reports}>
                    {(reports) => (
                      <ul>
                        {reports.map((report) => (
                          <li key={report.key}>
                            <button
                              className="text-link"
                              onClick={() => open(report.key)}
                            >
                              {report.title || report.id}
                            </button>
                            <span>
                              {
                                conclusionLabels[
                                  report.metadata.conclusion || "undetermined"
                                ]
                              }
                            </span>
                            <small>
                              {report.metadata.applicability?.scope_id ||
                                "范围未声明"}
                            </small>
                            {!report.usable && <small>报告元数据待核对</small>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </PagedItems>
                </>
              )}
            </LazyDetails>
          ))}
        </>
      )}
    </LazyDetails>
  );
}
