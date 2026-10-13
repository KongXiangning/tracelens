import {
  defaultOverviewFilters,
  overviewConclusionOptions,
  overviewFiltersActive,
  overviewTaskOptions,
  type ConclusionFilter,
  type OverviewFilters,
} from "./overview-card-state";

export function OverviewFilterBar({
  filters,
  change,
  counts,
  reviewCount,
  shown,
  total,
}: {
  filters: OverviewFilters;
  change: (next: OverviewFilters) => void;
  counts: Record<ConclusionFilter, number>;
  reviewCount: number;
  shown: number;
  total: number;
}) {
  function toggleConclusion(value: ConclusionFilter) {
    const conclusions = filters.conclusions.includes(value)
      ? filters.conclusions.filter((conclusion) => conclusion !== value)
      : [...filters.conclusions, value];
    change({ ...filters, conclusions });
  }
  return (
    <section className="overview-filters" aria-label="完整范围筛选">
      <fieldset className="overview-conclusion-filters">
        <legend>
          报告结论 <span>可多选</span>
        </legend>
        <div>
          <button
            type="button"
            aria-pressed={!filters.conclusions.length}
            onClick={() => change({ ...filters, conclusions: [] })}
          >
            全部 <b>{total}</b>
          </button>
          {overviewConclusionOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              data-conclusion={option.value}
              aria-label={`筛选${option.label}`}
              aria-pressed={filters.conclusions.includes(option.value)}
              onClick={() => toggleConclusion(option.value)}
            >
              <i aria-hidden="true">{option.symbol}</i>
              {option.label}
              <b>{counts[option.value]}</b>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="overview-filter-secondary">
        <button
          type="button"
          className="overview-review-filter"
          aria-label="筛选待核对"
          aria-pressed={filters.reviewOnly}
          title="只显示验收适用性待核对的需求"
          onClick={() =>
            change({ ...filters, reviewOnly: !filters.reviewOnly })
          }
        >
          <i aria-hidden="true">!</i> 待核对 <b>{reviewCount}</b>
        </button>
        <label className="overview-task-filter">
          <span>Task 关联</span>
          <select
            aria-label="筛选 Task 关联情况"
            value={filters.task}
            onChange={(event) => {
              const selected = overviewTaskOptions.find(
                (option) => option.value === event.target.value,
              )!;
              change({ ...filters, task: selected.value });
            }}
          >
            {overviewTaskOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div
          className="overview-filter-result"
          role="status"
          aria-live="polite"
        >
          显示 <b>{shown}</b> / {total} 项
          {overviewFiltersActive(filters) && (
            <button
              type="button"
              onClick={() => change(defaultOverviewFilters())}
            >
              清除筛选
            </button>
          )}
        </div>
      </div>
      <p>
        包含原报告结论；多份报告可命中多个类别。待核对可与结论、Task 条件组合。
      </p>
    </section>
  );
}
