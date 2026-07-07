import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Typography,
  App,
  Popconfirm,
  Tag,
  type TableColumnsType,
} from 'antd'
import { EditOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { libraryGroupsApi } from '@/api/libraryGroups'
import { librariesApi } from '@/api/libraries'
import type { LibraryGroup } from '@/types/domain'

const { Title } = Typography

interface FormValues {
  name: string
  description?: string
}

export default function LibraryGroupsPage() {
  const { message } = App.useApp()
  const [items, setItems] = useState<LibraryGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [target, setTarget] = useState<LibraryGroup | null>(null)
  const [form] = Form.useForm<FormValues>()
  const [usage, setUsage] = useState<Record<number, number>>({})

  const fetch = async () => {
    setLoading(true)
    try {
      const [groups, libs] = await Promise.all([
        libraryGroupsApi.list({ size: 200, q: q || undefined }),
        librariesApi.list({ size: 200 }).catch(() => ({ items: [], total: 0 })),
      ])
      setItems(groups.items)
      setTotal(groups.total)
      const counts: Record<number, number> = {}
      libs.items.forEach((l) => {
        if (l.is_deleted) return
        counts[l.group_id] = (counts[l.group_id] ?? 0) + 1
      })
      setUsage(counts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const openCreate = () => {
    setTarget(null)
    form.resetFields()
    setOpen(true)
  }

  const openEdit = (g: LibraryGroup) => {
    setTarget(g)
    form.setFieldsValue({ name: g.name, description: g.description ?? '' })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    setEditing(true)
    try {
      if (target) {
        await libraryGroupsApi.update(target.id, v)
        message.success('已更新分组')
      } else {
        await libraryGroupsApi.create(v)
        message.success('已新建分组')
      }
      setOpen(false)
      void fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setEditing(false)
    }
  }

  const onDelete = async (g: LibraryGroup) => {
    try {
      await libraryGroupsApi.remove(g.id)
      message.success(`已删除「${g.name}」`)
      void fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const columns: TableColumnsType<LibraryGroup> = [
    {
      title: '分组名称',
      dataIndex: 'name',
      width: '30%',
      render: (v: string, row) => (
        <Space size={6} align="center">
          <span style={{ color: '#020617', fontWeight: 500 }}>{v}</span>
          {(usage[row.id] ?? 0) > 0 && <Tag color="blue">已使用</Tag>}
        </Space>
      ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      width: '40%',
      render: (v: string | null) => (
        <span style={{ color: '#475569' }}>{v || '—'}</span>
      ),
    },
    {
      title: '关联库数',
      width: '12%',
      align: 'center',
      render: (_v, row) => usage[row.id] ?? 0,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: '12%',
      render: (v: string) => (
        <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD')}</span>
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
            改名
          </Button>
          <Popconfirm
            title={`删除分组「${row.name}」？`}
            description="请确认该分组下已无词库 / 图片库"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete(row)}
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
      {/* Always-mounted Form so useForm has an attached Form element.
          Modal's Form below also uses the same `form` instance. */}
      <div style={{ display: 'none' }} aria-hidden="true">
        <Form<FormValues> form={form}>
          <Form.Item name="name"><Input /></Form.Item>
        </Form>
      </div>
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
          库管理
        </Title>
        <Space wrap>
          <Input.Search
            placeholder="搜索分组"
            allowClear
            style={{ width: 240 }}
            onSearch={(v) => setQ(v.trim())}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建分组
          </Button>
        </Space>
      </div>

      <Table<LibraryGroup>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{
          total,
          pageSize: 50,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 个分组`,
        }}
        size="middle"
        scroll={{ x: true }}
        locale={{ emptyText: '暂无分组，点击右上角新建' }}
      />

      <Modal
        open={open}
        title={target ? `编辑分组「${target.name}」` : '新建分组'}
        okText="保存"
        cancelText="取消"
        confirmLoading={editing}
        onCancel={() => setOpen(false)}
        onOk={submit}
        destroyOnHidden
      >
        <Form<FormValues> form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="分组名称"
            rules={[
              { required: true, message: '请输入分组名称' },
              { max: 64, message: '不超过 64 个字符' },
            ]}
          >
            <Input placeholder="例如：双十一活动词" maxLength={64} showCount />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea
              placeholder="可选,用于说明分组用途"
              rows={2}
              maxLength={200}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}