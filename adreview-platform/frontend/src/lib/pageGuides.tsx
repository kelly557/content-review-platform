import type { CSSProperties } from 'react'

export interface GuideSection {
  heading?: string
  markdown: string
}

export interface PageGuide {
  title: string
  sections: GuideSection[]
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
        '处置策略与审核结果分开,处置策略根据风险结果可以进行灵活设置。',
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

  '/admin/users': TBD,
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