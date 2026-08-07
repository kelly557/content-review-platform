import {
  Button,
  Drawer,
  Empty,
  List,
  Space,
  Tag,
  Typography,
} from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import type { ModelReferencesResponse } from '@/types/domain'

const { Text } = Typography

interface ModelReferencesDrawerProps {
  open: boolean
  loading: boolean
  data: ModelReferencesResponse | null
  onClose: () => void
}

const KIND_LABEL: Record<string, string> = {
  audit_item: '审核项',
  strategy: '策略',
}

const KIND_COLOR: Record<string, string> = {
  audit_item: 'magenta',
  strategy: 'blue',
}

export default function ModelReferencesDrawer({
  open,
  loading,
  data,
  onClose,
}: ModelReferencesDrawerProps) {
  return (
    <Drawer
      title="模型被引用情况"
      open={open}
      onClose={onClose}
      width={420}
      destroyOnClose
      extra={
        <Button type="primary" onClick={onClose}>
          我知道了
        </Button>
      }
    >
      {loading ? (
        <Text type="secondary">查询中…</Text>
      ) : !data ? (
        <Empty description="暂无数据" />
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            {data.is_blocked ? (
              <Text type="danger" strong>
                该模型仍被引用，无法删除
              </Text>
            ) : (
              <Text type="success" strong>
                该模型未被引用，可安全删除
              </Text>
            )}
          </div>
          <Space size="small" wrap style={{ marginBottom: 12 }}>
            <Tag color={KIND_COLOR.audit_item}>
              审核项 {data.summary.audit_item}
            </Tag>
            <Tag color={KIND_COLOR.strategy}>
              策略 {data.summary.strategy}
            </Tag>
          </Space>
          {data.items.length === 0 ? (
            <Empty description="无引用" />
          ) : (
            <List
              dataSource={data.items}
              renderItem={(item) => (
                <List.Item key={`${item.kind}-${item.id}`}>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Tag color={KIND_COLOR[item.kind]}>
                          {KIND_LABEL[item.kind] ?? item.kind}
                        </Tag>
                        <Text strong>{item.name}</Text>
                      </Space>
                    }
                    description={
                      <Space size={6} style={{ color: '#94a3b8', fontSize: 12 }}>
                        <span>#{item.id}</span>
                        {item.detail && (
                          <>
                            <span>·</span>
                            <span>{item.detail}</span>
                          </>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
          {data.is_blocked && (
            <div style={{ marginTop: 16, color: '#64748b', fontSize: 12 }}>
              <LinkOutlined /> 请先迁移或解除引用后再操作。
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}
