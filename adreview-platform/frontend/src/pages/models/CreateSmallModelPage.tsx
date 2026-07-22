import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { App, Button, Card, Form, Space, Tag, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'

import SmallModelFormFields from './SmallModelFormFields'
import { registeredModelsApi } from '@/api/registered-models'
import type { ArtifactUploadResponse } from '@/types/domain'
import { useRiskCategoryStore, useRiskCategoryByCode } from '@/store/riskCategories'

const { Title, Text } = Typography

/**
 * 独立路由 — 添加小模型。
 * - 入口来源：模型库列表"小模型 Tab"头部 [+] 添加 / Tab 头部 [+添加风险类型] 创建后跳转
 * - 风险类型从 ?risk_category=<code> 自动预填
 */
export default function CreateSmallModelPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { message } = App.useApp()

  const riskCode = searchParams.get('risk_category') ?? undefined
  const ensureLoaded = useRiskCategoryStore((s) => s.ensureLoaded)
  const loaded = useRiskCategoryStore((s) => s.loaded)
  const loading = useRiskCategoryStore((s) => s.loading)
  const preset = useRiskCategoryByCode(riskCode ?? null)

  const [form] = Form.useForm<CreateFormValues>()

  useEffect(() => {
    void ensureLoaded()
  }, [ensureLoaded])

  // 字典加载完后，把 query 中的风险类型写到 form
  useEffect(() => {
    if (!loaded) return
    if (riskCode) {
      form.setFieldValue('small_category', riskCode)
    }
  }, [loaded, riskCode, form])

  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    const artifact = (v as CreateFormValues & { __artifact?: ArtifactUploadResponse }).__artifact
    if (!artifact) {
      message.error('请上传小模型文件')
      return
    }
    if (!v.modality) {
      message.error('请选择支持的素材类型')
      return
    }
    if (!v.small_category) {
      message.error('请选择识别风险类型')
      return
    }
    if (!v.model_name || !v.model_name.trim()) {
      message.error('请填写模型名称')
      return
    }
    try {
      setSubmitting(true)
      const autoVersion = `${v.modality}-${v.small_category}`
      const created = await registeredModelsApi.create({
        name: v.name ?? v.model_name.trim(),
        description: v.description,
        kind: 'small',
        small_category: v.small_category ?? null,
        modality: v.modality as 'text' | 'image',
        large_category: null,
        provider_id: null,
        model_name: v.model_name.trim(),
        version: autoVersion,
        config: v.__auditPoints?.length ? { points: v.__auditPoints } : undefined,
        registration_method: 'uploaded_file',
        artifact,
      })
      message.success('小模型创建成功')
      navigate(`/resources/models/${created.id}`, { replace: true })
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = () => {
    navigate('/resources/models', { replace: true })
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 920, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} type="link" onClick={cancel}>
          返回模型库
        </Button>
      </Space>

      <Card>
        <Title level={4} style={{ marginTop: 0 }}>
          添加小模型
        </Title>

        {riskCode && (
          <div
            style={{
              padding: '8px 12px',
              background: '#f0f9ff',
              border: '1px solid #bae0ff',
              borderRadius: 6,
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            <Text type="secondary">已选风险类型：</Text>{' '}
            {loading && !loaded ? (
              <Tag>加载中…</Tag>
            ) : preset ? (
              <Tag color={preset.color}>{preset.label}</Tag>
            ) : (
              <Tag color="red">字典中未找到 ({riskCode})</Tag>
            )}
          </div>
        )}

        <Form<CreateFormValues>
          form={form}
          layout="vertical"
          initialValues={{}}
        >
          <SmallModelFormFields
            form={form as never}
            uploading={false}
            setUploading={() => {}}
          />
        </Form>

        <Space style={{ marginTop: 24, justifyContent: 'flex-end', display: 'flex' }}>
          <Button onClick={cancel}>取消</Button>
          <Button type="primary" loading={submitting} onClick={submit}>
            保存
          </Button>
        </Space>
      </Card>
    </div>
  )
}

interface CreateFormValues {
  modality?: string
  small_category?: string
  model_name?: string
  name?: string
  description?: string
  __auditPoints?: { label: string; description?: string }[]
  __artifact?: ArtifactUploadResponse
}
