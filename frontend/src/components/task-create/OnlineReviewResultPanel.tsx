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
        点击「检测」后，请求与响应数据将出现在此
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

function ConclusionTag({ value }: { value?: string }) {
  if (!value) return null
  const isNonCompliant = value === '不合规'
  return (
    <Tag
      color={isNonCompliant ? 'error' : 'success'}
      style={{ marginInlineEnd: 0, fontWeight: 500 }}
    >
      {value}
    </Tag>
  )
}

function ResultSummary({ response, latencyMs }: { response: OnlineReviewResponse; latencyMs?: number }) {
  const conclusion = response.conclusion ?? response.data?.[0]?.conclusion
  const hitCount = response.data?.[0]?.hits?.length ?? 0
  const engines = response.engines_used ?? []
  const llmUsed = engines.includes('llm')
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
      <ConclusionTag value={conclusion} />
      {response.strategy && (
        <Tag bordered={false} color="blue">
          策略：{response.strategy.name}
        </Tag>
      )}
      <Tag bordered={false}>
        命中 {hitCount} 条
      </Tag>
      <Tag bordered={false} color={llmUsed ? 'geekblue' : 'default'}>
        {llmUsed ? `大模型：${response.model ?? '已启用'}` : '仅词库'}
      </Tag>
      {typeof latencyMs === 'number' && <Tag bordered={false}>{latencyMs} ms</Tag>}
    </div>
  )
}

export default function OnlineReviewResultPanel({
  state,
  request,
  response,
  latencyMs,
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
      {response && <ResultSummary response={response} latencyMs={latencyMs} />}
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
        defaultActiveKey={['response']}
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