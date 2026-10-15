import type {
  ProductBindingView,
  ProductItem,
  ProductSnapshot,
} from "./product-types.js";
import type { Snapshot } from "./types.js";
import { selectAssessment, type AssessmentSelection } from "./product-view.js";

/** Keep each declared scope and delivery object separate, including conflicts. */
export function overviewAssessmentRecords(
  product: ProductSnapshot,
  requirement: ProductItem,
): { report: ProductItem; selection: AssessmentSelection }[] {
  const records: { report: ProductItem; selection: AssessmentSelection }[] = [];
  const seen = new Set<string>();
  for (const report of product.items) {
    const { applicability, subject, target } = report.metadata;
    if (
      report.type !== "assessment" ||
      ![3, 4, 5, 6].includes(report.version || 0) ||
      target !== requirement.id ||
      !applicability ||
      !subject
    )
      continue;
    if (
      !product.items.some(
        (item) =>
          item.id === applicability.goal_id &&
          item.type === "goal" &&
          item.usable &&
          item.metadata.scope === "current",
      )
    )
      continue;
    const key = JSON.stringify([
      applicability.goal_id,
      applicability.scope_id,
      subject.kind,
      subject.value,
      subject.revision ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    const selection = selectAssessment(
      product,
      requirement.id,
      applicability.goal_id,
      subject,
      applicability.scope_id,
    );
    for (const selected of selection.reports)
      records.push({ report: selected, selection });
  }
  return records;
}

/** Browse declarations without adopting the latest report as a requirement verdict. */
export function assessmentGroups(product: ProductSnapshot) {
  const groups = new Map<
    string,
    {
      key: string;
      path: string;
      goal?: string;
      subject?: string;
      checkedAt: string;
      reports: ProductItem[];
      conclusions: Record<string, number>;
      passed: number;
      failed: number;
      pending: number;
      failedChecks: number;
    }
  >();
  for (const report of product.items.filter(
    (item) => item.type === "assessment",
  )) {
    const m = report.metadata;
    const key = JSON.stringify([
      report.source.path,
      m.applicability?.goal_id,
      m.subject?.kind,
      m.subject?.value,
      m.subject?.revision,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        path: report.source.path,
        goal: m.applicability?.goal_id,
        subject:
          m.subject && m.subject.kind !== "unknown"
            ? `${m.subject.kind} · ${m.subject.value}${m.subject.revision ? ` @ ${m.subject.revision}` : ""}`
            : undefined,
        checkedAt: m.checked_at || "",
        reports: [],
        conclusions: {},
        passed: 0,
        failed: 0,
        pending: 0,
        failedChecks: 0,
      };
      groups.set(key, group);
    }
    group.reports.push(report);
    const conclusion = m.conclusion || "undetermined";
    group.conclusions[conclusion] = (group.conclusions[conclusion] || 0) + 1;
    if (m.extensions?.scenario_verdict === "pass") group.passed++;
    if (m.extensions?.scenario_verdict === "fail") group.failed++;
    for (const check of product.sources.filter(
      (s) => s.ownerKey === report.key,
    )) {
      if (check.readState === "not-read") group.pending++;
      else if (
        check.readState === "unavailable" ||
        check.readState === "outside" ||
        check.readState === "excluded" ||
        check.byteState === "changed" ||
        check.locationState === "unlocated" ||
        check.locationState === "ambiguous"
      )
        group.failedChecks++;
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.checkedAt.localeCompare(a.checkedAt) || a.key.localeCompare(b.key),
  );
}

export interface OverviewCard {
  key: string;
  id: string;
  title: string;
  description: string;
  owner: ProductItem;
  workId?: string;
  state?: string;
  stage?: string;
  dependencies: { label: string; inferred: boolean }[];
  bindings: ProductBindingView[];
  followsPrevious: boolean;
}

/** Read existing relationships and arrays; never generate an implementation order. */
export function overviewCards(
  product: ProductSnapshot,
  plan?: ProductItem,
): OverviewCard[] {
  const active = product.bindings.filter(
    (view) => view.binding.state === "active",
  );
  if (plan)
    return (plan.metadata.work_items || []).map((work, index, works) => ({
      key: `${plan.key}:${work.id}:${index}`,
      id: work.id,
      title: work.title,
      description: work.scope || work.outcome,
      owner: plan,
      workId: work.id,
      state: work.state,
      stage: work.stage,
      dependencies: (work.depends_on || []).map((dependency) => ({
        label: dependency.item_id,
        inferred: false,
      })),
      bindings: active.filter((view) =>
        view.planItems.some(
          (ref) =>
            ref.planId === plan.id &&
            ref.workItemId === work.id &&
            ref.state === "resolved",
        ),
      ),
      followsPrevious:
        index > 0 &&
        Boolean(
          work.depends_on?.some(
            (dependency) => dependency.item_id === works[index - 1].id,
          ),
        ),
    }));
  return product.items
    .filter((item) => item.usable && item.type === "requirement")
    .map((item) => ({
      key: item.key,
      id: item.id,
      title: item.title,
      description: "完整需求、范围边界与验收要求见原文。",
      owner: item,
      state: item.metadata.scope,
      dependencies: product.relations
        .filter(
          (relation) =>
            relation.ownerKey === item.key &&
            relation.link.state === "active" &&
            relation.link.relation === "depends_on" &&
            relation.resolution === "resolved",
        )
        .map((relation) => ({
          label: relation.link.target,
          inferred: relation.link.origin === "inferred",
        })),
      bindings: active.filter((view) => view.ownerKey === item.key),
      followsPrevious: false,
    }));
}

const taskStates: { label: string; tone: string; pattern: RegExp }[] = [
  {
    label: "已完成",
    tone: "green",
    pattern: /^(done|complete|completed|已完成|完成)$/i,
  },
  {
    label: "进行中",
    tone: "orange",
    pattern: /^(active|in[_-]progress|进行中|执行中)$/i,
  },
  { label: "待开始", tone: "slate", pattern: /^(pending|待开始)$/i },
  { label: "已关闭", tone: "slate", pattern: /^(closed|已关闭|关闭)$/i },
  { label: "已暂停", tone: "slate", pattern: /^(paused|暂停|已暂停)$/i },
  { label: "草稿", tone: "slate", pattern: /^(draft|草稿)$/i },
  {
    label: "已终止",
    tone: "slate",
    pattern: /^(terminated|cancelled|终止|已终止)$/i,
  },
  { label: "已跳过", tone: "slate", pattern: /^(skipped|跳过|已跳过)$/i },
  { label: "已归档", tone: "slate", pattern: /^(archived|已归档)$/i },
  { label: "受阻", tone: "orange", pattern: /^(blocked|阻塞)$/i },
];

/** Count unique declared task identities, preserving unknown and conflicting observations. */
export function overviewTaskStates(
  snapshot: Snapshot,
  bindings: ProductBindingView[],
) {
  const identities = new Map<string, ProductBindingView[]>();
  const active = [
    ...new Map(
      bindings
        .filter((view) => view.binding.state === "active")
        .map((view) => [view.key, view]),
    ).values(),
  ];
  for (const view of active) {
    const identity = JSON.stringify(
      view.binding.task.task_id === null
        ? ["unconfirmed", view.key]
        : ["task", view.binding.task.task_id],
    );
    identities.set(identity, [...(identities.get(identity) || []), view]);
  }
  const states = new Map<
    string,
    { label: string; tone: string; count: number }
  >();
  for (const views of identities.values()) {
    let label = "状态待核对",
      tone = "slate";
    const observations = new Set(
      views
        .flatMap((view) => view.match.taskIds)
        .flatMap(
          (id) => snapshot.tasks.find((task) => task.id === id)?.statuses || [],
        )
        .map(
          (entry) =>
            taskStates.find((state) => state.pattern.test(entry.text.trim()))
              ?.label || `未识别：${entry.text}`,
        ),
    );
    const trusted = snapshot.tasks.filter(
      (task) =>
        task.runtimeLifecycle &&
        task.realTaskId === views[0].binding.task.task_id &&
        views.some(
          (view) =>
            view.match.state === "matched" &&
            view.match.taskIds.includes(task.id),
        ),
    );
    if (views[0].binding.task.task_id === null) label = "身份未确认";
    else if (trusted.length === 1) {
      const declared = taskStates.find((s) =>
        s.pattern.test(trusted[0].runtimeLifecycle!),
      );
      if (declared) {
        label = declared.label;
        tone = declared.tone;
      }
    } else if (
      views.some((view) => view.match.state === "conflict") ||
      observations.size > 1
    )
      label = "状态冲突";
    else if (
      views.every((view) => view.match.state === "matched") &&
      observations.size === 1
    ) {
      const declared = taskStates.find(
        (state) => state.label === [...observations][0],
      );
      if (declared) {
        label = declared.label;
        tone = declared.tone;
      }
    }
    const previous = states.get(label);
    states.set(label, { label, tone, count: (previous?.count || 0) + 1 });
  }
  return {
    total: [...identities.values()].filter(
      (views) => views[0].binding.task.task_id !== null,
    ).length,
    unconfirmed: active.filter((view) => view.binding.task.task_id === null)
      .length,
    associationPending: [...identities.values()].filter((views) =>
      views.some((view) => view.match.state !== "matched"),
    ).length,
    states: [...states.values()],
  };
}
