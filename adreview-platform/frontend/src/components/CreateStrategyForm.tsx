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
  Select,
} from 'antd'
import { ArrowLeftOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons'
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
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(mode === 'create')
  const [saveResult, setSaveResult] = useState<{
    open: boolean
    strategyId?: number
    fromCreate: boolean
    name?: string
  }>({ open: false, fromCreate: mode === 'create' })
  const [copyModalOpen, setCopyModalOpen] = useState(false)
  const [sourceStrategies, setSourceStrategies] = useState<Strategy[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null)
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    if (mode !== 'edit' || !initial) return
    const defs = (initial.definition ?? {}) as { services?: string[] }
    const services = Array.isArray(defs.services) ? defs.services : []
    setSelectedServices(services)
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
    if (mode === 'create' && selectedServices.length === 0) {
      message.warning('请在第二步选择至少一个规则')
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'edit' && strategyId) {
        const savedStrategy = await strategiesApi.update(strategyId, {
          name,
          services: selectedServices,
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
        services: selectedServices,
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

  const openCopyModal = async () => {
    try {
      const data = await strategiesApi.list({ size: 100 })
      setSourceStrategies(data.items.filter((s) => s.scope !== 'default' && s.id !== strategyId))
    } catch {
      // ignore
    }
    setCopyModalOpen(true)
  }

  const onCopyConfirm = async () => {
    if (!selectedSourceId) {
      message.warning('请选择要复制的源策略')
      return
    }
    if (!strategyId && mode === 'create') {
      message.warning('请先保存策略后再复制配置')
      return
    }
    setCopying(true)
    try {
      if (strategyId) {
        await strategiesApi.importRuleConfig(strategyId, selectedSourceId)
        const src = sourceStrategies.find((s) => s.id === selectedSourceId)
        const srcServices = ((src?.definition ?? {}) as { services?: string[] }).services || []
        setSelectedServices(srcServices)
        message.success(`已从「${src?.name}」复制策略配置`)
      }
      setCopyModalOpen(false)
      setSelectedSourceId(null)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '复制失败')
    } finally {
      setCopying(false)
    }
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
            value={selectedServices}
            onChange={setSelectedServices}
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
              {selectedServices.length} 项
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
          <Button
            type="text"
            icon={<CopyOutlined />}
            onClick={openCopyModal}
            aria-label="复制策略配置"
          >
            复制策略配置
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
                <Link to={`/strategies/${saveResult.strategyId}/rule-config`}>
                  <Button icon={<LinkOutlined />}>规则配置</Button>
                </Link>
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

      <Modal
        open={copyModalOpen}
        title="复制策略配置"
        onCancel={() => {
          setCopyModalOpen(false)
          setSelectedSourceId(null)
        }}
        onOk={onCopyConfirm}
        confirmLoading={copying}
        okText="确认复制"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12 }}>
          <Text>选择一个已有策略，将其审核规则配置复制到当前策略：</Text>
        </div>
        <Select
          style={{ width: '100%' }}
          placeholder="选择源策略"
          value={selectedSourceId ?? undefined}
          onChange={(v) => setSelectedSourceId(v)}
          options={sourceStrategies.map((s) => ({
            value: s.id,
            label: `${s.name}（${s.code}）`,
          }))}
          showSearch
          optionFilterProp="label"
        />
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            复制内容包括：各服务的检测规则阈值、启停状态、自定义词库绑定等。
          </Text>
        </div>
      </Modal>
    </div>
  )
}
