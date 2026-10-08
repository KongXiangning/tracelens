import { documentPathKey } from "./config.js";
import { stateKey } from "./parser.js";
import type { SourceRef, Task } from "../shared/types.js";
import type {
  ProductAssessmentView,
  ProductBindingView,
  ProductDiagnostic,
  ProductItem,
  ProductLink,
  ProductSnapshot,
  ProductSource,
  ProductSourceCheck,
  ProductTaskMatch,
  ProductTaskRef,
  ProductWorkItem,
} from "../shared/product-types.js";

/** Work IDs are local to a plan, not global product or Runtime task IDs. */
export function productWorkItemKey(
  planKey: string,
  workItemId: string,
): string {
  return `${planKey}:work:${encodeURIComponent(workItemId)}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function sourceCheck(
  product: ProductSnapshot,
  ownerKey: string,
  reference: ProductSource,
): ProductSourceCheck | undefined {
  const key = canonical(reference);
  return product.sources.find(
    (check) =>
      check.ownerKey === ownerKey && canonical(check.reference) === key,
  );
}

function taskSources(task: Task): SourceRef[] {
  return task.identitySources?.length ? task.identitySources : [task.source];
}

function sourceContains(
  reference: Extract<ProductSource, { kind: "file" }>,
  check: ProductSourceCheck | undefined,
  source: SourceRef,
): boolean {
  if (documentPathKey(reference.path) !== documentPathKey(source.path))
    return false;
  if (
    reference.lines &&
    (source.line < reference.lines.start || source.line > reference.lines.end)
  )
    return false;
  if (reference.section || reference.item_id) {
    // A resolved parent heading includes its child subsections. The task's
    // nearest heading therefore need not equal the heading in the reference.
    if (
      check?.locationState === "located" &&
      check.source &&
      check.endLine !== undefined
    )
      return source.line >= check.source.line && source.line <= check.endLine;
    if (check?.source && source.line < check.source.line) return false;
    // Without a complete resolved range, only an exact heading is evidence.
    // An item ID alone cannot establish containment without its body range.
    return Boolean(
      reference.section &&
      (source.section === reference.section ||
        (check?.source?.section && source.section === check.source.section)),
    );
  }
  return true;
}

function matchTask(
  product: ProductSnapshot,
  ownerKey: string,
  reference: ProductTaskRef,
  tasks: Task[],
): ProductTaskMatch {
  const check = sourceCheck(product, ownerKey, reference.source);
  const result = (
    state: ProductTaskMatch["state"],
    detail: string,
    taskIds: string[] = [],
  ): ProductTaskMatch => ({
    task: reference,
    taskIds,
    state,
    detail,
    ...(check ? { sourceCheckId: check.id } : {}),
  });
  if (reference.task_id === null)
    return result(
      "identity-unknown",
      "真实任务身份未确认；仅保留明确来源导航，显示编号不用于匹配",
    );

  const candidates = tasks.filter(
    (task) => task.realTaskId === reference.task_id,
  );
  let scoped: Task[] = [];
  if (reference.source.kind === "file") {
    const file = reference.source;
    const samePath = tasks.filter((task) =>
      taskSources(task).some(
        (source) => documentPathKey(source.path) === documentPathKey(file.path),
      ),
    );
    scoped = samePath.filter((task) =>
      taskSources(task).some((source) => sourceContains(file, check, source)),
    );
    if (
      scoped.some(
        (task) =>
          (task.realTaskId != null && task.realTaskId !== reference.task_id) ||
          (task.realTaskId == null && (task.identitySources?.length || 0) > 1),
      )
    )
      return result(
        "conflict",
        "引用位置的真实任务 ID 与绑定不一致或自身存在冲突；当前文件焦点变化不会继承旧绑定",
      );
    if (check?.byteState === "changed")
      return result(
        "conflict",
        "任务来源字节与声明摘要不一致，保留原引用但不确认任务导航",
      );
    if (
      !check ||
      check.readState !== "read" ||
      check.locationState !== "located" ||
      !check.source
    )
      return result(
        "unresolved",
        "真实任务 ID 已声明，但来源尚未读取或无法唯一定位，不能核对来源约束",
      );
    if (
      candidates.some((task) => samePath.includes(task)) &&
      !candidates.some((task) => scoped.includes(task))
    )
      return result(
        "conflict",
        "同文件真实任务 ID 位于引用范围之外，不能用文件级身份覆盖章节或行号约束",
      );
    if (
      scoped.some((task) =>
        taskSources(task).some(
          (source) =>
            documentPathKey(source.path) === documentPathKey(file.path) &&
            source.digest !== check.source!.digest,
        ),
      )
    )
      return result(
        "conflict",
        "任务身份声明与引用来源不是同一快照字节，不能确认导航",
      );
  }
  if (!candidates.length)
    return result(
      "unresolved",
      "本快照未发现相同真实 task_id 的任务声明；不按编号、标题或历史表行创建任务",
    );

  const observedStates = new Set(
    candidates.flatMap((task) =>
      task.statuses
        .map((status) => stateKey(status.text) || status.text.trim())
        .filter(Boolean),
    ),
  );
  const matchingSources = scoped.filter(
    (task) => task.realTaskId === reference.task_id,
  );
  if (!matchingSources.length && candidates.length > 1)
    return result(
      "conflict",
      "多个任务来源声明相同真实 ID，引用来源不足以选择唯一观察；所有任务原文仍保留",
    );
  return result(
    "matched",
    `${matchingSources.length ? "真实 task_id 与引用位置一致" : "按绑定声明的真实 task_id 定位；该来源未独立验证任务身份"}；保留 ${candidates.length} 份任务观察${observedStates.size > 1 ? "，文档状态声明冲突，不择新覆盖" : ""}。任务状态仅为文档报告`,
    candidates.map((task) => task.id),
  );
}

function validDirection(
  owner: ProductItem,
  target: ProductItem,
  relation: string,
): boolean {
  switch (relation) {
    case "part_of":
      return (
        ["requirement", "module"].includes(owner.type) &&
        target.type === "module"
      );
    case "supports":
      return (
        ["requirement", "module"].includes(owner.type) && target.type === "goal"
      );
    case "addresses":
      return owner.type === "design" && target.type === "requirement";
    case "depends_on":
      return (
        ["requirement", "design"].includes(owner.type) &&
        ["requirement", "design"].includes(target.type)
      );
    case "replaces":
    case "derived_from":
      return (
        ["goal", "module", "requirement", "design", "plan"].includes(
          owner.type,
        ) && owner.type === target.type
      );
    case "discusses":
      return (
        owner.type === "discussion" &&
        ["goal", "module", "requirement", "design"].includes(target.type)
      );
    case "references":
      return true;
    default:
      return false;
  }
}

/** Index only this snapshot. This function never reads files, invents tasks, or derives delivery from task lifecycle. */
export function buildProductIndex(
  product: ProductSnapshot,
  tasks: Task[],
): void {
  product.relations = [];
  product.bindings = [];
  product.assessments = [];
  if (!product.manifest) return;
  const report = (
    code: string,
    item: ProductItem | undefined,
    message: string,
    severity: ProductDiagnostic["severity"] = "warning",
  ) => {
    const diagnostic: ProductDiagnostic = {
      code,
      message,
      severity,
      path: item?.source.path || product.manifestPath,
      ...(item
        ? { line: item.source.line, itemId: item.id, source: item.source }
        : {}),
    };
    const same = (other: ProductDiagnostic) =>
      other.code === code &&
      other.path === diagnostic.path &&
      other.line === diagnostic.line &&
      other.itemId === diagnostic.itemId &&
      other.message === message;
    if (!product.diagnostics.some(same)) product.diagnostics.push(diagnostic);
    if (item && !item.diagnostics.some(same)) item.diagnostics.push(diagnostic);
  };
  const allById = new Map<string, ProductItem[]>();
  for (const item of product.items)
    if (item.id.trim())
      allById.set(item.id, [...(allById.get(item.id) || []), item]);
  for (const group of allById.values()) {
    if (group.length <= 1) continue;
    for (const item of group) {
      item.usable = false;
      report(
        "AMBIGUOUS_ID",
        item,
        `条目 ${item.id} 存在多个当前定义，保留全部来源且不按最新文件选择`,
        "error",
      );
    }
  }
  const usable = product.items.filter((item) => item.usable && item.id.trim());
  const byId = new Map(usable.map((item) => [item.id, item]));
  const projects = usable.filter((item) => item.type === "project");
  if (
    projects.length !== 1 ||
    documentPathKey(projects[0].source.path) !==
      documentPathKey(product.manifest.entry)
  )
    report(
      "PROJECT_ENTRY",
      undefined,
      "manifest.entry 中应有唯一可用 project 条目；不从其他文件猜入口",
    );

  const target = (
    owner: ProductItem,
    id: string,
    types: string[] | null,
    label: string,
  ): ProductItem | undefined => {
    const found = byId.get(id);
    if (!found)
      report(
        "UNRESOLVED_TARGET",
        owner,
        `${label}：${id} 缺失、不可用或存在身份冲突`,
      );
    else if (types && !types.includes(found.type)) {
      report(
        "TARGET_TYPE",
        owner,
        `${label}：${id} 类型为 ${found.type}，应为 ${types.join("/")}`,
      );
      return undefined;
    }
    return found;
  };
  const workMap = (plan: ProductItem) => {
    const map = new Map<string, ProductWorkItem[]>();
    for (const work of plan.metadata.work_items || [])
      map.set(work.id, [...(map.get(work.id) || []), work]);
    return map;
  };
  const workMaps = new Map(
    usable
      .filter((item) => item.type === "plan")
      .map((item) => [item.key, workMap(item)]),
  );

  for (const item of usable) {
    const m = item.metadata;
    const linkIds = new Set<string>();
    for (const [index, link] of (m.links || []).entries()) {
      if (linkIds.has(link.id))
        report("DUPLICATE_LINK_ID", item, `关系 ID ${link.id} 重复，逐条保留`);
      linkIds.add(link.id);
      const matches = allById.get(link.target) || [];
      const resolved = byId.get(link.target);
      let resolution: ProductSnapshot["relations"][number]["resolution"] =
        matches.length > 1 ? "ambiguous" : resolved ? "resolved" : "missing";
      if (resolved && !validDirection(item, resolved, link.relation))
        resolution = "invalid-direction";
      if (link.state === "active") {
        if (!resolved)
          report(
            "UNRESOLVED_TARGET",
            item,
            `${link.relation}：${link.target} 缺失、不可用或存在身份冲突`,
          );
        else if (resolution === "invalid-direction")
          report(
            "LINK_DIRECTION",
            item,
            `${item.type} → ${resolved.type} 不支持 ${link.relation}`,
          );
      }
      product.relations.push({
        key: `${item.key}:link:${encodeURIComponent(link.id)}:${index}`,
        ownerKey: item.key,
        link,
        targetKey: resolution === "resolved" ? resolved!.key : null,
        resolution,
      });
    }

    if (item.type === "plan") {
      const works = m.work_items || [];
      const map = workMaps.get(item.key)!;
      const covered = new Set((m.targets || []).map((entry) => entry.target));
      for (const entry of m.targets || [])
        target(item, entry.target, ["goal", "requirement"], "计划覆盖");
      for (const work of works) {
        if (map.get(work.id)!.length > 1)
          report(
            "DUPLICATE_WORK_ITEM",
            item,
            `工作项 ${work.id} 重复，不能唯一连接`,
          );
        if (!work.targets.length)
          report("WORK_TARGET_UNKNOWN", item, `${work.id}：业务归属尚未明确`);
        if (work.origin === "added" && !work.sources?.length)
          report(
            "WORK_BASIS_MISSING",
            item,
            `${work.id}：新增工作未记录插入来源`,
          );
        for (const entry of work.targets) {
          target(
            item,
            entry.target,
            ["goal", "requirement"],
            `工作项 ${work.id}`,
          );
          if (!covered.has(entry.target))
            report(
              "WORK_OUTSIDE_PLAN",
              item,
              `${work.id}：${entry.target} 不在所属计划声明范围内`,
            );
        }
        for (const dependency of work.depends_on || []) {
          const before = map.get(dependency.item_id) || [];
          if (!before.length)
            report(
              "WORK_DEPENDENCY_MISSING",
              item,
              `${work.id}：前置工作 ${dependency.item_id} 不存在`,
            );
          else if (before.length > 1)
            report(
              "WORK_DEPENDENCY_AMBIGUOUS",
              item,
              `${work.id}：前置工作 ${dependency.item_id} 身份冲突`,
            );
          else if (before[0].state === "withdrawn")
            report(
              "WORK_DEPENDENCY_WITHDRAWN",
              item,
              `${work.id}：前置工作 ${dependency.item_id} 已撤回；安排不是 Runtime gate`,
            );
        }
        for (const replaced of work.replaces || []) {
          const before = map.get(replaced) || [];
          if (!before.length)
            report(
              "WORK_REPLACEMENT_MISSING",
              item,
              `${work.id}：被替代工作 ${replaced} 不存在`,
            );
          else if (before.length > 1)
            report(
              "WORK_REPLACEMENT_AMBIGUOUS",
              item,
              `${work.id}：被替代工作 ${replaced} 身份冲突`,
            );
          else if (before[0].state !== "withdrawn")
            report(
              "WORK_REPLACEMENT_ACTIVE",
              item,
              `${work.id}：被替代工作 ${replaced} 尚未撤回`,
            );
        }
      }
      // Iterative DFS keeps large (but bounded) documents off the JS call stack.
      const done = new Set<string>();
      for (const id of map.keys()) {
        if (done.has(id)) continue;
        const visiting = new Set<string>();
        const stack: { id: string; exit: boolean }[] = [{ id, exit: false }];
        while (stack.length) {
          const node = stack.pop()!;
          if (node.exit) {
            visiting.delete(node.id);
            done.add(node.id);
            continue;
          }
          if (visiting.has(node.id)) {
            report(
              "WORK_DEPENDENCY_CYCLE",
              item,
              `工作项依赖存在包含 ${node.id} 的环；保留原数组顺序`,
            );
            continue;
          }
          if (done.has(node.id)) continue;
          visiting.add(node.id);
          stack.push({ id: node.id, exit: true });
          for (const work of map.get(node.id) || [])
            for (const dependency of work.depends_on || [])
              if (map.has(dependency.item_id))
                stack.push({ id: dependency.item_id, exit: false });
        }
      }
    }

    const bindingIds = new Set<string>();
    const fingerprints = new Set<string>();
    for (const [index, binding] of (m.task_bindings || []).entries()) {
      if (bindingIds.has(binding.id))
        report(
          "DUPLICATE_BINDING_ID",
          item,
          `绑定 ID ${binding.id} 重复，逐条保留`,
        );
      bindingIds.add(binding.id);
      if (binding.state === "active") {
        if (binding.task.task_id === null)
          report(
            "TASK_ID_UNCONFIRMED",
            item,
            `${binding.id}：真实任务身份未确认，仅按明确来源定位`,
          );
        const fingerprint = canonical([
          binding.task.task_id ?? binding.task.source,
          binding.task.plan_ref ?? null,
          binding.task.step_id ?? null,
          binding.role,
          binding.coverage,
        ]);
        if (fingerprints.has(fingerprint))
          report(
            "DUPLICATE_BINDING_CANDIDATE",
            item,
            `${binding.id}：存在可能等价的绑定，保留各自覆盖和依据`,
          );
        fingerprints.add(fingerprint);
      }
      const planItems: ProductBindingView["planItems"] = (
        binding.plan_items || []
      ).map((ref) => {
        const plan = byId.get(ref.plan_id);
        const matches =
          plan?.type === "plan"
            ? workMaps.get(plan.key)?.get(ref.work_item_id) || []
            : [];
        const ambiguous =
          (allById.get(ref.plan_id)?.length || 0) > 1 || matches.length > 1;
        const state = ambiguous
          ? "ambiguous"
          : matches.length === 1
            ? "resolved"
            : "missing";
        if (state !== "resolved" && binding.state === "active")
          report(
            "BINDING_WORK_ITEM",
            item,
            `${binding.id}：工作项 ${ref.plan_id}/${ref.work_item_id} ${ambiguous ? "身份冲突" : "未定位"}`,
          );
        return {
          planId: ref.plan_id,
          workItemId: ref.work_item_id,
          key:
            state === "resolved"
              ? productWorkItemKey(plan!.key, ref.work_item_id)
              : null,
          state,
        };
      });
      const match = matchTask(product, item.key, binding.task, tasks);
      if (match.state === "conflict")
        report("TASK_ID_CONFLICT", item, `${binding.id}：${match.detail}`);
      if (match.state === "matched" && match.detail.includes("状态声明冲突"))
        report("TASK_STATUS_CONFLICT", item, `${binding.id}：${match.detail}`);
      product.bindings.push({
        key: `${item.key}:binding:${encodeURIComponent(binding.id)}:${index}`,
        ownerKey: item.key,
        binding,
        match,
        planItems,
        repairs: (binding.repairs || []).map((repair) => ({
          ...repair,
          match: matchTask(product, item.key, repair.task, tasks),
        })),
      });
    }

    if (item.type === "assessment") {
      const requirement = target(
        item,
        m.target || "",
        ["requirement"],
        "交付摘要目标",
      );
      if (
        m.target_definition_sha256 &&
        requirement?.definitionSha256 &&
        m.target_definition_sha256 !== requirement.definitionSha256
      )
        report(
          "DEFINITION_CHANGED",
          item,
          "当前需求定义与报告依据不同；不判断语义变化或当前代码适用性",
        );
      if (!m.target_definition_sha256 || !requirement?.definitionSha256)
        report("DEFINITION_UNKNOWN", item, "需求定义版本对齐未知");
      if (
        (m.implementation !== "unknown" || m.verification !== "unknown") &&
        !m.sources?.length
      )
        report(
          "REPORT_SOURCE_MISSING",
          item,
          "实施或验证报告缺少原始来源；报告标签不证明交付",
        );
      if (m.pending_sources?.length)
        report(
          "PENDING_SOURCES",
          item,
          "存在尚未纳入结论的新材料，旧通过报告不能表示当前完整通过",
        );
    }
    if (item.type === "change")
      for (const delta of m.deltas || [])
        if (!byId.has(delta.target))
          report(
            "CHANGE_TARGET",
            item,
            `变化目标 ${delta.target} 未定位，历史声明保留`,
          );
  }

  for (const requirement of usable.filter(
    (item) => item.type === "requirement",
  )) {
    const selected = requirement.metadata.assessment_id;
    const view: ProductAssessmentView = {
      requirementKey: requirement.key,
      assessmentKey: null,
      state: selected ? "missing" : "unselected",
      definitionState: "unknown",
      historicalState: "unknown",
      detail: selected
        ? "显式选择的交付摘要未定位"
        : "未选择交付摘要；不按时间或报告结果自动选择",
    };
    if (selected) {
      const found = byId.get(selected);
      if ((allById.get(selected)?.length || 0) > 1) {
        view.state = "ambiguous";
        view.detail = "选择的交付摘要存在多个当前定义";
      } else if (
        found &&
        (found.type !== "assessment" ||
          found.metadata.target !== requirement.id)
      ) {
        view.state = "target-mismatch";
        view.detail = "所选条目不是该需求的交付摘要，不能作为该需求的报告入口";
        report("ASSESSMENT_TARGET", requirement, view.detail);
      } else if (found) {
        view.state = "selected";
        view.assessmentKey = found.key;
        const digest = found.metadata.target_definition_sha256;
        view.definitionState =
          digest && requirement.definitionSha256
            ? digest === requirement.definitionSha256
              ? "same"
              : "changed"
            : "unknown";
        const basis = found.metadata.target_basis;
        const checked = basis
          ? sourceCheck(product, found.key, basis)
          : undefined;
        view.basisDefinitionState =
          digest && checked?.definitionSha256
            ? digest === checked.definitionSha256
              ? "same"
              : "changed"
            : "unknown";
        if (view.basisDefinitionState === "changed")
          report(
            "BASIS_DEFINITION_MISMATCH",
            found,
            "原依据中的需求定义摘要与报告声明不同；原件字节核对不能替代定义对齐",
          );
        view.historicalState =
          checked?.readState === "read" && checked.locationState === "located"
            ? checked.byteState === "same-bytes"
              ? "verified"
              : checked.byteState === "changed"
                ? "changed"
                : "unknown"
            : "unknown";
        view.detail =
          "报告仅适用于所记对象、版本与覆盖范围；定义对齐和历史原件核对不证明当前代码适用";
        if (found.metadata.pending_sources?.length)
          view.detail += `；${found.metadata.pending_sources.length} 份新材料仍待对账`;
      } else
        report(
          "UNRESOLVED_TARGET",
          requirement,
          `所选交付摘要 ${selected} 缺失或不可用`,
        );
    }
    product.assessments.push(view);
  }
}
