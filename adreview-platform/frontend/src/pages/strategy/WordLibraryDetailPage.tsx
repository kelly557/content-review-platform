import { useEffect, useState } from 'react'
import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  App,
  type TableColumnsType,
} from 'antd'
import {
  PlusOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { librariesApi } from '@/api/libraries'
import type { Library, LibraryItem } from '@/types/domain'
import EditWordDrawer from '@/components/library/EditWordDrawer'
import EditLibraryEffectiveModal from '@/components/library/EditLibraryEffectiveModal'
import EditPlatformToggleModal from '@/components/library/EditPlatformToggleModal'
import { useAuthStore } from '@/store'
import { deriveEffectiveMeta } from '@/lib/libraryEffective'

const { Title, Text } = Typography

export default function WordLibraryDetailPage() {
  const { id: rawId } = useParams<{ id?: string }>()
  const libraryId =
    rawId != null && !Number.isNaN(Number(rawId)) ? Number(rawId) : null
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const isSuperadmin = user?.role === 'superadmin' || user?.role === 'root_admin'

  const [library, setLibrary] = useState<Library | null>(null)
  const [loading, setLoading] = useState(false)

  const [items, setItems] = useState<LibraryItem[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const [addOpen, setAddOpen] = useState(false)
  const [editEffOpen, setEditEffOpen] = useState(false)
  const [editPlatformOpen, setEditPlatformOpen] = useState(false)

  const effectiveMeta = deriveEffectiveMeta(
    library?.is_active ?? false,
    library?.effective_from ?? null,
    library?.effective_until ?? null,
  )

  function effectiveTooltip(lib: Library): string {
    if (lib.library_type === 'reply') return '代答库不支持有效时间'
    if (!lib.effective_from && !lib.effective_until) return '永久：一直生效'
    return `到期后审核默认不生效`
  }

  const fetchLibrary = async () => {
    if (libraryId == null) return
    setLoading(true)
    try {
      setLibrary(await librariesApi.get(libraryId))
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(d ?? '加载库失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchItems = async (kw: string) => {
    if (libraryId == null) return
    setItemsLoading(true)
    try {
      const data = await librariesApi.listItems(libraryId, {
        keyword: kw || undefined,
        size: 10,
      })
      setItems(data.items)
      setItemsTotal(data.total)
      setSelectedIds([])
    } finally {
      setItemsLoading(false)
    }
  }

  useEffect(() => {
    void fetchLibrary()
    void fetchItems('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId])

  const onDeleteItem = async (itemId: number) => {
    if (!library) return
    try {
      await librariesApi.deleteItem(library.id, itemId)
      message.success('已删除')
      void fetchItems(keyword)
      void fetchLibrary()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(d ?? '删除失败')
    }
  }

  const onBatchDelete = async () => {
    if (!library || selectedIds.length === 0) return
    Modal.confirm({
      title: `确认删除 ${selectedIds.length} 个词条？`,
      content: '删除后 30 天内可在回收站恢复,之后会被自动清理',
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await librariesApi.batchDeleteItems(library.id, selectedIds)
          message.success(`已删除 ${res.deleted} 个`)
          setSelectedIds([])
          void fetchItems(keyword)
          void fetchLibrary()
        } catch (e: unknown) {
          const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          message.error(d ?? '删除失败')
        }
      },
    })
  }

  if (libraryId == null) {
    return <Empty description="无效的词库 ID" />
  }

  const cols: TableColumnsType<LibraryItem> = [
    {
      title: '文本',
      dataIndex: 'word',
      render: (v: string | null, row) => (
        <Text style={{ fontFamily: v ? 'monospace' : undefined, color: '#020617' }}>
          {v ?? row.original_filename ?? '—'}
        </Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: '40%',
      defaultSortOrder: 'descend',
      sorter: (a, b) =>
        dayjs(a.created_at).valueOf() - dayjs(b.created_at).valueOf(),
      render: (v: string) => (
        <Text style={{ color: '#64748B', fontSize: 12 }}>
          {dayjs(v).format('YYYY-MM-DD HH:mm:ss')}
        </Text>
      ),
    },
    {
      title: '操作',
      width: '12%',
      render: (_v, row) => (
        <Popconfirm
          title="确认删除该词条？"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDeleteItem(row.id)}
        >
          <Button type="link" size="small" danger>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Space style={{ marginBottom: 12 }}>
        <Link to="/resources/words" style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            词库
          </Space>
        </Link>
      </Space>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space size={12} align="center" wrap>
          <Title level={3} style={{ margin: 0 }}>
            {library?.name ?? '加载中…'}
          </Title>
          {library?.kind && (
            <Tag color={library.kind === '黑名单' ? 'red' : 'green'}>
              {library.kind}
            </Tag>
          )}
          {library && (
            <>
              <Tooltip title={effectiveTooltip(library)}>
                <Tag color={effectiveMeta.color}>{effectiveMeta.status}</Tag>
              </Tooltip>
              {effectiveMeta.rangeText && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {effectiveMeta.rangeText}
                </Text>
              )}
            </>
          )}
          {library?.is_platform && (
            <Tooltip title="通用平台库:仅超级管理员可见可改可删">
              <Tag color="purple">通用平台</Tag>
            </Tooltip>
          )}
          {library && !library.is_active && <Tag>已停用</Tag>}
          <Button
            type="link"
            size="small"
            icon={<ClockCircleOutlined />}
            onClick={() => setEditEffOpen(true)}
            disabled={!library}
          >
            编辑有效期
          </Button>
          {isSuperadmin && library && (
            <Button
              type="link"
              size="small"
              onClick={() => setEditPlatformOpen(true)}
            >
              {library.is_platform ? '改为个性化' : '设为通用平台'}
            </Button>
          )}
        </Space>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAddOpen(true)}
            disabled={!library}
          >
            添加
          </Button>
          <Input.Search
            placeholder="请输入文本"
            allowClear
            style={{ width: 280 }}
            onSearch={(v) => {
              const kw = v.trim()
              setKeyword(kw)
              void fetchItems(kw)
            }}
          />
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchItems(keyword)} />
        </Space>
      </div>

      <Table<LibraryItem>
        rowKey="id"
        loading={loading || itemsLoading}
        dataSource={items}
        columns={cols}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys.map(Number)),
        }}
        pagination={{
          total: itemsTotal,
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          showTotal: (t) => `共 ${t} 条数据`,
        }}
        size="middle"
        scroll={{ x: true }}
        locale={{ emptyText: '暂无词条,点击「添加」批量导入' }}
      />

      {itemsTotal > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: '#fff',
            padding: '8px 0',
            marginTop: 12,
            borderTop: '1px solid #E2E8F0',
          }}
        >
          <Popconfirm
            title={`确认删除 ${selectedIds.length} 个词条？`}
            disabled={selectedIds.length === 0}
            onConfirm={onBatchDelete}
          >
            <Button danger icon={<DeleteOutlined />} disabled={selectedIds.length === 0}>
              批量删除({selectedIds.length})
            </Button>
          </Popconfirm>
        </div>
      )}

      <EditWordDrawer
        open={addOpen}
        library={library}
        onCancel={() => setAddOpen(false)}
        onSuccess={() => {
          setAddOpen(false)
          void fetchItems(keyword)
          void fetchLibrary()
        }}
      />
      <EditLibraryEffectiveModal
        open={editEffOpen}
        library={library}
        onClose={() => setEditEffOpen(false)}
        onSuccess={(updated) => setLibrary(updated)}
      />
      <EditPlatformToggleModal
        open={editPlatformOpen}
        library={library}
        onClose={() => setEditPlatformOpen(false)}
        onSuccess={(updated) => setLibrary(updated)}
      />
    </div>
  )
}