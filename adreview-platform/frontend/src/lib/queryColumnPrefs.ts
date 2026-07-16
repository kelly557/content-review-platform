import {
  DEFAULT_VISIBLE_COLUMNS,
  QUERY_COLUMNS_SCHEMA_VERSION,
  type QueryColumnKey,
} from '@/types/domain'

const COL_STORAGE_KEY = 'adreview.query.visibleColumns'
const VALID_KEYS = new Set<string>(
  Object.keys({
    task_title: 1,
    strategy_name: 1,
    machine_decision: 1,
    feedback: 1,
    material_type: 1,
    request_id: 1,
    task_id: 1,
    labels: 1,
    risk_level: 1,
    requested_at: 1,
    ip: 1,
    account_id: 1,
    content_preview: 1,
  } as Record<QueryColumnKey, number>),
)

interface StoredPrefs {
  version: number
  cols: QueryColumnKey[]
}

export function loadVisibleColumns(): QueryColumnKey[] {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY)
    if (raw === null) return DEFAULT_VISIBLE_COLUMNS
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>
    if (parsed.version !== QUERY_COLUMNS_SCHEMA_VERSION) {
      localStorage.removeItem(COL_STORAGE_KEY)
      return DEFAULT_VISIBLE_COLUMNS
    }
    const cols = Array.isArray(parsed.cols) ? parsed.cols.filter((k) => VALID_KEYS.has(k)) : []
    return cols.length ? cols : DEFAULT_VISIBLE_COLUMNS
  } catch {
    return DEFAULT_VISIBLE_COLUMNS
  }
}

export function saveVisibleColumns(cols: QueryColumnKey[]): void {
  try {
    const payload: StoredPrefs = { version: QUERY_COLUMNS_SCHEMA_VERSION, cols }
    localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* ignore quota errors */
  }
}