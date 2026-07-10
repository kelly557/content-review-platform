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
import { describeLaunch } from '@/lib/cronDescriber'

function describeLaunchSpec(t: Trigger): string {
  return describeLaunch(t)
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
      message.error('加载自动审核失败')
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
      message.success(next ? '已开启' : '已关闭')
      fetchTriggers()
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '操作失败')
    }
  }

  const handleRun = (record: Trigger) => {
    let reason = ''
    modal.confirm({
      title: '立即运行一次',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            当前规则：<strong>{record.name}</strong>
          </p>
          <p style={{ marginBottom: 8, color: '#666' }}>
            本次将立即扫描所有适用素材并创建一次审核任务，不会修改规则的启动时间。
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
      okText: '立即运行',
      cancelText: '取消',
      onOk: async () => {
        try {
          await triggersApi.runNow(record.id)
          message.success('已运行')
          fetchTriggers()
        } catch (e) {
          const err = e as { response?: { data?: { detail?: string } } }
          message.error(err.response?.data?.detail || '运行失败')
        }
        void reason
      },
    })
  }

  const columns: TableColumnsType<Trigger> = [
    { title: '名称', dataIndex: 'name', ellipsis: true, render: (t, r) => <a onClick={() => navigate(`/triggers/${r.id}`)}>{t}</a> },
    {
      title: '启动方式',
      dataIndex: 'trigger_type',
      width: 100,
      render: () => <Tag color="blue">按时间计划</Tag>,
    },
    { title: '启动时间', key: 'launch', width: 240, render: (_, r) => describeLaunchSpec(r) },
    {
      title: '适用素材',
      key: 'strategy',
      width: 160,
      ellipsis: true,
      render: (_, r) => (r.strategy_name ? <Tag>{r.strategy_name}</Tag> : <span style={{ color: '#999' }}>不限</span>),
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
      title: '下次启动',
      key: 'next_run',
      width: 180,
      render: (_, r) =>
        r.next_run_at ? (
          <span style={{ fontSize: 12, color: '#666' }}>
            {new Date(r.next_run_at).toLocaleString('zh-CN')}
          </span>
        ) : (
          <span style={{ color: '#999' }}>—</span>
        ),
    },
    {
      title: '操作',
      width: 220,
      render: (_, r) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => navigate(`/triggers/${r.id}`)}>
            查看
          </Button>
          <Button type="link" size="small" onClick={() => handleRun(r)} disabled={!r.is_enabled}>
            立即运行
          </Button>
          <Button type="link" size="small" onClick={() => navigate(`/triggers/${r.id}`, { state: { edit: true } })}>
            编辑
          </Button>
        </Space>
      ),
    },
  ]

  if (!isAdmin) {
    return <Empty description="仅管理员可访问" />
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
        <div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>自动审核</div>
          <div style={{ marginTop: 4, color: '#666', fontSize: 13 }}>
            按时间计划或外部通知自动发起的审核任务
          </div>
        </div>
        <Space>
          <Button onClick={fetchTriggers}>刷新</Button>
          <Button type="primary" onClick={() => navigate('/triggers/new')}>
            + 新建自动审核
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
          style={{ width: 160 }}
          options={[
            { value: 'all', label: '全部启动方式' },
            { value: 'cron', label: '按时间计划' },
            { value: 'external_callback', label: '外部通知触发' },
          ]}
        />
        <Select
          value={enabledFilter}
          onChange={setEnabledFilter}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'true', label: '已开启' },
            { value: 'false', label: '已关闭' },
          ]}
        />
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{ pageSize: 20, total, showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: <Empty description="暂无自动审核" /> }}
      />
    </div>
  )
}
