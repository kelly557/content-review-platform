import { useEffect, useState } from 'react'
import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
  App,
  type TableColumnsType,
} from 'antd'
import {
  PlusOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { librariesApi } from '@/api/libraries'
import type { Library, LibraryItem } from '@/types/domain'
import EditReplyDrawer from '@/components/library/EditReplyDrawer'

const { Title, Text } = Typography

export default function ReplyLibraryDetailPage() {
  const { id: rawId } = useParams<{ id?: string }>()
  const libraryId =
    rawId != null && !Number.isNaN(Number(rawId)) ? Number(rawId) : null
  const { message } = App.useApp()

  const [library, setLibrary] = useState<Library | null>(null)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<LibraryItem | null>(null)
  const [editTrigger, setEditTrigger] = useState('')
  const [editReply, setEditReply] = useState('')
  const [editSaving, setEditSaving] = useState(false)

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
        size: 20,
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
      title: `确认删除 ${selectedIds.length} 条代答？`,
      content: '删除后 30 天内可在回收站恢复,之后会被自动清理',
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await librariesApi.batchDeleteItems(library.id, selectedIds)
          message.success(`已删除 ${res.deleted} 条`)
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

  const openEdit = (row: LibraryItem) => {
    setEditing(row)
    setEditTrigger(row.trigger ?? '')
    setEditReply(row.reply ?? '')
  }

  const submitEdit = async () => {
    if (!library || !editing) return
    const t = editTrigger.trim()
    const r = editReply.trim()
    if (!t || !r) {
      message.warning('触发词与代答内容均不能为空')
      return
    }
    setEditSaving(true)
    try {
      await librariesApi.updateItem(library.id, editing.id, t)
      message.success('已保存')
      setEditing(null)
      void fetchItems(keyword)
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(d ?? '保存失败')
    } finally {
      setEditSaving(false)
    }
  }

  if (libraryId == null) {
    return <Empty description="无效的代答库 ID" />
  }

  const cols: TableColumnsType<LibraryItem> = [
    {
      title: '触发词',
      dataIndex: 'trigger',
      width: '24%',
      render: (v: string | null) => (
        <Text style={{ fontFamily: v ? 'monospace' : undefined, color: '#020617' }}>
          {v ?? '—'}
        </Text>
      ),
    },
    {
      title: '代答内容',
      dataIndex: 'reply',
      render: (v: string | null) => (
        <Text style={{ color: '#020617' }}>{v ?? '—'}</Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: '18%',
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
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(row)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该条代答？"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDeleteItem(row.id)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Space style={{ marginBottom: 12 }}>
        <Link to="/knowledge/replies" style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            代答库
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
        <Title level={3} style={{ margin: 0 }}>
          {library?.name ?? '加载中…'}
        </Title>
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
            placeholder="请输入触发词或代答"
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
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (t) => `共 ${t} 条数据`,
        }}
        size="middle"
        scroll={{ x: true }}
        locale={{ emptyText: '暂无代答,点击「添加」批量导入' }}
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
            title={`确认删除 ${selectedIds.length} 条代答？`}
            disabled={selectedIds.length === 0}
            onConfirm={onBatchDelete}
          >
            <Button danger icon={<DeleteOutlined />} disabled={selectedIds.length === 0}>
              批量删除({selectedIds.length})
            </Button>
          </Popconfirm>
        </div>
      )}

      <EditReplyDrawer
        open={addOpen}
        library={library}
        onCancel={() => setAddOpen(false)}
        onSuccess={() => {
          setAddOpen(false)
          void fetchItems(keyword)
          void fetchLibrary()
        }}
      />

      <Modal
        open={editing != null}
        title="编辑代答"
        onCancel={() => setEditing(null)}
        onOk={submitEdit}
        confirmLoading={editSaving}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              触发词
            </Text>
            <Input
              value={editTrigger}
              onChange={(e) => setEditTrigger(e.target.value)}
              maxLength={50}
              placeholder="不超过 50 字"
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              代答内容
            </Text>
            <Input.TextArea
              value={editReply}
              onChange={(e) => setEditReply(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="不超过 500 字"
            />
          </div>
        </Space>
      </Modal>
    </div>
  )
}