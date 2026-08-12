import { useEffect, useState } from 'react'
import { Empty, Space, Spin, Switch, Typography } from 'antd'
import { reviewAgentsApi, type ReviewAgent } from '@/api/reviewAgents'

const { Text } = Typography

/** cat.key → review_agents.modality 映射 (图文智能体在文本/图片两个 tab 都显示) */
const CATEGORY_TO_MODALITIES: Record<string, string[]> = {
  text: ['文本', '图文'],
  image: ['图片', '图文'],
  audio: ['音频'],
  video: ['视频'],
  doc: ['文档'],
}

interface Props {
  /** 当前 tab 的 cat.key，用于过滤 modality */
  categoryKey: string
  /** 已启用的 agent id 列表（由父级 definition.review_agent_ids 持有） */
  enabledAgentIds: number[]
  /** 切换开关时通知父级更新 definition.review_agent_ids */
  onToggleAgent: (agentId: number, checked: boolean) => void
}

/**
 * 审核智能体卡片列（按模态拉取已发布智能体）。
 *
 * - 数据源：review_agents 表（status=已发布），按当前 tab 的 cat.key 过滤 modality
 * - 展示：每张卡片 = Switch 开关 + 智能体名称
 * - 状态：开关状态由父级 enabledAgentIds 驱动，切换时通知父级更新 definition
 */
export default function ReviewAgentCardsColumn({
  categoryKey,
  enabledAgentIds,
  onToggleAgent,
}: Props) {
  const [agents, setAgents] = useState<ReviewAgent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    reviewAgentsApi
      .list()
      .then((list) => {
        if (cancel) return
        const modalities = CATEGORY_TO_MODALITIES[categoryKey] ?? []
        setAgents(
          list.filter(
            (a) => a.status === '已发布' && modalities.includes(a.modality),
          ),
        )
      })
      .catch(() => {
        if (!cancel) setAgents([])
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [categoryKey])

  const enabledSet = new Set(enabledAgentIds)

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
          审核智能体
        </Text>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            color: '#94A3B8',
            lineHeight: 1.6,
            fontWeight: 500,
          }}
        >
          {agents.length}
        </span>
      </div>

      {loading ? (
        <Spin size="small" style={{ margin: '12px 0' }} />
      ) : agents.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无已发布的审核智能体"
          style={{ padding: '24px 0' }}
        />
      ) : (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {agents.map((agent) => {
            const enabled = enabledSet.has(agent.id)
            return (
              <div
                key={agent.id}
                style={{
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <Switch
                  checked={enabled}
                  onChange={(checked) => onToggleAgent(agent.id, checked)}
                  aria-label={`启用审核智能体 ${agent.name}`}
                />
                <Text strong style={{ fontSize: 15, color: '#0F172A' }}>
                  {agent.name}
                </Text>
              </div>
            )
          })}
        </Space>
      )}
    </div>
  )
}
