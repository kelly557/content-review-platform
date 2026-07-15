import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  App,
} from 'antd'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  TagsOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { registeredModelsApi, providersApi } from '@/api/registered-models'
import type {
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

type ModelRow = {
  id: number
  name: string
  versionText: string
  updatedAt: string | null
  points: string[] | null
}

type CategoryGroup = {
  key: string
  label: string
  color: string
  count: number
  models: ModelRow[]
}

type ModalityGroup = {
  key: string
  label: string
  color: string
  icon: React.ReactNode
  count: number
  categories: CategoryGroup[]
}

const MODALITY_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  text: { label: '文本', color: 'blue', icon: <TagsOutlined /> },
  image: { label: '图片', color: 'geekblue', icon: <PictureOutlined /> },
  unknown: { label: '未设置', color: 'default', icon: <TagsOutlined /> },
}

export default function ModelListPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'root_admin'

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

  // 大模型列
  const largeColumns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: '20%' },
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
        width: '16%',
        render: (v: string | null, row: RegisteredModelListItem) =>
          row.provider_id ? (
            <Link to={`/resources/providers/${row.provider_id}`}>
              <span style={{ color: '#0369A1' }}>{v || `#${row.provider_id}`}</span>
            </Link>
          ) : (
            <Text type="secondary">未挂载</Text>
          ),
      },
      { title: 'Model ID', dataIndex: 'model_name', width: '18%' },
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
    [],
  )

const smallGroups = useMemo<ModalityGroup[]>(() => {
    const byModality = new Map<string, Map<string, ModelRow[]>>()
    for (const m of items) {
      const mod = m.modality ?? 'unknown'
      const cat = m.small_category ?? 'unknown'
      const versionText = m.current_version_no
        ? m.current_version_label
          ? `v${m.current_version_no} · ${m.current_version_label}`
          : `v${m.current_version_no}`
        : '-'
      const points = m.current_version_config
        ? (m.current_version_config as { points?: string[] }).points ?? null
        : null
      const row: ModelRow = {
        id: m.id,
        name: m.name,
        versionText,
        updatedAt: m.updated_at,
        points,
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
            placeholder="审核场景"
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
                  smallGroups.map((mod) => (
                    <SmallModalityGroup key={mod.key} group={mod} />
                  ))
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

function SmallModalityGroup({ group }: { group: ModalityGroup }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 4px',
          background: '#f8fafc',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}>
          {expanded ? (
            <CaretDownOutlined style={{ fontSize: 11, color: '#64748b' }} />
          ) : (
            <CaretRightOutlined style={{ fontSize: 11, color: '#64748b' }} />
          )}
        </span>
        <Space size={8}>
          <span style={{ color: '#475569' }}>{group.icon}</span>
          <Tag color={group.color} style={{ fontWeight: 600 }}>
            {group.label}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {group.count} 个模型
          </Text>
        </Space>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 18, marginTop: 4 }}>
          {group.categories.map((cat) => (
            <SmallCategoryGroup key={cat.key} category={cat} />
          ))}
        </div>
      )}
    </div>
  )
}

function SmallCategoryGroup({ category }: { category: CategoryGroup }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}>
          {expanded ? (
            <CaretDownOutlined style={{ fontSize: 10, color: '#94a3b8' }} />
          ) : (
            <CaretRightOutlined style={{ fontSize: 10, color: '#94a3b8' }} />
          )}
        </span>
        <Space size={6}>
          <Tag color={category.color}>{category.label}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {category.count} 个模型
          </Text>
        </Space>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 18, marginTop: 4 }}>
          {category.models.map((m) => (
            <SmallModelRow key={m.id} row={m} />
          ))}
        </div>
      )}
    </div>
  )
}

function SmallModelRow({ row }: { row: ModelRow }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        marginBottom: 6,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 500, minWidth: 200 }}>{row.name}</span>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {row.versionText}
        </Text>
        <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {row.updatedAt ? dayjs(row.updatedAt).format('YYYY-MM-DD HH:mm') : '-'}
        </Text>
      </div>
      <div style={{ marginTop: 6 }}>
        {row.points && row.points.length > 0 ? (
          <Space size={4} wrap>
            {row.points.map((p, i) => (
              <Tag key={i}>{p}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>未配置审核点</Text>
        )}
      </div>
    </div>
  )
}