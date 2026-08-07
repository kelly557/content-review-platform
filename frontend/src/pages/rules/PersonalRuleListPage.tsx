/**
 * 个性化图片/文本审核规则 — 列表页（重构版）
 *
 * 列：规则名 / 大模型 / 文档 / 状态 / 审核点 / Prompt / 启用 / 操作
 *
 * 上传入口：表格「文档」列的 + 上传文件 按钮（行级）。
 * 上方「UploadHintPanel」展示全局说明与解析进度统计。
 * 点击表格「N 条」按钮打开 Drawer 查看审核点。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { auditItemsApi } from '@/api/auditItems'
import { registeredModelsApi } from '@/api/registered-models'
import { uploadedDocumentsApi } from '@/api/uploadedDocuments'
import type {
  AuditItem,
  MediaTypeKey,
  RegisteredModelListItem,
  UploadedDocument,
} from '@/types/domain'
import {
  LARGE_MODEL_CATEGORY_LABEL,
  LARGE_MODEL_CATEGORY_OPTIONS,
} from '@/types/domain'

import AuditPointsDrawer from './AuditPointsDrawer'
import DocumentsCell from './DocumentsCell'
import ParseStatusTag from './ParseStatusTag'
import PromptEditorModal from './PromptEditorModal'
import UploadHintPanel from './UploadHintPanel'

const { Text } = Typography

const MEDIA_LABEL: Record<MediaTypeKey, string> = {
  image: '图片',
  text: '文本',
  audio: '音频',
  doc: '文档',
  video: '视频',
}

const PACKAGE_BY_MEDIA: Record<MediaTypeKey, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

const LARGE_CATEGORY_COLOR: Record<string, string> = LARGE_MODEL_CATEGORY_OPTIONS.reduce(
  (acc, o) => ({ ...acc, [o.value]: o.color }),
  {} as Record<string, string>,
)

export default function PersonalRuleListPage({
  embedded = false,
  mediaTypeProp,
}: {
  embedded?: boolean
  mediaTypeProp?: MediaTypeKey
}) {
  const params = useParams<{ mediaType: MediaTypeKey }>()
  const mediaType = (mediaTypeProp ?? params.mediaType ?? 'image') as MediaTypeKey
  const navigate = useNavigate()
  const { message, modal } = App.useApp()

  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState<RegisteredModelListItem[]>([])
  const [modelLoading, setModelLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerItem, setDrawerItem] = useState<AuditItem | null>(null)
  const [promptDoc, setPromptDoc] = useState<UploadedDocument | null>(null)
  // 行级缓存：item.id → documents[] (由 DocumentsCell 内部 fetch，这里保存快照用于 status 列)
  const [docMap, setDocMap] = useState<Record<number, UploadedDocument[]>>({})

  const reload = async () => {
    setLoading(true)
    try {
      const all = await auditItemsApi.listByMediaType(mediaType)
      const list = all.filter((it) => !it.is_builtin)
      setItems(list)
      // 顺手拉所有文档 (用于 status 列)
      const newDocMap: Record<number, UploadedDocument[]> = {}
      await Promise.all(
        list.map(async (it) => {
          try {
            const resp = await uploadedDocumentsApi.list(PACKAGE_BY_MEDIA[mediaType], it.id)
            newDocMap[it.id] = resp.documents
          } catch {
            newDocMap[it.id] = []
          }
        }),
      )
      setDocMap(newDocMap)
    } catch {
      // toast handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [mediaType])

  useEffect(() => {
    let cancelled = false
    setModelLoading(true)
    registeredModelsApi
      .list({ size: 100, kind: 'large', status: 'active' })
      .then((p) => {
        if (cancelled) return
        setModels(p.items.filter((m) => m.status === 'active' && m.current_version_id != null))
      })
      .catch(() => message.error('加载大模型失败'))
      .finally(() => !cancelled && setModelLoading(false))
    return () => {
      cancelled = true
    }
  }, [message])

  // 轮询：任意行有 parsing/pending 文档时每 3 秒刷新
  useEffect(() => {
    const inflight = Object.values(docMap).some((docs) =>
      docs.some((d) => d.status === 'parsing' || d.status === 'pending'),
    )
    if (!inflight) return
    const t = setInterval(() => void reload(), 3000)
    return () => clearInterval(t)
  }, [JSON.stringify(docMap)])

  const onDelete = (row: AuditItem) => {
    modal.confirm({
      title: `删除「${row.name_cn}」？`,
      content: '该操作不可恢复，且会级联删除其下审核点及上传文件。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await auditItemsApi.remove(row.package_code, row.id)
          message.success('已删除')
          await reload()
        } catch {
          // toast handled
        }
      },
    })
  }

  const handleModelChange = async (
    row: AuditItem,
    modelId: number | undefined,
  ) => {
    try {
      await auditItemsApi.setActiveLargeModel(
        row.package_code,
        row.id,
        modelId ?? null,
      )
      message.success('已更新大模型')
      await reload()
    } catch {
      // toast handled
    }
  }

  const modelOptions = useMemo(
    () =>
      models.map((m) => ({
        value: m.id!,
        label: (
          <Space size={6} wrap>
            <span>{m.name}</span>
            {m.large_category && (
              <Tag
                color={LARGE_CATEGORY_COLOR[m.large_category] ?? 'default'}
                style={{ marginInline: 0 }}
              >
                {LARGE_MODEL_CATEGORY_LABEL[m.large_category]}
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
        width: 160,
        render: (v: string, row) => (
          <Link to={`/rules/personal/${mediaType}/${row.id}`}>
            <Text strong>{v}</Text>
          </Link>
        ),
      },
      {
        title: '大模型',
        key: 'model',
        width: 220,
        render: (_, row) => {
          const currentId = row.active_large_model_id ?? undefined
          return (
            <Select<number | undefined>
              value={currentId}
              onChange={(v) => handleModelChange(row, v)}
              placeholder={modelLoading ? '加载大模型中…' : '请选择大模型 ▼'}
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
                if (!props.value) return <span style={{ color: '#94A3B8' }}>请选择大模型 ▼</span>
                const m: RegisteredModelListItem | undefined = models.find(
                  (x) => x.id === props.value,
                )
                if (!m) return <span>#{props.value}</span>
                return (
                  <Space size={6} wrap>
                    <span style={{ fontWeight: 600 }}>{m.model_name ?? m.name}</span>
                    {m.large_category && (
                      <Tag
                        color={LARGE_CATEGORY_COLOR[m.large_category] ?? 'default'}
                        style={{ marginInline: 0 }}
                      >
                        {LARGE_MODEL_CATEGORY_LABEL[m.large_category]}
                      </Tag>
                    )}
                  </Space>
                )
              }}
            />
          )
        },
      },
      {
        title: '文档',
        key: 'documents',
        width: 240,
        render: (_, row) => (
          <DocumentsCell
            item={row}
            packageCode={row.package_code}
            onPromptEdit={(doc) => setPromptDoc(doc)}
            onReload={() => void reload()}
          />
        ),
      },
      {
        title: '状态',
        key: 'status',
        width: 110,
        render: (_, row) => (
          <ParseStatusTag documents={docMap[row.id] ?? []} />
        ),
      },
      {
        title: '审核点',
        key: 'points',
        width: 120,
        render: (_, row) => {
          const total = (docMap[row.id] ?? []).reduce(
            (acc, d) => acc + (d.parsed_point_count || 0),
            row.point_count,
          )
          return (
            <Space size={6}>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setDrawerItem(row)
                  setDrawerOpen(true)
                }}
              >
                {total} 条
              </Button>
            </Space>
          )
        },
      },
      {
        title: 'Prompt',
        key: 'prompt',
        width: 80,
        render: (_, row) => {
          const docs = (docMap[row.id] ?? []).filter((d) => d.kind === 'llm')
          if (docs.length === 0) return <Text type="secondary">—</Text>
          return (
            <Button
              size="small"
              type="link"
              onClick={() => setPromptDoc(docs[0])}
            >
              编辑
            </Button>
          )
        },
      },
      {
        title: '启用',
        dataIndex: 'is_enabled',
        width: 90,
        render: (v: boolean) => (
          <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已停用'}</Tag>
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: 160,
        render: (_, row) => (
          <Space size={12}>
            <a
              onClick={() =>
                navigate(`/rules/personal/${mediaType}/${row.id}/points`)
              }
            >
              编辑审核点
            </a>
            <a style={{ color: '#DC2626' }} onClick={() => onDelete(row)}>
              删除
            </a>
          </Space>
        ),
      },
    ],
    [mediaType, models, modelLoading, modelOptions, docMap],
  )

  const pkg = PACKAGE_BY_MEDIA[mediaType]

  return (
    <div style={{ width: '100%' }}>
      {!embedded && (
        <Space style={{ marginBottom: 12 }}>
          <Text type="secondary">
            个性化{MEDIA_LABEL[mediaType]}审核规则 · 共 {items.length} 条
          </Text>
          <Button size="small" onClick={() => void reload()}>刷新</Button>
        </Space>
      )}

      <UploadHintPanel items={items} packageCode={pkg} />

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
              description="暂无个性化规则，请先点击「+ 新增审核 Agent」创建"
              style={{ padding: '24px 0' }}
            />
          ),
        }}
      />

      <AuditPointsDrawer
        open={drawerOpen}
        item={drawerItem}
        packageCode={pkg}
        onClose={() => setDrawerOpen(false)}
      />

      {promptDoc && drawerItem && (
        <PromptEditorModal
          open={!!promptDoc}
          itemId={drawerItem.id}
          packageCode={pkg}
          document={promptDoc}
          onClose={() => setPromptDoc(null)}
          onSaved={() => {
            void reload()
          }}
        />
      )}

      </div>
  )
}