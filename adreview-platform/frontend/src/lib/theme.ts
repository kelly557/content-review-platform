/**
 * Editorial design tokens — a restrained palette for the "审核任务" surface.
 * Use semantic names; do not reference raw hex from components.
 */

export const palette = {
  bg: '#FAFAF9', // stone-50
  surface: '#FFFFFF',
  surfaceAlt: '#F5F5F4', // stone-100
  border: '#E7E5E4', // stone-200
  borderStrong: '#D6D3D1', // stone-300
  ink: '#1C1917', // stone-900 — primary text
  inkMuted: '#57534E', // stone-600 — secondary
  inkSubtle: '#A8A29E', // stone-400 — captions
  accent: '#1F1B2E', // near-black indigo — primary CTA
  accentSoft: '#EDE9FE', // violet-100 — selected chip
  accentInk: '#3B0764', // violet-950 — selected label
  success: '#166534',
  warning: '#9A3412',
  danger: '#991B1B',
} as const

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
} as const

export const shadow = {
  card: '0 1px 0 0 rgba(28,25,23,0.04), 0 1px 2px 0 rgba(28,25,23,0.04)',
  soft: '0 1px 2px rgba(28,25,23,0.05)',
} as const

export const font = {
  serif: `'Source Serif Pro', 'Source Han Serif SC', 'Noto Serif CJK SC', Georgia, 'Times New Roman', serif`,
  sans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`,
  mono: `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`,
} as const
