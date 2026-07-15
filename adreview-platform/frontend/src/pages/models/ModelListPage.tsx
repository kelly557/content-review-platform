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
  CloudDownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
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
  SmallModelModality,
} from '@/types/domain'
import {
  LARGE_MODEL_CATEGORY_OPTIONS,
  REGISTERED_MODEL_STATUS_OPTIONS,
  SMALL_MODEL_CATEGORY_OPTIONS,
  SMALL_MODEL_MODALITY_OPTIONS,
} from '@/types/domain'
import { useAuthStore } from '@/store'
import CreateModelModal from './CreateModelModal'

const { Text } = Typography

type ModelTab = 'large' | 'small'

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

  // 小模型列（无 Provider 概念）
  const smallColumns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: '18%' },
      {
        title: '审核场景',
        dataIndex: 'small_category',
        width: '8%',
        render: (v: SmallModelCategory | null) => {
          if (!v) return '-'
          const opt = SMALL_MODEL_CATEGORY_OPTIONS.find((o) => o.value === v)
          return opt ? <Tag color={opt.color}>{opt.label}</Tag> : v
        },
      },
      {
        title: '模态',
        dataIndex: 'modality',
        width: '8%',
        render: (v: SmallModelModality | null) => {
          if (!v) return '-'
          const opt = SMALL_MODEL_MODALITY_OPTIONS.find((o) => o.value === v)
          return opt ? <Tag color={opt.color}>{opt.label}</Tag> : v
        },
      },
      {
        title: '当前版本',
        dataIndex: 'current_version_label',
        width: '20%',
        render: (_v: string | null, row: RegisteredModelListItem) => {
          if (!row.current_version_no) return '-'
          return row.current_version_label
            ? `v${row.current_version_no} · ${row.current_version_label}`
            : `v${row.current_version_no}`
        },
      },
      {
        title: '操作',
        width: '14%',
        render: (_v: unknown, row: RegisteredModelListItem) => (
          <Link to={`/resources/models/${row.id}`}>
            <Button type="link" size="small" icon={<CloudDownloadOutlined />}>
              详情
            </Button>
          </Link>
        ),
      },
    ],
    [],
  )

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
              <Table<RegisteredModelListItem>
                rowKey="id"
                size="middle"
                loading={loading}
                columns={smallColumns}
                dataSource={items}
                pagination={{
                  total,
                  pageSize: 50,
                  showSizeChanger: false,
                  onChange: () => {},
                }}
                scroll={{ x: 'max-content' }}
                footer={() => <Text type="secondary">共 {total} 条</Text>}
                locale={{ emptyText: '暂无小模型，请先添加模型' }}
              />
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