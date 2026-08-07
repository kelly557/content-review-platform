// 模型管理 / 大模型
// 双视图：表格 / 卡片（顶部 Segmented 切换）
// 列（表格）或卡片字段：名称 / 模态 / Provider / Model ID / API Key / 到期日 / Base URL / 启用 / 更新时间 / 操作
import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AppstoreOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  TableOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { registeredModelsApi, providersApi } from '@/api/registered-models'
import type {
  LargeModelCategory,
  ModelReferencesResponse,
  RegisteredModelListItem,
  RegisteredModelStatus,
  RegisteredProviderOption,
} from '@/types/domain'
import {
  LARGE_MODEL_CATEGORY_OPTIONS,
} from '@/types/domain'
import { useAuthStore } from '@/store'
import CreateModelModal from '@/pages/models/CreateModelModal'
import ConfirmCascadeActivateModal from '@/pages/models/ConfirmCascadeActivateModal'
import ModelReferencesDrawer from '@/pages/models/ModelReferencesDrawer'
import InlineEditableCell, {
  type InlineEditableField,
} from '@/pages/models/InlineEditableCell'

const { Text } = Typography

type ViewMode = 'table' | 'card'

const STATUS_COLOR: Record<RegisteredModelStatus, string> = {
  active: 'green',
  draft: 'default',
  validating: 'blue',
  failed: 'red',
  inactive: 'default',
  archived: 'default',
}

const STATUS_LABEL: Record<RegisteredModelStatus, string> = {
  active: '已发布',
  draft: '草稿',
  validating: '校验中',
  failed: '失败',
  inactive: '已下线',
  archived: '已归档',
}

type FlatRow = {
  flatKey: string
  modelId: number
  modelName: string
  versionText: string
  updatedAt: string | null
  providerLabel: string | null
  modality: string | null
  largeCategory: LargeModelCategory | null
  status: RegisteredModelStatus
  currentVersionId: number | null
  publicId?: string
  /** DB 中的 RegisteredModel.model 字段（业务标识） */
  model_name?: string | null
}

export default function ModelsAdminLargePage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'superadmin' || user?.role === 'root_admin'

  type StatusFilter = 'active' | 'inactive' | null

const [items, setItems] = useState<RegisteredModelListItem[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null)
  const [largeCategoryFilter, setLargeCategoryFilter] = useState<
    LargeModelCategory | null
  >(null)
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const [providerOptions, setProviderOptions] = useState<
    RegisteredProviderOption[]
  >([])
  const [createOpen, setCreateOpen] = useState(false)
  const [cascadeOpen, setCascadeOpen] = useState(false)
  const [cascadeConfirming, setCascadeConfirming] = useState(false)
  const [pendingCascade, setPendingCascade] = useState<{
    target: RegisteredModelListItem
    cascadeIds: number[]
  } | null>(null)

  // —— 行内编辑状态（单一 cell 一时刻只允许 1 个 editing） ————————
  const [editing, setEditing] = useState<{
    rowId: number
    field: InlineEditableField
  } | null>(null)
  // 行内编辑草稿值
  const [drafts, setDrafts] = useState<{
    api_key?: string
    token_expires_at?: Dayjs | null
    endpoint_url?: string
  }>({})
  // 删除（Drawer + 确认 Modal）状态保留
  const [referencesTarget, setReferencesTarget] = useState<{
    modelId: number
    modelName: string
  } | null>(null)
  const [referencesData, setReferencesData] = useState<ModelReferencesResponse | null>(null)
  const [referencesLoading, setReferencesLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const fetchProviders = async () => {
    try {
      const opts = await providersApi.options()
      setProviderOptions(opts)
    } catch {
      // ignore
    }
  }

  const fetchList = async () => {
    setLoading(true)
    try {
      const res = await registeredModelsApi.list({
        kind: 'large',
        size: 100,
        q: q || undefined,
        status:
          statusFilter === 'active'
            ? ('active' as RegisteredModelStatus)
            : undefined,
        large_category: largeCategoryFilter ?? undefined,
        provider_id: providerFilter ? Number(providerFilter) : undefined,
      })
      let fetched = res.items
      // 「未启用」走客户端反向过滤（后端 status 只支持单一值）
      if (statusFilter === 'inactive') {
        fetched = fetched.filter((m) => m.status !== 'active')
      }
      setItems(fetched)
      setTotal(fetched.length)
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProviders()
  }, [])

  useEffect(() => {
    fetchList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRefresh = () => {
    fetchList()
    fetchProviders()
  }

  const handleToggleStatus = async (row: RegisteredModelListItem) => {
    try {
      if (row.status === 'active') {
        await registeredModelsApi.deactivate(row.id)
        message.success('已取消启用')
      } else {
        await registeredModelsApi.activate(row.id)
        message.success('已启用')
      }
      fetchList()
    } catch (err: unknown) {
      const detail = (
        err as { response?: { data?: { detail?: string } } }
      )?.response?.data?.detail
      message.error(`操作失败：${detail ?? '未知错误'}`)
    }
  }

  const requestActivate = async (row: RegisteredModelListItem) => {
    try {
      // 看是否有同模态的 active 同类，作为级联参考
      const sibs = await registeredModelsApi.listActiveSiblings(row.id)
      const cascadeIds = sibs
        .filter((s) => s.id !== row.id)
        .map((s) => s.id)
      if (cascadeIds.length > 0) {
        setPendingCascade({ target: row, cascadeIds })
        setCascadeOpen(true)
        return
      }
      await registeredModelsApi.activate(row.id)
      message.success('已启用')
      fetchList()
    } catch (err: unknown) {
      const detail = (
        err as { response?: { data?: { detail?: string } } }
      )?.response?.data?.detail
      message.error(`操作失败：${detail ?? '未知错误'}`)
    }
  }

  const confirmCascade = async () => {
    if (!pendingCascade) return
    setCascadeConfirming(true)
    try {
      await registeredModelsApi.activate(pendingCascade.target.id)
      message.success(
        `已启用，并将同组 ${pendingCascade.cascadeIds.length} 个模型下线`,
      )
      setCascadeOpen(false)
      setPendingCascade(null)
      fetchList()
    } catch (err: unknown) {
      const detail = (
        err as { response?: { data?: { detail?: string } } }
      )?.response?.data?.detail
      message.error(`操作失败：${detail ?? '未知错误'}`)
    } finally {
      setCascadeConfirming(false)
    }
  }

  // —— 行内编辑 save handlers ————————
  // 流程：先 precheck(新值) → 失败 → 返回错误字符串（cell 下方红字，editing 不退出）
  //       成功 → 真实 API 调用 → 退出 editing → 刷新列表
  const handleSaveField = async (
    rowId: number,
    field: InlineEditableField,
  ): Promise<string | void> => {
    const m = items.find((i) => i.id === rowId)
    if (!m?.provider_id) return '无 Provider 关联'

    try {
      if (field === 'api_key') {
        const newKey = drafts.api_key ?? ''
        if (!newKey.trim()) return '请填写 API Key'
        // precheck: 新 key + 现有 url
        const check = await providersApi.validate(m.provider_id, {
          api_key: newKey,
          endpoint_url: m.provider_base_url ?? undefined,
        })
        if (!check.ok) {
          return `测试连接失败：${check.message}（HTTP ${check.http_status ?? '-'} · ${check.latency_ms ?? '-'}ms）`
        }
        await providersApi.rotateApiKey(m.provider_id, { api_key: newKey })
        message.success('API Key 已替换')
      } else if (field === 'token_expires_at') {
        const newDate = drafts.token_expires_at
        if (!newDate) return '请选择到期日'
        // precheck: 用 DB 现值（不改 key/url，只确认 Provider 还活着）
        const check = await providersApi.validate(m.provider_id, {})
        if (!check.ok) {
          return `测试连接失败：${check.message}（HTTP ${check.http_status ?? '-'} · ${check.latency_ms ?? '-'}ms）`
        }
        await providersApi.setTokenExpiresAt(m.provider_id, {
          token_expires_at: newDate.toDate().toISOString(),
        })
        message.success('到期日已更新')
      } else if (field === 'endpoint_url') {
        const newUrl = drafts.endpoint_url ?? ''
        if (!newUrl.trim()) return '请填写 Base URL'
        // precheck: 新 url + 现有 key
        const check = await providersApi.validate(m.provider_id, {
          endpoint_url: newUrl,
        })
        if (!check.ok) {
          return `测试连接失败：${check.message}（HTTP ${check.http_status ?? '-'} · ${check.latency_ms ?? '-'}ms）`
        }
        await providersApi.update(m.provider_id, { endpoint_url: newUrl })
        message.success('Base URL 已更新')
      }
      fetchList()
    } catch (err: unknown) {
      const detail = (
        err as { response?: { data?: { detail?: string | { message?: string } } } }
      )?.response?.data?.detail
      const text =
        typeof detail === 'string'
          ? detail
          : typeof detail === 'object' && detail && 'message' in detail
            ? String(detail.message)
            : '保存失败'
      return text
    }
  }

  const startEdit = (rowId: number, field: InlineEditableField) => {
    const m = items.find((i) => i.id === rowId)
    if (!m) return
    // 初始化草稿值
    if (field === 'api_key') setDrafts((d) => ({ ...d, api_key: '' }))
    if (field === 'token_expires_at')
      setDrafts((d) => ({
        ...d,
        token_expires_at: m.token_expires_at ? dayjs(m.token_expires_at) : null,
      }))
    if (field === 'endpoint_url')
      setDrafts((d) => ({ ...d, endpoint_url: m.provider_base_url ?? '' }))
    setEditing({ rowId, field })
  }

  const cancelEdit = () => {
    setEditing(null)
    setDrafts({})
  }

  // drafts setter：暴露给卡片渲染层 onChange 调用
  const setDraftField = (
    field: 'api_key' | 'endpoint_url',
    value: string,
  ) => {
    setDrafts((d) => ({ ...d, [field]: value }))
  }
  const setDraftFieldDate = (
    field: 'token_expires_at',
    value: Dayjs | null,
  ) => {
    setDrafts((d) => ({ ...d, [field]: value }))
  }

  const handleDeleteClick = async (row: RegisteredModelListItem) => {
    setReferencesTarget({ modelId: row.id, modelName: row.name })
    setReferencesData(null)
    setReferencesLoading(true)
    try {
      const refs = await registeredModelsApi.references(row.id)
      setReferencesData(refs)
    } catch {
      message.error('查询引用失败')
      setReferencesTarget(null)
    } finally {
      setReferencesLoading(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!referencesTarget) return
    setDeleting(true)
    try {
      await registeredModelsApi.delete(referencesTarget.modelId)
      message.success('已删除')
      setReferencesTarget(null)
      setReferencesData(null)
      fetchList()
    } catch (err: unknown) {
      const detail = (
        err as { response?: { data?: { detail?: string } } }
      )?.response?.data?.detail
      const text = typeof detail === 'string' ? detail : '删除失败'
      message.error(text)
    } finally {
      setDeleting(false)
    }
  }

  const columns: ColumnsType<FlatRow> = [
    {
      title: '名称',
      dataIndex: 'modelName',
      width: '14%',
      render: (v: string) => (
        <span style={{ fontWeight: 500 }}>{v}</span>
      ),
    },
    {
      title: '模态',
      dataIndex: 'largeCategory',
      width: '8%',
      render: (c: LargeModelCategory | null) => {
        if (!c) return <Text type="secondary">—</Text>
        const opt = LARGE_MODEL_CATEGORY_OPTIONS.find((o) => o.value === c)
        return <Tag color={opt?.color ?? 'cyan'}>{opt?.label ?? c}</Tag>
      },
    },
    {
      title: 'Provider',
      dataIndex: 'providerLabel',
      width: '12%',
      render: (v: string | null) =>
        v ? <Text>{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Model ID',
      dataIndex: 'model_name',
      width: '12%',
      render: (id: string | null | undefined) =>
        id ? (
          <Text code style={{ fontSize: 12 }}>
            {id}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'API Key',
      key: 'api_key',
      width: '14%',
      render: (_v: unknown, row: FlatRow) => {
        const m = items.find((i) => i.id === row.modelId)
        if (!m?.provider_id) return <Text type="secondary">—</Text>
        const isEditingThis =
          editing?.rowId === row.modelId && editing.field === 'api_key'
        return (
          <InlineEditableCell
            field="api_key"
            value={m.masked_token}
            canWrite={canWrite}
            isEditing={isEditingThis}
            onStartEdit={() => startEdit(row.modelId, 'api_key')}
            onCancelEdit={cancelEdit}
            onSave={() => handleSaveField(row.modelId, 'api_key')}
            renderDisplay={() => (
              <code style={{ fontSize: 12, color: '#475569' }}>
                {m.masked_token ?? '—'}
              </code>
            )}
            renderInput={() => (
              <Input
                size="small"
                placeholder="新的 API Key"
                value={drafts.api_key ?? ''}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, api_key: e.target.value }))
                }
                onPressEnter={() => handleSaveField(row.modelId, 'api_key')}
              />
            )}
          />
        )
      },
    },
    {
      title: '到期日',
      key: 'token_expires_at',
      width: '14%',
      render: (_v: unknown, row: FlatRow) => {
        const m = items.find((i) => i.id === row.modelId)
        if (!m?.provider_id) return <Text type="secondary">—</Text>
        const isEditingThis =
          editing?.rowId === row.modelId && editing.field === 'token_expires_at'
        const exp = m.token_expires_at ? dayjs(m.token_expires_at) : null
        const isExpired = exp ? exp.isBefore(dayjs()) : false
        return (
          <InlineEditableCell
            field="token_expires_at"
            value={m.token_expires_at}
            canWrite={canWrite}
            isEditing={isEditingThis}
            onStartEdit={() => startEdit(row.modelId, 'token_expires_at')}
            onCancelEdit={cancelEdit}
            onSave={() => handleSaveField(row.modelId, 'token_expires_at')}
            renderDisplay={() =>
              exp ? (
                <Space size={4}>
                  <Text
                    style={{ fontSize: 12 }}
                    type={isExpired ? 'danger' : undefined}
                  >
                    {exp.format('YYYY-MM-DD HH:mm')}
                  </Text>
                  {isExpired && (
                    <Tag color="red" style={{ marginLeft: 0 }}>已过期</Tag>
                  )}
                </Space>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>未配置</Text>
              )
            }
            renderInput={() => (
              <DatePicker
                size="small"
                showTime
                style={{ width: '100%' }}
                format="YYYY-MM-DD HH:mm:ss"
                placeholder="选择到期日"
                value={drafts.token_expires_at ?? null}
                onChange={(v) =>
                  setDrafts((d) => ({ ...d, token_expires_at: v }))
                }
              />
            )}
          />
        )
      },
    },
    {
      title: 'Base URL',
      key: 'provider_base_url',
      width: '14%',
      render: (_v: unknown, row: FlatRow) => {
        const m = items.find((i) => i.id === row.modelId)
        if (!m?.provider_id) return <Text type="secondary">—</Text>
        const url = m.provider_base_url ?? ''
        const isEditingThis =
          editing?.rowId === row.modelId && editing.field === 'endpoint_url'
        return (
          <InlineEditableCell
            field="endpoint_url"
            value={url}
            canWrite={canWrite}
            isEditing={isEditingThis}
            onStartEdit={() => startEdit(row.modelId, 'endpoint_url')}
            onCancelEdit={cancelEdit}
            onSave={() => handleSaveField(row.modelId, 'endpoint_url')}
            renderDisplay={() =>
              url ? (
                <Text
                  ellipsis
                  style={{ fontSize: 12, maxWidth: 180, color: '#475569' }}
                  title={url}
                >
                  {url}
                </Text>
              ) : (
                <Text type="secondary">—</Text>
              )
            }
            renderInput={() => (
              <Input
                size="small"
                placeholder="https://api.openai.com/v1"
                value={drafts.endpoint_url ?? ''}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, endpoint_url: e.target.value }))
                }
                onPressEnter={() => handleSaveField(row.modelId, 'endpoint_url')}
              />
            )}
          />
        )
      },
    },
    {
      title: '启用',
      dataIndex: 'status',
      width: '7%',
      render: (s: RegisteredModelStatus, row) => {
        if (!canWrite) {
          return <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>
        }
        const model = row as unknown as RegisteredModelListItem
        return (
          <Switch
            size="small"
            checked={s === 'active'}
            onChange={(checked) => {
              if (checked) {
                requestActivate(model)
              } else {
                handleToggleStatus(model)
              }
            }}
          />
        )
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: '10%',
      render: (v: string | null) =>
        v ? (
          <Text type="secondary">{dayjs(v).format('YYYY-MM-DD HH:mm')}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: '6%',
      render: (_v: unknown, row: FlatRow) =>
        canWrite ? (
          <Tooltip title="删除模型">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteClick(row as unknown as RegisteredModelListItem)}
            />
          </Tooltip>
        ) : null,
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            模型管理 / 大模型
          </Typography.Title>
          <Text type="secondary">
            大模型（LLM）注册、启用管理
          </Text>
        </div>
        <Space>
          <Segmented<ViewMode>
            value={viewMode}
            onChange={(v) => setViewMode(v)}
            options={[
              { value: 'table', label: '表格', icon: <TableOutlined /> },
              { value: 'card', label: '卡片', icon: <AppstoreOutlined /> },
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            disabled={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            disabled={!canWrite}
          >
            添加模型
          </Button>
        </Space>
      </div>

      {/* 过滤栏 */}
      <div
        style={{
          background: '#fff',
          padding: 16,
          borderRadius: 8,
          marginBottom: 12,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Input
          placeholder="搜索模型名称 / Model ID"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={() => fetchList()}
          style={{ width: 240 }}
        />
        <Select
          placeholder="模态"
          allowClear
          value={largeCategoryFilter}
          onChange={(v) =>
            setLargeCategoryFilter((v as LargeModelCategory) ?? null)
          }
          style={{ width: 140 }}
          options={LARGE_MODEL_CATEGORY_OPTIONS.filter(
            (o) => o.value === 'text' || o.value === 'multimodal',
          ).map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        <Select
          placeholder="状态"
          allowClear
          value={statusFilter}
          onChange={(v) =>
            setStatusFilter(v as StatusFilter)
          }
          style={{ width: 110 }}
          options={[
            { value: 'active', label: '启用' },
            { value: 'inactive', label: '未启用' },
          ]}
        />
        <Select
          placeholder="Provider"
          allowClear
          value={providerFilter}
          onChange={(v) => setProviderFilter(v ?? null)}
          style={{ width: 200 }}
          showSearch
          optionFilterProp="label"
          options={providerOptions.map((p) => ({
            value: String(p.id),
            label: p.display_name,
          }))}
        />
        <Button onClick={() => fetchList()}>查询</Button>
        <div style={{ flex: 1 }} />
        <Text type="secondary">共 {total} 条</Text>
      </div>

      {/* 视图切换：表格 / 卡片 */}
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <Skeleton loading={loading && items.length === 0} active>
          {viewMode === 'table' ? (
            <Table<FlatRow>
              rowKey="flatKey"
              size="middle"
              pagination={{
                total,
                pageSize: 50,
                showSizeChanger: false,
                onChange: () => {},
              }}
              columns={columns}
              dataSource={items.map((m) => ({
                flatKey: `r-${m.id}`,
                modelId: m.id,
                modelName: m.name,
                versionText:
                  m.current_version_label ??
                  (m.current_version_no ? `v${m.current_version_no}` : '—'),
                updatedAt: m.updated_at,
                providerLabel: m.provider_label ?? null,
                modality: m.modality ?? null,
                largeCategory: m.large_category,
                status: m.status,
                currentVersionId: m.current_version_id,
                model_name: m.model_name ?? null,
              }))}
              scroll={{ x: 'max-content' }}
              footer={() => <Text type="secondary">共 {total} 条</Text>}
              locale={{
                emptyText: <Empty description="暂无大模型，请先添加模型" />,
              }}
            />
          ) : (
            <ModelCardGrid
              items={items}
              canWrite={canWrite}
              onToggle={handleToggleStatus}
              onRequestActivate={requestActivate}
              total={total}
              editing={editing}
              drafts={drafts}
              setDraftField={setDraftField}
              setDraftFieldDate={setDraftFieldDate}
              startEdit={startEdit}
              cancelEdit={cancelEdit}
              handleSaveField={handleSaveField}
            />
          )}
        </Skeleton>
      </div>

      {/* 新增大模型 Drawer（复用现有 CreateModelModal.mode='large'） */}
      <CreateModelModal
        open={createOpen}
        mode="large"
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          fetchList()
        }}
      />

      {/* 级联激活确认 */}
      <ConfirmCascadeActivateModal
        open={cascadeOpen}
        newModelName={pendingCascade?.target.name ?? ''}
        siblings={(pendingCascade?.cascadeIds ?? []).map((id) => ({
          id,
          name: '',
          version_label: null,
        }))}
        confirming={cascadeConfirming}
        onConfirm={confirmCascade}
        onCancel={() => {
          setCascadeOpen(false)
          setPendingCascade(null)
        }}
      />

      <ModelReferencesDrawer
        open={referencesTarget !== null}
        loading={referencesLoading}
        data={referencesData}
        onClose={() => {
          setReferencesTarget(null)
          setReferencesData(null)
        }}
      />

      <Modal
        title="确认删除"
        open={referencesTarget !== null && referencesData?.is_blocked === false}
        okText="确认删除"
        okButtonProps={{ danger: true, loading: deleting }}
        cancelText="取消"
        onCancel={() => {
          setReferencesTarget(null)
          setReferencesData(null)
        }}
        onOk={handleConfirmDelete}
        destroyOnClose
      >
        <p>
          确认删除模型 <Text strong>{referencesTarget?.modelName}</Text> 吗？
        </p>
        <p style={{ color: '#94a3b8', fontSize: 12 }}>
          删除后该模型会被软删除（is_deleted=true），无法恢复。
        </p>
      </Modal>
    </div>
  )
}

interface ModelCardGridProps {
  items: RegisteredModelListItem[]
  canWrite: boolean
  total: number
  onToggle: (row: RegisteredModelListItem) => void
  onRequestActivate: (row: RegisteredModelListItem) => void
  editing: { rowId: number; field: InlineEditableField } | null
  drafts: {
    api_key?: string
    token_expires_at?: Dayjs | null
    endpoint_url?: string
  }
  setDraftField: (
    field: 'api_key' | 'endpoint_url',
    value: string,
  ) => void
  setDraftFieldDate: (
    field: 'token_expires_at',
    value: Dayjs | null,
  ) => void
  startEdit: (rowId: number, field: InlineEditableField) => void
  cancelEdit: () => void
  handleSaveField: (
    rowId: number,
    field: InlineEditableField,
  ) => Promise<string | void>
}

function ModelCardGrid({
  items,
  canWrite,
  total,
  onToggle,
  onRequestActivate,
  editing,
  drafts,
  setDraftField,
  setDraftFieldDate,
  startEdit,
  cancelEdit,
  handleSaveField,
}: ModelCardGridProps) {
  if (items.length === 0) {
    return <Empty description="暂无大模型，请先添加模型" />
  }
  return (
    <div>
      <Row gutter={[16, 16]}>
        {items.map((m) => {
          const categoryOpt = m.large_category
            ? LARGE_MODEL_CATEGORY_OPTIONS.find(
                (o) => o.value === m.large_category,
              )
            : null
          return (
            <Col key={m.id} xs={24} sm={12} md={8} lg={8} xl={6}>
              <Card
                hoverable
                size="small"
                styles={{ body: { padding: 16 } }}
                title={
                  <Space size={4} wrap>
                    <span style={{ fontWeight: 500 }}>{m.name}</span>
                    {categoryOpt && (
                      <Tag
                        color={categoryOpt.color}
                        style={{ margin: 0 }}
                      >
                        {categoryOpt.label}
                      </Tag>
                    )}
                  </Space>
                }
                extra={
                  canWrite ? (
                    <Switch
                      size="small"
                      checked={m.status === 'active'}
                      onChange={(checked) => {
                        if (checked) {
                          onRequestActivate(m)
                        } else {
                          onToggle(m)
                        }
                      }}
                    />
                  ) : (
                    <Tag color={STATUS_COLOR[m.status]}>
                      {STATUS_LABEL[m.status]}
                    </Tag>
                  )
                }
              >
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Provider：
                    </Text>
                    <Text>{m.provider_label ?? '—'}</Text>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Model ID：
                    </Text>
                    <Text code style={{ fontSize: 12 }}>
                      {m.model_name ?? '—'}
                    </Text>
                  </div>
                  {m.provider_id && (
                    <>
                      <CardRow
                        label="API Key"
                        content={
                          <InlineEditableCell
                            field="api_key"
                            value={m.masked_token}
                            canWrite={canWrite}
                            isEditing={
                              editing?.rowId === m.id &&
                              editing.field === 'api_key'
                            }
                            onStartEdit={() => startEdit(m.id, 'api_key')}
                            onCancelEdit={cancelEdit}
                            onSave={() => handleSaveField(m.id, 'api_key')}
                            renderDisplay={() => (
                              <code
                                style={{ fontSize: 12, color: '#475569' }}
                              >
                                {m.masked_token ?? '—'}
                              </code>
                            )}
                            renderInput={() => (
                              <Input
                                size="small"
                                placeholder="新的 API Key"
                                value={drafts.api_key ?? ''}
                                onChange={(e) =>
                                  setDraftField('api_key', e.target.value)
                                }
                                onPressEnter={() =>
                                  handleSaveField(m.id, 'api_key')
                                }
                              />
                            )}
                          />
                        }
                      />
                      <CardRow
                        label="到期日"
                        content={
                          <InlineEditableCell
                            field="token_expires_at"
                            value={m.token_expires_at}
                            canWrite={canWrite}
                            isEditing={
                              editing?.rowId === m.id &&
                              editing.field === 'token_expires_at'
                            }
                            onStartEdit={() =>
                              startEdit(m.id, 'token_expires_at')
                            }
                            onCancelEdit={cancelEdit}
                            onSave={() =>
                              handleSaveField(m.id, 'token_expires_at')
                            }
                            renderDisplay={() => {
                              const exp = m.token_expires_at
                                ? dayjs(m.token_expires_at)
                                : null
                              if (!exp) {
                                return (
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 12 }}
                                  >
                                    未配置
                                  </Text>
                                )
                              }
                              const isExpired = exp.isBefore(dayjs())
                              return (
                                <Space size={4}>
                                  <Text
                                    style={{ fontSize: 12 }}
                                    type={isExpired ? 'danger' : undefined}
                                  >
                                    {exp.format('YYYY-MM-DD HH:mm')}
                                  </Text>
                                  {isExpired && (
                                    <Tag
                                      color="red"
                                      style={{ marginLeft: 0 }}
                                    >
                                      已过期
                                    </Tag>
                                  )}
                                </Space>
                              )
                            }}
                            renderInput={() => (
                              <DatePicker
                                size="small"
                                showTime
                                style={{ width: '100%' }}
                                format="YYYY-MM-DD HH:mm:ss"
                                placeholder="选择到期日"
                                value={drafts.token_expires_at ?? null}
                                onChange={(v) =>
                                  setDraftFieldDate('token_expires_at', v)
                                }
                              />
                            )}
                          />
                        }
                      />
                      <CardRow
                        label="Base URL"
                        content={
                          <InlineEditableCell
                            field="endpoint_url"
                            value={m.provider_base_url}
                            canWrite={canWrite}
                            isEditing={
                              editing?.rowId === m.id &&
                              editing.field === 'endpoint_url'
                            }
                            onStartEdit={() =>
                              startEdit(m.id, 'endpoint_url')
                            }
                            onCancelEdit={cancelEdit}
                            onSave={() =>
                              handleSaveField(m.id, 'endpoint_url')
                            }
                            renderDisplay={() =>
                              m.provider_base_url ? (
                                <Text
                                  ellipsis
                                  style={{
                                    fontSize: 12,
                                    color: '#475569',
                                  }}
                                  title={m.provider_base_url}
                                >
                                  {m.provider_base_url}
                                </Text>
                              ) : (
                                <Text type="secondary">—</Text>
                              )
                            }
                            renderInput={() => (
                              <Input
                                size="small"
                                placeholder="https://api.openai.com/v1"
                                value={drafts.endpoint_url ?? ''}
                                onChange={(e) =>
                                  setDraftField('endpoint_url', e.target.value)
                                }
                                onPressEnter={() =>
                                  handleSaveField(m.id, 'endpoint_url')
                                }
                              />
                            )}
                          />
                        }
                      />
                    </>
                  )}
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      更新时间：
                    </Text>
                    <Text type="secondary">
                      {m.updated_at
                        ? dayjs(m.updated_at).format('YYYY-MM-DD HH:mm')
                        : '—'}
                    </Text>
                  </div>
                </Space>
              </Card>
            </Col>
          )
        })}
      </Row>
      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <Text type="secondary">共 {total} 条</Text>
      </div>
    </div>
  )
}

/** 卡片内的可编辑行：左侧 label + 右侧 cell（占满剩余宽度） */
function CardRow({
  label,
  content,
}: {
  label: string
  content: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <Text
        type="secondary"
        style={{ fontSize: 12, minWidth: 70, flexShrink: 0 }}
      >
        {label}：
      </Text>
      <div style={{ flex: 1, minWidth: 0 }}>{content}</div>
    </div>
  )
}