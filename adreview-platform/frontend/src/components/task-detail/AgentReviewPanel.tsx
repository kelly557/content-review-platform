import { Alert, Badge, Button, Empty, Space, Statistic, Tabs, Tag, Tooltip, Typography } from 'antd'
import {
  AlertOutlined,
  PlayCircleOutlined,
  TagOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
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

const CHIP_BG: Record<string, string> = {
  高风险: colors.dangerSoft,
  中风险: colors.warningSoft,
  低风险: colors.successSoft,
  敏感: colors.accentSoft,
  无风险: colors.surface2,
}

export default function AgentReviewPanel({
  result,
  task,
  onTriggerMachineReview,
  triggering,
}: Props) {
  const canTrigger =
    task && task.review_type === 'machine' && task.machine_status === 'pending'

  if (!result) {
    return (
      <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
        {canTrigger ? (
          <div style={{ textAlign: 'center', padding: '40px 16px' }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="AI 审核尚未执行" />
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
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="后端尚未提供 Agent 审核结果" />
        )}
      </div>
    )
  }

  const { risk_level, hits, rule_hits, summary, finished_at } = result
  const suggestion = suggestAction(risk_level)
  const uniqueServiceNames = Array.from(
    new Set(hits.map((h) => h.service_name || h.service_code).filter(Boolean) as string[]),
  )

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Space size={10} align="center">
            <Tag
              color={RISK_COLOR[risk_level]}
              style={{
                fontSize: 13,
                padding: '2px 10px',
                background: CHIP_BG[risk_level] ?? colors.dangerSoft,
                borderColor: RISK_COLOR[risk_level],
              }}
            >
              AI 结论 · {risk_level}
            </Tag>
            <Badge count={hits.length} showZero color={hits.length > 0 ? colors.destructive : colors.mutedSoft}>
              <Text type="secondary" style={{ fontSize: 12 }}>命中</Text>
            </Badge>
            <Text type="secondary" style={{ fontSize: 12 }}>
              完成于 {new Date(finished_at).toLocaleString('zh-CN')}
            </Text>
          </Space>
          <Statistic
            title="命中条数"
            value={hits.length}
            valueStyle={{
              fontSize: 22,
              color: hits.length > 0 ? colors.destructive : colors.primary,
            }}
          />
        </div>

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
                    <Tag key={s} style={{ margin: 0 }}>{s}</Tag>
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

        {/* Consolidated tabs: hits (default) + rules + a single 详情 tab for the
            remaining info previously split across 4 tabs. */}
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
                        <Text
                          style={{
                            fontSize: 12,
                            color: r.matched ? colors.destructive : colors.mutedSoft,
                          }}
                        >
                          {r.matched ? '已触发' : '未触发'}
                        </Text>
                      </div>
                    ))}
                  </div>
                ),
            },
            ...(result.strategy
              ? [
                  {
                    key: 'detail',
                    label: (
                      <span>
                        <TagOutlined /> 详情
                      </span>
                    ),
                    children: (
                      <div style={{ padding: '8px 4px' }}>
                        <Tooltip title="策略名称即 score 计算的元规则集">
                          <Text>本任务依据策略 </Text>
                          <Text strong>{result.strategy.name}</Text>
                          <Text>（{result.strategy.code}）</Text>
                        </Tooltip>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Space>
    </div>
  )
}
