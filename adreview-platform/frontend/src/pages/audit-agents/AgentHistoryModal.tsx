import { useMemo } from 'react'
import { Button, Card, Descriptions, Drawer, Grid, Popconfirm, Space, Tag, Timeline, Typography } from 'antd'
import { RollbackOutlined } from '@ant-design/icons'
import { listVersions, type AgentVersion, type AgentVersionSnapshot } from '@/api/agentVersions'

const { Text } = Typography
const { useBreakpoint } = Grid

export interface AgentHistoryModalProps {
  open: boolean
  agentId: string
  onClose: () => void
  onRollback?: (snapshot: AgentVersionSnapshot) => void
}

function TimelineDot({ isCurrent }: { isCurrent: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: isCurrent ? '#52C41A' : '#BFBFBF',
        boxShadow: isCurrent ? '0 0 0 4px rgba(82,196,26,0.15)' : 'none',
      }}
    />
  )
}

function VersionCard({ version, onRollback }: { version: AgentVersion; onRollback?: () => void }) {
  return (
    <Card
      size="small"
      style={{ borderRadius: 6, background: '#FAFAFA' }}
      styles={{ body: { padding: 12 } }}
    >
      <Space size={6} style={{ marginBottom: 8 }}>
        {version.isCurrent && <Tag color="success">当前</Tag>}
        <Tag color={version.isCurrent ? 'success' : 'default'}>已发布</Tag>
      </Space>
      <Descriptions size="small" column={1} colon={false}>
        <Descriptions.Item label={<Text type="secondary">版本</Text>}>
          {version.version}
        </Descriptions.Item>
        <Descriptions.Item label={<Text type="secondary">发布时间</Text>}>
          {version.publishedAt}
        </Descriptions.Item>
      </Descriptions>
      {!version.isCurrent && onRollback && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Popconfirm
            title="确认恢复到此版本？"
            description="恢复后将以该版本为基础继续编辑（未保存的更改将丢失）。"
            okText="恢复"
            cancelText="取消"
            onConfirm={onRollback}
          >
            <Button type="link" icon={<RollbackOutlined />} size="small">
              恢复到此版本
            </Button>
          </Popconfirm>
        </div>
      )}
    </Card>
  )
}

export default function AgentHistoryModal({
  open,
  agentId,
  onClose,
  onRollback,
}: AgentHistoryModalProps) {
  const versions = useMemo(() => (open ? listVersions(agentId) : []), [open, agentId])
  const screens = useBreakpoint()
  const width = screens.md ? 520 : '100vw'

  return (
    <Drawer
      title="历史版本"
      placement="right"
      width={width}
      open={open}
      onClose={onClose}
      mask={false}
      destroyOnHidden
    >
      {versions.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#94A3B8', padding: '40px 0' }}>
          暂无历史版本，发布后会生成快照。
        </div>
      ) : (
        <Timeline
          items={versions.map((v) => ({
            dot: <TimelineDot isCurrent={v.isCurrent} />,
            children: (
              <VersionCard
                version={v}
                onRollback={
                  onRollback
                    ? () => {
                        onRollback(v.snapshot)
                        onClose()
                      }
                    : undefined
                }
              />
            ),
          }))}
        />
      )}
    </Drawer>
  )
}