import { reviewAgentsApi, type ReviewAgentVersion } from './reviewAgents'

export interface AgentVersionSnapshot {
  modality: '文本' | '图片' | '图文'
  name: string
  modelId: string
  points: { id: string; label: string; desc: string }[]
}

export interface AgentVersion {
  id: string
  agentId: string
  version: string
  status: 'published'
  isCurrent: boolean
  publishedAt: string
  snapshot: AgentVersionSnapshot
}

function _map(v: ReviewAgentVersion): AgentVersion {
  return {
    id: String(v.id),
    agentId: String(v.agent_id),
    version: v.version,
    status: 'published',
    isCurrent: v.is_current,
    publishedAt: v.published_at,
    snapshot: (v.snapshot as AgentVersionSnapshot) ?? {
      modality: '文本',
      name: '',
      modelId: '',
      points: [],
    },
  }
}

// agentId 为后端数值 id 的字符串形式
export async function listVersions(agentId: string): Promise<AgentVersion[]> {
  const list = await reviewAgentsApi.listVersions(Number(agentId))
  return list.map(_map).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
}

export async function publishVersion(
  agentId: string,
  snapshot: AgentVersionSnapshot,
): Promise<AgentVersion> {
  const v = await reviewAgentsApi.publish(Number(agentId), snapshot)
  return _map(v)
}

export async function unpublishCurrent(agentId: string): Promise<AgentVersion | null> {
  const v = await reviewAgentsApi.unpublish(Number(agentId))
  return _map(v)
}
