# 贡献关联与存量重判：C0 共同样例

本页与[文档契约第 12 节](../document-contract.md#12-v5需求实施关联与贡献性质c0-共同契约)共用贡献、兼容及统计语义。全部名称、Task 身份和材料均为合成输入，不是 LawAgent 或其他真实项目的重判结果。它可用于生产方／消费者核对期望，但不能代替实际宿主先读后判、保存回读、安装和浏览器证据。

## 1. 先读的原始材料

假设本次用户只授权核对并纠正下面三项需求的 Task 关联，保留业务验收和实施顺序。没有授权新的产品实现、Task 生命周期操作、交付报告或 Roadmap 重排。

| 材料 | 原始业务事实 |
|---|---|
| REQ-INPUT 当前要求 | 导入 CSV 时校验必填字段；错误返回行号和字段名，合法行进入后续处理；导入事务的整体回滚不在这项要求内 |
| REQ-TENANT 当前要求 | 查询、导入和导出按租户隔离；必须校验身份并在数据访问时执行租户限制 |
| REQ-AUDIT 当前要求 | 对已采用的关键操作保留操作者、时间和结果，审计范围及留存约束仍按正文 |
| TASK-SAMPLE-PARSER 的原采用范围 | 实现共用 CSV 解析器，检查必填字段并返回错误行号、字段名；输出行记录供调用端使用；明确排除身份校验、租户过滤和审计事件 |
| 该 Task 的真实结果（本例合成） | 解析器已实现；错误行定位检查通过。记录显示 Task 已关闭，但没有租户过滤或审计验证 |
| 已有 B-INPUT | 同一 Task 对 REQ-INPUT 的 implementation 关系，缺 contribution；覆盖写为“必填字段及错误行定位” |
| 已有 B-TENANT | 同一 Task 对 REQ-TENANT 的 implementation＋direct；旧理由仅为“租户导入要使用解析器” |
| 已有 B-AUDIT | 显示编号可知、task_id 为 null，来源正文不可恢复；没有足够材料判断是否曾实现审计 |

本例假设解析器为租户导入提供标准化输入这一支撑机制已经由所读设计明确记载，且没有一条既有需求依赖能够充分表达这项独立关联。若实际项目只有“可能用得上”的猜测，REQ-TENANT 也不得新建 supporting。

## 2. 可审阅的关系结论

- B-INPUT：在原 ID 补 direct；Task 的明确采用范围直接履行必填字段与错误定位义务。它只表达这项覆盖，关闭不另行证明整体交付
- B-TENANT：原 ID 改为 supporting；标准化输入支撑租户导入，但未履行身份校验和访问隔离。先保留旧分类、旧依据与本次纠正理由，不额外添加一条同范围 active 关系
- B-AUDIT：保持原记录、原来源和缺分类；身份未知与关系未判定分别显示。不补 Task ID，也不因未恢复原文将它 dismissed
- 已确认的解析器结果可作为已有成果的来源材料；本次未授权保存 Assessment，不发布租户隔离满足结论
- 不调用 Task prepare、adopt、close、resume、focus 或 supersede，不为了本次元数据维护重新执行验证

若需求随后增加“按租户隔离输入”的义务，应保留旧 Task 原覆盖并单独核对新增范围；不能倒推旧 Task 曾承诺隔离。若较晚才登记 REQ-INPUT，仍然可以根据其实际子义务识别较早 Task 的 direct，不按先后时间一律降级。

## 3. v5 保存后片段

下面是可独立读取的合成示例文件。来源文字只描述本页合成材料；真实写入必须替换为实际读到的来源，不复制这些示例身份或伪造摘要。B-AUDIT 是允许保留的旧未知记录，不是新建关系的模板。

`.workflow-system/PRODUCT.yaml`：

```yaml
schema: vnext-product-manifest/v2
project_id: contribution-synthetic
entry: docs/product/PROJECT.md
managed_paths:
  - docs/product/PROJECT.md
  - docs/product/REQUIREMENTS.md
source_paths: []
capture_paths: []
exclude_paths: []
maintenance: enabled
```

`docs/product/PROJECT.md`：

```markdown
---
schema: vnext-product-doc/v3
items:
  - id: PROJECT-SAMPLE
    type: project
    root_goal_id: null
    requirement_order: [REQ-INPUT, REQ-TENANT, REQ-AUDIT]
    inventory:
      state: partial
      checked_sources:
        - kind: text
          label: 合成样例材料
          text: 仅核对 CSV、租户隔离和旧审计绑定，不代表真实项目全量盘点。
      unreviewed_sources: []
---
# 合成贡献项目

## [PROJECT-SAMPLE] 贡献核对样例

### 项目定位
本页合成材料用于版本与关系消费核对。

### 盘点范围与未核对项
只有三项需求；旧审计任务正文未知，没有本次交付评估或 Roadmap 调整。
```

`docs/product/REQUIREMENTS.md`：

```markdown
---
schema: vnext-product-doc/v5
items:
  - id: REQ-INPUT
    type: requirement
    scope: current
    task_bindings:
      - id: B-INPUT
        task:
          task_id: TASK-SAMPLE-PARSER
          source:
            kind: text
            label: 合成 Task 采用材料
            text: 实现 CSV 必填字段检查和错误行号、字段名返回；排除租户隔离与审计。
        role: implementation
        contribution: direct
        coverage: CSV 必填字段校验及错误行号、字段名定位；不含整体回滚。
        origin: declared
        state: active
        reason: 采用的解析器工作直接对应本需求的字段校验及错误定位义务。
        sources:
          - kind: text
            label: 合成需求与采用范围核对
            text: 本需求要求必填字段检查及错误定位，解析器的采用范围明确包含两者。
  - id: REQ-TENANT
    type: requirement
    scope: current
    task_bindings:
      - id: B-TENANT
        task:
          task_id: TASK-SAMPLE-PARSER
          source:
            kind: text
            label: 合成 Task 采用材料
            text: 实现 CSV 必填字段检查和错误行号、字段名返回；排除租户隔离与审计。
        role: implementation
        contribution: supporting
        coverage: 为租户导入提供校验后的行输入；不含身份验证或数据访问隔离。
        origin: declared
        state: active
        reason: 输入标准化服务于隔离导入流程，但未履行本需求的隔离义务；纠正原 direct。
        sources:
          - kind: text
            label: 合成原分类依据
            text: 原 B-TENANT 被记为 direct，依据仅为租户导入需要解析器。
          - kind: text
            label: 合成本次核对材料
            text: 采用范围排除租户隔离；设计明确租户导入消费校验后的解析器输出。
  - id: REQ-AUDIT
    type: requirement
    scope: current
    task_bindings:
      - id: B-AUDIT
        task:
          task_id: null
          label: 历史显示编号（合成）
          source:
            kind: text
            label: 合成旧索引
            text: 旧索引曾关联此显示编号，原任务正文尚不可恢复。
        role: implementation
        coverage: 旧记录称覆盖审计事件，具体范围待核对。
        origin: declared
        state: active
---
# 合成贡献核对

## [REQ-INPUT] CSV 字段校验

### 需求内容
导入 CSV 时校验必填字段，错误返回行号和字段名，合法行进入后续处理。

### 范围边界
本项不包括导入事务整体回滚。

### 验收要求
缺失必填字段能定位具体行与字段，合法输入可继续处理。

## [REQ-TENANT] 租户隔离

### 需求内容
查询、导入和导出按租户隔离。

### 范围边界
适用于已采用的三个数据入口；共用解析器本身不承担隔离。

### 验收要求
身份校验和数据访问限制均覆盖对应租户，不能跨租户读取或导入。

## [REQ-AUDIT] 操作审计

### 需求内容
关键操作保留操作者、时间和结果。

### 范围边界
审计操作及留存约束保持原有约定，缺材料不缩减要求。

### 验收要求
在实际约定的操作范围内能够查到上述审计信息。
```

上述样例的有效关系统计：direct 1 条、supporting 1 条、未分类 1 条，涉及 1 个已确认 Task 身份。direct 与 supporting 组各自都包含同一个 Task，不能相加为 2 个唯一 Task；null 不凑成另一个已确认身份。统计不包含任务完成率或需求满足率。

## 4. 边界共同预期

| 场景 | 两侧应一致的结果 |
|---|---|
| v4 文档尝试添加 contribution | 按固定 v4 Schema 拒绝该字段；不能静默采用 v5 结构 |
| 原 v4 Roadmap 继续使用 | 不因其他需求迁入 v5 而迁移或重建；其 planning_baseline 和原稳定 ID 保留 |
| 迁移到 v5，但仅纠正 B-TENANT | 其他条目／旧无分类绑定保留；不强制全文件重判 |
| v5 新建无分类、无 reason 或无 sources 的 active 绑定 | 写入诊断具体条目；主 Task／其他成功文件不撤销 |
| v5 新增 reference＋direct | 要求澄清实际活动或改用普通来源；未改的旧同组合保留并诊断 |
| 新 Task 仅与“审计”标题相似 | 不建立正式绑定，不创建 undetermined 或空分类 active 候选 |
| B-TENANT 改 contribution 但义务正文未变 | 需求业务定义摘要不变，读取分类更新；整文件来源字节可真实变化并报告 |
| 同范围再添加 B-TENANT-2＋direct | 不用新 ID／不同 contribution 规避重复或冲突诊断；不任取 direct |
| 旧关系已 dismissed，又被搜索发现 | 原拒绝和理由保留，无新依据或明确反转不恢复 |
| Task 仅采用，或实际步骤只开始 A | 不称所有关联需求开始实施；B 保留范围活动未知 |
| supporting Task closed | 不能推导租户隔离已实施或满足 |
| 直接 verification／exploration | 分别呈现验证／探索，不自动变成编码交付；满足另按本义务 Assessment |
| repair 执行完但验证失败 | 保留修复活动与失败，不自动满意或抹掉 pending |
| 真实代码无历史 Task | 可在独立授权下评估其范围，不补造 Task 或要求先填 direct |
| 无修改的再次读取或同依据重判 | 不增加业务记录、时间戳或同义报告 |
| B-INPUT 保存成功，B-TENANT 并发冲突 | 保留前者，仅回读重试失败绑定；不重建 Task，不重跑验证 |
| 用户只要求分析 | 返回材料、判断、未读和待维护定位，不改任何业务文件／Task |
| 存在子 Task 关闭后的父续接 | 保持已保存的关闭与真实父焦点，局部产品对账不抢占续接 |
| 父项汇集共享子需求 | 保留子 owner／路径，Task 按身份去重，不提升为父项 direct 或满足 |
| 下游仅有 depends_on 路径 | 可呈现前置工作，不自动写入 N 条 supporting，不进入下游直接计数 |
| 旧 satisfied 报告当前适用性待核对 | 仍可历史浏览，不能无提示进入当前已确认成果 |

## 5. 取证要求与本页限制

字段读取、写入、迁移、摘要与确定性诊断可以用合成材料验证。语义行为另让实际宿主读取未预填分类的需求、采用范围和历史材料，分别观察新任务采用后关联与旧项目重判；必须包含“无据不建”和局部保存失败的恢复，保留原输入、实际来源、保存回读和未核对范围。

本页没有执行这些轨迹，也不证明任何真实项目已迁移或需求满足。实际验收记录应分别报告源码、分发／隔离安装、真实宿主有限行为和消费者只读界面，并明确尚未验证部分；不以两字段填写、Schema 通过或样例期望充当全部能力 PASS。
