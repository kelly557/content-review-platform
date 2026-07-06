import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Table,
  Tag,
  Select,
  Input,
  Space,
  Typography,
  Button,
  Modal,
  Form,
  Tooltip,
  Popconfirm,
  type TableColumnsType,
} from 'antd'
import {
  SearchOutlined,
  PlusOutlined,
  DeleteOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Link, useLocation } from 'react-router-dom'
import { servicesApi } from '@/api/services'
import { serviceCategoriesApi } from '@/api/serviceCategories'
import { detectionRulesApi } from '@/api/detectionRules'
import type {
  Service,
  ServiceScope,
  ServiceCategory,
  ServiceCreatePayload,
  DetectionRule,
} from '@/types/domain'

const RULE_SUPPORTED_CODES = new Set<string>([
  'ad_compliance_detection_pro',
  'text_audit_pro',
])

const RULE_PREVIEW_LIMIT = 3

interface Props {
  value?: string[]
  onChange?: (codes: string[]) => void
  categoryIds?: number[]
  categoryName?: string
  emptyHint?: string
  onCategoryCountChange?: (count: number) => void
  onVisibleItems?: (
    codes: string[],
    items: Array<{ code: string; category_id: number | null }>,
  ) => void
}

type RuleSummary = Pick<DetectionRule, 'label' | 'label_cn' | 'description' | 'is_enabled'>

export default function ServiceRuleTable({
  value = [],
  onChange,
  categoryIds,
  categoryName,
  emptyHint = '本类规则尚未启用',
  onCategoryCountChange,
  onVisibleItems,
}: Props) {
  const { message } = App.useApp()
  const location = useLocation()
  const [items, setItems] = useState<Service[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<ServiceScope | ''>('')
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm()
  const [creating, setCreating] = useState(false)

  const [rulesPreview, setRulesPreview] = useState<Record<string, RuleSummary[]>>({})
  const [rulesLoading, setRulesLoading] = useState(false)

  const fetchCategories = async () => {
    try {
      const data = await serviceCategoriesApi.list({ size: 200 })
      setCategories(data.items.filter((c) => c.is_active))
    } catch {
      // ignore
    }
  }

  const fetch = async () => {
    setLoading(true)
    try {
      const data = await servicesApi.list({
        size: 100,
        scope: scope === '' ? undefined : scope,
        q: q || undefined,
        category_ids: categoryIds && categoryIds.length > 0 ? categoryIds : undefined,
      })
      setItems(data.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCategories()
  }, [])

  useEffect(() => {
    fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, categoryIds?.join('|')])

  useEffect(() => {
    let cancelled = false
    if (items.length === 0) {
      setRulesPreview({})
      return () => {
        cancelled = true
      }
    }
    setRulesLoading(true)
    Promise.all(
      items.map(async (svc) => {
        try {
          const rules = await detectionRulesApi.list(svc.code)
          const summary: RuleSummary[] = rules
            .filter((r) => r.is_enabled)
            .slice(0, RULE_PREVIEW_LIMIT)
            .map((r) => ({
              label: r.label,
              label_cn: r.label_cn,
              description: r.description,
              is_enabled: r.is_enabled,
            }))
          return [svc.code, summary] as const
        } catch {
          return [svc.code, [] as RuleSummary[]] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      const map: Record<string, RuleSummary[]> = {}
      entries.forEach(([code, summary]) => {
        map[code] = summary
      })
      setRulesPreview(map)
      setRulesLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [items])

  const itemCodes = useMemo(() => new Set(items.map((s) => s.code)), [items])
  const selectedInCategory = useMemo(
    () => value.filter((code) => itemCodes.has(code)).length,
    [value, itemCodes],
  )
  useEffect(() => {
    onCategoryCountChange?.(selectedInCategory)
  }, [selectedInCategory, onCategoryCountChange])

  useEffect(() => {
    if (!onVisibleItems) return
    onVisibleItems(
      items.map((s) => s.code),
      items.map((s) => ({ code: s.code, category_id: s.category_id ?? null })),
    )
  }, [items, onVisibleItems])

  const onCreateRule = async () => {
    const values = await createForm.validateFields().catch(() => null)
    if (!values) return
    setCreating(true)
    try {
      const payload: ServiceCreatePayload = {
        name: values.name,
        description: values.description,
        scope: values.scope || '业务场景',
        category_id:
          (categoryIds && categoryIds.length === 1 ? categoryIds[0] : null) ??
          values.category_id ??
          null,
      }
      const created = await servicesApi.create(payload)
      message.success('规则已创建')
      setCreateOpen(false)
      createForm.resetFields()
      setItems((prev) => {
        if (prev.some((s) => s.code === created.code)) return prev
        return [created, ...prev]
      })
      await fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const onDeleteRule = async (svc: Service) => {
    if (!svc.is_custom) {
      message.warning('系统规则不可删除')
      return
    }
    try {
      await servicesApi.delete(svc.id)
      message.success('已删除')
      await fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const scopeOptions = [
    { value: '', label: '全部场景' },
    ...categories.map((c) => ({ value: c.name as ServiceScope, label: c.name })),
  ]

  const columns: TableColumnsType<Service> = [
    {
      title: '名称',
      dataIndex: 'name',
      width: '20%',
      render: (v: string, row) => (
        <Space>
          <span style={{ color: '#020617' }}>{v}</span>
          {row.is_custom && <Tag color="orange">自定义</Tag>}
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: '20%',
      render: (v: string | null) =>
        v ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: v }}>
            {v}
          </Typography.Text>
        ) : (
          <span style={{ color: '#94A3B8' }}>--</span>
        ),
    },
    {
      title: '检测规则',
      dataIndex: 'rules_preview',
      width: '24%',
      render: (_v, row) => {
        const list = rulesPreview[row.code] ?? []
        if (rulesLoading && list.length === 0) {
          return <span style={{ color: '#94A3B8', fontSize: 12 }}>加载中…</span>
        }
        if (list.length === 0) {
          return <span style={{ color: '#94A3B8', fontSize: 12 }}>暂无规则</span>
        }
        return (
          <Space size={4} wrap>
            {list.map((r) => (
              <Tooltip key={r.label} title={r.description ?? r.label_cn}>
                <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                  {r.label_cn || r.label}
                </Tag>
              </Tooltip>
            ))}
            {RULE_SUPPORTED_CODES.has(row.code) && (
              <Tooltip title="查看 / 配置完整检测点">
                <Link
                  to={`/strategies/rules/${row.code}`}
                  state={{ from: location.pathname, fromStep: 1 }}
                  style={{ fontSize: 12 }}
                >
                  更多 ›
                </Link>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
    {
      title: '场景',
      dataIndex: 'scope',
      width: '8%',
      render: (v: ServiceScope | null) =>
        v ? <Tag>{v}</Tag> : <span style={{ color: '#94A3B8' }}>--</span>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: '14%',
      render: (v: string | null) =>
        v ? (
          <span style={{ color: '#020617', fontVariantNumeric: 'tabular-nums' }}>
            {dayjs(v).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        ) : (
          <span style={{ color: '#94A3B8' }}>--</span>
        ),
    },
    {
      title: '操作',
      dataIndex: 'actions',
      width: '14%',
      render: (_v, row) => {
        return (
          <Space size={4} wrap>
            {RULE_SUPPORTED_CODES.has(row.code) ? (
              <Link
                to={`/strategies/rules/${row.code}`}
                state={{ from: location.pathname, fromStep: 1 }}
                style={{ color: '#0369A1' }}
              >
                <SettingOutlined /> 管理
              </Link>
            ) : (
              <Tooltip title="该规则暂不支持检测点配置">
                <span style={{ color: '#94A3B8', cursor: 'not-allowed' }}>
                  <SettingOutlined /> 管理
                </span>
              </Tooltip>
            )}
            <span style={{ color: '#E2E8F0' }}>|</span>
            {row.is_custom ? (
              <Popconfirm
                title="确认删除此自定义规则？"
                onConfirm={() => onDeleteRule(row)}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ) : (
              <Tooltip title="系统规则不可删除">
                <Button type="link" size="small" disabled icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'clamp(8px, 1.2vw, 16px)',
          marginBottom: 16,
        }}
      >
        <Space wrap size={8} style={{ display: 'flex', flexWrap: 'wrap' }}>
          <Select
            value={scope}
            onChange={(v) => setScope(v as ServiceScope | '')}
            options={scopeOptions}
            style={{ width: 'min(160px, 100%)' }}
            aria-label="按场景筛选"
          />
          <Input
            allowClear
            placeholder="请输入规则名称"
            prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
            style={{ width: 'min(280px, 100%)' }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onPressEnter={fetch}
            aria-label="搜索规则名称"
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新增规则
        </Button>
      </div>

      <Table<Service>
        rowKey="code"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        size="middle"
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: <Typography.Text type="secondary">{emptyHint}</Typography.Text>,
        }}
        rowSelection={
          onChange
            ? {
                selectedRowKeys: value,
                onChange: (keys) => onChange(keys as string[]),
              }
            : undefined
        }
      />

      <Modal
        open={createOpen}
        title={categoryName ? `新增「${categoryName}」规则` : '新增自定义规则'}
        onCancel={() => {
          setCreateOpen(false)
          createForm.resetFields()
        }}
        onOk={onCreateRule}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical" initialValues={{ scope: '业务场景' }}>
          <Form.Item
            name="name"
            label="规则名称"
            rules={[{ required: true, message: '请输入规则名称' }]}
          >
            <Input placeholder="如：自定义图片审核" maxLength={100} />
          </Form.Item>
          <Form.Item name="scope" label="所属场景">
            <Select
              options={categories.map((c) => ({ value: c.name, label: c.name }))}
              placeholder="选择场景分类"
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="规则描述（可选）" rows={2} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
