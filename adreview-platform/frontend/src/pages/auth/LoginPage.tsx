import { useState } from 'react'
import { Form, Input, Button, Card, Typography, Alert, Space } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store'

const { Title, Text } = Typography

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, login, loading, initialized } = useAuthStore()
  const [error, setError] = useState<string | null>(null)

  if (initialized && user) {
    return <Navigate to="/overview" replace />
  }

  const onFinish = async (values: { email: string; password: string }) => {
    setError(null)
    try {
      await login(values)
      navigate('/overview', { replace: true })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || '登录失败，请检查邮箱和密码')
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0369A1 100%)',
        padding: 24,
      }}
    >
      <Card
        style={{ width: '100%', maxWidth: 420 }}
        styles={{ body: { padding: 32 } }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                background: '#0F172A',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 18,
                marginBottom: 12,
              }}
            >
              内审
            </div>
            <Title level={3} style={{ margin: 0 }}>
              内容安全审核管理平台
            </Title>
          </div>

          {error && <Alert type="error" message={error} showIcon />}

          <Form layout="vertical" onFinish={onFinish} autoComplete="off" requiredMark={false}>
            <Form.Item
              label="邮箱"
              name="email"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '请输入有效邮箱' },
              ]}
            >
              <Input prefix={<MailOutlined />} placeholder="you@company.com" size="large" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="••••••" size="large" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                登录
              </Button>
            </Form.Item>
          </Form>

          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              默认账号: rootadmin@adreview.example.com / superadmin@adreview.example.com / admin@adreview.example.com / reviewer@adreview.example.com / submitter@adreview.example.com
            </Text>
          </div>
        </Space>
      </Card>
    </div>
  )
}
