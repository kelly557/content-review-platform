export interface AgentVersionSnapshot {
  modality: '文本' | '图像' | '图文'
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

export interface AgentVersionStore {
  versions: Record<string, AgentVersion[]>
}

const STORAGE_KEY = 'adreview.agent.versions'

function readStore(): AgentVersionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { versions: {} }
    const parsed = JSON.parse(raw) as AgentVersionStore
    return parsed && typeof parsed === 'object' && parsed.versions ? parsed : { versions: {} }
  } catch {
    return { versions: {} }
  }
}

function writeStore(store: AgentVersionStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // ignore quota errors in prototype
  }
}

function normalizeVersions(list: AgentVersion[]): AgentVersion[] {
  if (list.length === 0) return list
  const needsNormalize = list.some((v) => !v.version.startsWith('v'))
  if (!needsNormalize) return list
  const sorted = [...list].sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1))
  return sorted.map((v, idx) => ({ ...v, version: `v${idx + 1}` }))
}

export function listVersions(agentId: string): AgentVersion[] {
  const store = readStore()
  const raw = store.versions[agentId] ?? []
  const normalized = normalizeVersions(raw)
  if (normalized !== raw) {
    store.versions[agentId] = normalized
    writeStore(store)
  }
  return [...normalized].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
}

export function publishVersion(
  agentId: string,
  snapshot: AgentVersionSnapshot,
): AgentVersion {
  const store = readStore()
  const raw = store.versions[agentId] ?? []
  const list = normalizeVersions(raw)
  const ts = new Date()
  const nextSeq = list.length + 1
  const newVersion: AgentVersion = {
    id: `v-${nextSeq}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    version: `v${nextSeq}`,
    status: 'published',
    isCurrent: false,
    publishedAt: formatDate(ts),
    snapshot,
  }
  const next = list.map((v) => ({ ...v, isCurrent: false }))
  next.push(newVersion)
  newVersion.isCurrent = true
  store.versions[agentId] = next
  writeStore(store)
  return newVersion
}

export function unpublishCurrent(agentId: string): AgentVersion | null {
  const store = readStore()
  const list = store.versions[agentId] ?? []
  if (list.length === 0) return null
  const current = list.find((v) => v.isCurrent) ?? null
  const next = list.map((v) => ({ ...v, isCurrent: false }))
  store.versions[agentId] = next
  writeStore(store)
  return current
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function formatDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}