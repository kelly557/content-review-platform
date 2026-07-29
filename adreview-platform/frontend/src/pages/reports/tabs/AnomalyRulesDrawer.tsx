import { useState } from 'react'
import {
  Button,
  Drawer,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import {
  AnomalyThreshold,
  findExtraFieldLabel,
  renderPart,
} from '@/lib/anomalyThresholds'
import {
  useAnomalyThresholds,
  purgeLegacyAnomalyThresholds,
} from '@/hooks/useAnomalyThresholds'
import AnomalyRuleForm from './AnomalyRuleForm'

const { Text } = Typography

interface Props {
  open: boolean
  onClose: () => void
}

function renderPartCell(part: AnomalyThreshold['critical']) {
  return (
    <Space direction="vertical" size={2} style={{ lineHeight: 1.3 }}>
      <Text
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 12,
        }}
      >
        {renderPart(part)}
      </Text>
    </Space>
  )
}

function renderExtraCell(extraConditions: AnomalyThreshold['extra_conditions']) {
  if (extraConditions.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        —
      </Text>
    )
  }
  return (
    <div>
      {extraConditions.map((c, idx) => (
        <div
          key={idx}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <Text type="secondary" style={{ fontSize: 11, marginRight: 4 }}>
            AND
          </Text>
          <span>
            {findExtraFieldLabel(c.field)} {c.operator} {c.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function AnomalyRulesDrawer({ open, onClose }: Props) {
  const { thresholds, toggleEnabled, addRule, updateOne, removeRule, reset } =
    useAnomalyThresholds()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AnomalyThreshold | null>(null)

  const handleAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const handleEdit = (row: AnomalyThreshold) => {
    setEditing(row)
    setFormOpen(true)
  }
  const handleSubmit = (rule: AnomalyThreshold) => {
    if (editing) {
      updateOne(editing.rule_code, rule)
    } else {
      addRule(rule)
    }
    setFormOpen(false)
    setEditing(null)
  }
  const handleReset = () => {
    reset()
  }
  const handleOpen = (next: boolean) => {
    if (next) {
      purgeLegacyAnomalyThresholds()
    }
  }

  const enabledCount = thresholds.filter((t) => t.enabled).length

  const columns: ColumnsType<AnomalyThreshold> = [
    {
      title: '规则名',
      dataIndex: 'label',
      width: 180,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '指标',
      dataIndex: 'metric',
      width: 140,
    },
    {
      title: '时间窗口',
      dataIndex: 'window_label',
      width: 110,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '维度',
      dataIndex: 'dimension',
      width: 110,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '算法',
      dataIndex: 'algorithm',
      width: 100,
      render: (v: string) => <Tag color="purple">{v}</Tag>,
    },
    {
      title: '严重',
      key: 'critical',
      width: 120,
      render: (_v, row) => (
        <Space direction="vertical" size={2} style={{ lineHeight: 1.3 }}>
          {renderPartCell(row.critical)}
          <Tag color="red" style={{ marginRight: 0 }}>
            严重
          </Tag>
        </Space>
      ),
    },
    {
      title: '警告',
      key: 'warn',
      width: 120,
      render: (_v, row) => (
        <Space direction="vertical" size={2} style={{ lineHeight: 1.3 }}>
          {renderPartCell(row.warn)}
          <Tag color="orange" style={{ marginRight: 0 }}>
            警告
          </Tag>
        </Space>
      ),
    },
    {
      title: '附加条件',
      key: 'extra_conditions',
      width: 200,
      render: (_v, row) => renderExtraCell(row.extra_conditions),
    },
    {
      title: '状态',
      key: 'enabled',
      width: 110,
      render: (_v, row) => (
        <Space size="small" align="center">
          <Switch
            size="small"
            checked={row.enabled}
            onChange={() => toggleEnabled(row.rule_code)}
          />
          <Text type={row.enabled ? 'success' : 'secondary'} style={{ fontSize: 12 }}>
            {row.enabled ? '启用' : '停用'}
          </Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_v, row) => (
        <Space size="small">
          <Tooltip title="编辑规则">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEdit(row)}
            />
          </Tooltip>
          <Popconfirm
            title="删除该规则?"
            description="删除后无法恢复, 仅影响前端监测规则配置"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => removeRule(row.rule_code)}
          >
            <Tooltip title="删除规则">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Drawer
        title="监测规则配置"
        placement="right"
        width={960}
        open={open}
        onClose={onClose}
        destroyOnClose
        afterOpenChange={handleOpen}
        extra={
          <Space>
            <Tooltip title="新增监测规则">
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
                新增规则
              </Button>
            </Tooltip>
            <Popconfirm
              title="恢复默认规则?"
              description="将覆盖当前所有自定义规则"
              okText="恢复"
              cancelText="取消"
              onConfirm={handleReset}
            >
              <Button icon={<UndoOutlined />}>恢复默认</Button>
            </Popconfirm>
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            共 {thresholds.length} 条规则, 已启用 {enabledCount} 条
          </Text>
          <Table
            rowKey="rule_code"
            dataSource={thresholds}
            columns={columns}
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </Space>
      </Drawer>
      <AnomalyRuleForm
        open={formOpen}
        initial={editing}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSubmit={handleSubmit}
      />
    </>
  )
}
