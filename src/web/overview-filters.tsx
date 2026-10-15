import {
  defaultOverviewFilters,
  overviewConclusionOptions,
  overviewFiltersActive,
  overviewTaskOptions,
  requirementVisibilityOptions,
  type RequirementVisibility,
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
  visibility,
}: {
  filters: OverviewFilters;
  change: (next: OverviewFilters) => void;
  counts: Record<ConclusionFilter, number>;
  reviewCount: number;
  shown: number;
  total: number;
  visibility: {
    value: RequirementVisibility;
    change: (value: RequirementVisibility) => void;
    counts: Record<RequirementVisibility, number>;
  };
}) {
  function toggleConclusion(value: ConclusionFilter) {
    const conclusions = filters.conclusions.includes(value)
      ? filters.conclusions.filter((conclusion) => conclusion !== value)
      : [...filters.conclusions, value];
    change({ ...filters, conclusions });
  }
  return (
    <section className="overview-filters" aria-label="完整范围筛选">
      <fieldset className="overview-visibility-filters">
        <legend>需求显示范围</legend>
        <div role="group" aria-label="需求显示范围">
          {requirementVisibilityOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={`显示${option.label}`}
              aria-pressed={visibility.value === option.value}
              onClick={() => visibility.change(option.value)}
            >
              {option.label}
              <b>{visibility.counts[option.value]}</b>
            </button>
          ))}
        </div>
      </fieldset>
      <p>
        已开展包含明确的执行依据或适用的进展核对结论；已有核对结果也包含“未开始”和“无法确认”。
      </p>
      <fieldset className="overview-conclusion-filters">
        <legend>
          当前适用的范围结论 <span>可多选</span>
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
        按当前适用的范围结论筛选；待核对报告的原结论见详情。多份范围报告可命中多个类别，待核对可与
        Task 条件组合。
      </p>
    </section>
  );
}
import type { ReactNode } from "react";
