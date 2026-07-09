import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { triggersApi, type Trigger, type TriggerRun } from '@/api/triggers'

const { Text } = Typography

const STATUS_COLOR: Record<string, string> = {
  success: 'green',
  partial: 'orange',
  failed: 'red',
  running: 'blue',
}

const STATUS_LABEL: Record<string, string> = {
  success: '成功',
  partial: '部分失败',
  failed: '失败',
  running: '运行中',
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
  if (spec.path_token) return `…/${spec.path_token.slice(0, 8)}…`
  return '回调'
}

function renderMatchConditions(m: Record<string, string[]>): React.ReactNode {
  const entries = Object.entries(m).filter(([, v]) => v.length > 0)
  if (entries.length === 0) return <Tag>所有素材</Tag>
  return (
    <Space wrap size={[4, 4]}>
      {entries.map(([k, vs]) => (
        <Tag key={k}>{k} = {vs.join(' / ')}</Tag>
      ))}
    </Space>
  )
}

export default function TriggerDetailPage() {
  const { message, modal } = App.useApp()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const triggerId = id ? Number(id) : null

  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [runs, setRuns] = useState<TriggerRun[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!triggerId) return
    setLoading(true)
    try {
      const t = await triggersApi.get(triggerId)
      setTrigger(t)
      const r = await triggersApi.listRuns(triggerId, { size: 20 })
      setRuns(r.items)
    } catch {
      message.error('加载失败')
    } finally {
      setLoading(false)
    }
  }, [triggerId, message])

  useEffect(() => {
    load()
  }, [load])

  const handleToggle = async (next: boolean) => {
    if (!trigger) return
    try {
      await triggersApi.update(trigger.id, { is_enabled: next })
      message.success(next ? '已启用' : '已禁用')
      load()
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '操作失败')
    }
  }

  const handleRun = () => {
    if (!trigger) return
    let reason = ''
    modal.confirm({
      title: '立即执行',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>立即执行触发器「{trigger.name}」？该操作不可撤销。</p>
          <Input.TextArea rows={3} maxLength={500} showCount placeholder="备注（可选）"
            onChange={(e) => { reason = e.target.value }} />
        </div>
      ),
      okText: '确认执行',
      cancelText: '取消',
      onOk: async () => {
        try {
          await triggersApi.runNow(trigger.id)
          message.success('已触发执行')
          load()
        } catch (e) {
          const err = e as { response?: { data?: { detail?: string } } }
          message.error(err.response?.data?.detail || '执行失败')
        }
        void reason
      },
    })
  }

  const handleDelete = () => {
    if (!trigger) return
    modal.confirm({
      title: '删除触发器',
      content: `确认删除触发器「${trigger.name}」？该操作不可撤销，所有历史执行记录也会被级联删除。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await triggersApi.remove(trigger.id)
          message.success('已删除')
          navigate('/triggers')
        } catch (e) {
          const err = e as { response?: { data?: { detail?: string } } }
          message.error(err.response?.data?.detail || '删除失败')
        }
      },
    })
  }

  if (!triggerId || (!trigger && !loading)) {
    return <Empty description="未找到触发器" />
  }
  if (!trigger) {
    return <Empty description="加载中" />
  }

  const runColumns = [
    { title: '开始时间', dataIndex: 'started_at', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    { title: '触发源', dataIndex: 'source', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string | null) =>
        v ? <Tag color={STATUS_COLOR[v] ?? 'default'}>{STATUS_LABEL[v] ?? v}</Tag> : '-',
    },
    { title: '扫描', dataIndex: 'scanned_count', width: 80 },
    { title: '创建', dataIndex: 'created_count', width: 80 },
    { title: '跳过', dataIndex: 'skipped_count', width: 80 },
    { title: '失败', dataIndex: 'failed_count', width: 80 },
    {
      title: '耗时',
      key: 'duration',
      width: 100,
      render: (_: unknown, r: TriggerRun) => {
        if (!r.finished_at) return '-'
        const ms = new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()
        return `${(ms / 1000).toFixed(1)}s`
      },
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={() => navigate('/triggers')}>返回列表</Button>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Space size={12} align="center">
              <span style={{ fontSize: 18, fontWeight: 600 }}>{trigger.name}</span>
              <Tag color={trigger.trigger_type === 'cron' ? 'blue' : 'purple'}>
                {trigger.trigger_type === 'cron' ? 'Cron' : '回调'}
              </Tag>
              <Text type="secondary">{describeSpec(trigger)}</Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <span>启用</span>
              <Switch checked={trigger.is_enabled} onChange={handleToggle} />
              <Button onClick={handleRun} disabled={!trigger.is_enabled}>
                立即执行
              </Button>
              <Button onClick={() => navigate(`/triggers/${trigger.id}`, { state: { edit: true } })}>
                编辑
              </Button>
              <Button danger onClick={handleDelete}>
                删除
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Tabs
        items={[
          {
            key: 'overview',
            label: '概览',
            children: (
              <Row gutter={16}>
                <Col span={12}>
                  <Card title="触发配置" size="small">
                    <Space direction="vertical">
                      <div><Text type="secondary">类型：</Text>{trigger.trigger_type}</div>
                      <div><Text type="secondary">调度：</Text>{describeSpec(trigger)}</div>
                      <div><Text type="secondary">Code：</Text>{trigger.code}</div>
                      <div><Text type="secondary">创建人：</Text>{trigger.created_by ?? '-'}</div>
                      <div><Text type="secondary">创建时间：</Text>{new Date(trigger.created_at).toLocaleString('zh-CN')}</div>
                    </Space>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title="统计" size="small">
                    <Space direction="vertical">
                      <div><Text type="secondary">累计执行：</Text>{trigger.run_count} 次</div>
                      <div><Text type="secondary">上次执行：</Text>{trigger.last_run_at ? new Date(trigger.last_run_at).toLocaleString('zh-CN') : '从未运行'}</div>
                      <div><Text type="secondary">下次执行：</Text>{trigger.next_run_at ? new Date(trigger.next_run_at).toLocaleString('zh-CN') : '-'}</div>
                      <div><Text type="secondary">扫描间隔：</Text>{trigger.scan_interval_sec}s</div>
                    </Space>
                  </Card>
                </Col>
                <Col span={24} style={{ marginTop: 16 }}>
                  <Card title="目标策略" size="small">
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <div><Text type="secondary">工作流模板：</Text>{trigger.workflow_template_code ?? '-'}</div>
                      <div><Text type="secondary">审核策略：</Text>{trigger.strategy_name ?? <span style={{ color: '#999' }}>未指定</span>}</div>
                      <div>
                        <Text type="secondary">匹配条件：</Text>{renderMatchConditions(trigger.match_conditions)}
                      </div>
                    </Space>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'runs',
            label: '执行历史',
            children: (
              <Table
                rowKey="id"
                loading={loading}
                dataSource={runs}
                columns={runColumns}
                pagination={false}
                size="small"
                locale={{ emptyText: <Empty description="暂无执行记录" /> }}
              />
            ),
          },
          ...(trigger.trigger_type === 'external_callback'
            ? [
                {
                  key: 'webhook',
                  label: 'Webhook URL',
                  children: (
                    <Card size="small">
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <div>
                          <Text type="secondary">Endpoint：</Text>
                          <Input.Group compact>
                            <Input
                              style={{ width: '70%' }}
                              value={`POST {APP_BASE_URL}/api/v1/webhooks/callback/${(trigger.spec as { path_token?: string }).path_token ?? ''}`}
                              readOnly
                            />
                            <Button>复制</Button>
                          </Input.Group>
                        </div>
                        <div><Text type="secondary">签名算法：</Text>HMAC-SHA256(secret, X-Timestamp + raw_body)</div>
                        <div><Text type="secondary">防重放：</Text>X-Timestamp 偏差 &gt; 5 分钟 → 401</div>
                        <div>
                          <Text type="secondary">IP 白名单：</Text>
                          <Button type="link" onClick={() => navigate('/settings/webhook-allowlist')}>
                            管理白名单
                          </Button>
                        </div>
                      </Space>
                    </Card>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  )
}