import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { Alert, Button, Space, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  CATEGORIES,
  findCategory,
  isMediaType,
  MEDIA_TYPE_LABELS,
  type CategoryKey,
} from '@/components/strategy/constants'
import AuditItemListTable from '@/components/strategy/AuditItemListTable'

const { Title } = Typography

const PACKAGE_BY_MEDIA: Record<string, string | null> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

export default function StrategyRulesByTypePage() {
  const { mediaType } = useParams<{ mediaType: string }>()
  const location = useLocation()

  const validKey: CategoryKey = isMediaType(mediaType) ? (mediaType as CategoryKey) : 'image'
  const category = findCategory(validKey) ?? CATEGORIES[0]

  const hasChildRoute = /^\/strategies\/rules-by-type\/[^/]+\/[^/]+/.test(
    location.pathname,
  )

  const packageCode = PACKAGE_BY_MEDIA[validKey] ?? null

  if (hasChildRoute) {
    return <Outlet />
  }

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          {category.label} · 规则列表
        </Title>
        {packageCode && (
          <Space wrap>
            <Link to={`/strategies/rules-by-type/${validKey}/new`}>
              <Button type="primary" icon={<PlusOutlined />}>
                新建规则
              </Button>
            </Link>
          </Space>
        )}
      </div>

      {packageCode ? (
        <>
          {category.composesFrom && category.composesFrom.length > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={
                <span>
                  本类型由
                  {category.composesFrom.map((k) => (
                    <strong key={k} style={{ marginInline: 4 }}>
                      「{MEDIA_TYPE_LABELS[k] ?? k}」
                    </strong>
                  ))}
                  组合而成。可独立配置，亦可在「配置」中复用源规则。
                </span>
              }
            />
          )}
          <AuditItemListTable mediaType={validKey} />
        </>
      ) : null}
    </div>
  )
}