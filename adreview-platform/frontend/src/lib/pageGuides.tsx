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

export const AGILE_PLAN_SECTIONS: GuideSection[] = [
  {
    heading: '计划概览',
    markdown:
      '**内容安全审核平台 · 30 个工作日 MVP 敏捷开发计划**\n\n'
      + '**开始日期**：2026-07-27（周一）\n\n'
      + '**结束日期**：2026-09-04（周五）\n\n'
      + '**周期**：30 个工作日 / 4 个 Sprint\n\n'
      + '**团队**：5 人（前后端全栈 1、ux 1、算法-大模型 1、算法-小模型 1、产品+测试 1）',
  },
  {
    heading: '总体目标',
    markdown:
      '提交者通过 **API 提交审核任务**,平台按策略自动跑五模态(文本 / 图片 / 音频 / 视频 / 文档)审核链路(L1 规则 + L2 小模型 + L3 大模型),输出风险决策与命中详情,并支持运营在策略管理后台配置、模型管理后台注册、账号管理维护、以及审核查结模块的数据查询 / 风险趋势 / 异常分析。\n\n'
      + '**MVP 范围（一期必做）**:\n\n'
      + '- **五模态自动审核全链路**:文本 / 图片 / 音频 / 视频 / 文档\n'
      + '- **策略管理后台**:增删改查 + 启停\n'
      + '- **策略编辑**:配置面板 + 审核 agent\n'
      + '- **模型管理**:大模型 + 小模型 注册 / 版本 / 启停\n'
      + '- **资源库管理**:词库 / 代答库 管理\n'
      + '- **账号管理 + RBAC**:多角色 + 权限矩阵\n'
      + '- **审核查结**:数据查询 / 风险趋势 / 异常分析',
  },
  {
    heading: 'Sprint 划分',
    markdown:
      '四个 Sprint 按"启动 → 引擎 → 多模态 + 查结 → 联调内测"推进:\n\n'
      + '- **S0 · Day 1-3 · 2026-07-27(周一) ~ 2026-07-29(周三)**:**主题** 启动 + 策略设计 + 架构设计;**里程碑** M0\n'
      + '- **S1 · Day 4-13 · 2026-07-30(周四) ~ 2026-08-12(周三)**:**主题** 引擎 + 策略 + 模型管理;**里程碑** **M1 · 2026-08-12**\n'
      + '- **S2 · Day 14-25 · 2026-08-13(周四) ~ 2026-08-28(周五)**:**主题** 视频 / 音频 / 文档 + 账号 + 审核查结;**里程碑** **M2 · 2026-08-28**\n'
      + '- **S3 · Day 26-30 · 2026-08-31(周一) ~ 2026-09-04(周五)**:**主题** 联调 + 内测;**里程碑** **M3 · 2026-09-04**',
  },
  {
    heading: '关键里程碑',
    markdown:
      '三个核心里程碑按"文本图片 → 五模态闭环 → MVP 发布"递进:\n\n'
      + '- **M1 · Day 13 · 2026-08-12(周三)**:**内容** 文本 / 图片自动审核 + 策略编辑 + 模型管理 Demo\n'
      + '- **M2 · Day 25 · 2026-08-28(周五)**:**内容** 五模态闭环 + RBAC + 审核查结 Demo\n'
      + '- **M3 · Day 30 · 2026-09-04(周五)**:**内容** MVP 内测发布 + 小流量试用',
  },
  {
    heading: '会议节奏',
    markdown:
      '- **每日站会**:每周一、周三 下午 1:30,15 分钟\n'
      + '- **Sprint 计划和同步**:Sprint 首日 09:00,1 小时',
  },
  {
    heading: 'Sprint 0 — 启动 + 策略设计(Day 1-3 · 2026-07-27 ~ 2026-07-29)',
    markdown:
      '**Sprint Goal**:把策略设计定稿,统一认知、搭好脚手架,让 Sprint 1 第一天就能进入开发。\n\n'
      + '- 启动会与范围锁定。\n'
      + '- 策略设计工作:定义策略的输入标签 / 风险标签 / 决策标签的分类与默认值。\n'
      + '- 架构定稿 + API 契约 + 数据库 Schema。\n'
      + '- Dev 环境就绪(PG / Redis / 模型镜像 / FFmpeg / 文档解析工具)。\n'
      + '- 前后端工程脚手架。',
  },
  {
    heading: 'Sprint 1 — 引擎 + 策略 + 模型管理(Day 4-13 · 2026-07-30 ~ 2026-08-12)',
    markdown:
      '**Sprint Goal**:文本 / 图片自动审核跑通;策略管理后台与模型管理可视化。\n\n'
      + '- 文本审核全链路(提交 → 策略 → L1 + L2 + L3 → 决策)。\n'
      + '- 图片审核全链路(OCR + 图小模型 + VLM)。\n'
      + '- 策略管理:增删改查 + 启停。\n'
      + '- 策略编辑:配置面板 + 审核 agent 配置。\n'
      + '- 模型管理:大模型 + 小模型 注册 / 启停 / 版本。\n'
      + '- 词库 / 代答库管理:词库的增删改查\n'
      + '- 审核结果查询(列表 + 详情)。\n'
      + '- 登录 + 角色路由守卫。\n\n'
      + '**M1 里程碑(Day 13 · 2026-08-12 周三)**\n\n'
      + '- 文本 / 图片自动决策 Demo。\n'
      + '- 策略编辑管理。\n'
      + '- 模型注册 / 启停演示。',
  },
  {
    heading: 'Sprint 2 — 视频 / 音频 / 文档 + 账号 + 审核查结(Day 14-25 · 2026-08-13 ~ 2026-08-28)',
    markdown:
      '**Sprint Goal**:五模态全部跑通;账号体系完整;审核查结可用。\n\n'
      + '- **视频审核全链路**:上传 + 抽帧(FFmpeg)+ 音轨 + 字幕 → 并行审核 → 合并决策。\n'
      + '- **音频审核全链路**:ASR + 后处理 → 走文本策略链路。\n'
      + '- **文档审核全链路**:文档解析 → 文本提取(含图片型 PDF OCR)→ 文本策略。\n'
      + '- **审核查结**:数据查询 / 风险趋势 / 异常分析。\n'
      + '- 策略编辑器补视频 / 音频 / 文档节点。\n'
      + '- 异步任务队列(简化版)。\n\n'
      + '**M2 里程碑(Day 25 · 2026-08-28 周五)**\n\n'
      + '- 五模态闭环 Demo(文本 / 图片 / 音频 / 视频 / 文档)。\n'
      + '- 角色切换验证权限差异。\n'
      + '- 审核查结模块查询 / 趋势 / 异常分析演示。',
  },
  {
    heading: 'Sprint 3 — 联调 + 内测(Day 26-30 · 2026-08-31 ~ 2026-09-04)',
    markdown:
      '**Sprint Goal**:全链路集成验证、Bug 清零、Demo 完美、文档齐备。\n\n'
      + '- 全链路端到端联调(提交 → 审核 → 决策 → 审核查结)。\n'
      + '- 性能压测与优化(并发 + 五模态混合)。\n'
      + '- Bug 修复。\n'
      + '- Demo 演示稿 + 流程演练。\n'
      + '- 部署文档 / API 文档。\n'
      + '- Sprint 回顾(Retro)。\n\n'
      + '**M3 里程碑(Day 30 · 2026-09-04 周五)**\n\n'
      + '- **MVP 内测发布**,小流量试用。\n'
      + '- Demo Day 演示通过。\n'
      + '- P0 / P1 Bug 关闭。\n'
      + '- 文档齐备。',
  },
]

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

const queryGuide: PageGuide = {
  title: '数据查询 · 原型说明',
  sections: [
    {
      heading: '数据查询需要的字段',
      markdown:
        '列表展示字段(按表格降级为列表,保持原顺序):\n\n'
        + '- **1. 审核模态**:图 / 文 / 语音 / 视频 / 文档\n'
        + '- **2. 策略名称**:审核策略名称\n'
        + '- **3. Request ID**:\n'
        + '- **4. 审核结果**:通过 / 阻断\n'
        + '- **5. 反馈结果**:漏过 / 误报\n'
        + '- **6. 请求时间**:\n'
        + '- **7. 操作**:详情 / 反馈\n'
        + '- **9. RequestId**:\n'
        + '- **10. Task ID**:\n'
        + '- **11. 素材内容**:\n'
        + '- **13. 风险标签**:label1 - abel2-label3\n'
        + '- **14. 风险等级**:高 / 中 / 低 / 无\n'
        + '- **15. IP**:\n'
        + '- **16. Account Id**:\n'
        + '- **17. 渠道**:模型输入 / 模型输出 / 小红书等用户自定义',
    },
  ],
}

const reportsGuide: PageGuide = {
  title: '数据报表 · 原型说明',
  sections: [
    {
      heading: '趋势分析',
      markdown:
        '**时间窗口**:今日 / 近 7 日 / 近 30 日\n\n'
        + '**筛选维度**:审核模态、策略名称、渠道、账号\n\n'
        + '**横坐标维度**:按小时、按天、按月\n\n'
        + '**计算公式**:某风险占比 = 该风险等级条数 / 所有风险等级条数之和(在所筛选的时间窗口和所选维度下)',
    },
    {
      heading: '异常分析',
      markdown:
        '**时间窗口**:近 1 小时 / 近 24 小时 / 近 7 日 / 近 30 日\n\n'
        + '**筛选维度**:审核模态、策略名称、渠道\n\n'
        + '**横坐标维度**:按小时、按天\n\n'
        + '**指标**:拒绝率、通过率、审核率\n\n'
        + '**异常指标**:拒绝率突升、高风险账号聚集',
    },
    {
      heading: '指标计算公式',
      markdown:
        '- **拒绝率** = 阻断的 request / 所有的 request\n'
        + '- **通过率** = 通过的 request / 所有的 request\n'
        + '- **审核率** = (阻断 + 通过) / 所有的 request\n'
        + '- **高风险阻断密度** = 阻断的 request(account) / 所有的 request(account)\n'
        + '- **高风险账号密度** = 风险账号(IP) / 所有账号(IP)',
    },
    {
      heading: '异常计算公式',
      markdown:
        '**MVP 阶段**:由于冷启动,将使用统计方法实现异常检测,后期将基于历史数据使用算法。\n\n'
        + '**拒绝率突升异常**\n\n'
        + '- **计算启动条件**:最小样本量——窗口内总检测数 ≥ 50 才计算\n'
        + '- **1. 固定业务阈值**:在选定的时间窗口和筛选维度下,拒绝率 > 5%(用户可根据检测规则配置)\n'
        + '- **2. Z-score**(暂定)\n\n'
        + '**高风险账号聚集异常**\n\n'
        + '- **1. 单账号的异常**:账号高风险阻断异常 = 指定时间窗口 / 维度内,高风险请求次数 / 总请求次数 > 30% **且** 请求次数 > 20\n'
        + '- **2. IP 的多账号聚集异常**:高风险账号聚集异常 = 指定时间窗口 / 维度内,高风险账号数(IP) / 所有账号数(IP) > 50% **且** 账号数 > 5',
    },
    {
      heading: '严重度分级',
      markdown: '正常、提醒、严重。',
    },
    {
      heading: '监测流程',
      markdown:
        '```\n'
        + '请求日志\n'
        + '      │\n'
        + '      -->\n'
        + '按维度聚合(渠道、审核模态、策略名称)\n'
        + '      │\n'
        + '      -->\n'
        + '按时间窗口统计(近 1 小时 / 近 24 小时 / 近 7 日 / 近 30 日)\n'
        + '      │\n'
        + '      -->\n'
        + '指标计算\n'
        + '      │\n'
        + '      ├── 拒绝率\n'
        + '      ├── 通过率\n'
        + '      ├── 审核率\n'
        + '      |----- 高风险阻断密度\n'
        + '      |----- 高风险账号密度\n'
        + '      │\n'
        + '      -->\n'
        + '异常检测\n'
        + '      ├── 拒绝率突升\n'
        + '      ├── 高风险账号异常聚集\n'
        + '      │\n'
        + '      -->\n'
        + '告警\n'
        + '```',
    },
    {
      heading: '检测规则配置',
      markdown:
        '```\n'
        + '规则名              | 指标            | 时间窗口  | 维度      | 算法     | 严重程度                                      | 状态\n'
        + '------------------ | -------------- | -------- | -------- | -------- | -------------------------------------------- | ----\n'
        + '拒绝率异常          | 拒绝率          | 近 1 小时 | 审核模态  | 固定阈值  | > 5% 严重;> 3% 提醒                          | 启用\n'
        + '账号高风险阻断异常   | 高风险阻断密度   | 近 1 小时 | 全局      | 固定阈值  | > 30% 严重;> 20% 提醒;& count > 20           | 启用\n'
        + '高风险账号聚集异常   | 高风险账号密度   | 近 1 小时 | 全局      | 固定阈值  | > 50% 严重;> 30% 提醒;& account count > 5   | 启用\n'
        + '```',
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
            heading: '舆情事件应急处理流程图',
            markdown: '![舆情事件应急处理流程图](/page-guides/public-opinion-emergency.png)',
          },
          {
            heading: '舆情事件应急处理要点',
            markdown:
              '应急处理流程图完整版,展示周期性舆情事件的完整分类与双方协作路径,保留全部敏感词参考(12.01 朱德诞辰 / 12.04 国家宪法日 / 12.10 国际人权日 / 12.26 毛泽东诞辰 等)。\n\n'
              + '- **周期性舆情事件分类**:分两类——**重大事件专项**(六月专项 / 网信办专项 / 全公司专项 / 三十专项 / 重大专项 等)+ **当月专项**(日历视图标注每天关联的专项,涉政 / 法日 / 国日 / 反感 等主题与文案提前列出)\n'
              + '- **双方协作流程**(迈富时 ↔ 客户):**临近期重大专项前一周** → 客户**确认是否专项调整** → 若是 → 双方协作:迈富时**整理专项相关策略与名单** → 不满足 → 客户**确认是否专项调整** 循环;满足 → 迈富时**实验环境验证有效性与影响** → 满足 → **策略与名单上线** → 迈富时**每日效果监测** → **流程结束**\n\n'
              + '仅供内部审计、应急演练与策略联调用;对外分享前需对敏感词部分进行脱敏处理。',
          },
        ],
      },
      {
        key: 'agile',
        label: '30天 MVP 计划',
        sections: [...AGILE_PLAN_SECTIONS],
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

const tagsAdminGuide: PageGuide = {
  title: '标签管理 · 原型说明',
  sections: [
    {
      heading: '业务标签-小模型标签-小模型的业务流程',
      markdown:
        '1.小模型管理的新增模型页面，有一个"接入校验"按钮，点击时，返回当前模型服务的模型标签\n'
        + '2.后端预置"接入校验"的逻辑，预置默认的文本/图片模态测试数据\n'
        + '3.接入校验正常，保存新增模型后，模型详情页的模型标签自动填入检测到的模型标签\n'
        + '4.基于模型标签匹配业务标签,已经匹配的标签不能再次被选择\n'
        + '5.小模型详情页测试模型的返回接口要返回已经映射好的业务标签\n'
        + '6.标签管理页面只负责启用和新增业务标签',
    },
  ],
}

const modelAdminSmallGuide: PageGuide = {
  title: '模型管理 · 小模型 · 原型说明',
  sections: [
    {
      heading: '设计说明',
      markdown:
        '小模型管理用于管理审核平台中所有小模型，提供模型注册、版本管理、'
        + '模型测试、发布上线及模型引用查看等能力，支撑标签管理和策略管理调用。\n\n'
        + '**遵循职责划分：**\n\n'
        + '- **模型管理**：管理模型资产及生命周期\n'
        + '- **标签管理**：管理标签与模型绑定关系\n'
        + '- **策略管理**：管理实际生效的风险阈值及处置策略\n\n'
        + '> 模型管理不负责业务策略配置，仅维护模型推荐参数。',
    },
    {
      heading: '关于「模型删除」设计',
      markdown:
        '从业务（审计溯源）和需求紧急度考虑，第一期暂时不提供删除功能的设计，'
        + '即使删除也是软删除：因为在内容安全审核场景里，模型是生产资产：\n\n'
        + '- 被标签引用\n'
        + '- 被策略引用\n'
        + '- 有历史审核记录\n'
        + '- 有回滚依赖\n\n'
        + '如果允许「删除」，非常容易造成：\n\n'
        + '- 标签失效（找不到模型）\n'
        + '- 策略配置悬空\n'
        + '- 历史审核结果无法追溯\n'
        + '- 回滚链路断裂',
    },
    {
      heading: '后续迭代：归档与删除矩阵',
      markdown:
        '完善小模型资源的全生命周期管理，即 **注册、测试、发布、下线、归档、删除**。\n\n'
        + '归档后能力对比：\n\n'
        + '- **接收请求**：在线 ✓ ｜ 归档 ✗\n'
        + '- **允许绑定标签**：在线 ✓ ｜ 归档 ✗\n'
        + '- **允许策略引用**：在线 ✓ ｜ 归档 ✗\n'
        + '- **历史记录**：在线 ✓ ｜ 归档 ✓\n\n'
        + '**真正删除**仅超级管理员开放，并需满足：\n\n'
        + '- 无标签引用\n'
        + '- 无策略引用\n'
        + '- 无在线版本\n\n'
        + '> 避免影响审核业务。',
    },
    {
      heading: '状态说明',
      markdown:
        '**已发布：**\n\n'
        + '- 正在提供服务\n'
        + '- 可被标签绑定\n'
        + '- 可被策略引用\n\n'
        + '**未发布：**\n\n'
        + '- 不能接收新请求\n'
        + '- 不允许新标签绑定\n'
        + '- 测试通过后可以发布\n\n'
        + '**已下线：**\n\n'
        + '- 不再接收新请求\n'
        + '- 不允许新标签绑定\n'
        + '- 历史数据仍可查询\n'
        + '- 可以回滚上线\n\n'
        + '**已归档：**\n\n'
        + '- 不可恢复为在线（需重新发布）\n'
        + '- 不允许任何新引用\n'
        + '- 仅用于历史追溯\n'
        + '- 可申请删除',
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

  '/reports': reportsGuide,
  '/query': queryGuide,

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

  '/admin/tags': tagsAdminGuide,

  '/tags': TBD,
  '/human-review-rules': TBD,

  '/admin/models/small': modelAdminSmallGuide,
  '/admin/models/large': TBD,

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