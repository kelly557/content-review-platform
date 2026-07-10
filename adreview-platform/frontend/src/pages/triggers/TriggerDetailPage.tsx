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
import { describeCron, describeLaunch } from '@/lib/cronDescriber'

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

const ROUTING_LABEL: Record<string, string> = {
  material_type: '素材类型',
  business_line: '业务线',
  country: '国家/区域',
  channel: '渠道',
  content_category: '内容分类',
}

function renderMatchConditions(m: Record<string, string[]>): React.ReactNode {
  const entries = Object.entries(m).filter(([, v]) => v.length > 0)
  if (entries.length === 0) return <Tag>全部素材</Tag>
  return (
    <Space wrap size={[4, 4]}>
      {entries.map(([k, vs]) => (
        <Tag key={k}>
          {ROUTING_LABEL[k] ?? k}={vs.join(' / ')}
        </Tag>
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
      message.success(next ? '已开启' : '已关闭')
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
      title: '立即运行一次',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            当前规则：<strong>{trigger.name}</strong>
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
          await triggersApi.runNow(trigger.id)
          message.success('已运行')
          load()
        } catch (e) {
          const err = e as { response?: { data?: { detail?: string } } }
          message.error(err.response?.data?.detail || '运行失败')
        }
        void reason
      },
    })
  }

  const handleDelete = () => {
    if (!trigger) return
    modal.confirm({
      title: '删除自动审核',
      content: `确认删除「${trigger.name}」？该操作不可撤销。历史执行记录将被保留；进行中的任务将完成后再清理。`,
      okText: '删除',
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
    return <Empty description="未找到自动审核" />
  }
  if (!trigger) {
    return <Empty description="加载中" />
  }

  const cronStr = (trigger.spec as { cron?: string }).cron ?? ''
  const tzStr = (trigger.spec as { timezone?: string }).timezone ?? 'Asia/Shanghai'
  const launchLabel = describeLaunch(trigger)
  const humanCron = describeCron(cronStr).human

  const runColumns = [
    { title: '开始时间', dataIndex: 'started_at', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '启动方式',
      dataIndex: 'source',
      width: 110,
      render: (v: string) => {
        if (v === 'cron') return <Tag color="blue">按时间计划</Tag>
        if (v === 'manual') return <Tag color="cyan">手动运行</Tag>
        return <Tag>{v}</Tag>
      },
    },
    {
      title: '结果',
      dataIndex: 'status',
      width: 100,
      render: (v: string | null) =>
        v ? <Tag color={STATUS_COLOR[v] ?? 'default'}>{STATUS_LABEL[v] ?? v}</Tag> : '—',
    },
    { title: '扫描', dataIndex: 'scanned_count', width: 70 },
    { title: '创建', dataIndex: 'created_count', width: 70 },
    { title: '跳过', dataIndex: 'skipped_count', width: 70 },
    { title: '失败', dataIndex: 'failed_count', width: 70 },
    {
      title: '耗时',
      key: 'duration',
      width: 80,
      render: (_: unknown, r: TriggerRun) => {
        if (!r.finished_at) return '—'
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
            <Space size={12} align="center" wrap>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{trigger.name}</span>
              <Tag color="blue">按时间计划</Tag>
              <Tag color={trigger.is_enabled ? 'green' : 'default'}>
                {trigger.is_enabled ? '已开启' : '已关闭'}
              </Tag>
              <Text type="secondary">{launchLabel}</Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Switch
                checked={trigger.is_enabled}
                checkedChildren="已开启"
                unCheckedChildren="已关闭"
                onChange={handleToggle}
              />
              <Button onClick={handleRun} disabled={!trigger.is_enabled}>
                立即运行
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
                  <Card title="基本信息" size="small">
                    <Space direction="vertical">
                      <div>
                        <Text type="secondary">启动方式：</Text>
                        按时间计划
                      </div>
                      <div>
                        <Text type="secondary">启动时间规则：</Text>
                        {humanCron}
                      </div>
                      <div>
                        <Text type="secondary">时间基准：</Text>
                        {tzStr === 'Asia/Shanghai' ? '北京时间' : tzStr}
                      </div>
                      <div>
                        <Text type="secondary">创建时间：</Text>
                        {new Date(trigger.created_at).toLocaleString('zh-CN')}
                      </div>
                    </Space>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title="当前状态" size="small">
                    <Space direction="vertical">
                      <div>
                        <Text type="secondary">已触发任务数：</Text>
                        {trigger.run_count}
                      </div>
                      <div>
                        <Text type="secondary">上次运行：</Text>
                        {trigger.last_run_at ? new Date(trigger.last_run_at).toLocaleString('zh-CN') : '—'}
                      </div>
                      <div>
                        <Text type="secondary">下次启动：</Text>
                        {trigger.next_run_at ? new Date(trigger.next_run_at).toLocaleString('zh-CN') : '—'}
                      </div>
                    </Space>
                  </Card>
                </Col>
                <Col span={24} style={{ marginTop: 16 }}>
                  <Card title="适用素材" size="small">
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <div>
                        <Text type="secondary">匹配条件：</Text>
                        {renderMatchConditions(trigger.match_conditions)}
                      </div>
                      <div>
                        <Text type="secondary">命中策略：</Text>
                        {trigger.strategy_name ?? <span style={{ color: '#999' }}>使用工作流默认策略</span>}
                      </div>
                      <div>
                        <Text type="secondary">工作流模板：</Text>
                        {trigger.workflow_template_code ?? '-'}
                      </div>
                    </Space>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'runs',
            label: '运行历史',
            children: (
              <Table
                rowKey="id"
                loading={loading}
                dataSource={runs}
                columns={runColumns}
                pagination={false}
                size="small"
                locale={{ emptyText: <Empty description="暂无运行历史" /> }}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
