import { useState } from "react";
import { BookOpenCheck, Check, Copy, Search } from "lucide-react";
import {
  findScenarios,
  guideCategories,
  guideSource,
  scenarioPrompt,
  type GuideScenario,
} from "../shared/vnext-guide";
import { IconButton } from "./components";

function Scenario({ scenario }: { scenario: GuideScenario }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(scenarioPrompt(scenario));
      setCopied(true);
      setError("");
    } catch {
      setCopied(false);
      setError("剪贴板不可用，请选择下方提示词文本复制。");
    }
  }
  return (
    <details className="guide-scenario">
      <summary>
        <span>
          <strong>{scenario.title}</strong>
          <small>{scenario.when}</small>
        </span>
        <code>${scenario.skill}</code>
      </summary>
      <div className="guide-detail">
        <div className="guide-command">
          <span>
            {scenario.mode ? `模式：${scenario.mode}` : "无需指定模式"}
          </span>
          <IconButton
            label={`复制提示词：${scenario.title}`}
            onClick={() => void copy()}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}
          </IconButton>
          {copied && <span role="status">已复制</span>}
        </div>
        <textarea
          aria-label={`提示词：${scenario.title}`}
          readOnly
          value={scenarioPrompt(scenario)}
        />
        {error && (
          <p className="guide-copy-error" role="alert">
            {error}
          </p>
        )}
        <dl>
          <dt>预期结果</dt>
          <dd>{scenario.result}</dd>
          <dt>边界</dt>
          <dd>{scenario.boundary}</dd>
        </dl>
      </div>
    </details>
  );
}

export function VNextGuide() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const scenarios = findScenarios(query, category);
  return (
    <article className="vnext-guide">
      <section className="guide-intro">
        <h2>
          <BookOpenCheck size={23} />
          vNext 使用说明
        </h2>
        <p>
          在目标项目的 AI 会话中调用 skill。以下示例使用 Codex 的{" "}
          <code>$skill-name</code>{" "}
          写法；其他宿主使用其原生调用方式。模式写在提示词里，不是 CLI
          参数。填写尖括号中的内容后再发送。
        </p>
        <p>
          这是静态场景指南，不读取 Runtime 状态，也不在 TraceLens
          中执行指令。以目标项目安装的{" "}
          <code>.agents/skills/&lt;名称&gt;/SKILL.md</code>{" "}
          为准，不混用旧版斜杠指令。
        </p>
        <small>
          核对：{guideSource.repository} · {guideSource.version} 源码 ·{" "}
          {guideSource.revision} · {guideSource.checkedAt}
          。不同安装版本可能有差异。
        </small>
      </section>
      <section className="guide-install">
        <h3>首次接入</h3>
        <p>
          未安装的目标项目使用 <code>npx vibe-governance@latest install</code>
          ，之后调用 <code>$bootstrap-project</code>。安装提供 Runtime 和 11 个
          canonical skills，不自动确认项目事实或生成任务。
        </p>
        <p>
          旧版迁移使用 <code>npx vibe-governance@latest migrate</code>；已有较旧
          vNext Distribution 升级使用{" "}
          <code>npx vibe-governance@latest upgrade</code>
          。三种操作互不替代；先核对目标状态、保留用户文件并遵守实际安装器限制。本工具不会执行这些命令。
        </p>
      </section>
      <section className="guide-route">
        <h3>一次需求的常用路径</h3>
        <p>
          <code>prepare-task</code> → <code>review-draft</code> →{" "}
          <code>prepare-task / confirm</code> → <code>execute-step</code> →{" "}
          <code>review-change</code> → <code>execute-step / finish</code> →
          下一步或 <code>close-task</code>。
        </p>
        <p>
          这是参考路径，不是强制准入门槛。验证按实际风险选择{" "}
          <code>validate-change</code>；修复用{" "}
          <code>execute-step / repair</code>。阶段或最终提交需要明确授权{" "}
          <code>git-commit</code>。下一步建议 <code>next_route</code>{" "}
          不等于授权，收尾、关闭、提交也不会彼此自动执行。
        </p>
      </section>
      <section className="guide-notes">
        <h3>标准产品文档与只读规划</h3>
        <p>
          在项目配置预览 .workflow-system/PRODUCT.yaml
          后，明确启用并手动刷新。支持固定契约 v2，并只读兼容 v1；条目 type
          与普通文档分类分开。上游契约核对基线：813d3146561c974c1437fc4d116144dc800bc1ad。
        </p>
        <p>
          需求页保留九类条目、完整正文和四种
          scope；规划页按所选计划的原工作项顺序展示。多计划需明确选择，没有计划仍可阅读全部已知业务范围。
        </p>
        <p>
          项目 plan 与当前任务 adopted-plan
          分开。关联任务状态来自文档；交付仅沿需求 assessment_id
          的范围化报告展示。旧报告通过与待对账新材料同时保留，不从任务关闭推断需求完成。
        </p>
        <p>
          来源原文来自同一次快照；未读取、未定位、排除和字节变化分别说明。不会调用
          Runtime、运行 helper、抓取 URI、重放 journal
          或写入被观察项目。需要维护材料时，在该项目的已有授权工作流中修改，再回到
          TraceLens 刷新。
        </p>
      </section>
      <div className="guide-filters">
        <label className="guide-search">
          <Search size={17} />
          <input
            aria-label="搜索 vNext 场景"
            placeholder="搜索场景、skill 或模式"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="筛选 vNext 场景"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">全部场景</option>
          {guideCategories.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <span role="status">{scenarios.length} 个场景</span>
      </div>
      {guideCategories.map((value) => {
        const group = scenarios.filter(
          (scenario) => scenario.category === value,
        );
        if (!group.length) return null;
        return (
          <section className="guide-group" key={value}>
            <h3>{value}</h3>
            {group.map((scenario) => (
              <Scenario key={scenario.id} scenario={scenario} />
            ))}
          </section>
        );
      })}
      {!scenarios.length && <p className="guide-no-match">没有匹配场景</p>}
      <section className="guide-notes">
        <h3>始终保留的边界</h3>
        <p>
          只规划、只审查、只读验证不会自动授权实现。重大目标、范围、验收或顺序变更应一次说明后果并确认；已有效的授权不重复索取。管理失败、过期视图或丢失回执不是重复业务操作的理由。
        </p>
        <p>
          报告真实版本、结果和未完成项；测试失败、未运行、记录成功或任务关闭都不能冒充验收通过。文档导航只证明登记，核对全部用户需求与设计仍需原始需求及确认依据。
        </p>
      </section>
    </article>
  );
}
