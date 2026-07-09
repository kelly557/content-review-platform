import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App,
  Button,
  Card,
  Checkbox,
  Collapse,
  Input,
  Radio,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd'
import { strategiesApi } from '@/api/strategies'
import { workflowsApi } from '@/api/workflows'
import { triggersApi, type TriggerCreatePayload, type TriggerTypeStr } from '@/api/triggers'
import { useAuthStore } from '@/store'

const { Text } = Typography

const ROUTING_KEYS = ['material_type', 'business_line', 'country', 'channel', 'content_category'] as const
type RoutingKey = (typeof ROUTING_KEYS)[number]

const ROUTING_LABEL: Record<RoutingKey, string> = {
  material_type: '素材类型',
  business_line: '业务线',
  country: '国家/区域',
  channel: '渠道',
  content_category: '内容分类',
}

const ROUTING_OPTIONS: Record<RoutingKey, Array<{ value: string; label: string }>> = {
  material_type: [
    { value: 'image', label: '图片' },
    { value: 'video', label: '视频' },
    { value: 'text', label: '文本' },
    { value: 'pdf', label: '文档' },
  ],
  business_line: [
    { value: 'medical', label: '医药' },
    { value: 'finance', label: '金融' },
    { value: 'cpg', label: '日用消费品' },
    { value: 'other', label: '其他' },
  ],
  country: [
    { value: 'CN', label: '中国' },
    { value: 'US', label: '美国' },
    { value: 'EU', label: '欧盟' },
  ],
  channel: [
    { value: 'short_video', label: '短视频' },
    { value: 'live', label: '直播' },
    { value: 'ecommerce', label: '电商' },
  ],
  content_category: [
    { value: 'medical_ad', label: '医药广告' },
    { value: 'health_product', label: '保健品' },
    { value: 'medical_device', label: '医疗器械' },
  ],
}

function generatePathToken(): string {
  const arr = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function CreateTriggerPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Step 1
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [triggerType, setTriggerType] = useState<TriggerTypeStr>('cron')

  // Step 2 — cron
  const [repeatMode, setRepeatMode] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('weekly')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2])
  const [days, setDays] = useState<number[]>([1])
  const [time, setTime] = useState('09:00')
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [customCron, setCustomCron] = useState('0 9 * * 1,2')

  // Step 2 — callback
  const [pathToken] = useState(() => generatePathToken())
  const [secretAlias, setSecretAlias] = useState('primary')

  // Step 3
  const [workflowTemplateCode, setWorkflowTemplateCode] = useState<string | null>('hybrid')
  const [strategyId, setStrategyId] = useState<number | null>(null)
  const [match, setMatch] = useState<Record<RoutingKey, string[]>>({
    material_type: [],
    business_line: [],
    country: [],
    channel: [],
    content_category: [],
  })
  const [isEnabled, setIsEnabled] = useState(true)

  // Options
  const [templates, setTemplates] = useState<Array<{ id: number; code: string; name: string }>>([])
  const [strategies, setStrategies] = useState<Array<{ id: number; code: string; name: string }>>([])
  const [scanInterval, setScanInterval] = useState(60)

  useEffect(() => {
    if (user?.role !== 'admin') return
    workflowsApi.list({ include_inactive: false }).then((d) => {
      setTemplates(d.map((t) => ({ id: t.id, code: t.code, name: t.name })))
    }).catch(() => {})
    strategiesApi.list({ size: 100 }).then((d) => {
      setStrategies(d.items.map((s) => ({ id: s.id, code: s.code, name: s.name })))
    }).catch(() => {})
  }, [user])

  const cronExpr = useMemo(() => {
    const [hh, mm] = time.split(':').map((n) => parseInt(n, 10))
    if (repeatMode === 'daily') return `${mm ?? 0} ${hh ?? 0} * * *`
    if (repeatMode === 'weekly') {
      const w = weekdays.length ? weekdays.sort().join(',') : '*'
      return `${mm ?? 0} ${hh ?? 0} * * ${w}`
    }
    if (repeatMode === 'monthly') {
      const d = days.length ? days.sort().join(',') : '*'
      return `${mm ?? 0} ${hh ?? 0} ${d} * *`
    }
    return customCron
  }, [repeatMode, weekdays, days, time, customCron])

  const matchAllEmpty = ROUTING_KEYS.every((k) => match[k].length === 0)

  const handleSubmit = async () => {
    if (!code.trim() || !name.trim()) {
      message.warning('请填写名称与 code')
      return
    }
    setSubmitting(true)
    try {
      const spec: Record<string, unknown> =
        triggerType === 'cron'
          ? {
              cron: cronExpr,
              timezone,
              repeat: repeatMode,
              time,
              weekdays: repeatMode === 'weekly' ? weekdays : undefined,
              days: repeatMode === 'monthly' ? days : undefined,
            }
          : {
              path_token: pathToken,
              secret_alias: secretAlias,
            }
      const payload: TriggerCreatePayload = {
        code: code.trim(),
        name: name.trim(),
        trigger_type: triggerType,
        is_enabled: isEnabled,
        spec,
        workflow_template_code: workflowTemplateCode,
        strategy_id: strategyId,
        match_conditions: match,
        scan_interval_sec: scanInterval,
      }
      const created = await triggersApi.create(payload)
      message.success('已创建')
      navigate(`/triggers/${created.id}`)
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (user?.role !== 'admin') {
    return <div>仅管理员可访问</div>
  }

  const steps = [
    { title: '基本信息' },
    { title: triggerType === 'cron' ? 'Cron 调度' : '回调接入' },
    { title: '目标策略' },
    { title: '确认' },
  ]

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
        <div style={{ fontSize: 20, fontWeight: 600 }}>新建触发器</div>
        <Space>
          <Button onClick={() => navigate('/triggers')}>取消</Button>
        </Space>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Steps current={step} items={steps} onChange={(s) => setStep(s)} />
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {step === 0 && (
          <Card title="基本信息">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>名称 *</div>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：医药-中国-存量扫描" maxLength={128} />
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>Code * （英数字下划线，创建后不可改）</div>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例如：medicine_cn_daily" maxLength={64} />
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>类型 *</div>
                <Radio.Group value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
                  <Radio.Button value="cron">Cron</Radio.Button>
                  <Radio.Button value="external_callback">外部回调</Radio.Button>
                </Radio.Group>
              </div>
            </Space>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button type="primary" onClick={() => setStep(1)} disabled={!name.trim() || !code.trim()}>
                下一步
              </Button>
            </div>
          </Card>
        )}

        {step === 1 && triggerType === 'cron' && (
          <Card title="Cron 调度">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>重复</div>
                <Radio.Group value={repeatMode} onChange={(e) => setRepeatMode(e.target.value)}>
                  <Radio.Button value="daily">每天</Radio.Button>
                  <Radio.Button value="weekly">每周（多选）</Radio.Button>
                  <Radio.Button value="monthly">每月（多选）</Radio.Button>
                  <Radio.Button value="custom">自定义</Radio.Button>
                </Radio.Group>
              </div>

              {repeatMode === 'weekly' && (
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13 }}>星期</div>
                  <Checkbox.Group
                    value={weekdays}
                    onChange={(v) => setWeekdays(v as number[])}
                    options={[
                      { value: 1, label: '周一' },
                      { value: 2, label: '周二' },
                      { value: 3, label: '周三' },
                      { value: 4, label: '周四' },
                      { value: 5, label: '周五' },
                      { value: 6, label: '周六' },
                      { value: 7, label: '周日' },
                    ]}
                  />
                </div>
              )}

              {repeatMode === 'monthly' && (
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13 }}>日期</div>
                  <Checkbox.Group
                    value={days}
                    onChange={(v) => setDays(v as number[])}
                    options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: `${i + 1} 日` }))}
                  />
                </div>
              )}

              {(repeatMode === 'daily' || repeatMode === 'weekly' || repeatMode === 'monthly') && (
                <Space>
                  <div>
                    <div style={{ marginBottom: 4, fontSize: 13 }}>时间</div>
                    <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="HH:MM" style={{ width: 120 }} />
                  </div>
                  <div>
                    <div style={{ marginBottom: 4, fontSize: 13 }}>时区</div>
                    <Select
                      value={timezone}
                      onChange={setTimezone}
                      style={{ width: 180 }}
                      options={[
                        { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
                        { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
                        { value: 'Asia/Singapore', label: 'Asia/Singapore' },
                        { value: 'UTC', label: 'UTC' },
                      ]}
                    />
                  </div>
                </Space>
              )}

              <Collapse
                ghost
                items={[
                  {
                    key: 'advanced',
                    label: '高级模式（自定义 cron 表达式）',
                    children: (
                      <Input
                        value={repeatMode === 'custom' ? customCron : cronExpr}
                        onChange={(e) => {
                          setCustomCron(e.target.value)
                          setRepeatMode('custom')
                        }}
                        placeholder="0 9 * * 1,2"
                      />
                    ),
                  },
                ]}
              />

              <div>
                <Text type="secondary">预览：</Text>{' '}
                <Tag color="blue">{cronExpr}</Tag>{' '}
                <Text type="secondary">时区 {timezone}</Text>
              </div>

              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>扫描间隔（秒）</div>
                <Input
                  type="number"
                  min={10}
                  max={3600}
                  value={scanInterval}
                  onChange={(e) => setScanInterval(Number(e.target.value) || 60)}
                  style={{ width: 120 }}
                />
              </div>
            </Space>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setStep(0)}>上一步</Button>
                <Button type="primary" onClick={() => setStep(2)}>
                  下一步
                </Button>
              </Space>
            </div>
          </Card>
        )}

        {step === 1 && triggerType === 'external_callback' && (
          <Card title="回调接入">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>Endpoint</div>
                <Input.Group compact>
                  <Input
                    style={{ width: '70%' }}
                    value={`POST {APP_BASE_URL}/api/v1/webhooks/callback/${pathToken}`}
                    readOnly
                  />
                  <Button>复制</Button>
                </Input.Group>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  path_token 由系统生成 32 字符，不可修改。
                </Text>
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>Secret 别名</div>
                <Select
                  value={secretAlias}
                  onChange={setSecretAlias}
                  style={{ width: 240 }}
                  options={[
                    { value: 'primary', label: 'primary' },
                    { value: 'secondary', label: 'secondary' },
                    { value: 'backup', label: 'backup' },
                  ]}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  对应环境变量 WEBHOOK_SECRET_&lt;ALIAS&gt;。
                </Text>
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>签名算法</div>
                <Text>HMAC-SHA256(secret, X-Timestamp + raw_body)</Text>
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>防重放</div>
                <Text>X-Timestamp 偏差 &gt; 5 分钟 → 401</Text>
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>IP 白名单</div>
                <Text>启用（管理页面维护）</Text>
              </div>
            </Space>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setStep(0)}>上一步</Button>
                <Button type="primary" onClick={() => setStep(2)}>
                  下一步
                </Button>
              </Space>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card title="目标策略">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>工作流模板 *</div>
                <Select
                  value={workflowTemplateCode ?? undefined}
                  onChange={setWorkflowTemplateCode}
                  style={{ width: 320 }}
                  allowClear
                  placeholder="请选择工作流模板"
                  options={templates.map((t) => ({ value: t.code, label: `${t.name} (${t.code})` }))}
                />
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>审核策略</div>
                <Select
                  value={strategyId ?? undefined}
                  onChange={setStrategyId}
                  style={{ width: 320 }}
                  allowClear
                  placeholder="不指定，使用工作流默认策略"
                  options={strategies.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>

              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>匹配条件</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  留空表示对所有素材生效。
                </Text>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 12,
                    marginTop: 12,
                  }}
                >
                  {ROUTING_KEYS.map((k) => (
                    <div key={k}>
                      <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>{ROUTING_LABEL[k]}</div>
                      <Select
                        mode="multiple"
                        value={match[k]}
                        onChange={(v) => setMatch({ ...match, [k]: v })}
                        style={{ width: '100%' }}
                        allowClear
                        placeholder="不限"
                        options={ROUTING_OPTIONS[k]}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Checkbox checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)}>
                  启用
                </Checkbox>
              </div>
            </Space>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setStep(1)}>上一步</Button>
                <Button type="primary" onClick={() => setStep(3)}>
                  下一步
                </Button>
              </Space>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card title="确认">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div><Text type="secondary">名称：</Text>{name}</div>
              <div><Text type="secondary">Code：</Text>{code}</div>
              <div><Text type="secondary">类型：</Text>{triggerType === 'cron' ? 'Cron' : '外部回调'}</div>
              <div>
                <Text type="secondary">调度 / 路径：</Text>
                {triggerType === 'cron' ? `${cronExpr} (${timezone})` : `…/${pathToken.slice(0, 8)}…`}
              </div>
              <div><Text type="secondary">工作流模板：</Text>{workflowTemplateCode ?? '-'}</div>
              <div>
                <Text type="secondary">审核策略：</Text>
                {strategyId ? strategies.find((s) => s.id === strategyId)?.name ?? '-' : '-'}
              </div>
              <div>
                <Text type="secondary">匹配条件：</Text>
                {matchAllEmpty
                  ? <Tag>所有素材</Tag>
                  : ROUTING_KEYS.filter((k) => match[k].length > 0).map((k) => (
                      <Tag key={k}>{ROUTING_LABEL[k]}={match[k].join(' / ')}</Tag>
                    ))}
              </div>
              <div><Text type="secondary">状态：</Text>{isEnabled ? '启用' : '禁用'}</div>
            </Space>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setStep(2)}>上一步</Button>
                <Button type="primary" loading={submitting} onClick={handleSubmit}>
                  保存并启用
                </Button>
              </Space>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}