import type { Tenant, TenantCreateInput, TenantUpdateInput } from '@/types/tenant'
import type {
  ApiKey,
  ApiKeyCreateInput,
  ApiKeyCreated,
  ApiKeyListParams,
} from '@/types/apiKey'
import { deriveKeyStatus } from '@/types/apiKey'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function randomBase62(len: number): string {
  let out = ''
  const arr = new Uint32Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) {
    out += BASE62[arr[i] % 62]
  }
  return out
}

function genKeyPlaintext(): { plaintext: string; prefix: string } {
  const secret = randomBase62(22)
  const plaintext = `adr_${secret}`
  const prefix = plaintext.slice(0, 16)
  return { plaintext, prefix }
}

function delay(ms = 200): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isoMinusDays(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
}
function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
}

const tenants: Tenant[] = [
  {
    id: 'tnt_acme',
    code: 'acme',
    name: 'Acme 投放',
    contact_email: 'ops@acme.example.com',
    is_active: true,
    created_at: isoMinusDays(30),
  },
  {
    id: 'tnt_globex',
    code: 'globex',
    name: 'Globex 集团',
    contact_email: 'admin@globex.example.com',
    is_active: true,
    created_at: isoMinusDays(20),
  },
  {
    id: 'tnt_default',
    code: 'default',
    name: '默认租户 (历史)',
    contact_email: '',
    is_active: false,
    created_at: isoMinusDays(60),
  },
]

const keys: ApiKey[] = [
  {
    id: 'key_1',
    tenant_id: 'tnt_acme',
    name: '投放后台-生产',
    description: '广告投放系统调用审核 API',
    key_prefix: 'adr_a1b2c3d4e5f6g7',
    scope: 'read',
    created_by: 'admin@example.com',
    expires_at: isoPlusDays(300),
    revoked_at: null,
    last_used_at: isoMinusDays(0),
    created_at: isoMinusDays(15),
  },
  {
    id: 'key_2',
    tenant_id: 'tnt_acme',
    name: '投放后台-测试',
    description: '测试环境联调',
    key_prefix: 'adr_x9y8z7w6v5u4t3',
    scope: 'write',
    created_by: 'admin@example.com',
    expires_at: isoPlusDays(60),
    revoked_at: null,
    last_used_at: isoMinusDays(0),
    created_at: isoMinusDays(10),
  },
  {
    id: 'key_3',
    tenant_id: 'tnt_globex',
    name: '内容中台-读',
    description: '内容中台只读访问',
    key_prefix: 'adr_7k3m2n9p8q7r6s',
    scope: 'read',
    created_by: 'admin@example.com',
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: isoMinusDays(8),
  },
  {
    id: 'key_4',
    tenant_id: 'tnt_globex',
    name: '数据同步-旧',
    description: '已废弃的数据同步任务',
    key_prefix: 'adr_5p2q9r8s7t6u5v',
    scope: 'write',
    created_by: 'admin@example.com',
    expires_at: isoPlusDays(90),
    revoked_at: isoMinusDays(3),
    last_used_at: isoMinusDays(5),
    created_at: isoMinusDays(40),
  },
  {
    id: 'key_5',
    tenant_id: 'tnt_acme',
    name: '即将过期-演示',
    description: '演示用，3 天后过期',
    key_prefix: 'adr_zzz9yyyyxxxxww',
    scope: 'read',
    created_by: 'admin@example.com',
    expires_at: isoPlusDays(3),
    revoked_at: null,
    last_used_at: isoMinusDays(1),
    created_at: isoMinusDays(25),
  },
]

let nextTenantId = 100
let nextKeyId = 100

const USER_TENANT_MAP_KEY = 'adreview.userTenantMap'

const SEED_USER_TENANT_MAP: Record<number, string> = {
  1: 'tnt_acme',
  2: 'tnt_acme',
  3: 'tnt_globex',
  4: 'tnt_globex',
  5: 'tnt_default',
  6: 'tnt_default',
  7: 'tnt_globex',
  11: 'tnt_acme',
  12: 'tnt_globex',
}

function loadUserTenantMap(): Map<number, string> {
  try {
    const raw = localStorage.getItem(USER_TENANT_MAP_KEY)
    if (!raw) {
      const m = new Map<number, string>(Object.entries(SEED_USER_TENANT_MAP).map(([k, v]) => [Number(k), v]))
      saveUserTenantMap(m)
      return m
    }
    const obj = JSON.parse(raw) as Record<string, string>
    return new Map<number, string>(Object.entries(obj).map(([k, v]) => [Number(k), v]))
  } catch {
    return new Map<number, string>(Object.entries(SEED_USER_TENANT_MAP).map(([k, v]) => [Number(k), v]))
  }
}

function saveUserTenantMap(m: Map<number, string>): void {
  try {
    const obj: Record<string, string> = {}
    m.forEach((v, k) => { obj[String(k)] = v })
    localStorage.setItem(USER_TENANT_MAP_KEY, JSON.stringify(obj))
  } catch {
    // localStorage 不可用时静默降级（隐私模式等）
  }
}

const userTenantMap = loadUserTenantMap()

export const apiKeyMock = {
  getTenantByIdSync(id: string): Tenant | undefined {
    return tenants.find((t) => t.id === id)
  },

  getUserTenant(userId: number): string {
    return userTenantMap.get(userId) ?? 'tnt_default'
  },

  setUserTenant(userId: number, tenantId: string): void {
    userTenantMap.set(userId, tenantId)
    saveUserTenantMap(userTenantMap)
  },

  async listTenants(): Promise<Tenant[]> {
    await delay()
    return tenants.map((t) => ({
      ...t,
      key_count: keys.filter((k) => k.tenant_id === t.id).length,
      user_count: Array.from(userTenantMap.values()).filter((tid) => tid === t.id).length,
    }))
  },

  async createTenant(input: TenantCreateInput): Promise<Tenant> {
    await delay()
    if (tenants.some((t) => t.code === input.code)) {
      throw new Error(`租户 code "${input.code}" 已存在`)
    }
    const t: Tenant = {
      id: `tnt_${nextTenantId++}`,
      code: input.code,
      name: input.name,
      contact_email: input.contact_email,
      is_active: true,
      created_at: new Date().toISOString(),
    }
    tenants.push(t)
    return { ...t, key_count: 0, user_count: 0 }
  },

  async updateTenant(id: string, input: TenantUpdateInput): Promise<Tenant> {
    await delay()
    const idx = tenants.findIndex((t) => t.id === id)
    if (idx < 0) throw new Error('租户不存在')
    tenants[idx] = { ...tenants[idx], ...input }
    return {
      ...tenants[idx],
      key_count: keys.filter((k) => k.tenant_id === id).length,
      user_count: Array.from(userTenantMap.values()).filter((tid) => tid === id).length,
    }
  },

  async listKeys(params: ApiKeyListParams = {}): Promise<ApiKey[]> {
    await delay()
    let list = [...keys]
    if (params.tenant_id) list = list.filter((k) => k.tenant_id === params.tenant_id)
    if (params.scope) list = list.filter((k) => k.scope === params.scope)
    if (params.status) list = list.filter((k) => deriveKeyStatus(k) === params.status)
    if (params.q) {
      const q = params.q.toLowerCase()
      list = list.filter(
        (k) =>
          k.name.toLowerCase().includes(q) ||
          (k.description ?? '').toLowerCase().includes(q) ||
          k.key_prefix.toLowerCase().includes(q),
      )
    }
    return list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  },

  async createKey(input: ApiKeyCreateInput): Promise<ApiKeyCreated> {
    await delay()
    const { plaintext, prefix } = genKeyPlaintext()
    const now = new Date().toISOString()
    const k: ApiKey = {
      id: `key_${nextKeyId++}`,
      tenant_id: input.tenant_id,
      name: input.name,
      description: input.description,
      key_prefix: prefix,
      scope: input.scope,
      created_by: 'admin@example.com',
      expires_at: input.expires_at,
      revoked_at: null,
      last_used_at: null,
      created_at: now,
    }
    keys.push(k)
    return { ...k, plaintext }
  },

  async revokeKey(id: string): Promise<ApiKey> {
    await delay()
    const idx = keys.findIndex((k) => k.id === id)
    if (idx < 0) throw new Error('API Key 不存在')
    if (keys[idx].revoked_at) throw new Error('API Key 已撤销')
    keys[idx] = { ...keys[idx], revoked_at: new Date().toISOString() }
    return keys[idx]
  },

  async rotateKey(id: string): Promise<ApiKeyCreated> {
    await delay()
    const idx = keys.findIndex((k) => k.id === id)
    if (idx < 0) throw new Error('API Key 不存在')
    if (keys[idx].revoked_at) throw new Error('API Key 已撤销，无法轮换')
    keys[idx] = { ...keys[idx], revoked_at: new Date().toISOString() }
    const old = keys[idx]
    const { plaintext, prefix } = genKeyPlaintext()
    const now = new Date().toISOString()
    const fresh: ApiKey = {
      id: `key_${nextKeyId++}`,
      tenant_id: old.tenant_id,
      name: old.name,
      description: old.description,
      key_prefix: prefix,
      scope: old.scope,
      created_by: 'admin@example.com',
      expires_at: old.expires_at,
      revoked_at: null,
      last_used_at: null,
      created_at: now,
    }
    keys.push(fresh)
    return { ...fresh, plaintext }
  },
}
