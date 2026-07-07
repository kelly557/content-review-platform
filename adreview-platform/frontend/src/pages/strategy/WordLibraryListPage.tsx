import { useEffect, useState } from 'react'
import {
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  App,
  type TableColumnsType,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { librariesApi } from '@/api/libraries'
import { libraryGroupsApi } from '@/api/libraryGroups'
import type {
  Library,
  LibraryCreate,
  LibraryGroup,
  LibraryListItem,
} from '@/types/domain'
import DeleteLibraryDialog from '@/components/library/DeleteLibraryDialog'

const { Title } = Typography

const MAX_WORDS = 1000

interface CreateFormValues {
  name: string
  group_id: number
  description?: string
  wordsText?: string
}

export default function WordLibraryListPage() {
  const { message } = App.useApp()
  const [groups, setGroups] = useState<LibraryGroup[]>([])
  const [filterGroupId, setFilterGroupId] = useState<number | null>(null)
  const [items, setItems] = useState<LibraryListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm] = Form.useForm<CreateFormValues>()

  const [deleteTarget, setDeleteTarget] = useState<Library | null>(null)

  const fetchGroups = async () => {
    const data = await libraryGroupsApi.list({ size: 200 })
    setGroups(data.items)
  }

  const fetchLibraries = async () => {
    setLoading(true)
    try {
      const data = await librariesApi.list({
        type: 'word',
        group_id: filterGroupId ?? undefined,
        q: q || undefined,
        size: 50,
      })
      setItems(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void fetchLibraries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterGroupId])

  const openCreate = () => {
    if (groups.length === 0) {
      message.warning('请先到「库管理」新建一个分组')
      return
    }
    createForm.resetFields()
    createForm.setFieldsValue({ group_id: filterGroupId ?? groups[0]?.id })
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    const words = (v.wordsText ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (words.length > MAX_WORDS) {
      message.error(`单次最多 ${MAX_WORDS} 个词`)
      return
    }
    const payload: LibraryCreate = {
      name: v.name.trim(),
      library_type: 'word',
      group_id: v.group_id,
      description: v.description,
      words,
    }
    setCreating(true)
    try {
      await librariesApi.create(payload)
      message.success('已新建')
      setCreateOpen(false)
      void fetchLibraries()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '新建失败')
    } finally {
      setCreating(false)
    }
  }

  const cols: TableColumnsType<LibraryListItem> = [
    { title: 'ID', dataIndex: 'id', width: '8%' },
    {
      title: '名称',
      dataIndex: 'name',
      width: '22%',
      render: (v: string, row) => (
        <Space size={6}>
          <Link
            to={`/strategies/words/${row.id}`}
            style={{ color: '#020617', fontWeight: 500 }}
          >
            {v}
          </Link>
          {!row.is_active && <Tag>已停用</Tag>}
        </Space>
      ),
    },
    {
      title: '分组',
      width: '14%',
      render: (_v, row) => (
        <span style={{ color: '#475569' }}>{row.group_name ?? `#${row.group_id}`}</span>
      ),
    },
    { title: '词数', dataIndex: 'item_count', width: '12%', align: 'right' },
    {
      title: '最近修改',
      dataIndex: 'updated_at',
      width: '18%',
      render: (v: string | null) => (
        <span style={{ color: '#64748B', fontSize: 12 }}>
          {v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'}
        </span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: '14%',
      render: (v: string) => (
        <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD')}</span>
      ),
    },
    {
      title: '操作',
      width: '12%',
      render: (_v, row) => (
        <Space size={4}>
          <Link to={`/strategies/words/${row.id}`}>
            <Button type="link" size="small" icon={<EditOutlined />}>
              编辑
            </Button>
          </Link>
          <Popconfirm
            title="确认删除该词库？"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => setDeleteTarget(row as Library)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
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
          词库
        </Title>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建词库
          </Button>
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
          <Select
            allowClear
            placeholder="全部分组"
            style={{ width: 200 }}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            value={filterGroupId ?? undefined}
            onChange={(v) => {
              setFilterGroupId(v ?? null)
              void fetchLibraries()
            }}
          />
        </Space>
        <Space>
          <Input.Search
            placeholder="搜索词库名称"
            allowClear
            style={{ width: 260 }}
            onSearch={(v) => {
              setQ(v.trim())
              void fetchLibraries()
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void fetchLibraries()} />
        </Space>
      </div>

      <Table<LibraryListItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={cols}
        pagination={{
          total,
          pageSize: 50,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 个`,
        }}
        size="middle"
        scroll={{ x: true }}
        locale={{ emptyText: '当前筛选条件下暂无库,点击右上角新建' }}
      />

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建词库"
        width={520}
        extra={
          <Space>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button type="primary" loading={creating} onClick={submitCreate}>
              确定
            </Button>
          </Space>
        }
      >
        <Form<CreateFormValues>
          form={createForm}
          layout="vertical"
          initialValues={{ group_id: filterGroupId ?? undefined }}
        >
          <Form.Item
            name="group_id"
            label="所属分组"
            rules={[{ required: true, message: '请选择分组' }]}
          >
            <Select
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              placeholder="选择分组"
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入名称' },
              { max: 128, message: '不超过 128 字' },
            ]}
          >
            <Input maxLength={128} showCount placeholder="例如：双十一活动词" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
          <Form.Item name="wordsText" label="词条（每行一个,可选）">
            <Input.TextArea rows={8} placeholder={'习近平\n领导人\n反动'} />
          </Form.Item>
        </Form>
      </Drawer>

      <DeleteLibraryDialog
        open={deleteTarget != null}
        library={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onSuccess={() => {
          setDeleteTarget(null)
          void fetchLibraries()
        }}
      />
    </div>
  )
}