import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
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
import SchedulePicker, { type SchedulePickerValue } from '@/components/triggers/SchedulePicker'
import { describeCron } from '@/lib/cronDescriber'

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

  // Step 1 — 基本信息
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [triggerType, setTriggerType] = useState<TriggerTypeStr>('cron')
  const [timezone, setTimezone] = useState('Asia/Shanghai')

  // Step 2 — 运行方式
  const [schedule, setSchedule] = useState<SchedulePickerValue>({
    cron: '0 9 * * *',
    scanIntervalSec: 60,
  })
  const [pathToken] = useState(() => generatePathToken())
  const [secretAlias, setSecretAlias] = useState('primary')

  // Step 3 — 适用素材
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

  // 模板与策略
  const [templates, setTemplates] = useState<Array<{ id: number; code: string; name: string }>>([])
  const [strategies, setStrategies] = useState<Array<{ id: number; code: string; name: string }>>([])

  useEffect(() => {
    if (user?.role !== 'admin') return
    workflowsApi.list({ include_inactive: false }).then((d) => {
      setTemplates(d.map((t) => ({ id: t.id, code: t.code, name: t.name })))
    }).catch(() => {})
    strategiesApi.list({ size: 100 }).then((d) => {
      setStrategies(d.items.map((s) => ({ id: s.id, code: s.code, name: s.name })))
    }).catch(() => {})
  }, [user])

  const cronPreview = schedule.cron
  const cronHuman = useMemo(() => describeCron(cronPreview).human, [cronPreview])
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
              cron: cronPreview,
              timezone,
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
        scan_interval_sec: schedule.scanIntervalSec,
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
    { title: '启动方式' },
    { title: '适用素材' },
    { title: '确认并创建' },
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
        <div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>新建自动审核</div>
          <div style={{ marginTop: 4, color: '#666', fontSize: 13 }}>
            设置规则后，系统将按时间计划或外部通知自动创建审核任务。
          </div>
        </div>
        <Space>
          <Button onClick={() => navigate('/triggers')}>返回列表</Button>
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
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：医药-中国-存量扫描"
                  maxLength={128}
                />
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>
                  任务编码 *（英数字下划线，创建后不可改）
                </div>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="例如：medicine_cn_daily"
                  maxLength={64}
                />
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>启动方式 *</div>
                <Radio.Group value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
                  <Radio.Button value="cron">按时间计划</Radio.Button>
                  <Radio.Button value="external_callback">外部通知触发</Radio.Button>
                </Radio.Group>
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    按时间计划：系统在指定时间自动运行；外部通知触发：当合作方通知"有新内容要审"时立即创建任务。
                  </Text>
                </div>
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>时间基准</div>
                <Select
                  value={timezone}
                  onChange={setTimezone}
                  style={{ width: 200 }}
                  options={[
                    { value: 'Asia/Shanghai', label: '北京时间' },
                    { value: 'Asia/Tokyo', label: '东京时间' },
                    { value: 'Asia/Singapore', label: '新加坡时间' },
                    { value: 'UTC', label: 'UTC' },
                  ]}
                />
              </div>
            </Space>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button
                type="primary"
                onClick={() => setStep(1)}
                disabled={!name.trim() || !code.trim()}
              >
                下一步
              </Button>
            </div>
          </Card>
        )}

        {step === 1 && triggerType === 'cron' && (
          <Card title="按时间计划">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <SchedulePicker
                value={schedule}
                onChange={(v) => setSchedule(v)}
                defaultScanIntervalSec={60}
              />
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
          <Card title="外部通知触发">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message="合作方通知方式"
                description="当合作方主动告知'有新内容要审'时，本规则立即创建审核任务。通知地址与校验码由系统生成，请在合作方系统中安全保存。"
              />
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>通知地址</div>
                <Input.Group compact>
                  <Input
                    style={{ width: 'calc(100% - 80px)' }}
                    value={`POST {APP_BASE_URL}/api/v1/webhooks/callback/${pathToken}`}
                    readOnly
                  />
                  <Button
                    onClick={() => {
                      navigator.clipboard?.writeText(
                        `{APP_BASE_URL}/api/v1/webhooks/callback/${pathToken}`,
                      )
                      void message.success('已复制')
                    }}
                  >
                    复制
                  </Button>
                </Input.Group>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  系统已生成 32 字符的地址标识，不可修改。
                </Text>
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>校验码别名</div>
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
                  对应环境变量 WEBHOOK_SECRET_&lt;别名&gt;。
                </Text>
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>签名与防重放</div>
                <Text style={{ fontSize: 13 }}>
                  HMAC-SHA256(secret, X-Timestamp + body)；X-Timestamp 偏差 ≤ 5 分钟。
                </Text>
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
          <Card title="适用素材">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                仅当素材满足以下全部条件时，本规则才会处理它。留空表示不限制。
              </Text>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 12,
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

              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>工作流模板</div>
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
                <div style={{ marginBottom: 4, fontSize: 13 }}>命中策略</div>
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
                <Checkbox checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)}>
                  启动后立即生效
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
          <Card title="确认并创建">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <DescriptionRow label="名称" value={name} />
              <DescriptionRow label="任务编码" value={code} />
              <DescriptionRow label="启动方式" value={triggerType === 'cron' ? '按时间计划' : '外部通知触发'} />
              {triggerType === 'cron' ? (
                <>
                  <DescriptionRow label="启动时间" value={cronHuman} />
                  <DescriptionRow label="时间基准" value={timezone === 'Asia/Shanghai' ? '北京时间' : timezone} />
                </>
              ) : (
                <DescriptionRow label="通知地址" value={`.../webhooks/callback/${pathToken.slice(0, 8)}…`} />
              )}
              <DescriptionRow label="工作流模板" value={workflowTemplateCode ?? '-'} />
              <DescriptionRow
                label="命中策略"
                value={
                  strategyId
                    ? strategies.find((s) => s.id === strategyId)?.name ?? '-'
                    : '使用工作流默认策略'
                }
              />
              <div>
                <Text type="secondary" style={{ marginRight: 8 }}>
                  适用素材：
                </Text>
                {matchAllEmpty
                  ? <Tag>全部素材</Tag>
                  : ROUTING_KEYS.filter((k) => match[k].length > 0).map((k) => (
                      <Tag key={k}>{ROUTING_LABEL[k]}={match[k].join(' / ')}</Tag>
                    ))}
              </div>
              <DescriptionRow label="状态" value={isEnabled ? '已开启' : '已关闭'} />
            </Space>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setStep(2)}>上一步</Button>
                <Button type="primary" loading={submitting} onClick={handleSubmit}>
                  创建
                </Button>
              </Space>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function DescriptionRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text type="secondary">{label}：</Text>
      <span>{value}</span>
    </div>
  )
}
