/**
 * 统一图片/文本审核规则 Tab 容器。
 *
 * - 一个页面承载两个 Tab：系统规则 / 自定义 Agent
 * - 超级管理员可见两个 Tab；其他用户仅可见「自定义 Agent」Tab
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

  const isSuperadmin = isSuperadminOnly(user?.role)
  const allowed: TabKey[] = isSuperadmin ? ['system', 'agent'] : ['agent']
  const defaultTab: TabKey = isSuperadmin ? 'system' : 'agent'
  const [activeTab, setActiveTab] = useTabFromUrl(allowed, defaultTab)

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
        label: k === 'system' ? '系统规则' : '自定义 Agent',
      })),
    [allowed],
  )

  const mediaLabel = MEDIA_LABEL[mediaType as MediaType] ?? mediaType
  const mediaKey = mediaType as MediaTypeKey

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/strategies">策略中心</Link> },
          { title: '审核策略' },
          { title: `${mediaLabel}审核规则` },
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
            {mediaLabel}审核规则
          </Title>
          <Tag color={activeTab === 'system' ? 'blue' : 'green'}>
            {activeTab === 'system' ? '系统规则' : '自定义 Agent'}
          </Tag>
        </Space>
      </div>

      {tabItems.length > 1 && (
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
          items={tabItems.map((it) => ({ key: it.key, label: it.label }))}
          destroyInactiveTabPane={false}
        />
      )}

      <div style={{ marginTop: tabItems.length > 1 ? 8 : 0 }}>
        {activeTab === 'system' && isSuperadmin && (
          <GeneralRuleListPage embedded mediaTypeProp={mediaKey} />
        )}
        {activeTab === 'agent' && (
          <PersonalRuleListPage embedded mediaTypeProp={mediaKey} />
        )}
      </div>
    </div>
  )
}