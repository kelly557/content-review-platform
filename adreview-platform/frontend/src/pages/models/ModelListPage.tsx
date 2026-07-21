import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  App,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  TagsOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { registeredModelsApi, providersApi } from '@/api/registered-models'
import type {
  AuditPointEntry,
  LargeModelCategory,
  RegisteredModelListItem,
  RegisteredModelStatus,
  RegisteredProviderOption,
  SmallModelCategory,
} from '@/types/domain'
import {
  LARGE_MODEL_CATEGORY_OPTIONS,
  REGISTERED_MODEL_STATUS_OPTIONS,
  SMALL_MODEL_CATEGORY_OPTIONS,
} from '@/types/domain'
import { useAuthStore } from '@/store'
import CreateModelModal from './CreateModelModal'

const { Text } = Typography

type ModelTab = 'large' | 'small'
type ModalityKey = 'text' | 'image' | 'unknown'

type ModelRow = {
  id: number
  name: string
  versionText: string
  updatedAt: string | null
  points: AuditPointEntry[]
  status: RegisteredModelStatus
}

type CategoryGroup = {
  key: string
  label: string
  color: string
  count: number
  models: ModelRow[]
}

type ModalityGroup = {
  key: ModalityKey
  label: string
  color: string
  icon: React.ReactNode
  count: number
  categories: CategoryGroup[]
}

const MODALITY_META: Record<ModalityKey, { label: string; color: string; icon: React.ReactNode }> = {
  text: { label: '文本', color: 'blue', icon: <TagsOutlined /> },
  image: { label: '图片', color: 'geekblue', icon: <PictureOutlined /> },
  unknown: { label: '未设置', color: 'default', icon: <TagsOutlined /> },
}

type FlatRow = {
  flatKey: string
  modelId: number
  modelName: string
  versionText: string
  updatedAt: string | null
  point: AuditPointEntry | null
  rowSpan: number
  status: RegisteredModelStatus
}

type GroupTitleRow = {
  flatKey: string
  catKey: string
  catLabel: string
  catCount: number
}

type UnionRow = FlatRow | GroupTitleRow

function isGroupRow(row: UnionRow): row is GroupTitleRow {
  return (row as GroupTitleRow).catKey !== undefined
}

export default function ModelListPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'superadmin' || user?.role === 'root_admin'

  const [activeTab, setActiveTab] = useState<ModelTab>('large')
  const [q, setQ] = useState('')
  const [smallCategory, setSmallCategory] = useState<SmallModelCategory | null>(null)
  const [largeCategory, setLargeCategory] = useState<LargeModelCategory | null>(null)
  const [status, setStatus] = useState<RegisteredModelStatus | null>(null)
  const [providerFilter, setProviderFilter] = useState<string | null>(null)

  const [items, setItems] = useState<RegisteredModelListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [providerOptions, setProviderOptions] = useState<RegisteredProviderOption[]>([])

  const [activeModality, setActiveModality] = useState<ModalityKey>('text')
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null)

  const fetchList = async () => {
    setLoading(true)
    try {
      const data = await registeredModelsApi.list({
        q: q || undefined,
        kind: activeTab,
        small_category: smallCategory ?? undefined,
        large_category: largeCategory ?? undefined,
        provider_id: providerFilter ? Number(providerFilter) : undefined,
        status: status ?? undefined,
        size: 50,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  const fetchProviders = async () => {
    try {
      const list = await providersApi.options()
      setProviderOptions(list)
    } catch {
      setProviderOptions([])
    }
  }

  useEffect(() => {
    void fetchList()
    void fetchProviders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void fetchList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const openCreate = () => {
    if (!canWrite) {
      message.warning('仅管理员可添加模型')
      return
    }
    setCreateOpen(true)
  }

  const onToggleEnabled = async (
    row: { id: number; name: string },
    next: boolean,
  ) => {
    if (!canWrite) {
      message.warning('仅管理员可启用/停用模型')
      return
    }
    try {
      if (next) {
        await registeredModelsApi.activate(row.id)
        message.success(`「${row.name}」已启用`)
      } else {
        await registeredModelsApi.deactivate(row.id)
        message.success(`「${row.name}」已停用`)
      }
      void fetchList()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '操作失败')
    }
  }

  const renderEnableSwitch = (
    status: RegisteredModelStatus,
    row: { id: number; name: string },
  ) => {
    const enabled = status === 'active'
    const toggleable = status === 'active' || status === 'inactive'
    const reason = !toggleable
      ? status === 'archived'
        ? '已归档的模型不可启用'
        : `当前状态为 ${
            REGISTERED_MODEL_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status
          }，不可直接启用`
      : ''
    const sw = (
      <Switch
        size="small"
        checked={enabled}
        disabled={!canWrite || !toggleable}
        onChange={(next) => onToggleEnabled(row, next)}
        aria-label={`${row.name} 启用状态`}
      />
    )
    return reason ? <Tooltip title={reason}>{sw}</Tooltip> : sw
  }

  const onTabChange = (next: string) => {
    const tab = next as ModelTab
    setActiveTab(tab)
    if (tab === 'large') {
      setSmallCategory(null)
    } else {
      setLargeCategory(null)
      setProviderFilter(null)
    }
  }

  const largeColumns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: '18%' },
      {
        title: '能力类型',
        dataIndex: 'large_category',
        width: '10%',
        render: (v: LargeModelCategory | null) => {
          if (!v) return '-'
          const opt = LARGE_MODEL_CATEGORY_OPTIONS.find((o) => o.value === v)
          return opt ? <Tag color={opt.color}>{opt.label}</Tag> : v
        },
      },
      {
        title: 'Provider',
        dataIndex: 'provider_label',
        width: '14%',
        render: (v: string | null, row: RegisteredModelListItem) =>
          row.provider_id ? (
            <Link to={`/resources/providers/${row.provider_id}`}>
              <span style={{ color: '#0369A1' }}>{v || `#${row.provider_id}`}</span>
            </Link>
          ) : (
            <Text type="secondary">未挂载</Text>
          ),
      },
      { title: 'Model ID', dataIndex: 'model_name', width: '16%' },
      {
        title: '启用',
        dataIndex: 'status',
        width: '8%',
        render: (v: RegisteredModelStatus, row: RegisteredModelListItem) =>
          renderEnableSwitch(v, row),
      },
      {
        title: '更新时间',
        dataIndex: 'updated_at',
        width: '12%',
        render: (v: string | null) =>
          v ? (
            <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm')}</span>
          ) : (
            '-'
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite],
  )

  const smallGroups = useMemo<ModalityGroup[]>(() => {
    const byModality = new Map<ModalityKey, Map<string, ModelRow[]>>()
    for (const m of items) {
      const mod = (m.modality ?? 'unknown') as ModalityKey
      const cat = m.small_category ?? 'unknown'
      const versionText = m.current_version_no
        ? m.current_version_label
          ? `v${m.current_version_no} · ${m.current_version_label}`
          : `v${m.current_version_no}`
        : '-'
      const points: AuditPointEntry[] = (() => {
        const raw = m.current_version_config
        if (!raw) return []
        const rawPoints = (raw as { points?: unknown[] }).points
        if (!Array.isArray(rawPoints)) return []
        const out: AuditPointEntry[] = []
        for (const p of rawPoints) {
          if (typeof p === 'string') {
            out.push({ label: p, description: '' })
          } else if (
            p != null &&
            typeof p === 'object' &&
            typeof (p as { label?: unknown }).label === 'string'
          ) {
            const obj = p as { label: string; description?: unknown }
            out.push({
              label: obj.label,
              description: typeof obj.description === 'string' ? obj.description : '',
            })
          }
        }
        return out
      })()
      const row: ModelRow = {
        id: m.id,
        name: m.name,
        versionText,
        updatedAt: m.updated_at,
        points,
        status: m.status,
      }
      if (!byModality.has(mod)) byModality.set(mod, new Map())
      const byCat = byModality.get(mod)!
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(row)
    }

    const groups: ModalityGroup[] = []
    for (const [mod, byCat] of byModality.entries()) {
      const meta = MODALITY_META[mod] ?? MODALITY_META.unknown
      let totalCount = 0
      const categories: CategoryGroup[] = []
      for (const [cat, models] of byCat.entries()) {
        totalCount += models.length
        const catOpt = SMALL_MODEL_CATEGORY_OPTIONS.find((o) => o.value === cat)
        categories.push({
          key: `${mod}-${cat}`,
          label: catOpt?.label ?? cat,
          color: catOpt?.color ?? 'default',
          count: models.length,
          models,
        })
      }
      groups.push({
        key: mod,
        label: meta.label,
        color: meta.color,
        icon: meta.icon,
        count: totalCount,
        categories,
      })
    }
    return groups
  }, [items])

  const visibleModality = smallGroups.find((g) => g.key === activeModality) ?? smallGroups[0]

  const unionRows = useMemo<UnionRow[]>(() => {
    if (!visibleModality) return []
    const rows: UnionRow[] = []
    for (const cat of visibleModality.categories) {
      rows.push({
        flatKey: `group-${cat.key}`,
        catKey: cat.key,
        catLabel: cat.label,
        catCount: cat.count,
      })
      for (const m of cat.models) {
        const span = Math.max(m.points.length, 1)
        if (m.points.length === 0) {
          rows.push({
            flatKey: `${m.id}-empty`,
            modelId: m.id,
            modelName: m.name,
            versionText: m.versionText,
            updatedAt: m.updatedAt,
            point: null,
            rowSpan: 1,
            status: m.status,
          })
        } else {
          m.points.forEach((p, i) => {
            rows.push({
              flatKey: `${m.id}-${i}`,
              modelId: m.id,
              modelName: m.name,
              versionText: m.versionText,
              updatedAt: m.updatedAt,
              point: p,
              rowSpan: i === 0 ? span : 0,
              status: m.status,
            })
          })
        }
      }
    }
    return rows
  }, [visibleModality])

  useEffect(() => {
    if (!visibleModality || visibleModality.categories.length === 0) {
      setActiveAnchor(null)
      return
    }
    const exists = visibleModality.categories.some((c) => c.key === activeAnchor)
    if (!exists) {
      setActiveAnchor(visibleModality.categories[0].key)
    }
  }, [visibleModality, activeAnchor])

  useEffect(() => {
    if (!visibleModality) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          const key = visible[0].target.id.replace('cat-', '')
          setActiveAnchor(key)
        }
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
    )
    visibleModality.categories.forEach((cat) => {
      const el = document.getElementById(`cat-${cat.key}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [visibleModality])

  const columns: ColumnsType<UnionRow> = [
    {
      title: '模型名称',
      key: 'name',
      width: '18%',
      render: (_, row) =>
        isGroupRow(row) ? (
          <span style={{ fontWeight: 500 }}>{row.catLabel}（{row.catCount} 个模型）</span>
        ) : (
          <span style={{ fontWeight: row.rowSpan > 0 ? 500 : 400 }}>{row.modelName}</span>
        ),
      onCell: (row) => {
        if (isGroupRow(row)) {
          return { colSpan: 6, id: `cat-${row.catKey}` }
        }
        return { rowSpan: row.rowSpan }
      },
    },
    {
      title: '启用',
      key: 'enabled',
      width: '8%',
      render: (_, row) =>
        isGroupRow(row)
          ? null
          : renderEnableSwitch(row.status, { id: row.modelId, name: row.modelName }),
      onCell: (row) => (isGroupRow(row) ? { colSpan: 0 } : { rowSpan: row.rowSpan }),
    },
    {
      title: '版本号',
      key: 'version',
      width: '14%',
      render: (_, row) =>
        isGroupRow(row) ? null : (
          <Text type="secondary" style={{ fontSize: 12 }}>{row.versionText}</Text>
        ),
      onCell: (row) => {
        if (isGroupRow(row)) return { colSpan: 0 }
        return { rowSpan: row.rowSpan }
      },
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: '14%',
      render: (_, row) =>
        isGroupRow(row) ? null : row.updatedAt ? (
          <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(row.updatedAt).format('YYYY-MM-DD HH:mm')}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
      onCell: (row) => {
        if (isGroupRow(row)) return { colSpan: 0 }
        return { rowSpan: row.rowSpan }
      },
    },
    {
      title: '审核点',
      key: 'point',
      width: '18%',
      render: (_, row) =>
        isGroupRow(row) ? null : row.point ? (
          <span style={{ color: '#020617' }}>{row.point.label}</span>
        ) : (
          <span style={{ color: '#94a3b8' }}>未配置审核点</span>
        ),
      onCell: (row) => (isGroupRow(row) ? { colSpan: 0 } : {}),
    },
    {
      title: '审核说明',
      key: 'description',
      render: (_, row) =>
        isGroupRow(row) ? null : row.point?.description ? (
          <span style={{ color: '#64748b', fontSize: 12 }}>{row.point.description}</span>
        ) : (
          <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span>
        ),
      onCell: (row) => (isGroupRow(row) ? { colSpan: 0 } : {}),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      {!canWrite && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="您当前为只读用户。如需添加或编辑模型，请联系管理员。"
        />
      )}
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder={activeTab === 'large' ? '搜索大模型名称 / Model ID' : '搜索小模型名称'}
          onSearch={(val) => {
            setQ(val)
            void fetchList()
          }}
          style={{ width: 240 }}
        />
        {activeTab === 'large' && (
          <Select
            allowClear
            placeholder="能力类型"
            style={{ width: 140 }}
            value={largeCategory ?? undefined}
            onChange={(v) => setLargeCategory((v as LargeModelCategory) ?? null)}
            options={LARGE_MODEL_CATEGORY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
        )}
        {activeTab === 'small' && (
          <Select
            allowClear
            placeholder="识别风险类型"
            style={{ width: 140 }}
            value={smallCategory ?? undefined}
            onChange={(v) => setSmallCategory(v ?? null)}
            options={SMALL_MODEL_CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        )}
        {activeTab === 'large' && (
          <Select
            allowClear
            placeholder="Provider"
            style={{ width: 180 }}
            value={providerFilter ?? undefined}
            onChange={(v) => setProviderFilter(v ?? null)}
            options={providerOptions.map((p) => ({
              value: String(p.id),
              label: p.display_name,
            }))}
          />
        )}
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          value={status ?? undefined}
          onChange={(v) => setStatus(v ?? null)}
          options={REGISTERED_MODEL_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => fetchList()}>
          刷新
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
          disabled={!canWrite}
        >
          添加模型
        </Button>
      </Space>
      <Tabs
        activeKey={activeTab}
        onChange={onTabChange}
        items={[
          {
            key: 'large',
            label: `大模型 (${activeTab === 'large' ? total : '...'})`,
            children: (
              <Table<RegisteredModelListItem>
                rowKey="id"
                size="middle"
                loading={loading}
                columns={largeColumns}
                dataSource={items}
                pagination={{
                  total,
                  pageSize: 50,
                  showSizeChanger: false,
                  onChange: () => {},
                }}
                scroll={{ x: 'max-content' }}
                footer={() => <Text type="secondary">共 {total} 条</Text>}
                locale={{ emptyText: '暂无大模型，请先添加模型' }}
              />
            ),
          },
          {
            key: 'small',
            label: `小模型 (${activeTab === 'small' ? total : '...'})`,
            children: (
              <div style={{ padding: '4px 0' }}>
                {smallGroups.length === 0 ? (
                  <Text type="secondary">暂无小模型，请先添加模型</Text>
                ) : (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Tabs
                      activeKey={activeModality}
                      onChange={(k) => setActiveModality(k as ModalityKey)}
                      items={smallGroups
                        .filter((g) => g.key !== 'unknown')
                        .map((g) => ({
                          key: g.key,
                          label: (
                            <Space size={6}>
                              {g.icon}
                              <span>{g.label}</span>
                              <Tag color={g.color}>{g.count}</Tag>
                            </Space>
                          ),
                        }))}
                    />
                    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 320 }}>
                      <div
                        style={{
                          minWidth: 180,
                          flexShrink: 0,
                          paddingRight: 16,
                          maxHeight: 600,
                          overflowY: 'auto',
                        }}
                      >
                        {(visibleModality?.categories ?? []).length === 0 ? (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="暂无小模型"
                            style={{ paddingTop: 40 }}
                          />
                        ) : (
                          (visibleModality?.categories ?? []).map((cat) => {
                            const active = cat.key === activeAnchor
                            return (
                              <div
                                key={cat.key}
                                onClick={() => {
                                  setActiveAnchor(cat.key)
                                  document
                                    .getElementById(`cat-${cat.key}`)
                                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '6px 8px',
                                  marginBottom: 2,
                                  cursor: 'pointer',
                                  background: active ? '#e0f2fe' : 'transparent',
                                  transition: 'background 0.15s',
                                }}
                              >
                                <Tag color={cat.color}>{cat.label}</Tag>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {cat.count}
                                </Text>
                              </div>
                            )
                          })
                        )}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          paddingLeft: 16,
                          borderLeft: '1px solid #e2e8f0',
                          maxHeight: 600,
                          overflowY: 'auto',
                        }}
                      >
                        {visibleModality && visibleModality.categories.length > 0 ? (
                          <>
                            <div
                              style={{
                                fontSize: 13,
                                color: '#475569',
                                marginBottom: 12,
                                fontWeight: 500,
                              }}
                            >
                              {visibleModality.label}（{visibleModality.count} 个模型）
                            </div>
                            <Table<UnionRow>
                              rowKey="flatKey"
                              size="small"
                              pagination={false}
                              columns={columns}
                              dataSource={unionRows}
                            />
                          </>
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="暂无小模型"
                            style={{ padding: '60px 0' }}
                          />
                        )}
                      </div>
                    </div>
                  </Space>
                )}
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">共 {total} 条</Text>
                </div>
              </div>
            ),
          },
        ]}
      />

      <CreateModelModal
        open={createOpen}
        mode={activeTab === 'large' ? 'large' : 'small'}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          void fetchProviders()
          void fetchList()
        }}
      />
    </div>
  )
}