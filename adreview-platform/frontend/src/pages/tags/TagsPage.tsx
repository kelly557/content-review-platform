import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Empty,
  type TableColumnsType,
} from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { tagsApi, type TagListParams } from '@/api/tags'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type { AuditItem, AuditPoint } from '@/types/domain'
import {
  TAG_CATEGORY_OPTIONS,
  TAG_DOMAIN_OPTIONS,
  TAG_JURISDICTION_OPTIONS,
  TAG_STATUS_OPTIONS,
  type TagCategory,
  type TagDomain,
  type TagStatus,
  type TagSummary,
} from '@/types/domain'

const { Title, Text } = Typography

const STATUS_COLORS: Record<TagStatus, string> = {
  active: 'green',
  draft: 'default',
  deprecated: 'default',
}

const STATUS_LABEL: Record<TagStatus, string> = {
  active: '已启用',
  draft: '草稿',
  deprecated: '已停用',
}

const PACKAGE_BY_MEDIA: Array<{ key: 'image' | 'text' | 'audio' | 'doc' | 'video'; label: string; code: string }> = [
  { key: 'image', label: '图片审核', code: 'image_audit_pro' },
  { key: 'text', label: '文本审核', code: 'text_audit_pro' },
  { key: 'audio', label: '语音审核', code: 'audio_audit_pro' },
  { key: 'doc', label: '文档审核', code: 'document_audit_pro' },
  { key: 'video', label: '视频审核', code: 'video_audit_pro' },
] // 语音/文档/视频 菜单已下线，但标签管理里允许按原始审核类型查看来源

interface RuleTagRow {
  id: string
  label: string
  package: string
  parent: string | null
  scope: string | null
  builtin: boolean
  enabled: boolean
}

function domainLabel(d: TagDomain): string {
  return TAG_DOMAIN_OPTIONS.find((o) => o.value === d)?.cn ?? d
}

function categoryLabel(c: TagCategory): string {
  return TAG_CATEGORY_OPTIONS.find((o) => o.value === c)?.cn ?? c
}

interface DraftValues {
  name: string
  domain?: TagDomain
  category?: TagCategory
}

export default function TagsPage() {
  const { message } = App.useApp()

  const [filters, setFilters] = useState<TagListParams>({
    page: 1,
    size: 20,
  })
  const [q, setQ] = useState('')
  const [items, setItems] = useState<TagSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [createForm] = Form.useForm<DraftValues>()
  const [editForm] = Form.useForm<DraftValues>()

  const fetchList = async () => {
    setLoading(true)
    try {
      const res = await tagsApi.list({ ...filters, q: q || undefined })
      setItems(res.items)
      setTotal(res.total)
    } catch {
      // error handled by interceptor
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const handleSearch = () => {
    setFilters((f) => ({ ...f, page: 1 }))
    fetchList()
  }

  const handleStartCreate = () => {
    createForm.resetFields()
    setCreating(true)
    setEditingId(null)
  }

  const handleCancelCreate = () => {
    setCreating(false)
    createForm.resetFields()
  }

  const handleStartEdit = (row: TagSummary) => {
    editForm.setFieldsValue({
      name: row.name,
      domain: row.domain,
      category: row.category,
    })
    setEditingId(row.id)
    setCreating(false)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    editForm.resetFields()
  }

  const handleSaveCreate = async () => {
    try {
      const values = await createForm.validateFields()
      setSaving(true)
      await tagsApi.create({
        code: undefined,
        name: values.name,
        domain: values.domain!,
        category: values.category!,
        status: 'active',
      })
      message.success('已创建')
      setCreating(false)
      createForm.resetFields()
      fetchList()
    } catch (e: any) {
      if (e?.errorFields) {
        message.error('请检查表单')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    try {
      const values = await editForm.validateFields()
      setSaving(true)
      await tagsApi.update(editingId, {
        name: values.name,
        domain: values.domain!,
        category: values.category!,
      })
      message.success('已保存')
      setEditingId(null)
      editForm.resetFields()
      fetchList()
    } catch (e: any) {
      if (e?.errorFields) {
        message.error('请检查表单')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await tagsApi.remove(id)
      message.success('已删除')
      if (editingId === id) {
        setEditingId(null)
      }
      fetchList()
    } catch {
      // handled
    }
  }

  const handleToggleStatus = async (row: TagSummary) => {
    try {
      if (row.status === 'active') {
        await tagsApi.deprecate(row.id)
        message.success('已停用')
      } else {
        await tagsApi.activate(row.id)
        message.success('已启用')
      }
      fetchList()
    } catch {
      // handled
    }
  }

  const columns: TableColumnsType<TagSummary> = [
    {
      title: '名称',
      dataIndex: 'name',
      width: '18%',
      render: (v: string, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          {row.name_en && <Text type="secondary" style={{ fontSize: 12 }}>{row.name_en}</Text>}
        </Space>
      ),
    },
    {
      title: '标签类型',
      dataIndex: 'domain',
      width: '10%',
      render: (d: TagDomain) => <Tag color="geekblue">{domainLabel(d)}</Tag>,
    },
    {
      title: '命中示例',
      dataIndex: 'category',
      width: '10%',
      render: (c: TagCategory) => <Tag>{categoryLabel(c)}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: '10%',
      render: (s: TagStatus) => <Tag color={STATUS_COLORS[s]}>{STATUS_LABEL[s]}</Tag>,
    },
    {
      title: '操作',
      width: '22%',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4} wrap>
          <Button type="link" size="small" onClick={() => handleStartEdit(row)}>
            编辑
          </Button>
          {row.status === 'active' ? (
            <Button
              type="link"
              size="small"
              icon={<PauseCircleOutlined />}
              onClick={() => handleToggleStatus(row)}
            >
              停用
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => handleToggleStatus(row)}
            >
              启用
            </Button>
          )}
          <Popconfirm
            title="确认删除？"
            description="删除后不可恢复"
            onConfirm={() => handleDelete(row.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const summary = useMemo(() => {
    const active = items.filter((i) => i.status === 'active').length
    return { active }
  }, [items])

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>标签管理</Title>
        <Text type="secondary">
          扁平多维标签 · 平台内置 + 用户扩展
        </Text>
      </div>

      <Tabs
        defaultActiveKey="general"
        items={[
          {
            key: 'general',
            label: '通用标签',
            children: <GeneralTagsTabBody />,
          },
          {
            key: 'rule',
            label: '审核规则标签',
            children: <RuleTagsTab />,
          },
        ]}
      />
    </div>
  )

  function GeneralTagsTabBody() {
    return (
      <>
        <div
          style={{
            background: '#fff',
            padding: 16,
            borderRadius: 8,
            marginBottom: 12,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Input
            placeholder="搜索名称"
            prefix={<SearchOutlined />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            placeholder="标签类型"
            allowClear
            style={{ width: 130 }}
            value={filters.domain}
            onChange={(v) => setFilters({ ...filters, domain: v, page: 1 })}
            options={TAG_DOMAIN_OPTIONS.map((o) => ({ value: o.value, label: o.cn }))}
          />
          <Select
            placeholder="命中示例"
            allowClear
            style={{ width: 140 }}
            value={filters.category}
            onChange={(v) => setFilters({ ...filters, category: v, page: 1 })}
            options={TAG_CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.cn }))}
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 110 }}
            value={filters.status}
            onChange={(v) => setFilters({ ...filters, status: v, page: 1 })}
            options={TAG_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <Select
            placeholder="法域"
            allowClear
            mode="multiple"
            style={{ width: 200 }}
            value={filters.jurisdiction}
            onChange={(v) => setFilters({ ...filters, jurisdiction: v, page: 1 })}
            options={TAG_JURISDICTION_OPTIONS}
            maxTagCount={2}
          />
          <Button
            onClick={() => {
              setFilters({ page: 1, size: 20 })
              setQ('')
            }}
          >
            清空
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleStartCreate}
            disabled={creating || editingId !== null}
          >
            新建标签
          </Button>
        </div>

        <div
          style={{
            background: '#fff',
            padding: '8px 16px',
            borderRadius: 8,
            marginBottom: 8,
            display: 'flex',
            gap: 24,
          }}
        >
          <Text type="secondary">当前页</Text>
          <Text>启用 <Text strong>{summary.active}</Text></Text>
          <Text type="secondary">合计 {total}</Text>
        </div>

        {/* Inline create form row */}
        {creating && (
          <div
            style={{
              background: '#fafafa',
              padding: 16,
              border: '1px dashed #d9d9d9',
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              新建标签
            </Text>
            <Form<DraftValues>
              form={createForm}
              layout="inline"
              initialValues={{ name: '' }}
            >
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: '请输入名称' }]}
                style={{ minWidth: 220 }}
              >
                <Input placeholder="必填" />
              </Form.Item>
              <Form.Item
                name="domain"
                label="标签类型"
                rules={[{ required: true, message: '请选择' }]}
                style={{ minWidth: 180 }}
              >
                <Select
                  placeholder="必选"
                  options={TAG_DOMAIN_OPTIONS.map((o) => ({ value: o.value, label: o.cn }))}
                />
              </Form.Item>
              <Form.Item
                name="category"
                label="命中示例"
                rules={[{ required: true, message: '请选择' }]}
                style={{ minWidth: 180 }}
              >
                <Select
                  placeholder="必选"
                  options={TAG_CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.cn }))}
                />
              </Form.Item>
              <Form.Item>
                <Space>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={saving}
                    onClick={handleSaveCreate}
                  >
                    保存
                  </Button>
                  <Button icon={<CloseOutlined />} onClick={handleCancelCreate}>
                    取消
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </div>
        )}

        <Table<TagSummary>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          pagination={{
            current: filters.page,
            pageSize: filters.size,
            total,
            showSizeChanger: true,
            onChange: (page, size) => setFilters({ ...filters, page, size }),
          }}
          expandable={{
            showExpandColumn: false,
            expandedRowKeys: editingId ? [editingId] : [],
            expandedRowRender: (row) => (
              <div
                style={{
                  background: '#fffbe6',
                  padding: 16,
                  border: '1px solid #ffe58f',
                  borderRadius: 6,
                  margin: '4px 0',
                }}
              >
                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                  编辑标签 · {row.name}
                </Text>
                <Form<DraftValues> form={editForm} layout="inline">
                  <Form.Item
                    name="name"
                    label="名称"
                    rules={[{ required: true, message: '请输入名称' }]}
                    style={{ minWidth: 220 }}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="domain"
                    label="标签类型"
                    rules={[{ required: true, message: '请选择' }]}
                    style={{ minWidth: 180 }}
                  >
                    <Select
                      options={TAG_DOMAIN_OPTIONS.map((o) => ({ value: o.value, label: o.cn }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name="category"
                    label="命中示例"
                    rules={[{ required: true, message: '请选择' }]}
                    style={{ minWidth: 180 }}
                  >
                    <Select
                      options={TAG_CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.cn }))}
                    />
                  </Form.Item>
                  <Form.Item>
                    <Space>
                      <Button
                        type="primary"
                        icon={<CheckOutlined />}
                        loading={saving}
                        onClick={handleSaveEdit}
                      >
                        保存
                      </Button>
                      <Button icon={<CloseOutlined />} onClick={handleCancelEdit}>
                        取消
                      </Button>
                    </Space>
                  </Form.Item>
                </Form>
              </div>
            ),
          }}
          locale={{
            emptyText: <Empty description="暂无标签，试试调整筛选或新建" />,
          }}
          scroll={{ x: 900 }}
        />
      </>
    )
  }
}

function RuleTagsTab() {
  const [packageKey, setPackageKey] = useState<string>('image')
  const [items, setItems] = useState<RuleTagRow[]>([])
  const [loading, setLoading] = useState(false)

  const fetchAll = async (key: string) => {
    const pkg = PACKAGE_BY_MEDIA.find((p) => p.key === key)
    if (!pkg) return
    setLoading(true)
    try {
      const [auditItems, points] = await Promise.all([
        auditItemsApi.list(pkg.code).catch(() => [] as AuditItem[]),
        auditPointsApi.list(pkg.code).catch(() => [] as AuditPoint[]),
      ])
      const itemById = new Map(auditItems.map((it) => [it.id, it]))
      const rows: RuleTagRow[] = []
      for (const it of auditItems) {
        rows.push({
          id: `item-${it.id}`,
          label: it.name_cn || it.code,
          package: pkg.label,
          parent: null,
          scope: it.description,
          builtin: it.is_builtin,
          enabled: it.is_enabled,
        })
      }
      for (const p of points) {
        const parent = itemById.get(p.item_id)
        rows.push({
          id: `point-${p.id}`,
          label: p.label_cn || p.label || p.code,
          package: pkg.label,
          parent: parent?.name_cn ?? null,
          scope: p.scope_text,
          builtin: p.is_builtin,
          enabled: p.is_enabled,
        })
      }
      setItems(rows)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll(packageKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageKey])

  const itemRows = items.filter((r) => r.parent === null)
  const pointRows = items.filter((r) => r.parent !== null)

  const itemColumns: TableColumnsType<RuleTagRow> = [
    {
      title: '名称',
      dataIndex: 'label',
      width: '30%',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '所属审核类型',
      dataIndex: 'package',
      width: '14%',
      render: (v: string) => <Tag color="geekblue">{v}</Tag>,
    },
    {
      title: '说明',
      dataIndex: 'scope',
      width: '30%',
      render: (v: string | null) =>
        v ? <Text type="secondary">{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: '10%',
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已停用'}</Tag>
      ),
    },
    {
      title: '操作',
      width: '16%',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={() =>
            row.package &&
            window.location.assign(
              `/strategies/rules-by-type/${packageKey}/${extractItemId(row.id)}`,
            )
          }
        >
          查看
        </Button>
      ),
    },
  ]

  const pointColumns: TableColumnsType<RuleTagRow> = [
    {
      title: '名称',
      dataIndex: 'label',
      width: '26%',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '父级规则',
      dataIndex: 'parent',
      width: '20%',
      render: (v: string | null) =>
        v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: '所属审核类型',
      dataIndex: 'package',
      width: '12%',
      render: (v: string) => <Tag color="geekblue">{v}</Tag>,
    },
    {
      title: '审核内容',
      dataIndex: 'scope',
      width: '26%',
      render: (v: string | null) =>
        v ? <Text type="secondary">{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: '8%',
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已停用'}</Tag>
      ),
    },
    {
      title: '操作',
      width: '8%',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={() =>
            row.package &&
            window.location.assign(
              `/strategies/rules-by-type/${packageKey}/${extractItemId(row.id)}`,
            )
          }
        >
          查看
        </Button>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          background: '#fff',
          padding: 16,
          borderRadius: 8,
          marginBottom: 12,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Text type="secondary">所属审核类型：</Text>
        <Select
          value={packageKey}
          onChange={setPackageKey}
          style={{ width: 160 }}
          options={PACKAGE_BY_MEDIA.map((p) => ({ value: p.key, label: p.label }))}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          · 规则名 = 审核项；审核点 = 审核项下属的检测点
        </Text>
      </div>

      <div style={{ marginBottom: 8 }}>
        <Text strong>规则名（审核项）· {itemRows.length} 条</Text>
      </div>
      <Table<RuleTagRow>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={itemRows}
        columns={itemColumns}
        pagination={false}
        locale={{
          emptyText: <Empty description="暂无规则名" />,
        }}
      />

      <div style={{ marginTop: 16, marginBottom: 8 }}>
        <Text strong>审核点 · {pointRows.length} 条</Text>
      </div>
      <Table<RuleTagRow>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={pointRows}
        columns={pointColumns}
        pagination={false}
        locale={{
          emptyText: <Empty description="暂无审核点" />,
        }}
      />
    </div>
  )
}

function extractItemId(rowId: string): number {
  const parts = rowId.split('-')
  return Number(parts[parts.length - 1]) || 0
}