export type CategoryKey = 'image' | 'text' | 'audio' | 'doc' | 'video'

export type MediaType = CategoryKey

export interface CategoryDef {
  key: CategoryKey
  label: string
  /** 直接属于本审核类型的场景分类。空数组表示本类型不单独配置，从合成类型复用。 */
  categoryNames: string[]
  /** 合成来源：本类型由其它类型的规则组合而成时，引用这些类型的 key。 */
  composesFrom?: CategoryKey[]
  /** 是否启用「从合成来源复制规则」动作。 */
  allowCopyFromSources?: boolean
  /** 命名提示：在文案中显示「由 X 与 Y 合成」之类说明。 */
  description?: string
}

export const MEDIA_TYPE_LABELS: Record<CategoryKey, string> = {
  image: '图片审核',
  text: '文本审核',
  audio: '语音审核',
  doc: '文档审核',
  video: '视频审核',
}

export const CATEGORIES: CategoryDef[] = [
  {
    key: 'image',
    label: MEDIA_TYPE_LABELS.image,
    categoryNames: ['特殊场景'],
  },
  {
    key: 'text',
    label: MEDIA_TYPE_LABELS.text,
    categoryNames: ['通用场景', '业务场景'],
  },
  {
    key: 'audio',
    label: MEDIA_TYPE_LABELS.audio,
    categoryNames: [],
    composesFrom: ['text'],
    allowCopyFromSources: true,
    description: '语音审核可复用「文本审核」规则，或独立设置。',
  },
  {
    key: 'doc',
    label: MEDIA_TYPE_LABELS.doc,
    categoryNames: [],
    composesFrom: ['text', 'image'],
    allowCopyFromSources: true,
    description: '文档审核由「文本审核」与「图片审核」规则组合而成。',
  },
  {
    key: 'video',
    label: MEDIA_TYPE_LABELS.video,
    categoryNames: [],
    composesFrom: ['image', 'audio'],
    allowCopyFromSources: true,
    description: '视频审核由「图片审核」与「语音审核」规则组合而成。',
  },
]

export const MEDIA_TYPE_ORDER: CategoryKey[] = ['image', 'text', 'audio', 'doc', 'video']

export const MEDIA_TYPE_KEYS = new Set<CategoryKey>(['image', 'text', 'audio', 'doc', 'video'])

export function isMediaType(value: string | undefined): value is CategoryKey {
  return !!value && MEDIA_TYPE_KEYS.has(value as CategoryKey)
}

export function findCategory(key: CategoryKey): CategoryDef {
  const c = CATEGORIES.find((x) => x.key === key)
  if (!c) {
    return { key, label: MEDIA_TYPE_LABELS[key] ?? key, categoryNames: [] }
  }
  return c
}

export function expandCategoryNames(key: CategoryKey): string[] {
  const cat = findCategory(key)
  if (cat.categoryNames.length > 0) return cat.categoryNames
  if (!cat.composesFrom?.length) return []
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (k: CategoryKey) => {
    const c = findCategory(k)
    if (c.categoryNames.length > 0) {
      c.categoryNames.forEach((n) => {
        if (!seen.has(n)) {
          seen.add(n)
          out.push(n)
        }
      })
      return
    }
    if (c.composesFrom?.length) {
      c.composesFrom.forEach(walk)
    }
  }
  cat.composesFrom.forEach(walk)
  return out
}
