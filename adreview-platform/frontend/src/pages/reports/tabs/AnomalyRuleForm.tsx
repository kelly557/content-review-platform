// 新增 / 编辑监测规则 — 嵌套 Drawer, 紧贴 AnomalyRulesDrawer 右侧打开.
import { useEffect, useState } from 'react'
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import {
  ALGORITHM_OPTIONS,
  AnomalyExtraCondition,
  AnomalyThreshold,
  AnomalyThresholdPart,
  DIMENSION_OPTIONS,
  EXTRA_FIELDS,
  THRESHOLD_OPERATORS,
  THRESHOLD_UNIT_OPTIONS,
  ThresholdOperator,
  ThresholdUnit,
  WINDOW_LABEL_OPTIONS,
} from '@/lib/anomalyThresholds'

const { Text } = Typography

interface Props {
  open: boolean
  initial?: AnomalyThreshold | null
  onClose: () => void
  onSubmit: (rule: AnomalyThreshold) => void
}

interface FormValues {
  label: string
  metric: string
  window_label: string
  dimension: string
  algorithm: string
  critical_operator: ThresholdOperator
  critical_value: number
  critical_unit: ThresholdUnit
  warn_operator: ThresholdOperator
  warn_value: number
  warn_unit: ThresholdUnit
  description: string
  enabled: boolean
}

const DEFAULT_VALUES: FormValues = {
  label: '',
  metric: '',
  window_label: '近 1 小时',
  dimension: '全局',
  algorithm: '固定阈值',
  critical_operator: '>',
  critical_value: 5,
  critical_unit: '%',
  warn_operator: '>',
  warn_value: 3,
  warn_unit: '%',
  description: '',
  enabled: true,
}

function newRuleCode(): string {
  return `custom_${Date.now().toString(36)}`
}

function toFormValues(initial: AnomalyThreshold | null): FormValues {
  if (!initial) return DEFAULT_VALUES
  return {
    label: initial.label,
    metric: initial.metric,
    window_label: initial.window_label,
    dimension: initial.dimension,
    algorithm: initial.algorithm,
    critical_operator: initial.critical.operator,
    critical_value: initial.critical.value,
    critical_unit: initial.critical.unit,
    warn_operator: initial.warn.operator,
    warn_value: initial.warn.value,
    warn_unit: initial.warn.unit,
    description: initial.description,
    enabled: initial.enabled,
  }
}

const OPERATOR_OPTIONS = THRESHOLD_OPERATORS.map((v) => ({ value: v, label: v }))
const UNIT_OPTIONS = THRESHOLD_UNIT_OPTIONS.map((v) => ({ value: v, label: v }))
const FIELD_OPTIONS = EXTRA_FIELDS.map((f) => ({ value: f.value, label: f.label }))

export default function AnomalyRuleForm({ open, initial, onClose, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [extraConditions, setExtraConditions] = useState<AnomalyExtraCondition[]>([])

  const isEdit = !!initial

  useEffect(() => {
    if (open) {
      form.setFieldsValue(toFormValues(initial ?? null))
      setExtraConditions(initial?.extra_conditions ?? [])
    }
  }, [open, initial, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const critical: AnomalyThresholdPart = {
        operator: values.critical_operator,
        value: values.critical_value,
        unit: values.critical_unit,
      }
      const warn: AnomalyThresholdPart = {
        operator: values.warn_operator,
        value: values.warn_value,
        unit: values.warn_unit,
      }
      // 过滤无效条件 (value 必须填)
      const validExtras = extraConditions.filter(
        (c): c is AnomalyExtraCondition =>
          !!c.field && !!c.operator && c.value !== undefined && c.value !== null && !Number.isNaN(c.value),
      )
      const rule: AnomalyThreshold = {
        rule_code: initial?.rule_code ?? newRuleCode(),
        label: values.label.trim(),
        metric: values.metric.trim(),
        dimension: values.dimension,
        algorithm: values.algorithm,
        window_label: values.window_label,
        critical,
        warn,
        extra_conditions: validExtras,
        threshold: values.critical_value,
        unit: values.critical_unit,
        description: values.description.trim(),
        enabled: values.enabled,
        source: 'custom',
      }
      onSubmit(rule)
    } catch {
      // form.validateFields 已展示错误, 不重复弹
    } finally {
      setSubmitting(false)
    }
  }

  const updateCondition = (idx: number, patch: Partial<AnomalyExtraCondition>) => {
    setExtraConditions((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    )
  }

  const removeCondition = (idx: number) => {
    setExtraConditions((prev) => prev.filter((_, i) => i !== idx))
  }

  const addCondition = () => {
    setExtraConditions((prev) => [
      ...prev,
      { field: 'request_count', operator: '>', value: 0 },
    ])
  }

  return (
    <Drawer
      title={isEdit ? '编辑监测规则' : '新增监测规则'}
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      destroyOnClose
      // 嵌套 drawer: 关闭遮罩 + 加大 zIndex 让它叠在父 drawer 之上.
      mask={false}
      zIndex={1100}
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={() => void handleOk()} loading={submitting}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label="规则名"
          name="label"
          rules={[{ required: true, message: '请输入规则名' }, { max: 64 }]}
        >
          <Input placeholder="例如 拒绝率异常" />
        </Form.Item>

        <Form.Item
          label="指标"
          name="metric"
          rules={[{ required: true, message: '请输入指标名' }, { max: 64 }]}
        >
          <Input placeholder="例如 拒绝率 / 高风险阻断密度" />
        </Form.Item>

        <Form.Item label="时间窗口" name="window_label" rules={[{ required: true }]}>
          <Select options={WINDOW_LABEL_OPTIONS.map((v) => ({ value: v, label: v }))} />
        </Form.Item>

        <Form.Item label="维度" name="dimension" rules={[{ required: true }]}>
          <Select options={DIMENSION_OPTIONS.map((v) => ({ value: v, label: v }))} />
        </Form.Item>

        <Form.Item label="算法" name="algorithm" rules={[{ required: true }]}>
          <Select options={ALGORITHM_OPTIONS.map((v) => ({ value: v, label: v }))} />
        </Form.Item>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <Form.Item
            label="严重"
            style={{ flex: 1, marginBottom: 8 }}
            required
          >
            <Input.Group compact>
              <Form.Item
                name="critical_operator"
                noStyle
                rules={[{ required: true, message: '操作符' }]}
                initialValue=">"
              >
                <Select
                  style={{ width: '30%' }}
                  options={OPERATOR_OPTIONS}
                />
              </Form.Item>
              <Form.Item
                name="critical_value"
                noStyle
                rules={[{ required: true, message: '请填阈值' }]}
              >
                <InputNumber
                  style={{ width: '40%' }}
                  placeholder="阈值"
                  min={0}
                  step={1}
                />
              </Form.Item>
              <Form.Item
                name="critical_unit"
                noStyle
                rules={[{ required: true, message: '单位' }]}
                initialValue="%"
              >
                <Select
                  style={{ width: '30%' }}
                  options={UNIT_OPTIONS}
                />
              </Form.Item>
            </Input.Group>
          </Form.Item>

          <Form.Item
            label="警告"
            style={{ flex: 1, marginBottom: 8 }}
            required
          >
            <Input.Group compact>
              <Form.Item
                name="warn_operator"
                noStyle
                rules={[{ required: true, message: '操作符' }]}
                initialValue=">"
              >
                <Select
                  style={{ width: '30%' }}
                  options={OPERATOR_OPTIONS}
                />
              </Form.Item>
              <Form.Item
                name="warn_value"
                noStyle
                rules={[{ required: true, message: '请填阈值' }]}
              >
                <InputNumber
                  style={{ width: '40%' }}
                  placeholder="阈值"
                  min={0}
                  step={1}
                />
              </Form.Item>
              <Form.Item
                name="warn_unit"
                noStyle
                rules={[{ required: true, message: '单位' }]}
                initialValue="%"
              >
                <Select
                  style={{ width: '30%' }}
                  options={UNIT_OPTIONS}
                />
              </Form.Item>
            </Input.Group>
          </Form.Item>
        </div>

        <div style={{ marginTop: 16, marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13 }}>
            附加条件（AND）
          </Text>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            多条条件同时满足才触发
          </Text>
        </div>

        <div style={{ marginBottom: 12 }}>
          {extraConditions.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无附加条件
            </Text>
          ) : (
            extraConditions.map((c, idx) => (
              <div
                key={idx}
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
              >
                <Text type="secondary" style={{ minWidth: 32, fontSize: 12 }}>
                  AND
                </Text>
                <Select
                  style={{ minWidth: 120 }}
                  value={c.field}
                  options={FIELD_OPTIONS}
                  onChange={(v) => updateCondition(idx, { field: v as typeof c.field })}
                  placeholder="字段"
                />
                <Select
                  style={{ width: 80 }}
                  value={c.operator}
                  options={OPERATOR_OPTIONS}
                  onChange={(v) => updateCondition(idx, { operator: v })}
                  placeholder="操作符"
                />
                <InputNumber
                  style={{ width: 100 }}
                  value={c.value}
                  min={0}
                  step={1}
                  placeholder="阈值"
                  onChange={(v) =>
                    updateCondition(idx, { value: typeof v === 'number' ? v : Number(v) || 0 })
                  }
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeCondition(idx)}
                />
              </div>
            ))
          )}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addCondition}
            size="small"
          >
            新增条件
          </Button>
        </div>

        <Form.Item label="说明" name="description">
          <Input.TextArea rows={2} placeholder="可选, 解释规则触发条件" />
        </Form.Item>

        <Form.Item label="状态" name="enabled" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
