import type { CSSProperties } from 'react'

export interface GuideSection {
  heading?: string
  markdown: string
}

export interface GuideTab {
  key: string
  label: string
  sections: GuideSection[]
}

export interface PageGuide {
  title: string
  sections: GuideSection[]
  tabs?: GuideTab[]
}

export const codeStyle: CSSProperties = {
  padding: '0 6px',
  margin: '0 2px',
  background: 'rgba(0,0,0,0.06)',
  borderRadius: 4,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: '0.92em',
}

const TBD: PageGuide = {
  title: '原型说明',
  sections: [
    {
      heading: '页面定位',
      markdown: 'TODO — 描述这个页面在产品里负责什么、给谁用。',
    },
    {
      heading: '关键产品逻辑',
      markdown: 'TODO — 列出 2~5 条核心规则,比如「列表默认按更新时间倒序」「状态切换要走二次确认」等。',
    },
    {
      heading: '操作流程',
      markdown: 'TODO — 简要写主要操作的步骤或入口。',
    },
    {
      heading: '数据口径',
      markdown: 'TODO — 说明本页涉及字段的定义 / 联动关系 / 限制。',
    },
  ],
}

const FILLED: Record<string, PageGuide> = {
  '/overview': {
    title: '总览 · 原型说明',
    sections: [
      {
        heading: '页面定位',
        markdown: '登录后的首屏。给所有角色一个"我今天要做什么"的入口,不做业务操作。',
      },
      {
        heading: '关键产品逻辑',
        markdown:
          '- 按角色展示不同的快捷入口(审核员看"待审队列",管理员看"策略/规则")。\n- 欢迎语取自当前登录用户的姓名,日期取浏览器本地时区。',
      },
    ],
    tabs: [
      {
        key: 'overview',
        label: '业务说明',
        sections: [
          {
            heading: '页面定位',
            markdown: '登录后的首屏。给所有角色一个"我今天要做什么"的入口,不做业务操作。',
          },
          {
            heading: '关键产品逻辑',
            markdown:
              '- 按角色展示不同的快捷入口(审核员看"待审队列",管理员看"策略/规则")。\n- 欢迎语取自当前登录用户的姓名,日期取浏览器本地时区。',
          },
          {
            heading: 'Notes',
            markdown:
              '## 南京项目对接时间线：10月底\n\n'
              + '业务指标：\n\n'
              + '1. 准确率高达 90% 以上（第一期的审核指标，重点关注小模型效果）\n'
              + '2. 网信办法律法规要求，无风险情况下模型的拒答率低于 5%\n'
              + '3. 模型输入/输出的性能要求（参考数美科技）\n\n'
              + '响应：50-80ms',
          },
        ],
      },
      {
        key: 'flow',
        label: '业务流程',
        sections: [
          {
            heading: '模型审核全景图',
            markdown: '![审核服务全景图](/page-guides/overview-flow.png)',
          },
          {
            heading: '一句话概括',
            markdown:
              '用户侧输入(AI问答 / Agent / 剧情类多场景)→ 审核服务(输入接口 → 风险模型 → 风险决策引擎 + 安全知识库 + 安全大模型)→ 大模型应用(Query 分类 → 输出柔性拒答 / 代替答案 / 大模型答案)→ 输出审核接口(共用风险模型 + 风险决策引擎2)。',
          },
          {
            heading: '模型输出的流式长文本审核策略',
            markdown: '![模型输出的流式长文本审核策略](/page-guides/streaming-text-audit.png)',
          },
          {
            heading: '流式长文本审核要点',
            markdown:
              '针对大模型输出长文本场景,安审引擎按句切片审核:\n\n'
              + '- **首句**:截前 200 字符做初审(40ms 内完成),`reject` → 删除回答停止送审,`pass` → 显示回答并继续切片\n'
              + '- **后续句**:截前 2000 字符切片审核(每片约 500ms),`reject` → 删除所有已生成回答停止送审,`pass` → 继续切片送审\n'
              + '- **结束**:模型流式输出结束后,审核链路整体结束',
          },
          {
            heading: '审核流程配置示意',
            markdown: '![审核流程配置示意图](/page-guides/audit-flow-overview.png)',
          },
          {
            heading: '审核流程配置要点',
            markdown:
              '审核流程主链路(场景 → 进审 → 处置)由四个环节串联:\n\n'
              + '- **场景**:覆盖文本对话输入 / 模型文本输出 / AI 美化图片 等多模态输入,按场景路由到对应审核链路\n'
              + '- **机审进审逻辑**:由机审引擎按命中策略判断是否需要继续走到人工审核\n'
              + '- **审核策略**:决定走机审 / 人审 / 处置的策略模板(命中后回灌到机审结果)\n'
              + '- **人审进审逻辑**:对机审结果有疑义的内容进入人审环节\n'
              + '- **处置方案**:综合机审 + 人审结果,给出最终处置(通过 / 拦截 / 下架 / 封号 / 敏感代答等)',
          },
          {
            heading: '人工审核与处置配置全流程',
            markdown: '![人工审核和处置配置全流程](/page-guides/manual-review-disposition-flow.png)',
          },
          {
            heading: '人工审核与处置配置要点',
            markdown:
              '完整流程从原始内容开始,经场景路由 → 策略匹配 → AI 审核 → 抽审/全量人工审核 → 处置配置:\n\n'
              + '- **场景 → 选择审核策略**:基于内容类型(文本 / 图片 / 音频 / 视频 / 文档 / 结构化数据)路由到对应审核策略\n'
              + '- **AI 审核结果 → 处置分流**:高风险 / 中风险 / 低风险 / 敏感 各自走不同处置分支\n'
              + '- **用户自定义审查范围**:用户可自行定义哪些内容进入人审(如「全部送人审」 / 「内容自审核不通过」 / 「用户 p1 = 封禁 / 禁言 / 上架 / 下架」)\n'
              + '- **抽审规则**:AI 审核结果是否抽审 → 配置抽审规则(按 media 类型 / 按比例 / 命中后送审等)\n'
              + '- **人工审核 → 结果一致时**:AI 结果与人审一致,以人审结果为最终结果\n'
              + '- **人工审核 → 结果不一致时**:以人工结果为准,并支持以人工处置结果为最终结论\n'
              + '- **结束处置配置**:统一汇总后回写到处置方案,落地到素材 / 账号 / 内容',
          },
          {
            heading: '舆情事件处理流程',
            markdown: '![舆情事件处理流程](/page-guides/public-opinion-incident.png)',
          },
          {
            heading: '舆情事件处理要点',
            markdown:
              '周期性舆情事件按"分类识别 + 双方协作"两步推进:\n\n'
              + '- **周期性舆情事件分类**:分两类——**重大事件专项**(六月专项 / 网信办专项 / 全公司专项 / 三十专项 / 重大专项 等)+ **当月专项**(日历视图标注每天关联的专项,涉政 / 法日 / 国日 / 反感 等主题与文案提前列出)\n'
              + '- **双方协作流程**(迈富时 ↔ 客户):**临近期重大专项前一周** → 客户**确认是否专项调整** → 若是 → 双方协作:迈富时**整理专项相关策略与名单** → 不满足 → 客户**确认是否专项调整** 循环;满足 → 迈富时**实验环境验证有效性与影响** → 满足 → **策略与名单上线** → 迈富时**每日效果监测** → **流程结束**',
          },
        ],
      },
    ],
  },

  '/strategies/agents': {
    title: '审核智能体 · 原型说明',
    sections: [
      {
        heading: '页面定位',
        markdown: '「文本/图像/图文/音频/视频」类智能审核能力的统一管理页(superadmin / root_admin 可见)。',
      },
      {
        heading: '关键产品逻辑',
        markdown:
          '- 智能体有三种状态:已发布 / 未发布 / 已下线,只有"已发布"才会被审核链路实际调用。\n- AI 优化结果当前为原型实现,会显示 toast「(原型,引用 X 份解析文档)」。\n- 同一时刻一个智能体只能有一个"线上版本",再次发布会顶替旧版本。',
      },
      {
        heading: '操作流程',
        markdown: '新建 → 配置提示词 & 模型 → 调试运行 → 发布。',
      },
    ],
  },
}

const onlineReviewGuide: PageGuide = {
  title: '在线审核 · 原型说明',
  sections: [
    {
      heading: '页面定位',
      markdown:
        '当前「在线审核结果」卡片展示的是 mock 数据,真实结果会基于技术方案中的接口进行渲染。',
    },
    {
      heading: '数据类型与大小限制',
      markdown: '待定 — 需要进一步细化。',
    },
    {
      heading: 'Request 建议字段',
      markdown:
        '- `strategy_id`\n' +
        '- `data_type`\n' +
        '- `data_id`\n' +
        '- `info_type` — 辅助信息,如图片审核时的人物信息、logo\n' +
        '- `account_id` (option)',
    },
    {
      heading: 'Response 建议字段',
      markdown:
        '- `request_id`\n' +
        '- `task_id`\n' +
        '- `strategy_id`\n' +
        '- `log_id`\n' +
        '- `label`\n' +
        '- `sub_label`\n' +
        '- `sub_label_description`\n' +
        '- `confidence`\n' +
        '- `risk_level`\n' +
        '- `account_id`\n' +
        '- `usage` — llm\n' +
        '- `customized_words`\n' +
        '- 命中的 `data` 位置信息与内容片段',
    },
    {
      heading: 'Notes',
      markdown:
        '审核模型时,需要额外传 `token_id` 与 `session_id`。',
    },
  ],
}

const usersAdminGuide: PageGuide = {
  title: '账号管理 · 原型说明',
  sections: [
    {
      heading: '本期范围',
      markdown:
        '一期先建立 `super_admin` / `admin` / `user` 三种角色的账号,'
        + '角色元数据与菜单权限请前往「角色管理」「权限管理」页面。',
    },
  ],
}

const auditPointGuide: PageGuide = {
  title: '审核点 · 原型说明',
  sections: [
    {
      heading: '字段统一说明',
      markdown:
        '为了方便理解、贴近竞品和客户认知习惯,平台统一了审核相关字段的命名,本文集中说明这套口径。',
    },
    {
      heading: '风险标签体系',
      markdown:
        '审核内容风险分为 `labels`(一级风险标签)和 `sub_label`(二级细分标签)。可根据细分标签的具体值,判断该内容是否通过或被拦截。\n\n' +
        '- **一级风险标签 — Label**\n  审核项、审核规则、风险类型统一使用一级风险标签。\n  例如:涉政、涉黄。\n\n' +
        '- **二级风险标签 — Sub label**\n  审核点统一使用二级标签,格式为「一级类别_二级类别」。\n  例如:涉政_现任国家主席。',
    },
    {
      heading: '核心字段定义',
      markdown:
        '- `sub_label_description` — 风险描述\n  取代旧的「审核说明 / 审核描述」,统一为风险描述 sub_label_description。\n\n' +
        '- `Confidence` — 置信分值\n  Float,范围 0–100,保留到小数点后 2 位。\n\n' +
        '- `RiskLevel` — 当前标签的风险等级\n  根据设置的高低风险阈值映射,返回值包括:high(高风险)、medium(中风险)、low(低风险)、none(未检测到风险)。',
    },
    {
      heading: '处置策略(当前为纯 AI)',
      markdown:
        '- **高风险** — 建议直接处置。\n\n' +
        '- **中风险** — 建议人工复查;纯 AI 场景下与高风险同等处置。\n\n' +
        '- **低风险** — 建议在高召回需求时再做处理,日常与「未检测到风险」按相同方式处理。\n\n' +
        '- **大模型专属**\n  - `high` — 高风险\n  - `none` — 未检测到风险\n\n' +
        '处置策略与审核结果分开,处置策略根据风险结果可以进行灵活设置。\n\n' +
        '---\n\n' +
        '分开的原因是处置策略二期计划如下:\n\n' +
        '1. 添加人工审核功能,用户可以选择是否启用人工审核。\n\n' +
        '2. 处置结果(不限于当前):\n' +
        '   - 通过\n' +
        '   - 拦截(例如:模型安全防护)\n' +
        '   - 下架(例如:宣传海报处理)\n' +
        '   - 封号(例如:危险的用户账号)\n' +
        '   - 敏感代答回复',
    },
  ],
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  ...FILLED,
  '/online-review': onlineReviewGuide,
  '/materials': TBD,
  '/materials/:id': TBD,
  '/tasks/:id': TBD,
  '/tasks/package/:id': TBD,

  '/reports': TBD,
  '/query': TBD,

  '/strategies': TBD,
  '/strategies/new': auditPointGuide,
  '/strategies/:id/edit': auditPointGuide,
  '/strategies/rules/:serviceCode': TBD,

  '/rules/audit/:mediaType': TBD,
  '/rules/general/:mediaType': TBD,
  '/rules/general/:mediaType/:itemId': TBD,
  '/rules/personal/:mediaType': TBD,
  '/rules/personal/:mediaType/:itemId': TBD,
  '/rules/personal/:mediaType/:itemId/points': TBD,
  '/rules/personal/:mediaType/new': TBD,

  '/resources/words': TBD,
  '/resources/words/:id': TBD,
  '/resources/replies': TBD,
  '/resources/replies/:id': TBD,
  '/resources/models': TBD,
  '/resources/models/:id': TBD,
  '/resources/providers/:id': TBD,
  '/resources/knowledge': TBD,
  '/resources/knowledge/:id': TBD,
  '/resources/images': TBD,
  '/resources/images/:id': TBD,

  '/packages/:code/items': TBD,
  '/packages/:code/items/new': TBD,
  '/packages/:code/items/:itemId/points': TBD,
  '/packages/:code/items/:itemId/points/new': auditPointGuide,
  '/packages/:code/items/:itemId/points/:pointId': auditPointGuide,

  '/triggers': TBD,
  '/triggers/new': TBD,
  '/triggers/:id': TBD,

  '/admin/users': usersAdminGuide,
  '/admin/roles': TBD,

  '/tags': TBD,
  '/human-review-rules': TBD,

  '/import-rules': TBD,
}

export function findGuide(pathname: string): PageGuide | null {
  if (PAGE_GUIDES[pathname]) return PAGE_GUIDES[pathname]

  const keys = Object.keys(PAGE_GUIDES).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    const segs = k.split('/').filter(Boolean)
    const pathSegs = pathname.split('/').filter(Boolean)
    if (segs.length !== pathSegs.length) continue
    let ok = true
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (s.startsWith(':')) continue
      if (s !== pathSegs[i]) {
        ok = false
        break
      }
    }
    if (ok) return PAGE_GUIDES[k]
  }
  return null
}

export interface ParsedGuideDraft {
  sections: GuideSection[]
  tabs?: GuideTab[]
}

const TAB_HEADING_RE = /^# Tab:\s*(.+?)\s*$/

function slugifyTabLabel(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '') || `tab-${Math.random().toString(36).slice(2, 8)}`
  )
}

function blockToSection(block: string): GuideSection {
  const lines = block.split('\n')
  if (lines[0]?.startsWith('## ')) {
    return {
      heading: lines[0].slice(3).trim(),
      markdown: lines.slice(1).join('\n').trim(),
    }
  }
  return { markdown: block.trim() }
}

function sectionToBlock(s: GuideSection): string {
  return s.heading ? `## ${s.heading}\n${s.markdown}` : s.markdown
}

export function guideToDraft(g: PageGuide): string {
  if (g.tabs && g.tabs.length > 0) {
    return g.tabs
      .map((t) => {
        const head = `# Tab: ${t.label}`
        const body = t.sections.map(sectionToBlock).join('\n\n---\n\n')
        return body ? `${head}\n\n${body}` : head
      })
      .join('\n\n\n\n')
  }
  return g.sections.map(sectionToBlock).join('\n\n---\n\n')
}

export function draftToGuide(raw: string): ParsedGuideDraft {
  const tabBlocks = raw.split(/\n{4,}/)
  const firstLineOf = (b: string) => b.split('\n')[0] ?? ''

  const hasAnyTab = tabBlocks.some((b) =>
    TAB_HEADING_RE.test(firstLineOf(b)),
  )

  if (!hasAnyTab) {
    return { sections: raw.split(/\n\n---\n\n/).map(blockToSection) }
  }

  const tabs: GuideTab[] = []
  for (const b of tabBlocks) {
    const m = firstLineOf(b).match(TAB_HEADING_RE)
    if (!m) continue
    const rest = b.split('\n').slice(1).join('\n').trim()
    const sections = rest
      ? rest.split(/\n\n---\n\n/).map(blockToSection)
      : []
    tabs.push({
      key: slugifyTabLabel(m[1]),
      label: m[1].trim(),
      sections,
    })
  }
  return { sections: [], tabs }
}