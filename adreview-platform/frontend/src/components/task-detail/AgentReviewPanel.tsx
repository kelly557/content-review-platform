import { Alert, Button, Empty, Space, Statistic, Tabs, Tag, Typography } from 'antd'
import { AlertOutlined, FileSearchOutlined, PlayCircleOutlined, TagOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { AgentReviewResult, ReviewTask } from '@/types/domain'
import { RISK_COLOR, suggestAction } from '@/lib/risk'
import { colors } from '@/styles/theme'

const { Text } = Typography

interface Props {
  result: AgentReviewResult | null | undefined
  task?: ReviewTask
  onTriggerMachineReview?: () => void
  triggering?: boolean
}

export default function AgentReviewPanel({ result, task, onTriggerMachineReview, triggering }: Props) {
  const canTrigger = task && task.review_type === 'machine' && task.machine_status === 'pending'

  if (!result) {
    return (
      <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
        {canTrigger ? (
          <div style={{ textAlign: 'center', padding: '40px 16px' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="AI 审核尚未执行"
            />
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={triggering}
              onClick={onTriggerMachineReview}
              style={{ marginTop: 16 }}
            >
              执行 AI 审核
            </Button>
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="后端尚未提供 Agent 审核结果"
          />
        )}
      </div>
    )
  }

  const { risk_level, hits, rule_hits, strategy, summary, finished_at } = result
  const suggestion = suggestAction(risk_level)
  const uniqueServiceNames = Array.from(
    new Set(hits.map((h) => h.service_name || h.service_code).filter(Boolean) as string[]),
  )

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space align="center" size={12} style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>AI 审核结论</Text>
            <div style={{ marginTop: 4 }}>
              <Tag color={RISK_COLOR[risk_level]} style={{ fontSize: 14, padding: '2px 10px' }}>
                {risk_level}
              </Tag>
            </div>
          </div>
          <Statistic
            title="命中条数"
            value={hits.length}
            valueStyle={{ fontSize: 22, color: hits.length > 0 ? colors.destructive : colors.primary }}
          />
        </Space>

        <Alert
          type={suggestion.tone}
          showIcon
          message={suggestion.label}
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span>{suggestion.reason}</span>
              {uniqueServiceNames.length > 0 && (
                <Space size={4} wrap>
                  <Text type="secondary" style={{ fontSize: 12 }}>命中服务：</Text>
                  {uniqueServiceNames.slice(0, 4).map((s) => (
                    <Tag key={s} style={{ margin: 0 }}>
                      {s}
                    </Tag>
                  ))}
                  {uniqueServiceNames.length > 4 && (
                    <Tag style={{ margin: 0 }}>+{uniqueServiceNames.length - 4}</Tag>
                  )}
                </Space>
              )}
            </Space>
          }
        />

        {summary && (
          <div
            style={{
              border: `1px solid ${colors.border}`,
              background: colors.surface2,
              borderRadius: 6,
              padding: 10,
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {summary}
          </div>
        )}

        <Text type="secondary" style={{ fontSize: 12 }}>
          审核时间：{new Date(finished_at).toLocaleString('zh-CN')}
          {strategy && (
            <>
              {' · '}
              <Tag color="blue" style={{ marginLeft: 4 }}>{strategy.name}</Tag>
            </>
          )}
        </Text>

        <Tabs
          size="small"
          items={[
            {
              key: 'hits',
              label: (
                <span>
                  <AlertOutlined /> 命中片段 ({hits.length})
                </span>
              ),
              children:
                hits.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无命中" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {hits.map((h, i) => (
                      <div
                        key={i}
                        style={{
                          border: `1px solid ${colors.border}`,
                          borderRadius: 6,
                          padding: 10,
                          background: colors.surface,
                        }}
                      >
                        <Space size={6} wrap>
                          <Tag color="red">{h.label_cn}</Tag>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {h.service_name || h.service_code}
                          </Text>
                          <Tag>置信度 {(h.score * 100).toFixed(0)}%</Tag>
                        </Space>
                        {h.quote && (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 13,
                              color: colors.textSecondary,
                              borderLeft: `3px solid ${colors.destructive}`,
                              paddingLeft: 8,
                              background: colors.dangerSoft,
                              padding: '4px 8px',
                            }}
                          >
                            “{h.quote}”
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ),
            },
            {
              key: 'rules',
              label: (
                <span>
                  <ThunderboltOutlined /> 规则 ({rule_hits.length})
                </span>
              ),
              children:
                rule_hits.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无规则命中" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rule_hits.map((r) => (
                      <div
                        key={r.rule_id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          border: `1px solid ${colors.border}`,
                          borderRadius: 4,
                          fontSize: 13,
                        }}
                      >
                        <Space>
                          <Tag color={r.matched ? 'red' : 'default'} style={{ margin: 0 }}>
                            {r.label_cn}
                          </Tag>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            阈值 {r.threshold}
                          </Text>
                        </Space>
                        <Text style={{ fontSize: 12, color: r.matched ? colors.destructive : colors.mutedSoft }}>
                          {r.matched ? '已触发' : '未触发'}
                        </Text>
                      </div>
                    ))}
                  </div>
                ),
            },
            {
              key: 'wordlist',
              label: (
                <span>
                  <FileSearchOutlined /> 命中词
                </span>
              ),
              children: (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未对接词库明细" />
              ),
            },
            {
              key: 'strategy',
              label: (
                <span>
                  <TagOutlined /> 策略依据
                </span>
              ),
              children: strategy ? (
                <div>
                  <Text>本任务依据策略 </Text>
                  <Text strong>{strategy.name}</Text>
                  <Text>（{strategy.code}）</Text>
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无策略信息" />
              ),
            },
          ]}
        />
      </Space>
    </div>
  )
}