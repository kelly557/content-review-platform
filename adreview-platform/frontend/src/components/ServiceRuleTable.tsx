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
  Popconfirm,
  type TableColumnsType,
} from 'antd'
import { SearchOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { Link, useLocation } from 'react-router-dom'
import { servicesApi } from '@/api/services'
import { serviceCategoriesApi } from '@/api/serviceCategories'
import type {
  Service,
  ServiceScope,
  ServiceCategory,
  ServiceCreatePayload,
} from '@/types/domain'

const RULE_SUPPORTED_CODES = new Set<string>([
  'ad_compliance_detection_pro',
  'text_audit_pro',
])

interface Props {
  value?: string[]
  onChange?: (codes: string[]) => void
  categoryIds?: number[]
  categoryName?: string
  emptyHint?: string
  onCategoryCountChange?: (count: number) => void
}

export default function ServiceRuleTable({
  value = [],
  onChange,
  categoryIds,
  categoryName,
  emptyHint = '本类规则尚未启用',
  onCategoryCountChange,
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

  const itemCodes = useMemo(() => new Set(items.map((s) => s.code)), [items])
  const selectedInCategory = useMemo(
    () => value.filter((code) => itemCodes.has(code)).length,
    [value, itemCodes],
  )
  useEffect(() => {
    onCategoryCountChange?.(selectedInCategory)
  }, [selectedInCategory, onCategoryCountChange])

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
      width: '35%',
      render: (v: string, row) => (
        <Space>
          <span style={{ color: '#020617' }}>{v}</span>
          {row.is_custom && <Tag color="orange">自定义</Tag>}
        </Space>
      ),
    },
    {
      title: '场景',
      dataIndex: 'scope',
      width: '12%',
      render: (v: ServiceScope | null) => (v ? <Tag>{v}</Tag> : <span style={{ color: '#94A3B8' }}>--</span>),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: '18%',
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
      width: '35%',
      render: (_v, row) => {
        return (
          <Space size={4} wrap>
            {RULE_SUPPORTED_CODES.has(row.code) ? (
              <Link
                to={`/strategies/rules/${row.code}`}
                state={{ from: location.pathname, fromStep: 1 }}
                style={{ color: '#0369A1' }}
              >
                管理检测规则
              </Link>
            ) : (
              <span style={{ color: '#94A3B8', cursor: 'not-allowed' }}>管理检测规则</span>
            )}
            <span style={{ color: '#E2E8F0' }}>|</span>
            {row.is_custom && (
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