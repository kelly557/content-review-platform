import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  App,
  Popconfirm,
  type TableColumnsType,
  type UploadProps,
} from 'antd'
import {
  PlusOutlined,
  InboxOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useParams } from 'react-router-dom'
import { librariesApi } from '@/api/libraries'
import { libraryGroupsApi } from '@/api/libraryGroups'
import type {
  Library,
  LibraryCreate,
  LibraryGroup,
  LibraryItem,
  LibraryListItem,
  LibraryType,
} from '@/types/domain'
import DeleteLibraryDialog from '@/components/library/DeleteLibraryDialog'

const { Title, Text } = Typography
const { Dragger } = Upload

const MAX_WORDS = 1000

interface CreateFormValues {
  name: string
  group_id: number
  description?: string
  wordsText?: string
}

export default function CustomLibraryPage() {
  const params = useParams<{ type?: string }>()
  const libType: LibraryType = params.type === 'image' ? 'image' : 'word'
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

  const [detail, setDetail] = useState<Library | null>(null)
  const [detailTab, setDetailTab] = useState<'basic' | 'items' | 'refs'>('basic')
  const [savingDetail, setSavingDetail] = useState(false)

  const [itemsList, setItemsList] = useState<LibraryItem[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsKeyword, setItemsKeyword] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([])

  const [refs, setRefs] = useState<{ audit_point_id: number; service_code: string; label: string }[]>([])
  const [refsLoading, setRefsLoading] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Library | null>(null)

  // ── fetch ──
  const fetchGroups = async () => {
    const data = await libraryGroupsApi.list({ size: 200 })
    setGroups(data.items)
  }

  const fetchLibraries = async () => {
    setLoading(true)
    try {
      const data = await librariesApi.list({
        type: libType,
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
  }, [libType, filterGroupId])

  // ── create ──
  const openCreate = () => {
    if (groups.length === 0) {
      message.warning('请先到「分组管理」新建一个分组')
      return
    }
    createForm.resetFields()
    createForm.setFieldsValue({ group_id: filterGroupId ?? groups[0]?.id })
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    const words = libType === 'word' ? (v.wordsText ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []
    if (libType === 'word' && words.length > MAX_WORDS) {
      message.error(`单次最多 ${MAX_WORDS} 个词`)
      return
    }
    const payload: LibraryCreate = {
      name: v.name.trim(),
      library_type: libType,
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

  // ── detail ──
  const openDetail = async (lib: LibraryListItem) => {
    setDetailTab('basic')
    setItemsKeyword('')
    setSelectedItemIds([])
    const full = await librariesApi.get(lib.id)
    setDetail(full)
  }

  const closeDetail = () => {
    setDetail(null)
    setItemsList([])
    setRefs([])
  }

  const fetchDetailItems = async (keyword: string) => {
    if (!detail) return
    setItemsLoading(true)
    try {
      const data = await librariesApi.listItems(detail.id, {
        keyword: keyword || undefined,
        size: 60,
      })
      setItemsList(data.items)
      setItemsTotal(data.total)
    } finally {
      setItemsLoading(false)
    }
  }

  const fetchDetailRefs = async () => {
    if (!detail) return
    setRefsLoading(true)
    try {
      setRefs(await librariesApi.references(detail.id))
    } finally {
      setRefsLoading(false)
    }
  }

  useEffect(() => {
    if (detail && detailTab === 'items') void fetchDetailItems(itemsKeyword)
    if (detail && detailTab === 'refs') void fetchDetailRefs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, detailTab])

  const saveBasic = async () => {
    if (!detail) return
    setSavingDetail(true)
    try {
      const updated = await librariesApi.update(detail.id, {
        name: detail.name,
        group_id: detail.group_id,
        description: detail.description ?? '',
        is_active: detail.is_active,
      })
      setDetail(updated)
      message.success('已保存')
      void fetchLibraries()
    } catch (e: unknown) {
      const detail2 = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail2 ?? '保存失败')
    } finally {
      setSavingDetail(false)
    }
  }

  const onAddWords = async (text: string) => {
    if (!detail) return
    const words = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (words.length === 0) return
    if (words.length > MAX_WORDS) {
      message.error(`单次最多 ${MAX_WORDS} 个词`)
      return
    }
    try {
      const res = await librariesApi.addItems(detail.id, words)
      message.success(`已添加,当前共 ${res.total} 个词`)
      void fetchDetailItems('')
      void fetchLibraries()
    } catch (e: unknown) {
      const detail2 = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail2 ?? '添加失败')
    }
  }

  const onBatchDeleteItems = async () => {
    if (!detail || selectedItemIds.length === 0) return
    Modal.confirm({
      title: `确认删除 ${selectedItemIds.length} 个词条？`,
      content: '删除后 30 天内可在回收站恢复,之后会被自动清理',
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await librariesApi.batchDeleteItems(detail.id, selectedItemIds)
          message.success(`已删除 ${res.deleted} 个`)
          setSelectedItemIds([])
          void fetchDetailItems(itemsKeyword)
          void fetchLibraries()
        } catch (e: unknown) {
          const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          message.error(d ?? '删除失败')
        }
      },
    })
  }

  // ── image upload ──
  const uploadProps: UploadProps = {
    multiple: true,
    showUploadList: false,
    accept: 'image/jpeg,image/png,image/webp,image/gif',
    beforeUpload: async (_file, fileList) => {
      if (!detail) return false
      try {
        const res = await librariesApi.uploadImages(detail.id, fileList)
        message.success(`上传成功 ${res.uploaded} 张,跳过 ${res.skipped} 张`)
        void fetchDetailItems('')
        void fetchLibraries()
      } catch (e: unknown) {
        const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        message.error(d ?? '上传失败')
      }
      return false
    },
  }

  // ── list cols ──
  const cols: TableColumnsType<LibraryListItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: '8%',
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: '22%',
      render: (v: string, row) => (
        <Space size={6}>
          <span style={{ color: '#020617', fontWeight: 500 }}>{v}</span>
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
    {
      title: libType === 'word' ? '词数' : '图片数',
      dataIndex: 'item_count',
      width: '12%',
      align: 'right',
    },
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
      width: '18%',
      render: (v: string) => (
        <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD')}</span>
      ),
    },
    {
      title: '操作',
      width: '20%',
      render: (_v, row) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openDetail(row)}>
            详情
          </Button>
          <Popconfirm
            title="确认删除该库？"
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

  const itemCols: TableColumnsType<LibraryItem> = [
    {
      title: '词条',
      dataIndex: 'word',
      render: (v: string | null) => (
        <span style={{ fontFamily: 'monospace', color: '#020617' }}>{v ?? '—'}</span>
      ),
    },
    {
      title: '添加时间',
      dataIndex: 'created_at',
      width: '30%',
      render: (v: string) => (
        <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm')}</span>
      ),
    },
    {
      title: '操作',
      width: '20%',
      render: (_v, row) => (
        <Space size={4}>
          <Popconfirm
            title="确认删除该词条？"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              if (!detail) return
              try {
                await librariesApi.deleteItem(detail.id, row.id)
                void fetchDetailItems(itemsKeyword)
                void fetchLibraries()
              } catch (e: unknown) {
                const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                message.error(d ?? '删除失败')
              }
            }}
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
        <Space size={12} align="center" wrap>
          <Title level={3} style={{ margin: 0 }}>
            {libType === 'word' ? '词库' : '图片库'}
          </Title>
        </Space>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建{libType === 'word' ? '词库' : '图库'}
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
            placeholder={`搜索${libType === 'word' ? '词库' : '图库'}名称`}
            allowClear
            style={{ width: 260 }}
            onSearch={(v) => {
              setQ(v.trim())
              void fetchLibraries()
            }}
          />
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

      {/* ─── Create Drawer ─── */}
      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`新建${libType === 'word' ? '词库' : '图库'}`}
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
          {libType === 'word' && (
            <Form.Item name="wordsText" label="词条（每行一个,可选）">
              <Input.TextArea rows={8} placeholder={'习近平\n领导人\n反动'} />
            </Form.Item>
          )}
          {libType === 'image' && (
            <Alert
              type="info"
              showIcon
              message="图库创建后可到详情页上传图片"
            />
          )}
        </Form>
      </Drawer>

      {/* ─── Detail Drawer ─── */}
      <Drawer
        open={detail != null}
        onClose={closeDetail}
        title={detail ? `${detail.name}（${detail.library_type === 'word' ? '词库' : '图库'}）` : ''}
        width={libType === 'image' ? 720 : 640}
        extra={
          detailTab === 'basic' ? (
            <Space>
              <Button onClick={closeDetail}>关闭</Button>
              <Button type="primary" onClick={saveBasic} loading={savingDetail}>
                保存
              </Button>
            </Space>
          ) : (
            <Button onClick={closeDetail}>关闭</Button>
          )
        }
      >
        {detail && (
          <Tabs
            activeKey={detailTab}
            onChange={(k) => setDetailTab(k as typeof detailTab)}
            items={[
              {
                key: 'basic',
                label: '基础信息',
                children: (
                  <Form layout="vertical">
                    <Form.Item label="所属分组">
                      <Select
                        value={detail.group_id}
                        onChange={(v) =>
                          setDetail({ ...detail, group_id: v as number })
                        }
                        options={groups.map((g) => ({ value: g.id, label: g.name }))}
                      />
                    </Form.Item>
                    <Form.Item label="名称">
                      <Input
                        value={detail.name}
                        onChange={(e) =>
                          setDetail({ ...detail, name: e.target.value })
                        }
                        maxLength={128}
                      />
                    </Form.Item>
                    <Form.Item label="说明">
                      <Input.TextArea
                        value={detail.description ?? ''}
                        onChange={(e) =>
                          setDetail({ ...detail, description: e.target.value })
                        }
                        rows={3}
                        maxLength={200}
                      />
                    </Form.Item>
                    <Form.Item label="启用">
                      <Switch
                        checked={detail.is_active}
                        onChange={(v) => setDetail({ ...detail, is_active: v })}
                      />
                    </Form.Item>
                    <Form.Item label="忽略服务">
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        暂以原方式保存,后续版本支持可视化编辑
                      </Text>
                    </Form.Item>
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        code: {detail.code} · 创建 {dayjs(detail.created_at).format('YYYY-MM-DD HH:mm')}
                      </Text>
                    </div>
                  </Form>
                ),
              },
              {
                key: 'items',
                label: detail.library_type === 'word' ? `词条 ${detail.item_count}` : `图片 ${detail.item_count}`,
                children:
                  detail.library_type === 'word' ? (
                    <div>
                      <Space style={{ marginBottom: 12 }} wrap>
                        <Input.Search
                          placeholder="搜索词条"
                          allowClear
                          style={{ width: 220 }}
                          onSearch={(v) => {
                            setItemsKeyword(v.trim())
                            void fetchDetailItems(v.trim())
                          }}
                        />
                        <Popconfirm
                          title={`确认删除 ${selectedItemIds.length} 个词条？`}
                          disabled={selectedItemIds.length === 0}
                          onConfirm={onBatchDeleteItems}
                        >
                          <Button
                            danger
                            disabled={selectedItemIds.length === 0}
                            icon={<DeleteOutlined />}
                          >
                            批量删除 ({selectedItemIds.length})
                          </Button>
                        </Popconfirm>
                      </Space>
                      <AddWordsArea onAdd={onAddWords} />
                      <Table<LibraryItem>
                        rowKey="id"
                        loading={itemsLoading}
                        dataSource={itemsList}
                        columns={[
                          {
                            title: '',
                            width: 36,
                            render: (_v, row) => (
                              <input
                                type="checkbox"
                                checked={selectedItemIds.includes(row.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedItemIds([...selectedItemIds, row.id])
                                  } else {
                                    setSelectedItemIds(
                                      selectedItemIds.filter((i) => i !== row.id),
                                    )
                                  }
                                }}
                              />
                            ),
                          },
                          ...itemCols,
                        ]}
                        rowSelection={{
                          selectedRowKeys: selectedItemIds,
                          onChange: (keys) => setSelectedItemIds(keys.map(Number)),
                        }}
                        pagination={{
                          total: itemsTotal,
                          pageSize: 60,
                          showSizeChanger: false,
                        }}
                        size="middle"
                        style={{ marginTop: 12 }}
                      />
                    </div>
                  ) : (
                    <div>
                      <Dragger {...uploadProps} style={{ marginBottom: 12 }}>
                        <p className="ant-upload-drag-icon">
                          <InboxOutlined />
                        </p>
                        <p className="ant-upload-text">点击或拖拽图片到此区域上传</p>
                        <p className="ant-upload-hint">
                          支持 jpg / png / webp / gif,单次最多 100 张,≤ 10MB / 张
                        </p>
                      </Dragger>
                      <Image.PreviewGroup>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                            gap: 12,
                          }}
                        >
                          {itemsList.map((it) => (
                            <Card
                              key={it.id}
                              size="small"
                              bodyStyle={{ padding: 8 }}
                              hoverable
                            >
                              <Image
                                src={librariesApi.itemDownloadUrl(detail.id, it.id)}
                                alt={it.original_filename ?? ''}
                                style={{ width: '100%', height: 100, objectFit: 'cover' }}
                                preview={false}
                              />
                              <div style={{ fontSize: 11, marginTop: 6, color: '#475569' }}>
                                {it.original_filename}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                                <span style={{ fontSize: 10, color: '#94A3B8' }}>
                                  {it.file_size ? `${(it.file_size / 1024).toFixed(1)} KB` : ''}
                                </span>
                                <Popconfirm
                                  title="确认删除该图片？"
                                  okText="删除"
                                  cancelText="取消"
                                  okButtonProps={{ danger: true }}
                                  onConfirm={async () => {
                                    try {
                                      await librariesApi.deleteItem(detail.id, it.id)
                                      void fetchDetailItems('')
                                      void fetchLibraries()
                                    } catch (e: unknown) {
                                      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                                      message.error(d ?? '删除失败')
                                    }
                                  }}
                                >
                                  <Button type="link" size="small" danger style={{ padding: 0 }}>
                                    删除
                                  </Button>
                                </Popconfirm>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </Image.PreviewGroup>
                      {itemsList.length === 0 && <Empty description="暂无图片,点击上方区域上传" />}
                    </div>
                  ),
              },
              {
                key: 'refs',
                label: `引用 ${refs.length}`,
                children: (
                  <Spin spinning={refsLoading}>
                    {refs.length === 0 ? (
                      <Empty description="该库当前未被任何审核点引用" />
                    ) : (
                      <Table
                        rowKey="audit_point_id"
                        dataSource={refs}
                        pagination={false}
                        size="middle"
                        columns={[
                          { title: '服务', dataIndex: 'service_code', width: '20%' },
                          { title: '审核点', dataIndex: 'label' },
                        ]}
                      />
                    )}
                  </Spin>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      <DeleteLibraryDialog
        open={deleteTarget != null}
        library={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onSuccess={() => {
          setDeleteTarget(null)
          void fetchLibraries()
          if (detail?.id === deleteTarget?.id) closeDetail()
        }}
      />
    </div>
  )
}

function AddWordsArea({ onAdd }: { onAdd: (text: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const submit = async () => {
    setAdding(true)
    try {
      await onAdd(text)
      setText('')
      setOpen(false)
    } finally {
      setAdding(false)
    }
  }
  return (
    <>
      <Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        添加词条
      </Button>
      <Modal
        open={open}
        title="添加词条"
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="添加"
        cancelText="取消"
        confirmLoading={adding}
        okButtonProps={{ disabled: text.trim().length === 0 }}
      >
        <Input.TextArea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'每行一个词\n习近平\n领导人'}
          autoFocus
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#94A3B8' }}>
          已存在的词会被自动跳过（去重）
        </div>
      </Modal>
    </>
  )
}