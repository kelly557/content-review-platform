import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
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
import dayjs, { type Dayjs } from 'dayjs'
import { librariesApi } from '@/api/libraries'
import type {
  Library,
  LibraryCreate,
  LibraryKind,
  LibraryListItem,
} from '@/types/domain'
import { LIBRARY_KIND_OPTIONS } from '@/types/domain'
import { parseWordsFile } from '@/lib/libraryImport'
import { deriveEffectiveMeta } from '@/lib/libraryEffective'
import DeleteLibraryDialog from '@/components/library/DeleteLibraryDialog'
import PlatformToggle from '@/components/library/PlatformToggle'
import { useAuthStore } from '@/store'

const { Title, Text } = Typography

const MAX_WORDS = 1000

interface CreateFormValues {
  name: string
  kind: LibraryKind
  description?: string
  durationMode: 'permanent' | 'range'
  effectiveRange?: [Dayjs, Dayjs]
  wordsText?: string
  is_platform?: boolean
}

export default function WordLibraryListPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const isSuperadmin = user?.role === 'superadmin'
  const [filterKind, setFilterKind] = useState<LibraryKind | null>(null)
  const [effectiveOnly, setEffectiveOnly] = useState(false)
  const [items, setItems] = useState<LibraryListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [creatingImport, setImporting] = useState(false)
  const [createForm] = Form.useForm<CreateFormValues>()

  const [deleteTarget, setDeleteTarget] = useState<Library | null>(null)

  const fetchLibraries = async () => {
    setLoading(true)
    try {
      const data = await librariesApi.list({
        type: 'word',
        kind: filterKind ?? undefined,
        q: q || undefined,
        size: 50,
        effective_only: effectiveOnly,
      })
      setItems(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchLibraries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKind, effectiveOnly])

  const openCreate = () => {
    createForm.resetFields()
    createForm.setFieldsValue({ durationMode: 'permanent', kind: '黑名单' })
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    const words = (v.wordsText ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (words.length > MAX_WORDS) {
      message.error(`单次最多 ${MAX_WORDS} 个词`)
      return
    }
    const hasRange =
      v.durationMode === 'range' &&
      v.effectiveRange &&
      v.effectiveRange.length === 2
    const payload: LibraryCreate = {
      name: v.name.trim(),
      library_type: 'word',
      kind: v.kind,
      description: v.description,
      words,
      effective_from: hasRange ? v.effectiveRange![0].toISOString() : null,
      effective_until: hasRange ? v.effectiveRange![1].toISOString() : null,
      is_platform: v.is_platform ?? false,
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
    {
      title: '名称',
      dataIndex: 'name',
      width: '20%',
      render: (v: string, row) => (
        <Space size={6}>
          <Link
            to={`/knowledge/words/${row.id}`}
            style={{ color: '#020617', fontWeight: 500 }}
          >
            {v}
          </Link>
          {!row.is_active && <Tag>已停用</Tag>}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'kind',
      width: '8%',
      render: (v: LibraryKind | null) =>
        v ? <Tag color={v === '黑名单' ? 'red' : 'green'}>{v}</Tag> : '—',
    },
    {
      title: '归属',
      dataIndex: 'is_platform',
      width: '10%',
      render: (v: boolean) =>
        v ? (
          <Tooltip title="通用平台库:仅超级管理员可编辑/删除">
            <Tag color="purple" style={{ margin: 0 }}>通用平台</Tag>
          </Tooltip>
        ) : (
          <Tag style={{ margin: 0 }}>个性化</Tag>
        ),
    },
    {
      title: '有效时间',
      key: 'effective',
      width: '18%',
      render: (_v, row) => {
        const meta = deriveEffectiveMeta(
          row.is_active,
          row.effective_from,
          row.effective_until,
        )
        return (
          <Space direction="vertical" size={2}>
            <Tag color={meta.color}>{meta.status}</Tag>
            {meta.rangeText && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {meta.rangeText}
              </Text>
            )}
          </Space>
        )
      },
    },
    {
      title: '词数',
      dataIndex: 'item_count',
      width: '8%',
      align: 'right',
    },
    {
      title: '最近修改',
      dataIndex: 'updated_at',
      width: '16%',
      render: (v: string | null) => (
        <span style={{ color: '#64748B', fontSize: 12 }}>
          {v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'}
        </span>
      ),
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
      render: (_v, row) => {
        const isPlatform = row.is_platform
        const deleteDisabled = isPlatform && !isSuperadmin
        return (
          <Space size={4}>
            <Link to={`/knowledge/words/${row.id}`}>
              <Button type="link" size="small" icon={<EditOutlined />}>
                编辑
              </Button>
            </Link>
            {deleteDisabled ? (
              <Tooltip title="通用平台库:仅超级管理员可删除">
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled
                >
                  删除
                </Button>
              </Tooltip>
            ) : (
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
            )}
          </Space>
        )
      },
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
            placeholder="全部类型"
            style={{ width: 160 }}
            options={LIBRARY_KIND_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            value={filterKind ?? undefined}
            onChange={(v) => {
              setFilterKind(v ?? null)
              void fetchLibraries()
            }}
          />
          <Tooltip
            title={
              effectiveOnly
                ? '仅显示当前在有效时间区间内且已启用的库'
                : '显示所有库，包括已过期 / 即将生效 / 已停用'
            }
          >
            <Radio.Group
              value={effectiveOnly ? 'effective' : 'all'}
              onChange={(e) => setEffectiveOnly(e.target.value === 'effective')}
              optionType="button"
            >
              <Radio.Button value="all">全部</Radio.Button>
              <Radio.Button value="effective">仅生效中</Radio.Button>
            </Radio.Group>
          </Tooltip>
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
        width={560}
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
          initialValues={{ durationMode: 'permanent', kind: '黑名单' }}
        >
          <Form.Item
            name="kind"
            label="类型"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Select
              options={LIBRARY_KIND_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              placeholder="黑名单 / 白名单"
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

          <PlatformToggle />

          <Form.Item
            name="durationMode"
            label="有效时间"
            rules={[{ required: true, message: '请选择有效时间' }]}
          >
            <Radio.Group buttonStyle="solid">
              <Radio.Button value="permanent">永久</Radio.Button>
              <Radio.Button value="range">自定义区间</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            shouldUpdate={(prev, cur) => prev.durationMode !== cur.durationMode}
            noStyle
          >
            {({ getFieldValue }) =>
              getFieldValue('durationMode') === 'range' ? (
                <Form.Item
                  name="effectiveRange"
                  label="起止时间"
                  rules={[
                    { required: true, message: '请选择起止时间' },
                    {
                      validator: async (_r, value: [Dayjs, Dayjs] | undefined) => {
                        if (!value || value.length !== 2) return
                        if (!value[0].isBefore(value[1])) {
                          throw new Error('起始时间必须早于结束时间')
                        }
                      },
                    },
                  ]}
                >
                  <DatePicker.RangePicker
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                    placeholder={['起始', '结束']}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {({ getFieldValue }) => {
              const mode = getFieldValue('durationMode')
              if (mode === 'range') {
                return (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    到期后审核默认不生效；可在详情页重新设置或恢复永久。
                  </Text>
                )
              }
              return (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  永久：词库一直生效；如需限时投放请选「自定义区间」。
                </Text>
              )
            }}
          </Form.Item>

          <Form.Item
            name="wordsText"
            label="词条（可选,创建时可一并填入）"
            style={{ marginTop: 12 }}
          >
            <Tabs
              defaultActiveKey="paste"
              items={[
                {
                  key: 'paste',
                  label: '直接粘贴',
                  children: (
                    <Form.Item
                      name="wordsText"
                      noStyle
                      rules={[
                        {
                          validator: async () =>
                            Promise.resolve(),
                        },
                      ]}
                    >
                      <Input.TextArea
                        rows={8}
                        placeholder={'习近平\n领导人\n反动'}
                        disabled={creatingImport}
                        onChange={(e) => {
                          createForm.setFieldValue('wordsText', e.target.value)
                        }}
                      />
                    </Form.Item>
                  ),
                },
                {
                  key: 'upload',
                  label: '上传 .txt / .csv',
                  children: (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Alert
                        type="info"
                        showIcon
                        message="每行一词,.csv 用逗号分隔多个"
                        description={
                          <span>
                            例：<code>习近平,领导人,反动</code> 三个词
                          </span>
                        }
                      />
                      <Upload
                        accept=".txt,.csv"
                        beforeUpload={async (file) => {
                          setImporting(true)
                          try {
                            const { words, errors } = await parseWordsFile(
                              file as File,
                            )
                            if (errors.length > 0 || words.length === 0) {
                              message.error(
                                errors[0] ?? '文件无有效数据',
                              )
                              return false
                            }
                            if (words.length > MAX_WORDS) {
                              message.error(
                                `单次最多 ${MAX_WORDS} 个词,检测到 ${words.length}`,
                              )
                              return false
                            }
                            createForm.setFieldValue(
                              'wordsText',
                              words.join('\n'),
                            )
                            message.success(
                              `已导入 ${words.length} 个词,切换到直接粘贴 tab 可继续编辑`,
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
