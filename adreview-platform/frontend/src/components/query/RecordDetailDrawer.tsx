import { Descriptions, Drawer, Empty, Space, Tag, Typography } from 'antd'
import type { MachineReviewRecord, ReviewRecord } from '@/types/domain'
import { MACHINE_DECISION_OPTIONS } from '@/types/domain'

const { Text } = Typography

type DetailRecord = MachineReviewRecord | ReviewRecord

interface Props {
  record: DetailRecord | null
  onClose: () => void
}

const decisionMeta = (v?: string | null) =>
  MACHINE_DECISION_OPTIONS.find((m) => m.value === v)

export default function RecordDetailDrawer({ record, onClose }: Props) {
  return (
    <Drawer
      title="机审详情"
      open={!!record}
      onClose={onClose}
      width="clamp(320px, 50vw, 640px)"
      destroyOnClose
    >
      {record ? (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions
            column={1}
            size="small"
            bordered
            items={[
              { key: 'id', label: 'Request ID', children: record.id },
              {
                key: 'strategy',
                label: '策略名称',
                children: record.strategy_name || record.strategy_code || '-',
              },
              {
                key: 'bailian',
                label: 'BailianRequestId',
                children: record.bailian_request_id || '-',
              },
              {
                key: 'task',
                label: 'Task ID',
                children: record.material_version_id ?? '-',
              },
              {
                key: 'risk',
                label: '风险等级',
                children: record.risk_level || '-',
              },
              {
                key: 'decision',
                label: '检测结果',
                children: (() => {
                  const meta = decisionMeta(record.machine_decision)
                  return meta ? <Tag color={meta.color}>{meta.label}</Tag> : '-'
                })(),
              },
              {
                key: 'feedback',
                label: '反馈结果',
                children: record.final_decision || '-',
              },
              { key: 'material', label: '检测模态', children: record.material_type || '-' },
              {
                key: 'submitter',
                label: '提交用户',
                children: record.submitter_name
                  ? `${record.submitter_name} (#${record.submitter_id})`
                  : '-',
              },
              {
                key: 'assignee',
                label: '审核人',
                children: record.assignee_name
                  ? `${record.assignee_name} (#${record.assignee_id})`
                  : '-',
              },
              { key: 'ip', label: 'IP', children: record.ip || '-' },
              { key: 'account', label: 'AccountId', children: record.account_id || '-' },
              {
                key: 'requested_at',
                label: '请求时间',
                children: record.requested_at
                  ? new Date(record.requested_at).toLocaleString('zh-CN')
                  : '-',
              },
              {
                key: 'finished_at',
                label: '完成时间',
                children: record.finished_at
                  ? new Date(record.finished_at).toLocaleString('zh-CN')
                  : '-',
              },
              ...(('machine_request_id' in record && record.machine_request_id) ||
              ('data_id' in record && record.data_id)
                ? [
                    {
                      key: 'machine_request_id',
                      label: '机审RequestId',
                      children:
                        'machine_request_id' in record
                          ? record.machine_request_id || '-'
                          : '-',
                    },
                    {
                      key: 'data_id',
                      label: 'DataId',
                      children:
                        'data_id' in record ? record.data_id || '-' : '-',
                    },
                  ]
                : []),
            ]}
          />

          <div>
            <Text strong>命中标签</Text>
            <div style={{ marginTop: 8 }}>
              {record.hits.length === 0 ? (
                <Empty description="无命中" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  {record.hits.map((h, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 8,
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        borderRadius: 4,
                      }}
                    >
                      <Space wrap>
                        <Tag color="blue">{h.label_cn || h.label || '-'}</Tag>
                        {h.score != null && (
                          <Text type="secondary">置信度 {(h.score * 100).toFixed(1)}%</Text>
                        )}
                        {h.service_name && <Tag>{h.service_name}</Tag>}
                      </Space>
                      {h.quote && (
                        <div style={{ marginTop: 4, fontSize: 12, color: '#475569' }}>
                          “{h.quote}”
                        </div>
                      )}
                    </div>
                  ))}
                </Space>
              )}
            </div>
          </div>

          {record.violation_tags.length > 0 && (
            <div>
              <Text strong>违规标签</Text>
              <div style={{ marginTop: 8 }}>
                <Space wrap>
                  {record.violation_tags.map((t, idx) => {
                    const snap = (t as Record<string, unknown>)?.snapshot as
                      | Record<string, unknown>
                      | undefined
                    const name =
                      (snap?.name as string | undefined) ??
                      ((t as Record<string, unknown>).id as string | undefined) ??
                      '-'
                    return <Tag key={idx}>{String(name)}</Tag>
                  })}
                </Space>
              </div>
            </div>
          )}

          {record.summary && (
            <div>
              <Text strong>摘要</Text>
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: '#F1F5F9',
                  borderRadius: 4,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {record.summary}
              </div>
            </div>
          )}
        </Space>
      ) : null}
    </Drawer>
  )
}