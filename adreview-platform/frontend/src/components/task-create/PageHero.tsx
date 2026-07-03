import { Button, Space, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { palette, font } from '@/lib/theme'

const { Title, Text } = Typography

export interface PageHeroProps {
  eyebrow?: string
  title: string
  subtitle?: string
  onBack: () => void
  rightExtra?: React.ReactNode
}

export default function PageHero({ eyebrow, title, subtitle, onBack, rightExtra }: PageHeroProps) {
  return (
    <div
      style={{
        position: 'relative',
        padding: '40px 32px 32px',
        marginBottom: 24,
        background: `linear-gradient(135deg, ${palette.bg} 0%, ${palette.surfaceAlt} 100%)`,
        borderBottom: `1px solid ${palette.border}`,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      {/* 装饰色条 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 96,
          height: 4,
          background: palette.accent,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -120,
          top: -120,
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${palette.accentSoft} 0%, transparent 70%)`,
          opacity: 0.55,
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 24 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={onBack}
          style={{
            borderRadius: 999,
            border: `1px solid ${palette.border}`,
            background: palette.surface,
          }}
        >
          返回
        </Button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow && (
            <div
              style={{
                fontFamily: font.sans,
                fontSize: 11,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: palette.inkMuted,
                marginBottom: 8,
                fontWeight: 500,
              }}
            >
              {eyebrow}
            </div>
          )}
          <Title
            level={1}
            style={{
              fontFamily: font.serif,
              fontWeight: 600,
              fontSize: 36,
              lineHeight: 1.15,
              margin: 0,
              color: palette.ink,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </Title>
          {subtitle && (
            <Text
              style={{
                display: 'block',
                marginTop: 8,
                color: palette.inkMuted,
                fontSize: 14,
                lineHeight: 1.6,
                maxWidth: 640,
              }}
            >
              {subtitle}
            </Text>
          )}
        </div>
        {rightExtra && <Space>{rightExtra}</Space>}
      </div>
    </div>
  )
}
