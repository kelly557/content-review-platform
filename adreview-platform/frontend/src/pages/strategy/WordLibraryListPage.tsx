import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Radio,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
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
import dayjs, { type Dayjs } from 'dayjs'
import { librariesApi } from '@/api/libraries'
import type {
  Library,
  LibraryCreate,
  LibraryKind,
  LibraryListItem,
} from '@/types/domain'
import { LIBRARY_KIND_OPTIONS } from '@/types/domain'
import { deriveEffectiveMeta } from '@/lib/libraryEffective'
import DeleteLibraryDialog from '@/components/library/DeleteLibraryDialog'
import PlatformToggle from '@/components/library/PlatformToggle'
import WordsInputPanel, { MAX_WORDS, type WordsMode } from '@/components/library/WordsInputPanel'
import { useAuthStore } from '@/store'

const { Title, Text } = Typography

interface CreateFormValues {
  name: string
  durationMode: 'permanent' | 'range'
  effectiveRange?: [Dayjs, Dayjs]
  is_platform?: boolean
}

export default function WordLibraryListPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const isSuperadmin = user?.role === 'superadmin' || user?.role === 'root_admin'
  const [filterKind, setFilterKind] = useState<LibraryKind | null>(null)
  const [effectiveOnly, setEffectiveOnly] = useState(false)
  const [items, setItems] = useState<LibraryListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm] = Form.useForm<CreateFormValues>()

  const [wordsMode, setWordsMode] = useState<WordsMode>('batch')
  const [wordsText, setWordsText] = useState('')
  const [wordsFile, setWordsFile] = useState<File | null>(null)

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
    createForm.setFieldsValue({ durationMode: 'permanent' })
    setWordsMode('batch')
    setWordsText('')
    setWordsFile(null)
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    const words = wordsText
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
      kind: filterKind ?? '黑名单',
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

  const cols: TableColumnsType<LibraryListItem> = useMemo(() => {
    const nameCol: TableColumnsType<LibraryListItem>[number] = {
      title: '名称',
      dataIndex: 'name',
      width: '20%',
      render: (v: string, row) => (
        <Space size={6}>
          <Link
            to={`/resources/words/${row.id}`}
            style={{ color: '#020617', fontWeight: 500 }}
          >
            {v}
          </Link>
          {!row.is_active && <Tag>已停用</Tag>}
        </Space>
      ),
    }
    const ownershipCol: TableColumnsType<LibraryListItem>[number] = {
      title: '归属',
      dataIndex: 'is_platform',
      width: '10%',
      render: (v: boolean) =>
        v ? (
          <Tooltip title="通用平台库:仅超级管理员可编辑/删除">
            <Tag color="purple" style={{ margin: 0 }}>通用平台</Tag>
          </Tooltip>
        ) : (
          <Tag style={{ margin: 0 }}>自定义</Tag>
        ),
    }
    const effectiveCol: TableColumnsType<LibraryListItem>[number] = {
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
    }
    const countCol: TableColumnsType<LibraryListItem>[number] = {
      title: '词数',
      dataIndex: 'item_count',
      width: '8%',
      align: 'right',
    }
    const updatedCol: TableColumnsType<LibraryListItem>[number] = {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: '16%',
      render: (v: string | null) => (
        <span style={{ color: '#64748B', fontSize: 12 }}>
          {v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'}
        </span>
      ),
    }
    const createdCol: TableColumnsType<LibraryListItem>[number] = {
      title: '创建时间',
      dataIndex: 'created_at',
      width: '12%',
      render: (v: string) => (
        <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD')}</span>
      ),
    }
    const actionCol: TableColumnsType<LibraryListItem>[number] = {
      title: '操作',
      width: '12%',
      render: (_v, row) => {
        const isPlatform = row.is_platform
        const deleteDisabled = isPlatform && !isSuperadmin
        return (
          <Space size={4}>
            <Link to={`/resources/words/${row.id}`}>
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
    }

    const base: TableColumnsType<LibraryListItem> = [
      nameCol,
      effectiveCol,
      countCol,
      updatedCol,
      createdCol,
      actionCol,
    ]
    if (isSuperadmin) base.splice(1, 0, ownershipCol)
    return base
  }, [isSuperadmin])

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
      </div>

      <Tabs
        type="line"
        activeKey={filterKind ?? '黑名单'}
        onChange={(k) => {
          setFilterKind(k as LibraryKind)
          void fetchLibraries()
        }}
        style={{ marginBottom: 12 }}
        items={LIBRARY_KIND_OPTIONS.map((o) => ({
          key: o.value,
          label: o.label,
        }))}
      />

      <div
        style={{
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 6,
          padding: '12px 16px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          创建词库
        </Button>
        <Text type="secondary" style={{ fontSize: 13 }}>
          您可以在策略配置时选择该词库进行过滤
        </Text>
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
          initialValues={{ durationMode: 'permanent' }}
        >
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
          <PlatformToggle uncheckedLabel="自定义" />

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

          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 14,
                color: 'rgba(0,0,0,0.88)',
                marginBottom: 8,
              }}
            >
              词条（可选,创建时可一并填入）
            </div>
            <WordsInputPanel
              text={wordsText}
              file={wordsFile}
              mode={wordsMode}
              disabled={creating}
              onModeChange={setWordsMode}
              onTextChange={setWordsText}
              onFileChange={setWordsFile}
            />
          </div>
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
