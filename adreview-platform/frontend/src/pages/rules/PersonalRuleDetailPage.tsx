/**
 * 个性化图片/文本审核规则 — 详情页
 *
 * - 关联知识文档(多选)可编辑
 * - 关联库可编辑(复用既有 ReplaceLinkedLibraries modal — 此处暂简化展示)
 * - 审核点可编辑阈值 / 启停(不暴露增删)
 */
import { useEffect, useState } from 'react'
import {
  App,
  Breadcrumb,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type {
  AuditItem,
  AuditPoint,
  AuditPointRisk,
  AuditPointUpdate,
  MediaTypeKey,
} from '@/types/domain'
import SelectKnowledgeDocumentsModal from './SelectKnowledgeDocumentsModal'

const { Text, Title } = Typography

const PACKAGE_BY_MEDIA: Record<MediaTypeKey, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

const MEDIA_LABEL: Record<MediaTypeKey, string> = {
  image: '图片',
  text: '文本',
  audio: '音频',
  doc: '文档',
  video: '视频',
}

const RISK_COLOR: Record<AuditPointRisk, string> = {
  低风险: 'green',
  中风险: 'gold',
  高风险: 'red',
}

export default function PersonalRuleDetailPage() {
  const { mediaType = 'image', itemId = '' } = useParams<{
    mediaType: MediaTypeKey
    itemId: string
  }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [item, setItem] = useState<AuditItem | null>(null)
  const [points, setPoints] = useState<AuditPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [selectOpen, setSelectOpen] = useState(false)
  const [editingPoint, setEditingPoint] = useState<AuditPoint | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [descInput, setDescInput] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [enabledLoading, setEnabledLoading] = useState(false)

  const pkg = PACKAGE_BY_MEDIA[mediaType as MediaTypeKey] ?? mediaType

  const reload = async () => {
    setLoading(true)
    try {
      const list = await auditItemsApi.list(pkg)
      const target = list.find((it) => it.id === Number(itemId))
      setItem(target ?? null)
      setNameInput(target?.name_cn ?? '')
      setDescInput(target?.description ?? '')
      if (target) {
        const ps = await auditPointsApi.list(pkg, { item_id: target.id })
        setPoints(ps)
      } else {
        setPoints([])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaType, itemId])

  const toggleEnabled = async (next: boolean) => {
    if (!item) return
    setEnabledLoading(true)
    try {
      const updated = await auditItemsApi.update(pkg, item.id, { is_enabled: next })
      setItem(updated)
      message.success(next ? '已启用' : '已停用')
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '更新失败')
    } finally {
      setEnabledLoading(false)
    }
  }

  const saveMeta = async () => {
    if (!item) return
    setSavingMeta(true)
    try {
      const updated = await auditItemsApi.update(pkg, item.id, {
        name_cn: nameInput,
        description: descInput,
      })
      setItem(updated)
      message.success('已保存')
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSavingMeta(false)
    }
  }

  const savePoint = async (pointId: number, payload: AuditPointUpdate) => {
    try {
      await auditPointsApi.update(pkg, pointId, payload)
      message.success('已保存')
      await reload()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    }
  }

  const pointColumns: ColumnsType<AuditPoint> = [
    { title: '审核点', dataIndex: 'label_cn', width: '20%' },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      width: '10%',
      render: (v: AuditPointRisk) => <Tag color={RISK_COLOR[v]}>{v}</Tag>,
    },
    {
      title: '中阈值',
      dataIndex: 'medium_threshold',
      width: '10%',
      render: (v: number) => (
        <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(2)}</Text>
      ),
    },
    {
      title: '高阈值',
      dataIndex: 'high_threshold',
      width: '10%',
      render: (v: number) => (
        <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(2)}</Text>
      ),
    },
    {
      title: '启用',
      dataIndex: 'is_enabled',
      width: '10%',
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已停用'}</Tag>
      ),
    },
    { title: '描述', dataIndex: 'description', width: '30%' },
    {
      title: '操作',
      width: '10%',
      render: (_, row) => (
        <Button size="small" type="link" onClick={() => setEditingPoint(row)}>
          编辑
        </Button>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/strategies">策略中心</Link> },
          { title: '审核策略' },
          {
            title: (
              <Link to={`/rules/personal/${mediaType}`}>
                {MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则
              </Link>
            ),
          },
          { title: <Tag color="green">个性化</Tag> },
        ]}
      />

      {item ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <Space>
              <Title level={4} style={{ margin: 0 }}>
                {item.name_cn}
              </Title>
              <Tag color="green">个性化</Tag>
              <Switch
                checked={item.is_enabled}
                onChange={toggleEnabled}
                loading={enabledLoading}
                checkedChildren="已启用"
                unCheckedChildren="已停用"
              />
            </Space>
            <Space>
              <Button onClick={() => navigate(-1)}>返回</Button>
            </Space>
          </div>

          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <Card title="基本信息" size="small">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div>
                    <Text type="secondary">名称：</Text>
                    <Input
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      maxLength={64}
                    />
                  </div>
                  <div>
                    <Text type="secondary">描述：</Text>
                    <Input.TextArea
                      value={descInput}
                      onChange={(e) => setDescInput(e.target.value)}
                      autoSize={{ minRows: 2, maxRows: 4 }}
                    />
                  </div>
                  <div>
                    <Button
                      type="primary"
                      onClick={saveMeta}
                      loading={savingMeta}
                      disabled={
                        nameInput === item.name_cn &&
                        (descInput ?? '') === (item.description ?? '')
                      }
                    >
                      保存基本信息
                    </Button>
                  </div>
                </Space>
              </Card>
            </Col>
            <Col span={12}>
              <Card
                title="关联知识文档 (多选)"
                size="small"
                extra={
                  <Button size="small" onClick={() => setSelectOpen(true)}>
                    + 添加知识文档
                  </Button>
                }
              >
                {item.knowledge_document_ids.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未关联知识文档"
                    style={{ padding: '8px 0' }}
                  />
                ) : (
                  <Space wrap>
                    {item.knowledge_document_ids.map((id) => (
                      <Tag key={id} color="cyan">
                        📚 #{id}
                      </Tag>
                    ))}
                  </Space>
                )}
              </Card>
            </Col>
          </Row>

          <Card
            title={`审核点 (${points.length})`}
            size="small"
            styles={{ body: { padding: 0 } }}
          >
            <Table<AuditPoint>
              rowKey="id"
              loading={loading}
              dataSource={points}
              columns={pointColumns}
              pagination={false}
              size="middle"
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="该规则下暂无审核点"
                    style={{ padding: '12px 0' }}
                  />
                ),
              }}
            />
          </Card>
        </>
      ) : (
        <Empty description={loading ? '加载中...' : '未找到该规则'} />
      )}

      <SelectKnowledgeDocumentsModal
        item={selectOpen ? item : null}
        onClose={() => setSelectOpen(false)}
        onSaved={async () => {
          setSelectOpen(false)
          await reload()
        }}
      />

      <Modal
        open={!!editingPoint}
        title={editingPoint ? `编辑审核点 — ${editingPoint.label_cn}` : '编辑审核点'}
        onCancel={() => setEditingPoint(null)}
        onOk={async () => {
          if (!editingPoint) return
          await savePoint(editingPoint.id, {
            medium_threshold: editingPoint.medium_threshold,
            high_threshold: editingPoint.high_threshold,
            is_enabled: editingPoint.is_enabled,
          })
          setEditingPoint(null)
        }}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        {editingPoint && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text type="secondary">中阈值</Text>
              <Input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={editingPoint.medium_threshold}
                onChange={(e) =>
                  setEditingPoint({
                    ...editingPoint,
                    medium_threshold: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <Text type="secondary">高阈值</Text>
              <Input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={editingPoint.high_threshold}
                onChange={(e) =>
                  setEditingPoint({
                    ...editingPoint,
                    high_threshold: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <Text type="secondary">启用</Text>
              <div>
                <Switch
                  checked={editingPoint.is_enabled}
                  onChange={(v) =>
                    setEditingPoint({ ...editingPoint, is_enabled: v })
                  }
                />
              </div>
            </div>
          </Space>
        )}
      </Modal>
    </div>
  )
}