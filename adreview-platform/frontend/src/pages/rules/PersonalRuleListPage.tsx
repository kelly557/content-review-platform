/**
 * 个性化图片/文本审核规则 — 列表页
 *
 * 视觉与行为故意与通用页不同：
 * - 顶栏有「+ 新建规则」
 * - 行操作「⋮ 配置」下拉含编辑/删除
 * - 「生效」列为「关联知识文档」chip
 * - 标签 [个性化] 绿底
 */
import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Breadcrumb,
  Button,
  Dropdown,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import { knowledgeDocumentsApi } from '@/api/knowledge-documents'
import type {
  AuditItem,
  MediaTypeKey,
} from '@/types/domain'

const { Text, Title } = Typography

const MEDIA_LABEL: Record<MediaTypeKey, string> = {
  image: '图片',
  text: '文本',
  audio: '音频',
  doc: '文档',
  video: '视频',
}

export default function PersonalRuleListPage() {
  const { mediaType = 'image' } = useParams<{ mediaType: MediaTypeKey }>()
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(false)
  const [docIndex, setDocIndex] = useState<Map<number, string>>(new Map())

  const reload = async () => {
    setLoading(true)
    try {
      const [all, docsPage] = await Promise.all([
        auditItemsApi.listByMediaType(mediaType),
        knowledgeDocumentsApi
          .list({ size: 200, include_deleted: false })
          .catch(() => null),
      ])
      setItems(all.filter((it) => !it.is_builtin))
      if (docsPage) {
        const idx = new Map<number, string>()
        for (const d of docsPage.items) idx.set(d.id, d.title)
        setDocIndex(idx)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaType])

  const onDelete = (row: AuditItem) => {
    modal.confirm({
      title: `删除「${row.name_cn}」？`,
      content: '该操作不可恢复，且会级联删除其下审核点。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await auditItemsApi.remove(row.package_code, row.id)
          message.success('已删除')
          await reload()
        } catch (err) {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          message.error(detail ?? '删除失败')
        }
      },
    })
  }

  const columns: ColumnsType<AuditItem> = useMemo(
    () => [
      {
        title: '规则名',
        dataIndex: 'name_cn',
        width: '28%',
        render: (v: string, row) => (
          <Link to={`/rules/personal/${mediaType}/${row.id}`}>
            <Text strong>{v}</Text>
          </Link>
        ),
      },
      {
        title: '关联知识文档',
        key: 'docs',
        width: '40%',
        render: (_, row) => {
          const ids = row.knowledge_document_ids ?? []
          if (ids.length === 0) {
            return (
              <Text type="secondary" style={{ fontStyle: 'italic' }}>
                (未关联)
              </Text>
            )
          }
          return (
            <Space size={4} wrap>
              {ids.map((id) => (
                <Tag key={id} color="cyan" style={{ margin: 0 }}>
                  📚 {docIndex.get(id) ?? `#${id}`}
                </Tag>
              ))}
            </Space>
          )
        },
      },
      {
        title: '启用',
        dataIndex: 'is_enabled',
        width: '12%',
        render: (v: boolean) => (
          <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已停用'}</Tag>
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: '20%',
        render: (_, row) => (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'view',
                  label: '查看 / 编辑',
                  onClick: () =>
                    navigate(`/rules/personal/${mediaType}/${row.id}`),
                },
                { type: 'divider' },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  onClick: () => onDelete(row),
                },
              ],
            }}
            trigger={['click']}
          >
            <Button size="small">⋮ 配置</Button>
          </Dropdown>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaType, docIndex],
  )

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/strategies">策略中心</Link> },
          { title: '审核策略' },
          { title: `${MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则` },
          { title: <Tag color="green">个性化</Tag> },
        ]}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            个性化{MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则
          </Title>
          <Tag color="green">个性化</Tag>
        </Space>
        <Space>
          <Button onClick={() => void reload()}>刷新</Button>
          <Button
            type="primary"
            onClick={() => navigate(`/rules/personal/${mediaType}/new`)}
          >
            + 新建规则
          </Button>
        </Space>
      </div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        个性化规则可关联知识库中的知识文档作为审核依据，仅自己可见，影响对应策略。
      </Text>
      <Table<AuditItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        size="middle"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无个性化规则，点击新建开始"
              style={{ padding: '24px 0' }}
            />
          ),
        }}
      />
    </div>
  )
}