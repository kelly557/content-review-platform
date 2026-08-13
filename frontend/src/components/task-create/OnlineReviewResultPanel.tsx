import { Alert, Collapse, Spin, Tag, Typography } from 'antd'
import JsonTreeView from './JsonTreeView'
import type { OnlineReviewRequest, OnlineReviewResponse } from '@/api/onlineReviewTypes'
import { colors } from '@/styles/theme'

const { Text } = Typography

const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export type OnlineReviewResultState = 'idle' | 'loading' | 'done' | 'error'

export interface OnlineReviewResultPanelProps {
  state: OnlineReviewResultState
  request?: OnlineReviewRequest
  response?: OnlineReviewResponse
  latencyMs?: number
  errorMessage?: string
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '32px 16px',
        textAlign: 'center',
        color: colors.secondary,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 48,
          height: 48,
          margin: '0 auto 12px',
          borderRadius: '50%',
          border: `1px dashed ${colors.border}`,
        }}
      />
      <Text style={{ color: colors.secondary, fontSize: 13, display: 'block' }}>
        点击「检测」后，结果将出现在此
      </Text>
    </div>
  )
}

function LoadingState() {
  return (
    <div
      style={{
        padding: '48px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        color: colors.secondary,
      }}
    >
      <Spin />
      <Text style={{ color: colors.secondary, fontSize: 13 }}>检测中…</Text>
    </div>
  )
}

function ResultSummary({ response }: { response: OnlineReviewResponse }) {
  const hits = response.data?.[0]?.hits ?? []
  const riskLevel = response.data?.[0]?.hits?.[0]?.risk_level ?? '高风险'
  const isHit = hits.length > 0
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '8px 4px',
        fontSize: 12,
        color: colors.secondary,
      }}
    >
      {/* 风险等级替换"不合规": 命中显示风险等级(高风险红), 未命中显示合规(绿) */}
      <Tag color={isHit ? 'error' : 'success'} style={{ marginInlineEnd: 0, fontWeight: 500 }}>
        {isHit ? riskLevel : '合规'}
      </Tag>
      {response.strategy && (
        <Tag bordered={false} color="blue">
          策略：{response.strategy.name}
        </Tag>
      )}
      {/* 命中标签值: 多条命中 → 多个红色 Tag 横排; 无命中 → "未命中" */}
      {isHit ? (
        hits.map((h, i) => (
          <Tag key={`${h.rule_code}-${i}`} color="red" bordered={false}>
            {h.rule_label}
          </Tag>
        ))
      ) : (
        <Tag bordered={false}>未命中</Tag>
      )}
    </div>
  )
}

export default function OnlineReviewResultPanel({
  state,
  request,
  response,
  errorMessage,
}: OnlineReviewResultPanelProps) {
  if (state === 'idle') return <EmptyState />
  if (state === 'loading') return <LoadingState />
  if (state === 'error') {
    return (
      <div
        style={{
          padding: '24px 16px',
          color: colors.destructive,
          fontSize: 13,
        }}
      >
        检测失败：{errorMessage || '未知错误'}
      </div>
    )
  }

  const items = [
    {
      key: 'request',
      label: (
        <span
          style={{
            fontFamily: MONO_FONT,
            fontSize: 13,
            color: colors.foreground,
            fontWeight: 500,
          }}
        >
          Request
        </span>
      ),
      children: request ? (
        <div
          style={{
            background: colors.surface,
            padding: '12px 14px',
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
          }}
        >
          <JsonTreeView data={request} initialDepth={1} />
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          无请求数据
        </Text>
      ),
    },
    {
      key: 'response',
      label: (
        <span
          style={{
            fontFamily: MONO_FONT,
            fontSize: 13,
            color: colors.foreground,
            fontWeight: 500,
          }}
        >
          Response
        </span>
      ),
      children: response ? (
        <div
          style={{
            background: colors.surface,
            padding: '12px 14px',
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
          }}
        >
          <JsonTreeView data={response} initialDepth={1} />
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          无响应数据
        </Text>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {response && <ResultSummary response={response} />}
      {response?.llm_error && (
        <Alert
          type="warning"
          showIcon
          message="大模型未参与本次检测"
          description={response.llm_error}
          style={{ fontSize: 12 }}
        />
      )}
      <Collapse
        accordion
        items={items}
        size="small"
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
        }}
      />
    </div>
  )
}
