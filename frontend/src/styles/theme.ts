import { theme as antdTheme, type ThemeConfig } from 'antd'

/**
 * Design system: Trust & Authority (ui-ux-pro-max).
 * Source of truth for every color referenced from inline styles. The same
 * hex values are also exposed via CSS custom properties in
 * `frontend/src/styles/global.css`. Keep the two in lock-step when extending.
 *
 * - Primary:    #0F172A (navy)
 * - Accent:     #0369A1 (blue CTA)
 * - Danger:     #DC2626
 * - Surface:    #FFFFFF
 * - Surface-2:  #F8FAFC (secondary surface / cards)
 * - Text:       #020617
 * - Text muted: #64748B (label/secondary)
 * - Text soft:  #94A3B8 (timestamps, disabled-ish labels)
 * - Border:     #E2E8F0
 * - Border-2:   #CBD5E1
 * - Divider:    #F1F5F9 (row separator, lighter than border)
 * - Accent soft:  #F0F9FF (selection background, accent quote background)
 * - Danger soft:  #FEF2F2 (hit quote background)
 * - Success soft: #F0FDF4
 * - Warning soft: #FFFBEB
 * - Accent rgb: (3, 105, 161) - for rgba() helpers
 */
export const colors = {
  primary: '#0F172A',
  onPrimary: '#FFFFFF',
  secondary: '#334155',
  accent: '#0369A1',
  accentRgb: '3, 105, 161',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surface2: '#F8FAFC',
  foreground: '#020617',
  textSecondary: '#475569',
  muted: '#64748B',
  mutedSoft: '#94A3B8',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  divider: '#F1F5F9',
  accentSoft: '#F0F9FF',
  dangerSoft: '#FEF2F2',
  successSoft: '#F0FDF4',
  warningSoft: '#FFFBEB',
  destructive: '#DC2626',
  success: '#16A34A',
  warning: '#D97706',
  jsonString: '#B91C1C',
  jsonNumber: '#A16207',
  jsonBool: '#0D9488',
  jsonNull: '#94A3B8',
  jsonKey: '#0F172A',
  jsonMeta: '#94A3B8',
} as const

/**
 * Build an rgba() string from the accent color's RGB triplet.
 * Used by selection/citation overlays where 12% alpha is required
 * (see docs/design-system.md §5 "圈注").
 */
export function accentRgba(alpha: number): string {
  return `rgba(${colors.accentRgb}, ${alpha})`
}

export const theme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: colors.accent,
    colorInfo: colors.accent,
    colorSuccess: colors.success,
    colorError: colors.destructive,
    colorWarning: colors.warning,
    colorTextBase: colors.foreground,
    colorBgBase: colors.background,
    colorBgLayout: colors.background,
    colorBorder: colors.border,
    borderRadius: 6,
    fontFamily:
      'Roboto, "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
    lineHeight: 1.5,
  },
  components: {
    Layout: {
      headerBg: colors.primary,
      headerColor: colors.onPrimary,
      siderBg: colors.primary,
      bodyBg: colors.background,
    },
    Menu: {
      darkItemBg: colors.primary,
      darkItemSelectedBg: colors.accent,
      darkItemHoverBg: '#1E293B',
    },
    Button: {
      controlHeight: 36,
    },
  },
}
