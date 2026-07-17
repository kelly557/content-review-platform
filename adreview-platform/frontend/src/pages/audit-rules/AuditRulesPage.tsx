/**
 * 统一图片/文本审核规则 Tab 容器。
 *
 * - 一个页面承载两个 Tab：系统规则 / 自定义规则 Agent
 * - 超级管理员可见两个 Tab；其他用户仅可见「自定义规则 Agent」Tab
 * - 仅一个 Tab 时不渲染 Tab 头部
 * - 当前 Tab 通过 ?tab= 同步到 URL，便于刷新/分享
 *
 * URL:
 *   /rules/audit/image  （图片）
 *   /rules/audit/text   （文本）
 *   ?tab=system | ?tab=agent
 */
import { useEffect, useMemo, useState } from 'react'
import { App, Breadcrumb, Button, Modal, Form, Input, Select, Space, Tabs, Tag, Typography } from 'antd'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store'
import { isSuperadminOnly } from '@/lib/permissions'
import { auditItemsApi } from '@/api/auditItems'
import GeneralRuleListPage from '@/pages/rules/GeneralRuleListPage'
import PersonalRuleListPage from '@/pages/rules/PersonalRuleListPage'
import type { MediaTypeKey } from '@/types/domain'

const { Title } = Typography
const { TextArea } = Input

type MediaType = 'image' | 'text'

const MEDIA_LABEL: Record<MediaType, string> = {
  image: '图片',
  text: '文本',
}

const PACKAGE_BY_MEDIA: Record<MediaType, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
}

type TabKey = 'system' | 'agent'

function useTabFromUrl(allowed: TabKey[], defaultTab: TabKey): [TabKey, (k: TabKey) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('tab') as TabKey | null
  const tab: TabKey = raw && allowed.includes(raw) ? raw : defaultTab
  const setTab = (k: TabKey) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', k)
    setSearchParams(next, { replace: true })
  }
  return [tab, setTab]
}

export default function AuditRulesPage() {
  const { mediaType = 'image' } = useParams<{ mediaType: MediaType }>()
  const { user } = useAuthStore()
  const { message } = App.useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()
  const [creating, setCreating] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const isSuperadmin = isSuperadminOnly(user?.role)
  const allowed: TabKey[] = isSuperadmin ? ['system', 'agent'] : ['agent']
  const defaultTab: TabKey = isSuperadmin ? 'system' : 'agent'
  const [activeTab, setActiveTab] = useTabFromUrl(allowed, defaultTab)

  const mediaKey = mediaType as MediaType
  const mediaKeyForApi = mediaType as MediaTypeKey
  const pkg = PACKAGE_BY_MEDIA[mediaKey]

  const handleCreate = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setCreating(true)
    try {
      await auditItemsApi.create(pkg, {
        name_cn: values.name_cn,
        aliases: values.aliases ?? [],
        description: values.description,
      })
      message.success('已创建审核 Agent')
      form.resetFields()
      setCreateOpen(false)
      setReloadKey((k) => k + 1)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '创建失败')
    } finally {
      setCreating(false)
    }
  }

  // 角色越权 fallback：普通用户在 system tab 时纠正到 agent
  useEffect(() => {
    if (!isSuperadmin && activeTab === 'system') {
      message.warning('仅超级管理员可查看「系统规则」')
      setActiveTab('agent')
    }
  }, [isSuperadmin, activeTab, message, setActiveTab])

  const tabItems = useMemo(
    () =>
      allowed.map((k) => ({
        key: k,
        label: k === 'system' ? '系统规则' : '自定义规则 Agent',
      })),
    [allowed],
  )

  const mediaLabel = MEDIA_LABEL[mediaKey] ?? mediaType

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/strategies">策略中心</Link> },
          { title: '审核策略' },
          { title: mediaLabel },
        ]}
      />
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
            {mediaLabel}
          </Title>
          <Tag color={activeTab === 'system' ? 'blue' : 'green'}>
            {activeTab === 'system' ? '系统规则' : '自定义规则 Agent'}
          </Tag>
        </Space>
        {activeTab === 'agent' && (
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            + 新增审核 Agent
          </Button>
        )}
      </div>

      {tabItems.length > 1 && (
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
          items={tabItems.map((it) => ({ key: it.key, label: it.label }))}
          destroyOnHidden={false}
        />
      )}

      <div style={{ marginTop: tabItems.length > 1 ? 8 : 0 }} key={reloadKey}>
        {activeTab === 'system' && isSuperadmin && (
          <GeneralRuleListPage embedded mediaTypeProp={mediaKeyForApi} />
        )}
        {activeTab === 'agent' && (
          <PersonalRuleListPage embedded mediaTypeProp={mediaKeyForApi} />
        )}
      </div>

      <Modal
        title="新增审核 Agent"
        open={createOpen}
        onCancel={() => {
          if (creating) return
          form.resetFields()
          setCreateOpen(false)
        }}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ aliases: [] }}>
          <Form.Item
            name="name_cn"
            label="Agent 名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如：涉政检测" maxLength={64} />
          </Form.Item>
          <Form.Item name="aliases" label="别名">
            <Select
              mode="tags"
              placeholder="按回车添加别名"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <TextArea rows={3} placeholder="描述该 Agent 的审核范围" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}