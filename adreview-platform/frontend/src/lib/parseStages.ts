import type { WorkflowStagePayload } from '@/types/domain'

/**
 * Parse a natural-language description into structured review stages.
 *
 * Stage splitting:
 *   - "→" / "," / "然后" / "再" / "接着" / "之后" / "；" / "。" / line breaks
 *
 * Role inference (in priority order):
 *   - MLR / 合规 / 联合 / 专家 → role = 'mlr'
 *   - 管理员 / 主管 / admin / 总监 → role = 'admin'
 *   - otherwise → role = 'reviewer'
 *
 * Mode inference:
 *   - 会签 / 联合 / 多人 / 一起 / joint → mode = 'joint'
 *   - otherwise → mode = 'single'
 *
 * Stage name: takes the chunk verbatim, stripping separators and
 * trailing/leading whitespace. Empty chunks are skipped.
 */
export function parseStages(text: string): WorkflowStagePayload[] {
  if (!text) return []
  const tokens = text
    .split(/[→,\n，；。]|然后|接着|再|之后/g)
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return []
  return tokens.map((raw) => {
    let role = 'reviewer'
    if (/(MLR|合规|专家)/.test(raw)) {
      role = 'mlr'
    } else if (/(管理员|主管|总监|admin)/i.test(raw)) {
      role = 'admin'
    }
    let mode: 'single' | 'joint' = 'single'
    if (/(会签|联合|多人|一起|joint)/i.test(raw)) {
      mode = 'joint'
    }
    return { name: raw, role, mode }
  })
}
