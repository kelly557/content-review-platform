import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from 'antd'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type { AuditItem, AuditPointRisk } from '@/types/domain'

const { TextArea } = Input
const { Title } = Typography

interface PointForm {
  code: string
  label: string
  label_cn: string
  description?: string
  medium_threshold: number
  high_threshold: number
  scope_text?: string
  risk_level: AuditPointRisk
  is_enabled: boolean
}

export default function CreateAuditPointPage() {
  const { code = '', itemId = '' } = useParams<{ code: string; itemId: string }>()
  const navigate = useNavigate()
  const [form] = Form.useForm<PointForm>()
  const [items, setItems] = useState<AuditItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!code) return
    void auditItemsApi.list(code).then(setItems)
  }, [code])

  useEffect(() => {
    form.setFieldsValue({
      item_id: Number(itemId) || undefined,
      medium_threshold: 60,
      high_threshold: 90,
      risk_level: '中风险',
      is_enabled: false,
    } as Partial<PointForm> & { item_id?: number })
  }, [itemId, form])

  const onSubmit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSubmitting(true)
    try {
      await auditPointsApi.create(code, {
        item_id: Number(itemId),
        code: values.code,
        label: values.label,
        label_cn: values.label_cn,
        description: values.description,
        medium_threshold: values.medium_threshold,
        high_threshold: values.high_threshold,
        scope_text: values.scope_text,
        risk_level: values.risk_level,
        is_enabled: values.is_enabled,
      })
      message.success('已创建')
      navigate(`/packages/${code}/items/${itemId}/points`)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        新建审核点
      </Title>
      <Card>
        <Form<PointForm> form={form} layout="vertical" style={{ maxWidth: 720 }}>
          <Form.Item
            name="label_cn"
            label="审核点名称（中文）"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如：涉政（严格模式）" />
          </Form.Item>
          <Form.Item
            name="label"
            label="label 标识"
            rules={[
              { required: true, message: '请输入 label' },
              { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '以字母开头，字母数字下划线' },
            ]}
          >
            <Input placeholder="例如：tx_politics_strict" />
          </Form.Item>
          <Form.Item
            name="code"
            label="审核点编码（包内唯一）"
            rules={[
              { required: true, message: '请输入编码' },
              { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '以字母开头，字母数字下划线' },
            ]}
          >
            <Input placeholder="例如：tx_politics_strict" />
          </Form.Item>
          <Form.Item label="所属审核项">
            <Select
              value={Number(itemId)}
              disabled
              options={items.map((i) => ({ value: i.id, label: i.name_cn }))}
            />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <TextArea rows={2} />
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
              />
            </Form.Item>
            <Form.Item name="is_enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item
            name="scope_text"
            label="细分检测范围"
            extra="描述该审核点要捕捉的具体违规模式，便于人工审核人员理解"
          >
            <TextArea rows={2} placeholder="例如：含有国家领导人负面评论或敏感历史事件" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" loading={submitting} onClick={onSubmit}>
                创建
              </Button>
              <Button onClick={() => navigate(`/packages/${code}/items/${itemId}/points`)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}