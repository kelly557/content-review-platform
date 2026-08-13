import { Alert, Collapse, Spin, Table, Tag, Typography } from 'antd'
import JsonTreeView from './JsonTreeView'
import type { OnlineReviewHit, OnlineReviewRequest, OnlineReviewResponse } from '@/api/onlineReviewTypes'
import { colors } from '@/styles/theme'

const { Text } = Typography

const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

const RISK_COLOR: Record<string, string> = {
  高风险: 'red',
  中风险: 'orange',
  低风险: 'gold',
  敏感: 'magenta',
  无风险: 'default',
}

const SOURCE_LABEL: Record<string, string> = {
  'rules.llm': '大模型',
  'rules.local_wordset': '词库',
}

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

/** 命中标签结果列表: 直接展示命中的审核标签 + 违规原文 + 风险等级 + 来源 */
function HitList({ hits }: { hits: OnlineReviewHit[] }) {
  if (hits.length === 0) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center' }}>
        <Text type="secondary">未检测到风险内容</Text>
      </div>
    )
  }
  return (
    <Table<OnlineReviewHit>
      size="small"
      rowKey={(r, i) => `${r.rule_code}-${i}`}
      pagination={false}
      dataSource={hits}
      columns={[
        {
          title: '审核标签',
          dataIndex: 'rule_label',
          width: '24%',
          render: (v: string) => <Text strong>{v}</Text>,
        },
        {
          title: '违规原文',
          dataIndex: 'matched_text',
          render: (v?: string) =>
            v ? (
              <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {v}
              </Text>
            ) : (
              <Text type="secondary">—</Text>
            ),
        },
        {
          title: '风险等级',
          dataIndex: 'risk_level',
          width: 90,
          render: (v: string) => (
            <Tag color={RISK_COLOR[v] ?? 'default'} bordered={false}>
              {v}
            </Tag>
          ),
        },
        {
          title: '来源',
          dataIndex: 'source',
          width: 80,
          render: (v: string) => SOURCE_LABEL[v] ?? v,
        },
      ]}
    />
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

  const hits = response?.data?.[0]?.hits ?? []
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
      {/* 命中标签结果直接展示 (不再只藏在 JSON 树里) */}
      {response && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: 12,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <Text strong>命中标签结果</Text>
          </div>
          <HitList hits={hits} />
        </div>
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