import { useEffect, useState } from 'react'
import {
  Form,
  Input,
  Segmented,
  DatePicker,
  Button,
  Space,
  Steps,
  Typography,
  App,
  Modal,
} from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate, Link } from 'react-router-dom'
import { strategiesApi } from '@/api/strategies'
import {
  type CategoryKey,
} from './strategy/constants'
import StrategyTypeTabs from './strategy/StrategyTypeTabs'
import type { Strategy } from '@/types/domain'

const { Text } = Typography

type DurationMode = 'always' | 'range'

interface BasicFormValues {
  name: string
  durationMode: DurationMode
  range?: [Dayjs, Dayjs]
}

interface Props {
  mode?: 'create' | 'edit'
  strategyId?: number
  initial?: Strategy
  initialStep?: 0 | 1
  onCancel?: () => void
}

const MEDIA_TYPE_LABEL_MAP: Record<CategoryKey, string> = {
  image: '图片',
  text: '文本',
  audio: '语音',
  doc: '文档',
  video: '视频',
}

const EMPTY_ENABLED: Record<CategoryKey, number[]> = {
  image: [],
  text: [],
  audio: [],
  doc: [],
  video: [],
}

function countEnabled(map: Record<CategoryKey, number[]>): number {
  return Object.values(map).reduce((s, arr) => s + arr.length, 0)
}

function flattenEnabledItems(
  map: Record<CategoryKey, number[]>,
): Array<{ media_type: CategoryKey; item_id: number; is_enabled: boolean }> {
  const out: Array<{ media_type: CategoryKey; item_id: number; is_enabled: boolean }> = []
  for (const [media_type, ids] of Object.entries(map) as [CategoryKey, number[]][]) {
    for (const item_id of ids) {
      out.push({ media_type, item_id, is_enabled: true })
    }
  }
  return out
}

export default function CreateStrategyForm({
  mode = 'create',
  strategyId,
  initial,
  initialStep,
  onCancel,
}: Props) {
  const { message } = App.useApp()

  const navigate = useNavigate()
  const [form] = Form.useForm<BasicFormValues>()
  const [durationMode, setDurationMode] = useState<DurationMode>('always')
  const [step, setStep] = useState<0 | 1>(
    initialStep ?? (mode === 'edit' ? 1 : 0),
  )
  const [submitting, setSubmitting] = useState(false)
  const [enabledItems, setEnabledItems] = useState<Record<CategoryKey, number[]>>(
    EMPTY_ENABLED,
  )
  const [hydrated, setHydrated] = useState(mode === 'create')
  const [saveResult, setSaveResult] = useState<{
    open: boolean
    strategyId?: number
    fromCreate: boolean
    name?: string
  }>({ open: false, fromCreate: mode === 'create' })

  useEffect(() => {
    if (mode !== 'edit' || !initial) return
    const map: Record<CategoryKey, number[]> = { ...EMPTY_ENABLED }
    const items = Array.isArray(initial.enabled_items) ? initial.enabled_items : []
    for (const it of items) {
      if (!it || !it.is_enabled) continue
      const mt = it.media_type as CategoryKey
      if (mt in map) {
        map[mt] = Array.from(new Set([...map[mt], it.item_id]))
      }
    }
    setEnabledItems(map)
    const from = initial.effective_from ? dayjs(initial.effective_from) : null
    const until = initial.effective_until ? dayjs(initial.effective_until) : null
    const useRange = !!(from && until)
    setDurationMode(useRange ? 'range' : 'always')
    form.setFieldsValue({
      name: initial.name,
      durationMode: useRange ? 'range' : 'always',
      range: useRange ? ([from, until] as [Dayjs, Dayjs]) : undefined,
    })
    setHydrated(true)
  }, [mode, initial, form])

  const goNext = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setStep(1)
  }

  const goBack = () => {
    setStep(0)
  }

  const onSubmit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) {
      setStep(0)
      return
    }
    const name = values.name?.trim()
    if (!name) {
      message.error('策略名称不能为空')
      setStep(0)
      return
    }
if (mode === 'create' && countEnabled(enabledItems) === 0) {
      message.warning('请在第二步选择至少一个业务规则')
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'edit' && strategyId) {
        const savedStrategy = await strategiesApi.update(strategyId, {
          name,
          enabled_items: flattenEnabledItems(enabledItems),
          effective_from:
            values.durationMode === 'range' && values.range?.[0]
              ? values.range[0].toISOString()
              : null,
          effective_until:
            values.durationMode === 'range' && values.range?.[1]
              ? values.range[1].toISOString()
              : null,
        })
        message.success('已保存策略')
        setSaveResult({
          open: true,
          strategyId: savedStrategy.id,
          fromCreate: false,
          name: savedStrategy.name,
        })
        return
      }
      const savedStrategy = await strategiesApi.create({
        name,
        enabled_items: flattenEnabledItems(enabledItems),
        effective_from:
          values.durationMode === 'range' && values.range?.[0]
            ? values.range[0].toISOString()
            : null,
        effective_until:
          values.durationMode === 'range' && values.range?.[1]
            ? values.range[1].toISOString()
            : null,
      })
      message.success('已创建策略')
      setSaveResult({
        open: true,
        strategyId: savedStrategy.id,
        fromCreate: true,
        name: savedStrategy.name,
      })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: unknown } } }
      const detail = err?.response?.data?.detail
      if (typeof detail === 'string') {
        message.error(detail)
      } else if (Array.isArray(detail)) {
        message.error(detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; '))
      } else {
        message.error('保存失败，请检查输入')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onContinueEdit = () => {
    const idVal = saveResult.strategyId
    const fromCreate = saveResult.fromCreate
    setSaveResult({
      open: false,
      strategyId: idVal,
      fromCreate,
      name: saveResult.name,
    })

    if (fromCreate && idVal) {
      navigate(`/strategies/${idVal}/edit`, { state: { step: 1 }, replace: true })
      return
    }
    setStep(1)
  }

  const onFinishSave = () => {
    setSaveResult((prev) => ({
      open: false,
      strategyId: prev.strategyId,
      fromCreate: prev.fromCreate,
      name: prev.name,
    }))
    navigate('/strategies', { state: { refresh: true } })
  }

  if (!hydrated) {
    return null
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        width: '100%',
      }}
    >
      <Steps
        current={step}
        size="small"
        responsive
        items={[
          { title: '基本信息' },
          { title: '策略审核规则' },
        ]}
      />

      <div style={{ display: step === 0 ? 'block' : 'none' }}>
        <Form
          form={form}
          layout="vertical"
          requiredMark={(label) => (
            <span>
              <span style={{ color: '#DC2626', marginRight: 4 }}>*</span>
              {label}
            </span>
          )}
          scrollToFirstError
          validateTrigger={['onBlur', 'onSubmit']}
        >
          <Form.Item
            label="策略名称"
            name="name"
            rules={[
              { required: true, message: '请输入策略名称' },
              { max: 20, message: '不超过 20 个字符' },
            ]}
          >
            <Input
              placeholder="请输入策略名称"
              maxLength={20}
              showCount
              style={{ maxWidth: 'min(560px, 100%)' }}
              aria-label="策略名称"
            />
          </Form.Item>

          <Form.Item
            name="durationMode"
            label="策略生效时间"
            rules={[{ required: true, message: '请选择生效时间' }]}
          >
            <Segmented
              options={[
                { label: '长期有效', value: 'always' },
                { label: '指定时间', value: 'range' },
              ]}
              value={durationMode}
              onChange={(v) => setDurationMode(v as DurationMode)}
              aria-label="策略生效时间模式"
            />
          </Form.Item>
          {durationMode === 'range' && (
            <Form.Item
              name="range"
              label="生效时间范围"
              dependencies={['durationMode']}
              rules={[
                {
                  validator: (_, value: [Dayjs, Dayjs] | undefined) => {
                    if (durationMode !== 'range') return Promise.resolve()
                    if (!value || value.length !== 2) {
                      return Promise.reject(new Error('请选择起止日期'))
                    }
                    if (!value[0].isBefore(value[1])) {
                      return Promise.reject(new Error('起始时间必须早于结束时间'))
                    }
                    return Promise.resolve()
                  },
                },
              ]}
            >
              <DatePicker.RangePicker
                showTime={{
                  format: 'HH:mm',
                  defaultValue: [dayjs('00:00', 'HH:mm'), dayjs('23:59', 'HH:mm')],
                }}
                format="YYYY.MM.DD HH:mm"
                placeholder={['开始日期', '结束日期']}
              />
            </Form.Item>
          )}
        </Form>
      </div>

      {step === 1 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            width: '100%',
          }}
        >
          <StrategyTypeTabs
            value={enabledItems}
            onChange={setEnabledItems}
          />

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text type="secondary">本步合计已选：</Text>
            <Text strong style={{ color: '#0369A1' }}>
              {countEnabled(enabledItems)} 项
            </Text>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space wrap>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => (onCancel ? onCancel() : navigate('/strategies'))}
          >
            返回
          </Button>
        </Space>
        <Space wrap>
          <Button disabled={step === 0} onClick={goBack}>
            上一步
          </Button>
          {step === 0 ? (
            <Button type="primary" onClick={goNext}>
              下一步
            </Button>
          ) : (
            <Button type="primary" loading={submitting} onClick={onSubmit}>
              保存策略
            </Button>
          )}
        </Space>
      </div>

      <Modal
        open={saveResult.open}
        title="策略已保存"
        onCancel={onContinueEdit}
        okText="完成"
        cancelText="继续编辑"
        onOk={onFinishSave}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space wrap>
            {saveResult.strategyId && (
              <>
                {(['image', 'text', 'audio', 'doc', 'video'] as CategoryKey[]).map((k) => (
                  <Link
                    key={k}
                    to={`/strategies/rules-by-type/${k}?strategy=${saveResult.strategyId}`}
                  >
                    <Button>
                      按类型管理：{MEDIA_TYPE_LABEL_MAP[k]}
                    </Button>
                  </Link>
                ))}
              </>
            )}
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <p>
          策略「{saveResult.name ?? ''}」已保存成功。你可以继续编辑策略内容，或点击完成返回策略列表。
        </p>
        <p>
          <Text type="secondary">
            可点击对应按钮前往该策略的检测规则配置，或按审核类型管理已选规则。
          </Text>
        </p>
      </Modal>
    </div>
  )
}
