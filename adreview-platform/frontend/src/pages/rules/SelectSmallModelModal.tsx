/**
 * 「选择小模型」单选弹窗 — 个性化规则共用
 *
 * 列出 RegisteredModel(kind=small, status=active)。每行展示：
 *   模型名称 · 分类(provider/model_name)
 *
 * 选中后 PUT /packages/{code}/items/{id} body={active_small_model_version_id}。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Radio,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { registeredModelsApi } from '@/api/registered-models'
import type {
  AuditItem,
  RegisteredModelListItem,
} from '@/types/domain'
import { SMALL_MODEL_CATEGORY_LABEL } from '@/types/domain'

const { Text } = Typography

interface Props {
  item: AuditItem | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export default function SelectSmallModelModal({
  item,
  onClose,
  onSaved,
}: Props) {
  const { message } = App.useApp()
  const [models, setModels] = useState<RegisteredModelListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!item) return
    setPicked(item.active_small_model_version_id ?? null)
    setLoading(true)
    registeredModelsApi
      .list({ size: 200, kind: 'small', status: 'active' })
      .then((p) => setModels(p.items.filter((m) => m.status === 'active')))
      .catch(() => message.error('加载模型失败'))
      .finally(() => setLoading(false))
  }, [item, message])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return models
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(kw) ||
        (m.code ?? '').toLowerCase().includes(kw) ||
        (m.model_name ?? '').toLowerCase().includes(kw) ||
        (m.provider_label ?? '').toLowerCase().includes(kw),
    )
  }, [models, q])

  const save = async () => {
    if (!item) return
    setSaving(true)
    try {
      await import('@/api/auditItems').then(({ auditItemsApi }) =>
        auditItemsApi.setActiveModelVersion(
          item.package_code,
          item.id,
          picked,
        ),
      )
      message.success('已保存模型')
      await onSaved()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<RegisteredModelListItem> = [
    {
      title: '选择',
      key: 'pick',
      width: 80,
      render: (_, row) => (
        <Radio
          checked={picked === (row.current_version_id ?? null)}
          disabled={row.current_version_id == null}
          onChange={() => setPicked(row.current_version_id ?? null)}
        />
      ),
    },
    {
      title: '模型名称',
      dataIndex: 'name',
      width: '28%',
      render: (v: string, row) => (
        <Space size={6} align="center">
          <Text strong>{v}</Text>
          {row.small_category && (
            <Tag>{SMALL_MODEL_CATEGORY_LABEL[row.small_category]}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '模型标识',
      dataIndex: 'model_name',
      width: '24%',
      render: (v: string | null) => <Text type="secondary">{v ?? '—'}</Text>,
    },
    {
      title: 'Provider',
      dataIndex: 'provider_label',
      width: '20%',
      render: (v: string | null) => <Text type="secondary">{v ?? '—'}</Text>,
    },
    {
      title: '当前版本',
      key: 'version',
      width: '16%',
      render: (_, row) =>
        row.current_version_no != null ? (
          <Tag>v{row.current_version_no}{row.current_version_label ? ` · ${row.current_version_label}` : ''}</Tag>
        ) : (
          <Text type="secondary">未发布</Text>
        ),
    },
  ]

  return (
    <Modal
      title={item ? `选择小模型 — ${item.name_cn}` : '选择小模型'}
      open={!!item}
      onCancel={onClose}
      width={820}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={saving}
          onClick={save}
          disabled={picked == null}
        >
          确认
        </Button>,
      ]}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <Text type="secondary">
          选择一个已发布的小模型（kind=small，status=active），作为本规则的运行模型。
        </Text>
        <Input.Search
          placeholder="搜索模型名称 / 标识 / Provider"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          allowClear
        />
        <Spin spinning={loading}>
          {filtered.length === 0 && !loading ? (
            <Empty description="暂无可用的小模型" />
          ) : (
            <Table<RegisteredModelListItem>
              rowKey="id"
              dataSource={filtered}
              columns={columns}
              pagination={{ pageSize: 10, size: 'small' }}
              size="small"
            />
          )}
        </Spin>
      </Space>
    </Modal>
  )
}