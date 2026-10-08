import type {
  ProductBinding,
  ProductItem,
  ProductTaskRef,
  ProductType,
  ProductView,
  TargetResolution,
} from "../shared/product-types.js";
import { documentPathKey } from "./config.js";
import { parseProductDocument, productKey } from "./product-parser.js";
import { stateKey, type Parsed } from "./parser.js";

export function indexProduct(view: ProductView, parsed: Parsed[]): ProductView {
  if (!view.manifest || !["available", "partial"].includes(view.status))
    return view;
  const tasks = parsed.flatMap((p) => (p.task ? [p.task] : []));
  function report(
    code: string,
    owner: ProductItem,
    message: string,
    pointer = "",
  ) {
    view.diagnostics.push({
      code,
      message,
      path: owner.source.path,
      line: owner.metadataLocations[pointer] || owner.metadataLine,
      itemId: owner.id,
      pointer,
      severity: "warning",
    });
  }
  function target(
    id: string,
    types?: ProductType[],
  ): { item: ProductItem | null; resolution: TargetResolution } {
    const items = view.items.filter((i) => i.id === id);
    if (items.length > 1) return { item: null, resolution: "ambiguous" };
    if (!items.length) return { item: null, resolution: "missing" };
    const item = items[0];
    if (!item.usable || (types && !types.includes(item.type!)))
      return { item, resolution: "invalid" };
    return { item, resolution: "resolved" };
  }
  function expect(owner: ProductItem, id: string, types?: ProductType[]) {
    const result = target(id, types);
    if (result.resolution !== "resolved")
      report(
        "UNRESOLVED_TARGET",
        owner,
        `${id}：${result.resolution}，不建立无歧义业务连接`,
      );
    return result;
  }
  const direction: Record<string, [ProductType[], ProductType[]]> = {
    part_of: [["requirement", "module"], ["module"]],
    supports: [["requirement", "module"], ["goal"]],
    addresses: [["design"], ["requirement"]],
    depends_on: [
      ["requirement", "design"],
      ["requirement", "design"],
    ],
    discusses: [["discussion"], ["goal", "module", "requirement", "design"]],
  };
  const usable = view.items.filter((i) => i.usable);
  for (const item of usable) {
    const m = item.metadata!;
    const linkIds = new Set<string>();
    for (const [i, link] of (m.links || []).entries()) {
      if (linkIds.has(link.id))
        report(
          "DUPLICATE_LINK_ID",
          item,
          `关联 ID ${link.id} 重复，全部声明保留`,
        );
      linkIds.add(link.id);
      const rule = ["replaces", "derived_from"].includes(link.relation)
        ? ([
            ["goal", "module", "requirement", "design", "plan"],
            [item.type!],
          ] as [ProductType[], ProductType[]])
        : direction[link.relation];
      const found = target(link.target, rule?.[1]);
      let resolution = found.resolution;
      if (rule && !rule[0].includes(item.type!)) {
        resolution = "invalid";
        report(
          "LINK_DIRECTION",
          item,
          `${item.type} 不能发出 ${link.relation}`,
        );
      }
      if (resolution !== "resolved" && link.state === "active")
        report(
          "UNRESOLVED_TARGET",
          item,
          `${link.relation} → ${link.target}：${resolution}`,
        );
      view.relations.push({
        key: `${item.key}:link:${link.id}${(m.links || []).filter((l) => l.id === link.id).length > 1 ? `:conflict:${i}` : ""}`,
        ownerKey: item.key,
        targetKey:
          found.item?.usable && resolution === "resolved"
            ? found.item.key
            : null,
        resolution,
        declaration: link,
        source: {
          ...item.source,
          line: item.metadataLocations[`/links/${i}`] || item.metadataLine,
        },
      });
    }
    if (item.type === "plan") {
      const work = m.work_items || [];
      const targets = new Set((m.targets || []).map((t) => t.target));
      for (const t of m.targets || [])
        expect(item, t.target, ["goal", "requirement"]);
      for (const [index, w] of work.entries()) {
        const duplicates = work.filter((other) => other.id === w.id).length > 1;
        if (duplicates)
          report(
            "DUPLICATE_WORK_ITEM",
            item,
            `工作项 ${w.id} 重复，不能唯一连接`,
          );
        view.workItems.push({
          key:
            productKey(view.root, view.manifest.project_id, item.id, w.id) +
            (duplicates ? `:conflict:${index}` : ""),
          planKey: item.key,
          declaration: w,
          bindingKeys: [],
          source: {
            ...item.source,
            line:
              item.metadataLocations[`/work_items/${index}`] ||
              item.metadataLine,
          },
        });
        if (!w.targets.length)
          report("WORK_TARGET_UNKNOWN", item, `${w.id} 未记录业务归属`);
        if (w.origin === "added" && !w.sources?.length)
          report(
            "WORK_BASIS_MISSING",
            item,
            `${w.id} 为新增工作但未记录插入依据`,
          );
        for (const t of w.targets) {
          expect(item, t.target, ["goal", "requirement"]);
          if (!targets.has(t.target))
            report(
              "WORK_OUTSIDE_PLAN",
              item,
              `${w.id} 的 ${t.target} 不在计划声明范围内`,
            );
        }
        for (const dependency of w.depends_on || []) {
          const prior = work.filter((w) => w.id === dependency.item_id);
          if (prior.length !== 1)
            report(
              "WORK_DEPENDENCY_MISSING",
              item,
              `${w.id} 的前置 ${dependency.item_id} 缺失或有歧义`,
            );
          else if (prior[0].state === "withdrawn")
            report(
              "WORK_DEPENDENCY_WITHDRAWN",
              item,
              `${w.id} 的前置 ${dependency.item_id} 已撤回`,
            );
        }
        for (const replaced of w.replaces || []) {
          const old = work.filter((w) => w.id === replaced);
          if (old.length !== 1 || old[0].state !== "withdrawn")
            report(
              "WORK_REPLACEMENT",
              item,
              `${w.id} 的替代来源 ${replaced} 缺失、有歧义或未撤回`,
            );
        }
      }
      const visiting = new Set<string>();
      const done = new Set<string>();
      function visit(id: string): void {
        if (visiting.has(id)) {
          report(
            "WORK_DEPENDENCY_CYCLE",
            item,
            `计划依赖有环：${id}，保留原数组顺序`,
          );
          return;
        }
        if (done.has(id)) return;
        visiting.add(id);
        for (const d of work.find((w) => w.id === id)?.depends_on || [])
          visit(d.item_id);
        visiting.delete(id);
        done.add(id);
      }
      for (const w of work) visit(w.id);
    }
    if (item.type === "assessment") {
      expect(item, m.target!, ["requirement"]);
      if (!m.target_definition_sha256)
        report(
          "DEFINITION_UNKNOWN",
          item,
          "报告的需求定义摘要未记录，当前定义对齐未知",
        );
      if (
        (m.implementation !== "unknown" || m.verification !== "unknown") &&
        !m.sources?.length
      )
        report(
          "REPORT_SOURCE_MISSING",
          item,
          "报告标签缺少报告来源；交付仍需范围化核对",
        );
      if (m.pending_sources?.length)
        report(
          "PENDING_SOURCES",
          item,
          "有新材料待对账；旧范围通过报告不能代表当前完整交付",
        );
    }
    if (item.type === "change")
      for (const d of m.deltas || []) expect(item, d.target);
  }
  function matchTask(
    ref: ProductTaskRef,
    owner: ProductItem,
    pointer: string,
  ): Pick<ProductBinding, "taskIds" | "match" | "detail"> {
    const check = view.sources.find(
      (s) => s.ownerKey === owner.key && s.pointer === `${pointer}/source`,
    );
    const refSource = ref.source;
    const sourceTasks =
      refSource.kind === "file"
        ? tasks.filter(
            (t) =>
              documentPathKey(t.source.path) ===
                documentPathKey(refSource.path) &&
              (!check?.target ||
                (t.source.line >= check.target.line &&
                  t.source.line <= (check.endLine || Infinity))),
          )
        : [];
    if (ref.task_id === null) {
      // A mutable CURRENT_TASK file is never proof of a historical identity.
      const historical = sourceTasks.filter(
        (t) => !/(^|\/)CURRENT_TASK\.md$/i.test(t.source.path),
      );
      return {
        taskIds:
          historical.length === 1 && check?.locationState === "located"
            ? [historical[0].id]
            : [],
        match: "unknown-identity",
        detail: "真实任务身份未确认；仅按具体历史来源阅读，不以显示编号猜测",
      };
    }
    if (
      sourceTasks.some(
        (t) => t.identityConflict || (t.taskId && t.taskId !== ref.task_id),
      )
    )
      return {
        taskIds: [],
        match: "conflict",
        detail: "来源中的真实任务身份与绑定矛盾",
      };
    const candidates = tasks.filter(
      (t) => t.taskId === ref.task_id && !t.identityConflict,
    );
    if (
      refSource.kind === "file" &&
      check &&
      (check.locationState !== "located" || check.digestState === "changed")
    )
      return {
        taskIds: [],
        match: "unresolved",
        detail: "任务来源尚未定位或声明字节已变化，不能可靠建立导航",
      };
    const exact = candidates.filter((t) =>
      sourceTasks.some((s) => s.id === t.id),
    );
    if (exact.length === 1 && candidates.length === 1)
      return {
        taskIds: [exact[0].id],
        match: "matched",
        detail: "真实 task_id 与精确来源一致",
      };
    if (!candidates.length)
      return {
        taskIds: [],
        match: "unresolved",
        detail: "当前快照没有可靠匹配该真实 task_id 的任务文档",
      };
    const statuses = candidates.flatMap((task) =>
      task.statuses.map((s) => stateKey(s.text) || s.text),
    );
    if (new Set(statuses).size > 1)
      report(
        "TASK_STATUS_CONFLICT",
        owner,
        `${ref.task_id} 有多个矛盾状态声明，保留全部来源`,
      );
    // Multiple declarations of the same identity retain all statuses, including conflicts.
    return {
      taskIds: candidates.map((t) => t.id),
      match: candidates.length === 1 ? "matched" : "ambiguous",
      detail:
        candidates.length === 1
          ? "真实 task_id 一致，来源未发现矛盾"
          : "同一真实身份有多个任务文档，保留全部声明与状态冲突",
    };
  }
  for (const owner of usable) {
    const bindingIds = new Set<string>();
    for (const [index, declaration] of (
      owner.metadata!.task_bindings || []
    ).entries()) {
      const pointer = `/task_bindings/${index}`;
      if (bindingIds.has(declaration.id))
        report(
          "DUPLICATE_BINDING_ID",
          owner,
          `绑定 ${declaration.id} 重复，全部范围保留`,
          pointer,
        );
      bindingIds.add(declaration.id);
      const match = matchTask(declaration.task, owner, `${pointer}/task`);
      if (match.match !== "matched")
        report(
          "TASK_MATCH",
          owner,
          `${declaration.id}：${match.detail}`,
          pointer,
        );
      const binding: ProductBinding = {
        key: `${owner.key}:binding:${declaration.id}${(owner.metadata!.task_bindings || []).filter((b) => b.id === declaration.id).length > 1 ? `:conflict:${index}` : ""}`,
        ownerKey: owner.key,
        declaration,
        ...match,
        source: {
          ...owner.source,
          line: owner.metadataLocations[pointer] || owner.metadataLine,
        },
        planItems: [],
        repairs: [],
      };
      for (const ref of declaration.plan_items || []) {
        const plan = target(ref.plan_id, ["plan"]);
        const work = view.workItems.filter(
          (w) =>
            w.planKey === plan.item?.key &&
            w.declaration.id === ref.work_item_id,
        );
        const resolution =
          plan.resolution !== "resolved"
            ? plan.resolution
            : work.length > 1
              ? "ambiguous"
              : work.length === 1
                ? "resolved"
                : "missing";
        const key = resolution === "resolved" ? work[0].key : null;
        binding.planItems.push({ ref, key, resolution });
        if (key)
          view.workItems
            .find((w) => w.key === key)!
            .bindingKeys.push(binding.key);
        else
          report(
            "BINDING_WORK_ITEM",
            owner,
            `${declaration.id} 的 ${ref.plan_id}/${ref.work_item_id}：${resolution}`,
            pointer,
          );
      }
      for (const [i, repair] of (declaration.repairs || []).entries())
        binding.repairs.push({
          ...repair,
          ...matchTask(repair.task, owner, `${pointer}/repairs/${i}/task`),
        });
      view.bindings.push(binding);
    }
  }
  for (const requirement of usable.filter((i) => i.type === "requirement")) {
    const selectedId = requirement.metadata!.assessment_id || null;
    const found = selectedId ? target(selectedId, ["assessment"]) : null;
    const assessment = found?.resolution === "resolved" ? found.item : null;
    const belongs = assessment?.metadata?.target === requirement.id;
    let alignment: "unknown" | "same" | "changed" = "unknown";
    const declaredDigest = belongs
      ? assessment?.metadata?.target_definition_sha256
      : null;
    if (declaredDigest)
      alignment =
        declaredDigest === requirement.definitionSha256 ? "same" : "changed";
    if (alignment === "changed")
      report(
        "DEFINITION_CHANGED",
        assessment!,
        "当前需求定义与报告摘要不同；不自动判断代码适用性",
      );
    let historicalState: "available" | "unavailable" | "unknown" = "unknown";
    let historicalDigest: string | null = null;
    const basis =
      assessment &&
      view.sources.find(
        (s) => s.ownerKey === assessment.key && s.pointer === "/target_basis",
      );
    if (basis?.ref.kind === "file") {
      historicalState =
        basis.readState === "read" && basis.locationState === "located"
          ? "available"
          : "unavailable";
      const document = parsed.find(
        (p) => p.document.id === basis.target?.documentId,
      )?.document;
      if (document && basis.locationState === "located") {
        const old = parseProductDocument(
          view.root,
          view.manifest.project_id,
          "historical",
          document,
        );
        const definitions = old.items.filter(
          (i) =>
            i.usable && i.type === "requirement" && i.id === requirement.id,
        );
        if (definitions.length === 1)
          historicalDigest = definitions[0].definitionSha256;
        else historicalState = "unknown";
      }
    }
    const selection = !selectedId
      ? "unselected"
      : !assessment
        ? found?.resolution === "ambiguous"
          ? "ambiguous"
          : "missing"
        : belongs
          ? "resolved"
          : "target-mismatch";
    if (selectedId && selection !== "resolved")
      report(
        "ASSESSMENT_SELECTION",
        requirement,
        `所选报告 ${selectedId}：${selection}；不自动选其他报告`,
      );
    view.assessments.push({
      requirementKey: requirement.key,
      selectedId,
      assessmentKey: assessment?.key || null,
      selection,
      definitionAlignment: alignment,
      currentDefinitionSha256: requirement.definitionSha256,
      historicalDefinitionSha256: historicalDigest,
      historicalDefinitionAlignment:
        historicalDigest && declaredDigest
          ? historicalDigest === declaredDigest
            ? "same"
            : "changed"
          : "unknown",
      historicalState,
    });
  }
  if (view.diagnostics.length) view.status = "partial";
  return view;
}
