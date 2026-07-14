import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import { BulbOutlined, FormOutlined } from '@ant-design/icons'
import { auditItemsApi } from '@/api/auditItems'
import type { ItemSuggestion, SuggestResponse } from '@/types/domain'

const { TextArea } = Input
const { Title, Text } = Typography

interface CreateForm {
  name_cn: string
  aliases: string[]
  description?: string
}

const PACKAGE_BY_MEDIA: Record<string, string | null> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: null,
  doc: null,
  video: null,
}

const MEDIA_BY_PACKAGE: Record<string, string | null> = {
  image_audit_pro: 'image',
  text_audit_pro: 'text',
}

export default function CreateAuditItemPage() {
  const routeParams = useParams<{ code?: string; mediaType?: string }>()
  const [searchParams] = useSearchParams()
  const initialMode = searchParams.get('mode') === 'form' ? 'form' : 'nl'
  const navigate = useNavigate()
  const [form] = Form.useForm<CreateForm>()

  const mediaType = (routeParams.mediaType ?? '') || null
  const code =
    routeParams.code ??
    (mediaType ? (PACKAGE_BY_MEDIA[mediaType] ?? '') : '') ??
    ''

  const [mode, setMode] = useState<'nl' | 'form'>(initialMode)
  const [nlText, setNlText] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  const onSuggest = async () => {
    if (!nlText.trim()) {
      message.warning('请输入自然语言描述')
      return
    }
    setSuggesting(true)
    try {
      const res = await auditItemsApi.suggest(code, nlText.trim(), 5)
      setSuggest(res)
    } finally {
      setSuggesting(false)
    }
  }

  const pickSuggestion = (s: ItemSuggestion) => {
    const targetMediaType = mediaType ?? MEDIA_BY_PACKAGE[code]
    navigate(
      targetMediaType
        ? `/rules/personal/${targetMediaType}/${s.item_id}`
        : `/packages/${code}/items/${s.item_id}/points`,
    )
  }

  const onSubmit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setCreating(true)
    try {
      await auditItemsApi.create(code, {
        name_cn: values.name_cn,
        aliases: values.aliases ?? [],
        description: values.description,
      })
      message.success('已创建')
      const targetMediaType = mediaType ?? MEDIA_BY_PACKAGE[code]
      navigate(
        targetMediaType
          ? `/rules/personal/${targetMediaType}`
          : `/packages/${code}/items`,
      )
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        新建审核项
      </Title>
      <Tabs
        activeKey={mode}
        onChange={(k) => setMode(k as 'nl' | 'form')}
        items={[
          {
            key: 'nl',
            label: (
              <Space>
                <BulbOutlined />
                自然语言
              </Space>
            ),
            children: (
              <Card>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="用一句话描述你想检测的内容，系统会推荐已有审核项或帮你预填表单。"
                />
                <TextArea
                  rows={4}
                  value={nlText}
                  onChange={(e) => setNlText(e.target.value)}
                  placeholder="例如：我想检测图片里出现的招聘引流二维码"
                />
                <Space style={{ marginTop: 12 }}>
                  <Button type="primary" loading={suggesting} onClick={onSuggest}>
                    智能推荐
                  </Button>
                  <Button onClick={() => setNlText('')}>清空</Button>
                </Space>

                {suggest && (
                  <div style={{ marginTop: 16 }}>
                    {suggest.mock && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message="当前为 mock 结果，仅返回前 N 个候选；后续将接入真实规则引擎。"
                      />
                    )}
                    {suggest.matches.length === 0 ? (
                      <Text type="secondary">未找到匹配项，可切换到表单模式手动创建</Text>
                    ) : (
                      <Space direction="vertical" style={{ width: '100%' }}>
                        {suggest.matches.map((m) => (
                          <Card
                            key={m.item_id}
                            size="small"
                            hoverable
                            onClick={() => pickSuggestion(m)}
                            style={{ cursor: 'pointer' }}
                          >
                            <Space size={8} wrap>
                              <Text strong>{m.item_name_cn}</Text>
                              <Tag>{m.item_code}</Tag>
                              <Tag color="blue">score {(m.score * 100).toFixed(0)}</Tag>
                              {m.matched_terms.map((t) => (
                                <Tag key={t} color="geekblue">
                                  {t}
                                </Tag>
                              ))}
                            </Space>
                            {m.matched_aliases.length > 0 && (
                              <div style={{ marginTop: 6 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  命中别名：
                                </Text>
                                {m.matched_aliases.map((a) => (
                                  <Tag key={a}>{a}</Tag>
                                ))}
                              </div>
                            )}
                          </Card>
                        ))}
                      </Space>
                    )}
                  </div>
                )}
              </Card>
            ),
          },
          {
            key: 'form',
            label: (
              <Space>
                <FormOutlined />
                表单模式
              </Space>
            ),
            children: (
              <Card>
                <Form<CreateForm>
                  form={form}
                  layout="vertical"
                  style={{ maxWidth: 640 }}
                  initialValues={{ aliases: [] }}
                >
                  <Form.Item
                    name="name_cn"
                    label="审核项名称"
                    rules={[{ required: true, message: '请输入名称' }]}
                  >
                    <Input placeholder="例如：涉政" />
                  </Form.Item>
                  <Form.Item name="aliases" label="别名（自然语言匹配用）">
                    <Select
                      mode="tags"
                      placeholder="按回车添加，例如 暴恐、恐怖、terrorism"
                      tokenSeparators={[',']}
                    />
                  </Form.Item>
                  <Form.Item name="description" label="说明">
                    <TextArea rows={3} />
                  </Form.Item>
                  <Form.Item>
                    <Space>
                      <Button type="primary" loading={creating} onClick={onSubmit}>
                        创建并继续添加审核点
                      </Button>
                      <Button
                        onClick={() => {
                          const targetMediaType = mediaType ?? MEDIA_BY_PACKAGE[code]
                          navigate(
                            targetMediaType
                              ? `/rules/personal/${targetMediaType}`
                              : `/packages/${code}/items`,
                          )
                        }}
                      >
                        取消
                      </Button>
                    </Space>
                  </Form.Item>
                </Form>
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}