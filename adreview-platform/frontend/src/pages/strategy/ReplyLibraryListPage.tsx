import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
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
  Tooltip,
  Typography,
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
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import { isMockRiskPointId } from '@/lib/riskPointMock'
import type {
  AuditItem,
  AuditPoint,
  Library,
  LibraryCreate,
  LibraryListItem,
} from '@/types/domain'
import { parseReplyFile } from '@/lib/libraryImport'
import DeleteLibraryDialog from '@/components/library/DeleteLibraryDialog'
import PlatformToggle from '@/components/library/PlatformToggle'
import { useAuthStore } from '@/store'

const { Title } = Typography

const MAX_PAIRS = 1000
const TEXT_PACKAGE = 'text_audit_pro'

interface RiskPointOption {
  value: number
  label: string
  itemId: number
  itemName: string
  isMock: boolean
}

interface CreateFormValues {
  name: string
  description?: string
  pairsText?: string
  is_platform?: boolean
  risk_point_id?: number
}

export default function ReplyLibraryListPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const isSuperadmin = user?.role === 'superadmin' || user?.role === 'root_admin'
  const [items, setItems] = useState<LibraryListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [riskPointFilter, setRiskPointFilter] = useState<number | undefined>(
    undefined,
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [creatingImport, setImporting] = useState(false)
  const [createForm] = Form.useForm<CreateFormValues>()
  const [riskPointOptions, setRiskPointOptions] = useState<RiskPointOption[]>([])
  const [riskPointsLoading, setRiskPointsLoading] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Library | null>(null)

  const fetchLibraries = async () => {
    setLoading(true)
    try {
      const data = await librariesApi.list({
        type: 'reply',
        q: q || undefined,
        risk_point_id: riskPointFilter,
        size: 50,
      })
      setItems(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }

  const fetchRiskPoints = async () => {
    setRiskPointsLoading(true)
    try {
      const [aiList, pointList] = await Promise.all([
        auditItemsApi.list(TEXT_PACKAGE).catch(() => [] as AuditItem[]),
        auditPointsApi.list(TEXT_PACKAGE).catch(() => [] as AuditPoint[]),
      ])
      const itemNameById = new Map<number, string>()
      aiList.forEach((it) => itemNameById.set(it.id, it.name_cn))
      const opts: RiskPointOption[] = pointList.map((p) => ({
        value: p.id,
        label: p.label_cn || p.label || p.code,
        itemId: p.item_id,
        itemName: itemNameById.get(p.item_id) ?? `审核项 ${p.item_id}`,
        isMock: p.is_mock === true || isMockRiskPointId(p.id),
      }))
      opts.sort((a, b) => {
        if (a.itemId !== b.itemId) return a.itemId - b.itemId
        return a.label.localeCompare(b.label, 'zh-CN')
      })
      setRiskPointOptions(opts)
    } finally {
      setRiskPointsLoading(false)
    }
  }

  useEffect(() => {
    void fetchLibraries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskPointFilter])

  const openCreate = () => {
    createForm.resetFields()
    setCreateOpen(true)
    void fetchRiskPoints()
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    if (!v.risk_point_id) {
      message.error('请选择二级风险标签（审核点）')
      return
    }
    if (isMockRiskPointId(v.risk_point_id)) {
      message.error('所选风险标签为演示数据,不可提交,请等待后端恢复后重试')
      return
    }
    const pairsText: string = v.pairsText ?? ''
    const words: string[] = pairsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const payload: LibraryCreate = {
      name: v.name.trim(),
      library_type: 'reply',
      description: v.description,
      words,
      is_platform: v.is_platform ?? false,
      risk_point_id: v.risk_point_id,
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

  const filterOptions = useMemo<RiskPointOption[]>(
    () => riskPointOptions,
    [riskPointOptions],
  )

  const cols: TableColumnsType<LibraryListItem> = [
    {
      title: '名称',
      dataIndex: 'name',
      width: '22%',
      render: (v: string, row) => (
        <Space size={6}>
          <Link
            to={`/resources/replies/${row.id}`}
            style={{ color: '#020617', fontWeight: 500 }}
          >
            {v}
          </Link>
          {!row.is_active && <Tag>已停用</Tag>}
        </Space>
      ),
    },
    {
      title: '风险标签',
      dataIndex: 'risk_point',
      width: '22%',
      render: (v: LibraryListItem['risk_point']) => {
        if (!v) {
          return (
            <Tooltip title="存量代答库,未指定二级风险标签">
              <Tag color="default" style={{ margin: 0 }}>
                未指定
              </Tag>
            </Tooltip>
          )
        }
        return (
          <Space size={4} wrap>
            {v.item_name && (
              <Tag color="blue" style={{ margin: 0 }}>
                {v.item_name}
              </Tag>
            )}
            <Tag color="geekblue" style={{ margin: 0 }}>
              {v.label_cn || v.label}
            </Tag>
          </Space>
        )
      },
    },
    { title: '条数', dataIndex: 'item_count', width: '10%', align: 'right' },
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
      width: '10%',
      render: (_v, row) => {
        const isPlatform = row.is_platform
        const deleteDisabled = isPlatform && !isSuperadmin
        return (
          <Space size={4}>
            <Link to={`/resources/replies/${row.id}`}>
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
        <Space wrap>
          <span style={{ color: '#64748B', fontSize: 12 }}>
            代答库条目本身就是命中即触发的规则,无需指定黑/白名单类型。
          </span>
        </Space>
        <Space wrap>
          <Select
            allowClear
            placeholder="按风险标签筛选"
            style={{ width: 240 }}
            loading={riskPointsLoading}
            value={riskPointFilter}
            onChange={(v) => setRiskPointFilter(v ?? undefined)}
            onClear={() => setRiskPointFilter(undefined)}
            notFoundContent={
              riskPointsLoading ? '加载中…' : '暂无可用风险标签'
            }
            options={filterOptions.map((o) => ({
              value: o.value,
              label: `${o.itemName} / ${o.label}${o.isMock ? ' (演示)' : ''}`,
              disabled: o.isMock,
            }))}
          />
          <Input.Search
            placeholder="搜索代答库名称"
            allowClear
            style={{ width: 240 }}
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
        <Form<CreateFormValues> form={createForm} layout="vertical">
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
          <PlatformToggle />
          <Form.Item
            name="risk_point_id"
            label="二级风险标签（审核点）"
            extra={
              <span style={{ color: '#64748B', fontSize: 12 }}>
                选择该代答库在策略编辑「文本审核」中的使用位置
              </span>
            }
            rules={[{ required: true, message: '请选择二级风险标签' }]}
          >
            <Select
              placeholder={
                riskPointsLoading
                  ? '加载中…'
                  : riskPointOptions.length === 0
                    ? '后端暂不可用,正在加载演示数据'
                    : '请选择文本审核下的二级风险标签'
              }
              loading={riskPointsLoading}
              showSearch
              optionFilterProp="label"
              notFoundContent={
                riskPointsLoading ? '加载中…' : '暂无可用风险标签'
              }
              options={riskPointOptions.map((o) => ({
                value: o.value,
                label: `${o.itemName} / ${o.label}${o.isMock ? ' (演示,不可提交)' : ''}`,
                disabled: o.isMock,
              }))}
              onFocus={() => {
                if (riskPointOptions.length === 0) void fetchRiskPoints()
              }}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                marginBottom: 8,
                color: 'rgba(0, 0, 0, 0.88)',
                fontSize: 14,
              }}
            >
              代答条目（可选,创建时可一并填入）
            </div>
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
                        placeholder={'您好,客官 您好,有什么可以帮您?\n发货时间 24小时内\n发货时间｜24小时内'}
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
                        message="每行一条,用 空格 或 '｜' 把触发词与回复隔开"
                        description={
                          <span>
                            例：<code>{'问候 您好,有什么可以帮您?\n发货｜24小时内'}</code>
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
                              .map((p) => `${p.trigger} ${p.reply}`)
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