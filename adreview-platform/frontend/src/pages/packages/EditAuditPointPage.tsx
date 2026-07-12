import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { LockOutlined, UnlockOutlined } from '@ant-design/icons'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type { AuditItem, AuditPoint, AuditPointRisk } from '@/types/domain'
import { useAuthStore } from '@/store'

const { TextArea } = Input
const { Title, Text } = Typography

interface PointForm {
  label_cn: string
  description?: string
  medium_threshold: number
  high_threshold: number
  scope_text?: string
  risk_level: AuditPointRisk
  is_enabled: boolean
}

const BUILTIN_POINT_WRITABLE_FIELDS = new Set([
  'is_enabled',
  'medium_threshold',
  'high_threshold',
  'linked_library_ids',
])

export default function EditAuditPointPage() {
  const { message } = App.useApp()
  const { code = '', itemId = '', pointId = '' } = useParams<{
    code: string
    itemId: string
    pointId: string
  }>()
  const navigate = useNavigate()
  const [form] = Form.useForm<PointForm>()
  const [items, setItems] = useState<AuditItem[]>([])
  const [point, setPoint] = useState<AuditPoint | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const { user } = useAuthStore()
  const isSuperadmin = user?.role === 'superadmin'
  const pointIdNum = Number(pointId)
  const itemIdNum = Number(itemId)

  useEffect(() => {
    if (!code) return
    void auditItemsApi.list(code).then(setItems)
  }, [code])

  useEffect(() => {
    if (!code || !Number.isFinite(pointIdNum)) return
    let cancel = false
    setLoading(true)
    auditPointsApi
      .get(code, pointIdNum)
      .then((p) => {
        if (cancel) return
        if (p.item_id !== itemIdNum) {
          message.error('审核点与审核项不匹配')
          navigate(`/packages/${code}/items/${itemId}/points`, { replace: true })
          return
        }
        setPoint(p)
        form.setFieldsValue({
          label_cn: p.label_cn,
          description: p.description ?? undefined,
          medium_threshold: p.medium_threshold,
          high_threshold: p.high_threshold,
          scope_text: p.scope_text ?? undefined,
          risk_level: p.risk_level,
          is_enabled: p.is_enabled,
        })
      })
      .catch((e: unknown) => {
        const detail = (e as { response?: { data?: { detail?: string } } })
          ?.response?.data?.detail
        message.error(detail ?? (e as Error).message ?? '加载审核点失败')
        navigate(`/packages/${code}/items/${itemId}/points`, { replace: true })
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [code, pointIdNum, itemIdNum, itemId, form, message, navigate])

  const isBuiltin = point?.is_builtin ?? false
  const lockField = (field: keyof PointForm): boolean =>
    isBuiltin && !isSuperadmin && !BUILTIN_POINT_WRITABLE_FIELDS.has(field)

  const onSubmit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values || !code || !Number.isFinite(pointIdNum)) return
    setSubmitting(true)
    try {
      await auditPointsApi.update(code, pointIdNum, {
        label_cn: values.label_cn,
        description: values.description,
        medium_threshold: values.medium_threshold,
        high_threshold: values.high_threshold,
        scope_text: values.scope_text,
        risk_level: values.risk_level,
        is_enabled: values.is_enabled,
      })
      message.success('已保存')
      navigate(`/packages/${code}/items/${itemId}/points`)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response
        ?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div>
        <Title level={4} style={{ marginTop: 0 }}>
          编辑审核点
        </Title>
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      </div>
    )
  }

  if (!point) return null

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        编辑审核点
      </Title>
      <Space size={8} align="center" wrap style={{ marginBottom: 12 }}>
        {isBuiltin ? (
          <Tooltip
            title={
              isSuperadmin
                ? '通用审核点:超级管理员可编辑全部字段'
                : '通用审核点:仅允许修改启用 / 中/高风险分 / 关联自定义库'
            }
          >
            <Tag color="gold" icon={<LockOutlined />} style={{ margin: 0 }}>
              通用规则
            </Tag>
          </Tooltip>
        ) : (
          <Tag color="blue" icon={<UnlockOutlined />} style={{ margin: 0 }}>
            个性化规则
          </Tag>
        )}
        {isBuiltin &&
          (isSuperadmin ? (
            <Tag color="purple" style={{ margin: 0 }}>
              超级管理员可编辑（全部字段）
            </Tag>
          ) : (
            <Tag style={{ margin: 0, color: '#64748B' }}>
              仅可启用 / 中/高风险分 / 关联库
            </Tag>
          ))}
        <Text type="secondary">code: {point.code}</Text>
      </Space>
      <Card>
        <Form<PointForm>
          form={form}
          layout="vertical"
          style={{ maxWidth: 720 }}
          disabled={false}
        >
          <Form.Item
            name="label_cn"
            label="审核点名称（中文）"
            rules={[{ required: true, message: '请输入名称' }]}
            extra={
              lockField('label_cn')
                ? '通用审核点的名称受后端白名单限制,无法修改'
                : undefined
            }
          >
            <Input
              placeholder="例如：涉政（严格模式）"
              disabled={lockField('label_cn')}
            />
          </Form.Item>
          <Form.Item label="所属审核项">
            <Select
              value={point.item_id}
              disabled
              options={items.map((i) => ({ value: i.id, label: i.name_cn }))}
            />
          </Form.Item>
          <Form.Item
            name="description"
            label="说明"
            extra={
              lockField('description')
                ? '通用审核点的说明受后端白名单限制,无法修改'
                : undefined
            }
          >
            <TextArea rows={2} disabled={lockField('description')} />
          </Form.Item>
          <Space size={16} wrap>
            <Form.Item
              name="medium_threshold"
              label="中风险分"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={100} step={0.1} />
            </Form.Item>
            <Form.Item
              name="high_threshold"
              label="高风险分"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={100} step={0.1} />
            </Form.Item>
            <Form.Item name="risk_level" label="风险等级">
              <Select
                style={{ width: 140 }}
                options={[
                  { value: '低风险', label: '低风险' },
                  { value: '中风险', label: '中风险' },
                  { value: '高风险', label: '高风险' },
                ]}
                disabled={lockField('risk_level')}
              />
            </Form.Item>
            <Form.Item name="is_enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item
            name="scope_text"
            label="细分检测范围"
            extra={
              lockField('scope_text')
                ? '通用审核点的细分检测范围受后端白名单限制,无法修改'
                : '描述该审核点要捕捉的具体违规模式，便于人工审核人员理解'
            }
          >
            <TextArea
              rows={2}
              placeholder="例如：含有国家领导人负面评论或敏感历史事件"
              disabled={lockField('scope_text')}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" loading={submitting} onClick={onSubmit}>
                保存
              </Button>
              <Button
                onClick={() =>
                  navigate(`/packages/${code}/items/${itemId}/points`)
                }
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}