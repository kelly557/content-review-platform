/**
 * 个性化图片/文本审核规则 — 列表页
 *
 * 列：规则名 / 模型（行内 Select 大模型）/ 选择知识（行内 Select 多选）/ 启用 / 操作（编辑审核点 + 删除）
 * 不再有 ⋮ 配置下拉，编辑/删除直接暴露。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Breadcrumb,
  Button,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import { registeredModelsApi } from '@/api/registered-models'
import type {
  AuditItem,
  MediaTypeKey,
  RegisteredModelListItem,
} from '@/types/domain'
import { SMALL_MODEL_CATEGORY_LABEL, SMALL_MODEL_CATEGORY_OPTIONS } from '@/types/domain'

const SMALL_CATEGORY_COLOR: Record<string, string> = SMALL_MODEL_CATEGORY_OPTIONS.reduce(
  (acc, o) => ({ ...acc, [o.value]: o.color }),
  {} as Record<string, string>,
)
import { KnowledgeSelectInline } from './SelectKnowledgeDocumentsModal'
import SelectSmallModelModal from './SelectSmallModelModal'

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
  const [models, setModels] = useState<RegisteredModelListItem[]>([])
  const [modelLoading, setModelLoading] = useState(false)
  const [modelItem, setModelItem] = useState<AuditItem | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      const all = await auditItemsApi.listByMediaType(mediaType)
      setItems(all.filter((it) => !it.is_builtin))
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '加载个性化规则失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaType])

  useEffect(() => {
    let cancelled = false
    setModelLoading(true)
    registeredModelsApi
      // backend caps size at le=100 (registered-models pagination); 100 covers realistic dropdown set
      .list({ size: 100, kind: 'small', status: 'active' })
      .then((p) => {
        if (cancelled) return
        setModels(p.items.filter((m) => m.status === 'active' && m.current_version_id != null))
      })
      .catch(() => message.error('加载模型失败'))
      .finally(() => !cancelled && setModelLoading(false))
    return () => {
      cancelled = true
    }
  }, [message])

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

  const handleModelChange = async (
    row: AuditItem,
    versionId: number | undefined,
  ) => {
    try {
      await auditItemsApi.setActiveModelVersion(
        row.package_code,
        row.id,
        versionId ?? null,
      )
      message.success('已更新模型')
      await reload()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    }
  }

  const modelOptions = useMemo(
    () =>
      models.map((m) => ({
        value: m.current_version_id!,
        label: (
          <Space size={6} wrap>
            <span>{m.name}</span>
            {m.small_category && (
              <Tag
                color={SMALL_CATEGORY_COLOR[m.small_category] ?? 'default'}
                style={{ marginInline: 0 }}
              >
                {SMALL_MODEL_CATEGORY_LABEL[m.small_category]}
              </Tag>
            )}
            {m.model_name && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {m.model_name}
              </Text>
            )}
          </Space>
        ),
        data: m,
      })),
    [models],
  )

  const columns: ColumnsType<AuditItem> = useMemo(
    () => [
      {
        title: '规则名',
        dataIndex: 'name_cn',
        width: '18%',
        render: (v: string, row) => (
          <Link to={`/rules/personal/${mediaType}/${row.id}`}>
            <Text strong>{v}</Text>
          </Link>
        ),
      },
      {
        title: '模型',
        key: 'model',
        width: '24%',
        render: (_, row) => {
          const currentId = row.active_small_model_version_id ?? undefined
          return (
            <Select<number | undefined>
              value={currentId}
              onChange={(v) => handleModelChange(row, v)}
              placeholder={modelLoading ? '加载模型中…' : '请选择模型 ▼'}
              loading={modelLoading}
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: '100%', minWidth: 200 }}
              popupMatchSelectWidth={420}
              notFoundContent={
                modelLoading ? '加载中…' : <Empty description="暂无可用大模型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              }
              options={modelOptions}
              labelRender={(props) => {
                if (!props.value) return <span style={{ color: '#94A3B8' }}>请选择模型 ▼</span>
                const m: RegisteredModelListItem | undefined = models.find(
                  (x) => x.current_version_id === props.value,
                )
                if (!m) return <span>#{props.value}</span>
                return (
                  <Space size={6} wrap>
                    <span style={{ fontWeight: 600 }}>{m.model_name ?? m.name}</span>
                    {m.small_category && (
                      <Tag
                        color={SMALL_CATEGORY_COLOR[m.small_category] ?? 'default'}
                        style={{ marginInline: 0 }}
                      >
                        {SMALL_MODEL_CATEGORY_LABEL[m.small_category]}
                      </Tag>
                    )}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      v{m.current_version_no ?? 1}
                      {m.current_version_label ? ` · ${m.current_version_label}` : ''}
                    </Text>
                  </Space>
                )
              }}
            />
          )
        },
      },
      {
        title: '选择知识',
        key: 'docs',
        width: '28%',
        render: (_, row) => (
          <KnowledgeSelectInline item={row} onSaved={() => void reload()} compact />
        ),
      },
      {
        title: '启用',
        dataIndex: 'is_enabled',
        width: '10%',
        render: (v: boolean) => (
          <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已停用'}</Tag>
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: '20%',
        render: (_, row) => (
          <Space size={12}>
            <Tooltip title="进入「审核点和审核内容」编辑器">
              <a
                onClick={() =>
                  navigate(`/rules/personal/${mediaType}/${row.id}/points`)
                }
              >
                编辑审核点
              </a>
            </Tooltip>
            <Tooltip title="删除该规则及其下所有审核点">
              <a
                style={{ color: '#DC2626' }}
                onClick={() => onDelete(row)}
              >
                删除
              </a>
            </Tooltip>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaType, models, modelLoading, modelOptions],
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

      {/* 兼容入口：保留模型 Modal 形式（备用）。 */}
      <SelectSmallModelModal
        item={modelItem}
        onClose={() => setModelItem(null)}
        onSaved={async () => {
          await reload()
          setModelItem(null)
        }}
      />
    </div>
  )
}