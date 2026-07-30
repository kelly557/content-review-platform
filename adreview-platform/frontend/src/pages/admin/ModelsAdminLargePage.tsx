// 模型管理 / 大模型
// 双视图：表格 / 卡片（顶部 Segmented 切换）
// 列（表格）或卡片字段：名称 / 模态 / Provider / Model ID / 启用 / 更新时间
import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AppstoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  TableOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { registeredModelsApi, providersApi } from '@/api/registered-models'
import type {
  LargeModelCategory,
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

  const columns: ColumnsType<FlatRow> = [
    {
      title: '名称',
      dataIndex: 'modelName',
      width: '22%',
      render: (v: string, row) => (
        <Link
          to={`/resources/models/${row.modelId}`}
          style={{ fontWeight: 500 }}
        >
          {v}
        </Link>
      ),
    },
    {
      title: '模态',
      dataIndex: 'largeCategory',
      width: '12%',
      render: (c: LargeModelCategory | null) => {
        if (!c) return <Text type="secondary">—</Text>
        const opt = LARGE_MODEL_CATEGORY_OPTIONS.find((o) => o.value === c)
        return <Tag color={opt?.color ?? 'cyan'}>{opt?.label ?? c}</Tag>
      },
    },
    {
      title: 'Provider',
      dataIndex: 'providerLabel',
      width: '20%',
      render: (v: string | null) =>
        v ? <Text>{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Model ID',
      dataIndex: 'model_name',
      width: '16%',
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
      title: '启用',
      dataIndex: 'status',
      width: '10%',
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
      width: '14%',
      render: (v: string | null) =>
        v ? (
          <Text type="secondary">{dayjs(v).format('YYYY-MM-DD HH:mm')}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
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
    </div>
  )
}

interface ModelCardGridProps {
  items: RegisteredModelListItem[]
  canWrite: boolean
  total: number
  onToggle: (row: RegisteredModelListItem) => void
  onRequestActivate: (row: RegisteredModelListItem) => void
}

function ModelCardGrid({
  items,
  canWrite,
  total,
  onToggle,
  onRequestActivate,
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
                    <Link
                      to={`/resources/models/${m.id}`}
                      style={{ fontWeight: 500 }}
                    >
                      {m.name}
                    </Link>
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
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
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