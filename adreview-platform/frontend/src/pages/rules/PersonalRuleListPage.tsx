/**
 * 个性化图片/文本审核规则 — 列表页
 *
 * 列：规则名 / 大模型 / 审核点（上传）/ 启用 / 操作（编辑审核点 + 删除）
 * 顶部「+ 新增审核 Agent」弹窗创建。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { InboxOutlined } from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import { registeredModelsApi } from '@/api/registered-models'
import { parseImportFile, rowsToText } from '@/lib/auditPointBatchImport'
import type {
  AuditItem,
  AuditPointBatchResult,
  MediaTypeKey,
  RegisteredModelListItem,
} from '@/types/domain'
import { LARGE_MODEL_CATEGORY_LABEL, LARGE_MODEL_CATEGORY_OPTIONS } from '@/types/domain'

const LARGE_CATEGORY_COLOR: Record<string, string> = LARGE_MODEL_CATEGORY_OPTIONS.reduce(
  (acc, o) => ({ ...acc, [o.value]: o.color }),
  {} as Record<string, string>,
)
import SelectSmallModelModal from './SelectSmallModelModal'

const { Text, Title } = Typography
const { TextArea } = Input

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

const MAX_UPLOAD_POINTS = 100

/* ─────────────── CreateAgentModal ─────────────── */

function CreateAgentModal({
  open,
  mediaType,
  onClose,
  onCreated,
}: {
  open: boolean
  mediaType: MediaTypeKey
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [creating, setCreating] = useState(false)

  const pkg = PACKAGE_BY_MEDIA[mediaType]

  const handleOk = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setCreating(true)
    try {
      await auditItemsApi.create(pkg, {
        name_cn: values.name_cn,
        aliases: values.aliases ?? [],
        description: values.description,
      })
      message.success('已创建审核 Agent')
      form.resetFields()
      await onCreated()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      title="新增审核 Agent"
      open={open}
      onCancel={() => {
        if (creating) return
        form.resetFields()
        onClose()
      }}
      onOk={handleOk}
      confirmLoading={creating}
      okText="创建"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ aliases: [] }}>
        <Form.Item
          name="name_cn"
          label="Agent 名称"
          rules={[{ required: true, message: '请输入名称' }]}
        >
          <Input placeholder="例如：涉政检测" maxLength={64} />
        </Form.Item>
        <Form.Item name="aliases" label="别名">
          <Select
            mode="tags"
            placeholder="按回车添加别名"
            tokenSeparators={[',']}
          />
        </Form.Item>
        <Form.Item name="description" label="说明">
          <TextArea rows={3} placeholder="描述该 Agent 的审核范围" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/* ─────────────── UploadAuditPointsModal ─────────────── */

function UploadAuditPointsModal({
  open,
  item,
  mediaType,
  onClose,
  onUploaded,
}: {
  open: boolean
  item: AuditItem | null
  mediaType: MediaTypeKey
  onClose: () => void
  onUploaded: () => void | Promise<void>
}) {
  const { message } = App.useApp()
  const [batchText, setBatchText] = useState('')
  const [importing, setImporting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const pkg = PACKAGE_BY_MEDIA[mediaType]

  const parsedRows = useMemo(() => {
    const lines = batchText.split('\n')
    const out: { displayIndex: number; label_cn: string; scope_text: string; valid: boolean; error: string | null }[] = []
    let display = 0
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      display += 1
      const parts = trimmed.split('|').map((p) => p.trim())
      const [name, scope] = parts
      let error: string | null = null
      if (!name) error = '名称不能为空'
      else if (name.length > 64) error = '名称超过 64 字符'
      else if (scope && scope.length > 255) error = '审核内容超过 255 字符'
      out.push({ displayIndex: display, label_cn: name ?? '', scope_text: scope ?? '', valid: error === null, error })
    }
    return out
  }, [batchText])

  const validCount = parsedRows.filter((r) => r.valid).length
  const overLimit = validCount > MAX_UPLOAD_POINTS

  const handleFileUpload = async (file: File) => {
    setImporting(true)
    try {
      const { rows, errors } = await parseImportFile(file)
      if (errors.length > 0 || rows.length === 0) {
        message.error(errors[0] ?? '文件无有效数据')
        return false
      }
      setBatchText(rowsToText(rows))
      message.success(`已解析 ${rows.length} 条审核点，请确认后提交`)
      return false
    } catch (e) {
      message.error('解析失败：' + (e as Error).message)
      return false
    } finally {
      setImporting(false)
    }
  }

  const handleSubmit = async () => {
    if (!item || validCount === 0 || overLimit) return
    const valid = parsedRows.filter((r) => r.valid)
    setSubmitting(true)
    try {
      const res: AuditPointBatchResult = await auditPointsApi.createMany(pkg, {
        item_id: item.id,
        points: valid.map((r) => ({
          item_id: item.id,
          label_cn: r.label_cn,
          scope_text: r.scope_text || undefined,
        })),
      })
      if (res.failed > 0) {
        message.warning(`成功 ${res.succeeded} 条，失败 ${res.failed} 条`)
      } else {
        message.success(`已上传 ${res.succeeded} 条审核点`)
      }
      setBatchText('')
      await onUploaded()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={item ? `上传审核点 — ${item.name_cn}` : '上传审核点'}
      open={open}
      onCancel={() => {
        if (submitting) return
        setBatchText('')
        onClose()
      }}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText={validCount > 0 ? `提交 ${validCount} 条` : '提交'}
      okButtonProps={{ disabled: validCount === 0 || overLimit }}
      cancelText="取消"
      width={780}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="上传的文件会被 AI 解析为审核点"
          description={
            <span>
              支持 <code>.txt / .csv / .xlsx</code> 格式。每行格式：<code>审核点 | 审核内容</code>
              <br />
              以 <code>#</code> 开头的行作为注释忽略。xlsx 首行表头须包含「审核点」「审核内容」。
            </span>
          }
        />
        <Upload
          accept=".txt,.csv,.xlsx,.xls"
          showUploadList={false}
          beforeUpload={(file) => {
            void handleFileUpload(file as File)
            return false
          }}
        >
          <Button icon={<InboxOutlined />} loading={importing}>
            选择文件上传
          </Button>
        </Upload>
        {batchText && (
          <>
            <Text type="secondary">
              已识别 {parsedRows.length} 行 / 合法 {validCount} 条
              {overLimit && (
                <Tag color="red" style={{ marginInlineStart: 8 }}>
                  超过 {MAX_UPLOAD_POINTS} 上限
                </Tag>
              )}
            </Text>
            <Input.TextArea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              autoSize={{ minRows: 8, maxRows: 16 }}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
            />
            {parsedRows.some((r) => !r.valid) && (
              <Alert
                type="warning"
                showIcon
                message="存在不合法行"
                description={
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {parsedRows
                      .filter((r) => !r.valid)
                      .map((r) => (
                        <li key={r.displayIndex}>
                          第 {r.displayIndex} 行：{r.error}
                        </li>
                      ))}
                  </ul>
                }
              />
            )}
          </>
        )}
      </Space>
    </Modal>
  )
}

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
  const [modelItem, setModelItem] = useState<AuditItem | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [uploadItem, setUploadItem] = useState<AuditItem | null>(null)

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
  }, [mediaType])

  useEffect(() => {
    let cancelled = false
    setModelLoading(true)
    registeredModelsApi
      // backend caps size at le=100 (registered-models pagination); 100 covers realistic dropdown set
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
      await auditItemsApi.setActiveLargeModelVersion(
        row.package_code,
        row.id,
        versionId ?? null,
      )
      message.success('已更新大模型')
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
        width: '18%',
        render: (v: string, row) => (
          <Link to={`/rules/personal/${mediaType}/${row.id}`}>
            <Text strong>{v}</Text>
          </Link>
        ),
      },
      {
        title: '大模型',
        key: 'model',
        width: '24%',
        render: (_, row) => {
          const currentId = row.active_large_model_version_id ?? undefined
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
                  (x) => x.current_version_id === props.value,
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
        title: '审核点',
        key: 'points',
        width: '28%',
        render: (_, row) => (
          <Space size={8}>
            <Text type="secondary">{row.point_count} 个</Text>
            <Button
              size="small"
              type="link"
              style={{ padding: 0 }}
              onClick={() => setUploadItem(row)}
            >
              上传审核点
            </Button>
          </Space>
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
    [mediaType, models, modelLoading, modelOptions],
  )

  return (
    <div style={{ width: '100%' }}>
      {!embedded && (
        <Breadcrumb
          style={{ marginBottom: 12 }}
          items={[
            { title: <Link to="/strategies">策略中心</Link> },
            { title: '审核策略' },
            { title: `${MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则` },
            { title: <Tag color="green">个性化</Tag> },
          ]}
        />
      )}
      {!embedded && (
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
              onClick={() => setCreateOpen(true)}
            >
              + 新增审核 Agent
            </Button>
          </Space>
        </div>
      )}
      {!embedded && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          自定义审核 Agent 可上传审核点文件由 AI 解析，仅自己可见，影响对应策略。
        </Text>
      )}
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

      <CreateAgentModal
        open={createOpen}
        mediaType={mediaType}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false)
          await reload()
        }}
      />

      <UploadAuditPointsModal
        open={!!uploadItem}
        item={uploadItem}
        mediaType={mediaType}
        onClose={() => setUploadItem(null)}
        onUploaded={async () => {
          setUploadItem(null)
          await reload()
        }}
      />
    </div>
  )
}