import { theme as antdTheme, type ThemeConfig } from 'antd'

/**
 * Design system: Trust & Authority (ui-ux-pro-max).
 * - Primary:  #0F172A (navy)
 * - Accent:   #0369A1 (blue CTA)
 * - Danger:   #DC2626
 * - Surface:  #F8FAFC
 * - Text:     #020617
 */
export const colors = {
  primary: '#0F172A',
  onPrimary: '#FFFFFF',
  secondary: '#334155',
  accent: '#0369A1',
  background: '#F8FAFC',
  foreground: '#020617',
  muted: '#E8ECF1',
  border: '#E2E8F0',
  destructive: '#DC2626',
  success: '#16A34A',
  warning: '#D97706',
} as const

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
