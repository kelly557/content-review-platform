import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App,
  Button,
  Empty,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  type TableColumnsType,
} from 'antd'
import { triggersApi, type Trigger } from '@/api/triggers'
import { useAuthStore } from '@/store'

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  success: { label: '成功', color: 'green' },
  partial: { label: '部分失败', color: 'orange' },
  failed: { label: '失败', color: 'red' },
  running: { label: '运行中', color: 'blue' },
}

function describeSpec(t: Trigger): string {
  if (t.trigger_type === 'cron') {
    const spec = t.spec as { cron?: string; timezone?: string; repeat?: string; time?: string; weekdays?: number[] }
    const cron = spec.cron ?? '-'
    if (spec.repeat === 'weekly' && Array.isArray(spec.weekdays)) {
      const names = ['一', '二', '三', '四', '五', '六', '日']
      const ws = spec.weekdays.map((d) => `周${names[d - 1]}`).join('、')
      return `${ws} ${spec.time ?? ''} (${spec.timezone ?? 'Asia/Shanghai'})`
    }
    return `${cron} (${spec.timezone ?? 'Asia/Shanghai'})`
  }
  const spec = t.spec as { path_token?: string }
  if (spec.path_token) {
    return `…/${spec.path_token.slice(0, 8)}…`
  }
  return '回调'
}

export default function TriggersListPage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [items, setItems] = useState<Trigger[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [enabledFilter, setEnabledFilter] = useState<string>('all')

  const isAdmin = user?.role === 'admin'

  const fetchTriggers = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const data = await triggersApi.list({
        size: 50,
        q: keyword || undefined,
        trigger_type: typeFilter !== 'all' ? (typeFilter as 'cron' | 'external_callback') : undefined,
        is_enabled: enabledFilter === 'all' ? undefined : enabledFilter === 'true',
      })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      message.error('加载触发器失败')
    } finally {
      setLoading(false)
    }
  }, [isAdmin, keyword, typeFilter, enabledFilter, message])

  useEffect(() => {
    fetchTriggers()
  }, [fetchTriggers])

  const handleToggle = async (record: Trigger, next: boolean) => {
    try {
      await triggersApi.update(record.id, { is_enabled: next })
      message.success(next ? '已启用' : '已禁用')
      fetchTriggers()
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '操作失败')
    }
  }

  const handleRun = (record: Trigger) => {
    let reason = ''
    modal.confirm({
      title: '立即执行',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            立即执行触发器「{record.name}」？该操作不可撤销。
          </p>
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            placeholder="备注（可选）"
            onChange={(e) => {
              reason = e.target.value
            }}
          />
        </div>
      ),
      okText: '确认执行',
      cancelText: '取消',
      onOk: async () => {
        try {
          await triggersApi.runNow(record.id)
          message.success('已触发执行')
          fetchTriggers()
        } catch (e) {
          const err = e as { response?: { data?: { detail?: string } } }
          message.error(err.response?.data?.detail || '执行失败')
        }
        void reason
      },
    })
  }

  const columns: TableColumnsType<Trigger> = [
    { title: '名称', dataIndex: 'name', ellipsis: true, render: (t, r) => <a onClick={() => navigate(`/triggers/${r.id}`)}>{t}</a> },
    {
      title: '类型',
      dataIndex: 'trigger_type',
      width: 100,
      render: (v) => <Tag color={v === 'cron' ? 'blue' : 'purple'}>{v === 'cron' ? 'Cron' : '回调'}</Tag>,
    },
    { title: '调度 / 路径', key: 'spec', width: 240, render: (_, r) => describeSpec(r) },
    {
      title: '策略',
      key: 'strategy',
      width: 160,
      ellipsis: true,
      render: (_, r) => (r.strategy_name ? <Tag>{r.strategy_name}</Tag> : <span style={{ color: '#999' }}>未指定</span>),
    },
    {
      title: '状态',
      key: 'enabled',
      width: 80,
      render: (_, r) => (
        <Switch size="small" checked={r.is_enabled} onChange={(v) => handleToggle(r, v)} />
      ),
    },
    {
      title: '上次运行',
      key: 'last_run',
      width: 200,
      render: (_, r) =>
        r.last_run_at ? (
          <Space size={4}>
            <span style={{ fontSize: 12, color: '#666' }}>
              {new Date(r.last_run_at).toLocaleString('zh-CN')}
            </span>
            <Tag color={STATUS_LABEL.success.color}>{STATUS_LABEL.success.label}</Tag>
          </Space>
        ) : (
          <span style={{ color: '#999' }}>从未运行</span>
        ),
    },
    {
      title: '操作',
      width: 200,
      render: (_, r) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => navigate(`/triggers/${r.id}`)}>
            查看
          </Button>
          <Button type="link" size="small" onClick={() => handleRun(r)} disabled={!r.is_enabled}>
            立即执行
          </Button>
          <Button type="link" size="small" onClick={() => navigate(`/triggers/${r.id}`, { state: { edit: true } })}>
            编辑
          </Button>
        </Space>
      ),
    },
  ]

  if (!isAdmin) {
    return <Empty description="仅管理员可访问触发器" />
  }

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600 }}>触发器</div>
        <Space>
          <Button onClick={fetchTriggers}>刷新</Button>
          <Button type="primary" onClick={() => navigate('/triggers/new')}>
            新建触发器
          </Button>
        </Space>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={fetchTriggers}
          style={{ width: 240 }}
          allowClear
        />
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部类型' },
            { value: 'cron', label: 'Cron' },
            { value: 'external_callback', label: '外部回调' },
          ]}
        />
        <Select
          value={enabledFilter}
          onChange={setEnabledFilter}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'true', label: '已启用' },
            { value: 'false', label: '已禁用' },
          ]}
        />
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{ pageSize: 20, total, showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: <Empty description="暂无触发器" /> }}
      />
    </div>
  )
}