import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  App,
  Upload,
  type TableColumnsType,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  InboxOutlined,
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
import { parseReplyFile } from '@/lib/libraryImport'
import DeleteLibraryDialog from '@/components/library/DeleteLibraryDialog'

const { Title } = Typography

const MAX_PAIRS = 1000

interface CreateFormValues {
  name: string
  group_id: number
  description?: string
  pairsText?: string
}

export default function ReplyLibraryListPage() {
  const { message } = App.useApp()
  const [groups, setGroups] = useState<LibraryGroup[]>([])
  const [filterGroupId, setFilterGroupId] = useState<number | null>(null)
  const [items, setItems] = useState<LibraryListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [creatingImport, setImporting] = useState(false)
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
        type: 'reply',
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
    const pairsText: string = v.pairsText ?? ''
    const words: string[] = pairsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const payload: LibraryCreate = {
      name: v.name.trim(),
      library_type: 'reply',
      group_id: v.group_id,
      description: v.description,
      words,
    }
    setCreating(true)
    try {
      await librariesApi.create(payload)
      message.success(
        words.length > 0
          ? `已新建并添加 ${words.length} 条`
          : '已新建',
      )
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
            to={`/strategies/replies/${row.id}`}
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
    { title: '条数', dataIndex: 'item_count', width: '12%', align: 'right' },
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
          <Link to={`/strategies/replies/${row.id}`}>
            <Button type="link" size="small" icon={<EditOutlined />}>
              编辑
            </Button>
          </Link>
          <Popconfirm
            title="确认删除该代答库？"
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
          代答库
        </Title>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建代答库
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
            placeholder="搜索代答库名称"
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
        title="新建代答库"
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
            <Input maxLength={128} showCount placeholder="例如：售前欢迎语" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
          <Form.Item
            name="pairsText"
            label="代答条目（可选,创建时可一并填入）"
          >
            <Tabs
              defaultActiveKey="paste"
              items={[
                {
                  key: 'paste',
                  label: '直接粘贴',
                  children: (
                    <Form.Item name="pairsText" noStyle>
                      <Input.TextArea
                        rows={8}
                        placeholder={'您好,客官|||您好,有什么可以帮您?\n发货时间|||24 小时内'}
                        disabled={creatingImport}
                        onChange={(e) =>
                          createForm.setFieldValue(
                            'pairsText',
                            e.target.value,
                          )
                        }
                      />
                    </Form.Item>
                  ),
                },
                {
                  key: 'upload',
                  label: '上传 .txt / .csv',
                  children: (
                    <Space
                      direction="vertical"
                      size={8}
                      style={{ width: '100%' }}
                    >
                      <Alert
                        type="info"
                        showIcon
                        message="每行 trigger + TAB/||| 与 reply 配对"
                        description={
                          <span>
                            例：<code>{'您好,客官\t您好,有什么可以帮您?'}</code>
                          </span>
                        }
                      />
                      <Upload
                        accept=".txt,.csv"
                        beforeUpload={async (file) => {
                          setImporting(true)
                          try {
                            const { pairs, errors } = await parseReplyFile(
                              file as File,
                            )
                            if (errors.length > 0 || pairs.length === 0) {
                              message.error(
                                errors[0] ?? '文件无有效数据',
                              )
                              return false
                            }
                            if (pairs.length > MAX_PAIRS) {
                              message.error(
                                `单次最多 ${MAX_PAIRS} 对,检测到 ${pairs.length}`,
                              )
                              return false
                            }
                            const text = pairs
                              .map((p) => `${p.trigger}|||${p.reply}`)
                              .join('\n')
                            createForm.setFieldValue('pairsText', text)
                            message.success(
                              `已导入 ${pairs.length} 对,切换到直接粘贴 tab 可继续编辑`,
                            )
                            return false
                          } catch (e) {
                            message.error(
                              '解析失败：' + (e as Error).message,
                            )
                            return false
                          } finally {
                            setImporting(false)
                          }
                        }}
                        showUploadList={false}
                        maxCount={1}
                        disabled={creating || creatingImport}
                      >
                        <Button
                          icon={<InboxOutlined />}
                          loading={creatingImport}
                        >
                          选择 .txt / .csv 上传
                        </Button>
                      </Upload>
                      <span style={{ color: '#64748B', fontSize: 12 }}>
                        文件读取后写入左侧粘贴框,可继续手动修改
                      </span>
                    </Space>
                  ),
                },
              ]}
            />
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