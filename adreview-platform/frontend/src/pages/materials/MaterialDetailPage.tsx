import { useEffect, useState } from 'react'
import {
  Card,
  Descriptions,
  Tag,
  Button,
  Space,
  Tabs,
  List,
  Typography,
  Empty,
  App,
  Modal,
  Form,
  Upload,
  Select,
  type UploadProps,
} from 'antd'
import {
  ArrowLeftOutlined,
  UploadOutlined,
  RocketOutlined,
  DownloadOutlined,
  HistoryOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { materialsApi, workflowsApi } from '@/api/materials'
import { annotationsApi } from '@/api/reviews'
import { useAuthStore } from '@/store'
import {
  STATUS_LABELS,
  STATUS_COLORS,
  TYPE_LABELS,
  type Material,
  type WorkflowTemplate,
  type Annotation,
} from '@/types/domain'
import AnnotationCanvas from '@/components/AnnotationCanvas'

const { Title, Text, Paragraph } = Typography

export default function MaterialDetailPage() {
  const { message } = App.useApp()

  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [material, setMaterial] = useState<Material | null>(null)
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [submitOpen, setSubmitOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string | undefined>(undefined)

  const materialId = Number(id)

  const fetchAll = async () => {
    if (!materialId) return
    const m = await materialsApi.get(materialId)
    setMaterial(m)
    if (m.current_version_id) {
      const ann = await annotationsApi.list(m.current_version_id)
      setAnnotations(ann.items)
    }
  }

  useEffect(() => {
    fetchAll()
    workflowsApi.templates().then(setTemplates).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId])

  if (!material) return <Empty description="加载中" />

  const currentVersion = material.versions.find((v) => v.id === material.current_version_id)
  const isImage = currentVersion?.mime_type.startsWith('image/')
  const isVideo = currentVersion?.mime_type.startsWith('video/')
  const isPdf = currentVersion?.mime_type === 'application/pdf'
  const isText = material.material_type === 'text'

  const canSubmit = user && (user.id === material.submitter_id || user.role === 'admin') &&
    ['draft', 'rejected'].includes(material.status)

  const uploadProps: UploadProps = {
    beforeUpload: (f) => { setFile(f); return false },
    maxCount: 1,
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/materials')}>返回</Button>
        <Title level={3} style={{ margin: 0 }}>{material.title}</Title>
        <Tag color={STATUS_COLORS[material.status]}>{STATUS_LABELS[material.status]}</Tag>
        <Tag>{TYPE_LABELS[material.material_type]}</Tag>
      </Space>

      <Card>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="素材ID">{material.id}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{new Date(material.created_at).toLocaleString('zh-CN')}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{new Date(material.updated_at).toLocaleString('zh-CN')}</Descriptions.Item>
          <Descriptions.Item label="描述" span={3}>
            {material.description || <Text type="secondary">无</Text>}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        defaultActiveKey="preview"
        items={[
          {
            key: 'preview',
            label: '预览与批注',
            children: (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16 }}>
                <Card>
                  {currentVersion ? (
                    isImage ? (
                      <AnnotationCanvas
                        src={materialsApi.downloadUrl(materialId, currentVersion.id)}
                        mime={currentVersion.mime_type}
                        annotations={annotations}
                        onCreate={async (a) => {
                          await annotationsApi.create({
                            version_id: currentVersion.id,
                            body: a.body,
                            x: a.x,
                            y: a.y,
                            w: a.w,
                            h: a.h,
                            quote: a.quote,
                          })
                          message.success('已添加批注')
                          fetchAll()
                        }}
                      />
                    ) : isVideo ? (
                      <video
                        src={materialsApi.downloadUrl(materialId, currentVersion.id)}
                        controls
                        style={{ width: '100%', maxHeight: 480, background: '#000' }}
                      />
                    ) : isPdf ? (
                      <iframe
                        title="pdf-preview"
                        src={materialsApi.downloadUrl(materialId, currentVersion.id)}
                        style={{ width: '100%', height: 600, border: 0 }}
                      />
                    ) : isText ? (
                      <Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                        {currentVersion.text_body || '(无文本内容)'}
                      </Paragraph>
                    ) : (
                      <Text type="secondary">不支持的格式: {currentVersion.mime_type}</Text>
                    )
                  ) : (
                    <Empty description="尚无版本" />
                  )}
                </Card>
                <Card title="批注列表" size="small" styles={{ body: { padding: 0, maxHeight: 520, overflow: 'auto' } }}>
                  {annotations.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无批注" style={{ padding: 24 }} />
                  ) : (
                    <List
                      dataSource={annotations}
                      renderItem={(a) => (
                        <List.Item style={{ padding: '8px 12px' }}>
                          <List.Item.Meta
                            title={<Text style={{ fontSize: 13 }}>{a.body}</Text>}
                            description={
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {a.quote ? `“${a.quote.slice(0, 30)}…” · ` : ''}
                                {new Date(a.created_at).toLocaleString('zh-CN')}
                              </Text>
                            }
                          />
                          {a.resolved ? <Tag color="success">已解决</Tag> : null}
                        </List.Item>
                      )}
                    />
                  )}
                </Card>
              </div>
            ),
          },
          {
            key: 'versions',
            label: `版本历史 (${material.versions.length})`,
            children: (
              <List
                dataSource={material.versions}
                renderItem={(v) => (
                  <List.Item
                    actions={[
                      <a
                        key="dl"
                        href={materialsApi.downloadUrl(materialId, v.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <DownloadOutlined /> 下载
                      </a>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<HistoryOutlined style={{ fontSize: 18, color: '#64748B' }} />}
                      title={`v${v.version_no} · ${v.original_filename}`}
                      description={
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {(v.file_size / 1024).toFixed(1)} KB · {v.mime_type} · {new Date(v.created_at).toLocaleString('zh-CN')}
                        </Text>
                      }
                    />
                    {v.id === material.current_version_id && <Tag color="blue">当前版本</Tag>}
                  </List.Item>
                )}
              />
            ),
          },
        ]}
      />

      {canSubmit && (
        <Card>
          <Space>
            <Upload {...uploadProps}>
              <Button icon={<UploadOutlined />}>上传新版本</Button>
            </Upload>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              disabled={!file}
              onClick={async () => {
                if (!file) {
                  message.warning('请先选择文件')
                  return
                }
                await materialsApi.uploadVersion(materialId, file)
                message.success('已上传新版本')
                setFile(null)
                fetchAll()
              }}
            >
              上传
            </Button>
            <Button type="primary" ghost icon={<RocketOutlined />} onClick={() => setSubmitOpen(true)}>
              提交审核
            </Button>
          </Space>
        </Card>
      )}

      <Modal
        title="选择人工审核策略"
        open={submitOpen}
        onCancel={() => setSubmitOpen(false)}
        onOk={async () => {
          await materialsApi.submit(materialId)
          message.success('已提交审核')
          setSubmitOpen(false)
          setSelectedTemplate(undefined)
          fetchAll()
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {templates.length === 0 ? (
            <Text type="secondary">暂无可用人工审核策略（将仅标记为已提交）</Text>
          ) : (
            <Form.Item label="人工审核策略">
              <Select
                placeholder="-- 无（仅标记为已提交）--"
                allowClear
                value={selectedTemplate}
                onChange={setSelectedTemplate}
                options={templates.map((t) => ({
                  value: t.code,
                  label: `${t.name} · ${t.description || ''}`,
                }))}
              />
            </Form.Item>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            提交后将进入审核队列。如选择联合审核 (joint)，所有 MLR 专家需一致通过。
          </Text>
        </Space>
      </Modal>
    </Space>
  )
}
