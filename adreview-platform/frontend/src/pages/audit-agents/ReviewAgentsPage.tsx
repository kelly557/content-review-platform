import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Drawer,
  Input,
  Popover,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  CheckCircleTwoTone,
  CloseOutlined,
  CopyOutlined,
  EditOutlined,
  PlusOutlined,
  SettingOutlined,
  StarOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import CreateAgentForm, { type CreateAgentPayload } from './CreateAgentModal'
import CreateAgentStep1Modal, {
  type CreateAgentStep1Payload,
  type Step1Modality,
} from './CreateAgentStep1Modal'
import { useUiStore } from '@/store'

const { Title, Text } = Typography

type AgentStatus = '已发布' | '未发布' | '已下线'
type AgentModality = '文本' | '图像' | '图文' | '音频' | '视频'

interface AgentRow {
  appId: string
  name: string
  status: AgentStatus
  modality: AgentModality
  onlineAt: string
  updatedAt: string
}

const INITIAL_AGENTS: AgentRow[] = [
  {
    appId: 'txt_check_agent_01',
    name: '测试',
    status: '已发布',
    modality: '文本',
    onlineAt: '2026-07-20 10:59:36',
    updatedAt: '2026-07-20 10:59:36',
  },
]

const STATUS_COLOR: Record<AgentStatus, string> = {
  已发布: 'green',
  未发布: 'gold',
  已下线: 'default',
}

const STEPS = [
  {
    key: 'create',
    title: '1.创建智能体',
    icon: <PlusOutlined />,
    description:
      '根据待审核内容模态，创建新建智能体应用。目前可支持文本、图像、图文多模态智能体。',
  },
  {
    key: 'config',
    title: '2.配置智能体',
    icon: <SettingOutlined />,
    description:
      '添加审核智能体，并逐步配置完善智能体：包含大模型选择、场景模版选择、提示词配置等。配置后可输入样本进行效果测试，直至满足业务需要。',
  },
  {
    key: 'online',
    title: '3.上线应用',
    icon: <StarOutlined />,
    description:
      '将配置好的智能体发布上线，可通过API接口实现调用，业务可根据接口返回结果自行决策。',
  },
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function timestamp() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function ReviewAgentsPage() {
  const { message } = App.useApp()
  const setAppDimmed = useUiStore((s) => s.setAppDimmed)
  const [agents, setAgents] = useState<AgentRow[]>(INITIAL_AGENTS)

  // 两步创建
  const [step1Open, setStep1Open] = useState(false)
  const [step1Payload, setStep1Payload] = useState<CreateAgentStep1Payload | null>(null)
  // 配置入口（编辑已有）
  const [editingAgent, setEditingAgent] = useState<AgentRow | null>(null)
  // 通用第二步抽屉
  const [step2Open, setStep2Open] = useState(false)
  const [creating, setCreating] = useState(false)
  // AI 优化提示词抽屉
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)

  const anyDrawerOpen = step1Open || step2Open || aiDrawerOpen

  useEffect(() => {
    setAppDimmed(anyDrawerOpen)
    return () => setAppDimmed(false)
  }, [anyDrawerOpen, setAppDimmed])

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      message.success('已复制到剪贴板')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  const handleStep1Submit = (payload: CreateAgentStep1Payload) => {
    setStep1Payload(payload)
    setStep1Open(false)
    setEditingAgent(null)
    setStep2Open(true)
  }

  const handleOpenConfig = (row: AgentRow) => {
    setEditingAgent(row)
    setStep1Payload(null)
    setStep2Open(true)
  }

  const closeStep2 = () => {
    if (creating) return
    setStep2Open(false)
    setStep1Payload(null)
    setEditingAgent(null)
  }

  const handleCreateOrUpdate = (payload: CreateAgentPayload) => {
    setCreating(true)
    if (editingAgent) {
      setAgents((prev) =>
        prev.map((a) =>
          a.appId === editingAgent.appId
            ? {
                ...a,
                name: payload.name,
                modality: payload.modality as AgentModality,
                updatedAt: timestamp(),
              }
            : a,
        ),
      )
      message.success('已更新审核智能体')
    } else {
      const ts = timestamp()
      const sequence = String(agents.length + 1).padStart(2, '0')
      const modalityPrefix =
        payload.modality === '文本' ? 'txt' : payload.modality === '图像' ? 'img' : 'mm'
      const appId = `${modalityPrefix}_check_agent_${sequence}`
      const next: AgentRow = {
        appId,
        name: payload.name,
        status: '未发布',
        modality: payload.modality as AgentModality,
        onlineAt: '-',
        updatedAt: ts,
      }
      setAgents((prev) => [next, ...prev])
      message.success('已创建审核智能体')
    }
    setCreating(false)
    closeStep2()
  }

  const handleRename = (agent: AgentRow, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed) {
      message.warning('名称不能为空')
      return false
    }
    setAgents((prev) =>
      prev.map((a) =>
        a.appId === agent.appId ? { ...a, name: trimmed, updatedAt: timestamp() } : a,
      ),
    )
    message.success('已更新名称')
    return true
  }

  const columns = useMemo(
    () => [
      {
        title: 'AppId',
        dataIndex: 'appId',
        width: '16%',
        render: (v: string) => (
          <Space size={6}>
            <Text style={{ fontFamily: 'monospace' }}>{v}</Text>
            <Tooltip title="复制 AppId">
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined style={{ fontSize: 12 }} />}
                onClick={() => onCopy(v)}
                aria-label={`复制 ${v}`}
              />
            </Tooltip>
          </Space>
        ),
      },
      {
        title: '智能体名称',
        dataIndex: 'name',
        width: '18%',
        render: (v: string, row: AgentRow) => (
          <Popover
            trigger="click"
            placement="topLeft"
            destroyTooltipOnHide
            content={
              <RenamePopoverContent
                initial={v}
                onConfirm={(val) => handleRename(row, val)}
              />
            }
          >
            <Space size={6} style={{ cursor: 'pointer' }}>
              <span>{v}</span>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined style={{ fontSize: 12 }} />}
                aria-label={`编辑名称 ${v}`}
              />
            </Space>
          </Popover>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: '10%',
        render: (v: AgentStatus) => (
          <Space size={6}>
            {v === '已发布' ? (
              <CheckCircleTwoTone twoToneColor="#52c41a" />
            ) : (
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#bfbfbf',
                }}
              />
            )}
            <Tag color={STATUS_COLOR[v]}>{v}</Tag>
          </Space>
        ),
      },
      { title: '模态', dataIndex: 'modality', width: '10%' },
      { title: '上线时间', dataIndex: 'onlineAt', width: '18%' },
      { title: '更新时间', dataIndex: 'updatedAt', width: '18%' },
      {
        title: '操作',
        dataIndex: 'appId',
        width: '10%',
        render: (_: string, row: AgentRow) => (
          <Space size={4}>
            <Button type="link" size="small" onClick={() => handleOpenConfig(row)}>
              配置
            </Button>
            <Button type="link" size="small" onClick={() => onCopy(row.appId)}>
              复制
            </Button>
          </Space>
        ),
      },
    ],
    [],
  )

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/strategies">策略中心</Link> },
          { title: '审核策略' },
          { title: '审核智能体' },
        ]}
      />

      <Title level={4} style={{ margin: '0 0 12px' }}>
        配置管理
      </Title>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="在此处您可以创建和配置审核智能体，满足自定义审核防护诉求。"
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {STEPS.map((step, idx) => (
          <Card key={step.key} bordered style={{ borderRadius: 8 }}>
            <Space align="start" size={12}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: '#E6F4FF',
                  color: '#1677FF',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  flexShrink: 0,
                }}
                aria-hidden
              >
                {step.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 15 }}>
                  {step.title}
                </Text>
                <Text
                  type="secondary"
                  style={{ display: 'block', marginTop: 6, fontSize: 12, lineHeight: 1.7 }}
                >
                  {step.description}
                </Text>
              </div>
            </Space>
            {idx < STEPS.length - 1 && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  right: -10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#1677FF',
                  fontSize: 18,
                  pointerEvents: 'none',
                }}
              />
            )}
          </Card>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setStep1Open(true)}>
          创建
        </Button>
      </div>

      <Table<AgentRow>
        rowKey="appId"
        size="middle"
        pagination={false}
        dataSource={agents}
        columns={columns}
        scroll={{ x: true }}
      />

      {/* 第一步：选择模态 + 智能体名称 */}
      <CreateAgentStep1Modal
        open={step1Open}
        onCancel={() => setStep1Open(false)}
        onSubmit={handleStep1Submit}
      />

      {/* 第二步：智能体编辑页（创建 / 配置） */}
      <Drawer
        open={step2Open}
        onClose={closeStep2}
        placement="right"
        width="50vw"
        mask={false}
        destroyOnHidden
        closeIcon={<CloseOutlined aria-label="关闭编辑抽屉" />}
        title={editingAgent ? '配置审核智能体' : '创建审核智能体'}
      >
        <CreateAgentForm
          submitting={creating}
          onCancel={closeStep2}
          onSubmit={handleCreateOrUpdate}
          aiDrawerOpen={aiDrawerOpen}
          onAiDrawerOpenChange={setAiDrawerOpen}
          initialName={
            editingAgent
              ? editingAgent.name
              : step1Payload
                ? step1Payload.name
                : undefined
          }
          initialModality={
            editingAgent
              ? (['文本', '图像', '图文'].includes(editingAgent.modality)
                  ? (editingAgent.modality as Step1Modality)
                  : '图文')
              : step1Payload
                ? step1Payload.modality
                : undefined
          }
        />
      </Drawer>
    </div>
  )
}

function RenamePopoverContent({
  initial,
  onConfirm,
}: {
  initial: string
  onConfirm: (value: string) => boolean
}) {
  const [val, setVal] = useState(initial)
  useEffect(() => {
    setVal(initial)
  }, [initial])

  return (
    <div style={{ width: 220 }}>
      <div style={{ marginBottom: 8 }}>重命名</div>
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        maxLength={64}
        autoFocus
        onPressEnter={() => onConfirm(val)}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <Button
          size="small"
          type="primary"
          onClick={() => onConfirm(val)}
        >
          确定
        </Button>
      </div>
    </div>
  )
}