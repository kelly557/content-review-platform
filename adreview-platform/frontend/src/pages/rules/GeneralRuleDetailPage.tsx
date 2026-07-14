/**
 * 通用图片/文本审核规则 — 详情页（只读展示）
 *
 * - 仅显示「切换版本」入口
 * - 审核点列表只读
 * - 关联库只读
 */
import { useEffect, useState } from 'react'
import {
  Breadcrumb,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
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
  MediaTypeKey,
} from '@/types/domain'
import ChooseModelVersionModal from './ChooseModelVersionModal'

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

export default function GeneralRuleDetailPage() {
  const { mediaType = 'image', itemId = '' } = useParams<{
    mediaType: MediaTypeKey
    itemId: string
  }>()
  const navigate = useNavigate()
  const [item, setItem] = useState<AuditItem | null>(null)
  const [points, setPoints] = useState<AuditPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const pkg = PACKAGE_BY_MEDIA[mediaType as MediaTypeKey] ?? mediaType
      const list = await auditItemsApi.list(pkg)
      const target = list.find((it) => it.id === Number(itemId))
      setItem(target ?? null)
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

  const pointColumns: ColumnsType<AuditPoint> = [
    { title: '审核点', dataIndex: 'label_cn', width: '20%' },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      width: '10%',
      render: (v: AuditPointRisk) => (
        <Tag color={RISK_COLOR[v]}>{v}</Tag>
      ),
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
    { title: '描述', dataIndex: 'description', width: '40%' },
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
              <Link to={`/rules/general/${mediaType}`}>
                {MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则
              </Link>
            ),
          },
          { title: <Tag color="blue">通用</Tag> },
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
              <Tag color="blue">通用</Tag>
              <Tag color={item.is_enabled ? 'green' : 'default'}>
                {item.is_enabled ? '已启用' : '已停用'}
              </Tag>
            </Space>
          </div>

          <Card
            size="small"
            style={{ marginBottom: 16 }}
            styles={{ body: { padding: 16 } }}
          >
            <Row gutter={16} align="middle">
              <Col flex="auto">
                <Space size="small">
                  <Text type="secondary">生效模型：</Text>
                  {item.active_model_version ? (
                    <Text strong>
                      {item.active_model_version.model_name} · v
                      {item.active_model_version.version_no}
                      {item.active_model_version.version_label
                        ? ` (${item.active_model_version.version_label})`
                        : ''}
                    </Text>
                  ) : (
                    <Text type="secondary" style={{ fontStyle: 'italic' }}>
                      未指定
                    </Text>
                  )}
                </Space>
              </Col>
              <Col>
                <Space>
                  <Button
                    type="primary"
                    ghost
                    onClick={() => setSwitchOpen(true)}
                  >
                    切换版本
                  </Button>
                  <Button onClick={() => navigate(-1)}>返回</Button>
                </Space>
              </Col>
            </Row>
          </Card>

          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <Card title="基本信息" size="small">
                <Space direction="vertical" size={4}>
                  <Text>
                    <Text type="secondary">名称：</Text>
                    {item.name_cn}
                  </Text>
                  <Text>
                    <Text type="secondary">Code：</Text>
                    <Text code>{item.code}</Text>
                  </Text>
                  {item.description && (
                    <Text>
                      <Text type="secondary">描述：</Text>
                      {item.description}
                    </Text>
                  )}
                </Space>
              </Card>
            </Col>
            <Col span={12}>
              <Card title="关联库 (只读)" size="small">
                {item.linked_libraries.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未关联自定义库"
                    style={{ padding: '8px 0' }}
                  />
                ) : (
                  <Space wrap>
                    {item.linked_libraries.map((lib) => (
                      <Tag key={lib.library_id}>{lib.name}</Tag>
                    ))}
                  </Space>
                )}
              </Card>
            </Col>
          </Row>

          <Card
            title={`审核点 (${points.length}, 只读)`}
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

      <ChooseModelVersionModal
        item={switchOpen ? item : null}
        mediaType={mediaType}
        onClose={() => setSwitchOpen(false)}
        onSaved={async () => {
          setSwitchOpen(false)
          await reload()
        }}
      />
    </div>
  )
}