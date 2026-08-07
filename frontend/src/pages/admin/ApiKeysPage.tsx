import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  PlusOutlined,
  ReloadOutlined,
  MoreOutlined,
  CopyOutlined,
  ExclamationCircleFilled,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

import { apiKeysApi } from '@/api/apiKeys'
import { tenantsApi } from '@/api/tenants'
import { isPlatformAdmin, getCurrentUserTenantId } from '@/lib/tenantAuth'
import { useAuthStore } from '@/store'
import type { ApiKey, ApiKeyScope, ApiKeyStatus } from '@/types/apiKey'
import { deriveKeyStatus } from '@/types/apiKey'
import type { Tenant } from '@/types/tenant'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const { Title, Text, Paragraph } = Typography

const STATUS_TAG: Record<ApiKeyStatus, { color: string; label: string }> = {
  active: { color: 'green', label: '有效' },
  revoked: { color: 'default', label: '已撤销' },
  expired: { color: 'red', label: '已过期' },
}

const SCOPE_TAG: Record<ApiKeyScope, { color: string; label: string; desc: string }> = {
  read: { color: 'blue', label: '读', desc: '只能查询审核 API' },
  write: { color: 'orange', label: '写', desc: '可触发审核与人工决策' },
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '从未使用'
  return dayjs(iso).fromNow()
}

export default function ApiKeysPage() {
  const { message, modal } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentUser = useAuthStore((s) => s.user)

  const [loading, setLoading] = useState(true)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const platformAdmin = isPlatformAdmin(currentUser)
  const ownTenantId = getCurrentUserTenantId(currentUser)
  const tenantFilter = platformAdmin
    ? (searchParams.get('tenant_id') ? Number(searchParams.get('tenant_id')) : undefined)
    : ownTenantId ?? undefined
  const scopeFilter = (searchParams.get('scope') as ApiKeyScope | null) ?? undefined
  const statusFilter = (searchParams.get('status') as ApiKeyStatus | null) ?? undefined
  const keyword = searchParams.get('q') ?? ''

  const tenantMap = useMemo(() => {
    const m = new Map<number, Tenant>()
    tenants.forEach((t) => m.set(t.id, t))
    return m
  }, [tenants])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [kList, tnList] = await Promise.all([
        apiKeysApi.list({
          tenant_id: tenantFilter,
          scope: scopeFilter,
          status: statusFilter,
          q: keyword || undefined,
        }),
        tenantsApi.list(),
      ])
      setKeys(kList)
      setTenants(tnList)
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || (e as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [tenantFilter, scopeFilter, statusFilter, keyword, message])

  useEffect(() => {
    load()
  }, [load])

  const updateParam = (key: string, val: string | number | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (val !== undefined && val !== null && val !== '') next.set(key, String(val))
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const handleCreate = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const created = await apiKeysApi.create({
        tenant_id: values.tenant_id,
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        scope: values.scope,
        expires_at: values.expires_at ? values.expires_at.toISOString() : null,
      })
      setDrawerOpen(false)
      form.resetFields()
      message.success('API Key 已创建')
      showPlaintextModal(created)
      await load()
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (detail) message.error(detail)
      else if ((e as Error).message) message.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const showPlaintextModal = (created: { plaintext: string; name: string }) => {
    let confirmed = false
    const m = modal.info({
      title: (
        <Space>
          <ExclamationCircleFilled style={{ color: '#faad14' }} />
          <span>请立即保存此 API Key</span>
        </Space>
      ),
      icon: null,
      width: 560,
      content: (
        <div style={{ marginTop: 16 }}>
          <Paragraph type="warning" style={{ marginBottom: 12 }}>
            此 API Key 仅显示一次，关闭后将无法再次查看完整内容。请立即复制到安全的密钥管理工具。
          </Paragraph>
          <Text strong>API Key</Text>
          <Input.Search
            value={created.plaintext}
            readOnly
            enterButton={
              <Button icon={<CopyOutlined />} type="primary">
                复制
              </Button>
            }
            style={{ marginTop: 6, marginBottom: 16 }}
            onSearch={() => {
              navigator.clipboard
                .writeText(created.plaintext)
                .then(() => message.success('已复制到剪贴板'))
                .catch(() => message.error('复制失败，请手动复制'))
            }}
          />
          <label style={{ cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              style={{ marginRight: 8 }}
              onChange={(e) => {
                confirmed = e.target.checked
                m.update({
                  okButtonProps: { disabled: !confirmed },
                })
              }}
            />
            我已保存到安全位置
          </label>
        </div>
      ),
      okText: '我知道了',
      okButtonProps: { disabled: !confirmed },
      onOk: () => Promise.resolve(),
    })
  }

  const handleRevoke = async (k: ApiKey) => {
    try {
      await apiKeysApi.revoke(k.id)
      message.success(`已撤销「${k.name}」`)
      await load()
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || (e as Error).message)
    }
  }

  const handleRotate = async (k: ApiKey) => {
    Modal.confirm({
      title: `轮换 API Key「${k.name}」?`,
      content: '旧 API Key 立即失效，将生成新 Key。请确认外部系统可以立即切换。',
      okText: '确认轮换',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const created = await apiKeysApi.rotate(k.id)
          message.success('已轮换，请保存新 API Key')
          showPlaintextModal(created)
          await load()
        } catch (e) {
          const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          message.error(detail || (e as Error).message)
        }
      },
    })
  }

  const columns: ColumnsType<ApiKey> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: '22%',
      render: (_, k) => (
        <div>
          <div style={{ fontWeight: 500 }}>{k.name}</div>
          {k.description && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {k.description}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: '租户',
      dataIndex: 'tenant_id',
      key: 'tenant',
      width: '12%',
      render: (id: number) => {
        const tn = tenantMap.get(id)
        return tn ? <Tag>{tn.code}</Tag> : <Text type="secondary">-</Text>
      },
    },
    {
      title: 'Prefix',
      dataIndex: 'key_prefix',
      key: 'prefix',
      width: '18%',
      render: (p: string) => (
        <Tooltip title={p}>
          <Text code style={{ fontSize: 12 }}>
            {p.slice(0, 12)}…
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Scope',
      dataIndex: 'scope',
      key: 'scope',
      width: '8%',
      render: (s: ApiKeyScope) => (
        <Tooltip title={SCOPE_TAG[s].desc}>
          <Tag color={SCOPE_TAG[s].color}>{SCOPE_TAG[s].label}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '最后使用',
      dataIndex: 'last_used_at',
      key: 'last_used',
      width: '12%',
      render: (iso: string | null) => (
        <Text type={iso ? undefined : 'secondary'}>{fmtRelative(iso)}</Text>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: '10%',
      render: (_, k) => {
        const s = deriveKeyStatus(k)
        return <Tag color={STATUS_TAG[s].color}>{STATUS_TAG[s].label}</Tag>
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: '8%',
      render: (_, k) => {
        const s = deriveKeyStatus(k)
        const disabled = s !== 'active'
        return (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'revoke',
                  label: '撤销',
                  disabled,
                  onClick: () => handleRevoke(k),
                },
                {
                  key: 'rotate',
                  label: '轮换',
                  disabled,
                  onClick: () => handleRotate(k),
                },
              ],
            }}
            trigger={['click']}
          >
            <Button type="text" icon={<MoreOutlined />} size="small">
              更多
            </Button>
          </Dropdown>
        )
      },
    },
  ]

  const tenantOptions = tenants.map((t) => ({
    label: `${t.name} (${t.code})${t.is_active ? '' : ' · 已禁用'}`,
    value: t.id,
    disabled: !t.is_active,
  }))

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            API Keys
          </Title>
          <Text type="secondary">外部系统调用审核 API 的凭证 · 共 {keys.length} 条</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields()
              setDrawerOpen(true)
            }}
          >
            新建 Key
          </Button>
        </Space>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        {platformAdmin && (
          <Select
            placeholder="按租户筛选"
            allowClear
            style={{ width: 200 }}
            value={tenantFilter}
            onChange={(v) => updateParam('tenant_id', v)}
            options={tenantOptions}
          />
        )}
        <Select
          placeholder="按 Scope 筛选"
          allowClear
          style={{ width: 140 }}
          value={scopeFilter}
          onChange={(v) => updateParam('scope', v)}
          options={[
            { label: '读', value: 'read' },
            { label: '写', value: 'write' },
          ]}
        />
        <Select
          placeholder="按状态筛选"
          allowClear
          style={{ width: 140 }}
          value={statusFilter}
          onChange={(v) => updateParam('status', v)}
          options={[
            { label: '有效', value: 'active' },
            { label: '已撤销', value: 'revoked' },
            { label: '已过期', value: 'expired' },
          ]}
        />
        <Input.Search
          placeholder="搜索名称 / 描述 / 前缀"
          allowClear
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => updateParam('q', e.target.value || undefined)}
        />
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={keys}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (n) => `共 ${n} 条` }}
          size="middle"
        />
      )}

      <Drawer
        title="新建 API Key"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={520}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={handleCreate}>
              创建
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={{ scope: 'read' }}>
          <Form.Item
            name="tenant_id"
            label="所属租户"
            rules={[{ required: true, message: '请选择租户' }]}
          >
            <Select placeholder="选择租户" options={tenantOptions} />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入名称' },
              { max: 128, message: '不超过 128 字符' },
            ]}
          >
            <Input placeholder="如：投放后台-生产" maxLength={128} showCount />
          </Form.Item>
          <Form.Item name="description" label="备注">
            <Input.TextArea placeholder="选填" rows={2} maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="scope" label="Scope" rules={[{ required: true }]}>
            <Radio.Group>
              <Space direction="vertical">
                <Radio value="read">
                  read — 只能查询审核 API
                </Radio>
                <Radio value="write">
                  write — 可触发审核与人工决策
                </Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="expires_at" label="过期时间" tooltip="留空 = 永不过期">
            <DatePicker
              style={{ width: '100%' }}
              showTime
              disabledDate={(d) => d && d.isBefore(dayjs().endOf('day'))}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
