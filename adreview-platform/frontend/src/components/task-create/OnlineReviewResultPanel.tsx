import { Collapse, Spin, Tag, Typography } from 'antd'
import JsonTreeView from './JsonTreeView'
import type { MockRequest, MockResponse } from '@/api/onlineReviewMock'
import { colors } from '@/styles/theme'

const { Text } = Typography

const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export type OnlineReviewResultState = 'idle' | 'loading' | 'done' | 'error'

export interface OnlineReviewResultPanelProps {
  state: OnlineReviewResultState
  request?: MockRequest
  response?: MockResponse
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

function _ConclusionTag({ value }: { value?: string }) {
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

// Kept around for the next iteration of the result summary footer.
// Touched via void so TS noUnusedLocals accepts the declaration until then.
void _ConclusionTag

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

  // Reserved for the next iteration of the result summary footer.
  // Kept live (no underscore prefix) and read once via void so TS
  // noUnusedLocals / noUnusedParameters stays happy until then.
  const _conclusion = response?.conclusion ?? response?.data?.[0]?.conclusion
  const _itemCount = response?.data?.[0]?.hits?.length ?? 0
  void _conclusion
  void _itemCount
  void latencyMs

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