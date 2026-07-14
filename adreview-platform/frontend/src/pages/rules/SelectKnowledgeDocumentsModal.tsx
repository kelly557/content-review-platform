/**
 * 「关联知识文档」多选弹窗 — 仅个性化规则使用
 *
 * 列出 KnowledgeDocument(status=active)，多选；选中后 PATCH
 * /packages/{code}/items/{id} body={knowledge_document_ids: number[]}。
 */
import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { auditItemsApi } from '@/api/auditItems'
import { knowledgeDocumentsApi } from '@/api/knowledge-documents'
import type { AuditItem, KnowledgeDocumentListItem } from '@/types/domain'

const { Text } = Typography

interface Props {
  item: AuditItem | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export default function SelectKnowledgeDocumentsModal({
  item,
  onClose,
  onSaved,
}: Props) {
  const { message } = App.useApp()
  const [docs, setDocs] = useState<KnowledgeDocumentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!item) return
    setPicked(new Set(item.knowledge_document_ids))
    setLoading(true)
    knowledgeDocumentsApi
      .list({ size: 500, status: 'active', include_deleted: false })
      .then((p) => setDocs(p.items))
      .catch(() => message.error('加载知识文档失败'))
      .finally(() => setLoading(false))
  }, [item, message])

  const toggle = (id: number, checked: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const save = async () => {
    if (!item) return
    setSaving(true)
    try {
      await auditItemsApi.setKnowledgeDocuments(
        item.package_code,
        item.id,
        Array.from(picked),
      )
      message.success('已保存关联知识文档')
      await onSaved()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const filtered = docs.filter(
    (d) => !q || d.title.toLowerCase().includes(q.toLowerCase()),
  )

  const columns: ColumnsType<KnowledgeDocumentListItem> = [
    {
      title: '选择',
      key: 'pick',
      width: '12%',
      render: (_, row) => (
        <Checkbox
          checked={picked.has(row.id)}
          onChange={(e) => toggle(row.id, e.target.checked)}
        />
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      width: '50%',
      render: (v: string) => <Text>{v}</Text>,
    },
    {
      title: '来源',
      dataIndex: 'source_type',
      width: '14%',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: '12%',
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag>
      ),
    },
  ]

  return (
    <Modal
      title={item ? `关联知识文档 — ${item.name_cn}` : '关联知识文档'}
      open={!!item}
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={saving}
          onClick={save}
        >
          确认 ({picked.size} 项)
        </Button>,
      ]}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <Input.Search
          placeholder="搜索知识文档"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          allowClear
        />
        <Text type="secondary">仅显示 status=active 的知识文档</Text>
        <Spin spinning={loading}>
          {filtered.length === 0 && !loading ? (
            <Empty description="暂无知识文档" />
          ) : (
            <Table<KnowledgeDocumentListItem>
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