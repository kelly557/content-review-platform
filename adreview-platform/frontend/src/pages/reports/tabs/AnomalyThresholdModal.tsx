import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import {
  ANOMALY_RULE_CODES,
  AnomalyRuleCode,
  AnomalyThreshold,
} from '@/lib/anomalyThresholds'

const { Text } = Typography

interface Props {
  open: boolean
  thresholds: Record<AnomalyRuleCode, AnomalyThreshold>
  onSave: (next: Record<AnomalyRuleCode, AnomalyThreshold>) => void
  onReset: () => void
  onClose: () => void
}

export default function AnomalyThresholdModal({
  open,
  thresholds,
  onSave,
  onReset,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Record<AnomalyRuleCode, AnomalyThreshold>>(
    thresholds,
  )

  useEffect(() => {
    if (open) setDraft(thresholds)
  }, [open, thresholds])

  const rows: AnomalyThreshold[] = [
    thresholds[ANOMALY_RULE_CODES.REJECT_RATE],
    thresholds[ANOMALY_RULE_CODES.HIGH_RISK_CONTENT],
    thresholds[ANOMALY_RULE_CODES.HIGH_RISK_ACCOUNT],
  ]

  const columns: ColumnsType<AnomalyThreshold> = [
    {
      title: '报警项',
      dataIndex: 'label',
      width: 160,
      render: (v: string, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {row.metric}
          </Text>
        </Space>
      ),
    },
    {
      title: '阈值',
      dataIndex: 'threshold',
      width: 140,
      render: (_v, row) => (
        <InputNumber
          value={draft[row.rule_code as AnomalyRuleCode].threshold}
          min={0}
          max={row.unit === '%' ? 100 : 10000}
          step={1}
          style={{ width: '100%' }}
          addonAfter={row.unit === '%' ? '%' : '条'}
          onChange={(nv) => {
            const code = row.rule_code as AnomalyRuleCode
            setDraft((d) => ({
              ...d,
              [code]: { ...d[code], threshold: Number(nv ?? 0) },
            }))
          }}
        />
      ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      render: (v: string, row) => {
        const isCustom = draft[row.rule_code as AnomalyRuleCode].source === 'custom'
        return (
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {v}
            </Text>
            {isCustom && <Tag color="blue">已自定义</Tag>}
          </Space>
        )
      },
    },
  ]

  return (
    <Modal
      title="配置预警阈值"
      open={open}
      onCancel={onClose}
      width={760}
      footer={
        <Space>
          <Popconfirm
            title="恢复默认阈值?"
            description="将覆盖当前所有自定义值"
            okText="确认恢复"
            cancelText="取消"
            onConfirm={() => {
              onReset()
              onClose()
            }}
          >
            <Button icon={<ReloadOutlined />}>恢复默认</Button>
          </Popconfirm>
          <Space style={{ marginLeft: 'auto' }}>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => {
                onSave(draft)
                onClose()
              }}
            >
              保存
            </Button>
          </Space>
        </Space>
      }
    >
      <Form layout="vertical" component={false}>
        <Table
          rowKey="rule_code"
          dataSource={rows}
          columns={columns}
          size="small"
          pagination={false}
        />
      </Form>

    </Modal>
  )
}
