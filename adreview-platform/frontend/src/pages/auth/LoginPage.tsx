import { useState } from 'react'
import { Form, Input, Button, Card, Typography, Alert, Space, Tooltip } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store'
import { DEV_ACCOUNTS, IS_DEV, type DevAccount } from '@/lib/devAccounts'

const { Title, Text } = Typography

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, login, loading, initialized } = useAuthStore()
  const [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm<{ identifier: string; password: string }>()

  if (initialized && user) {
    if (user.role === 'superadmin' || user.role === 'root_admin') {
      return <Navigate to="/admin/tenants" replace />
    }
    return <Navigate to="/overview" replace />
  }

  const onFinish = async (values: { identifier: string; password: string }) => {
    setError(null)
    try {
      const { user } = useAuthStore.getState()
      await login(values)
      const u = useAuthStore.getState().user ?? user
      if (u && (u.role === 'superadmin' || u.role === 'root_admin')) {
        navigate('/admin/tenants', { replace: true })
      } else {
        navigate('/overview', { replace: true })
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || '登录失败，请检查用户名和密码')
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

          <Form form={form} layout="vertical" onFinish={onFinish} autoComplete="off" requiredMark={false}>
            <Form.Item
              label="用户名"
              name="identifier"
              rules={[
                { required: true, message: '请输入用户名或邮箱' },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="用户名或邮箱" size="large" />
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

          {IS_DEV && (
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                开发环境快速填充（点击角色填充表单）
              </Text>
              <Space wrap size={[8, 8]}>
                {DEV_ACCOUNTS.map((acc: DevAccount) => (
                  <Tooltip
                    key={acc.role}
                    title={`${acc.identifier} / ${acc.password}`}
                  >
                    <Button
                      size="small"
                      onClick={() => {
                        form.setFieldsValue({
                          identifier: acc.identifier,
                          password: acc.password,
                        })
                      }}
                    >
                      {acc.label}
                    </Button>
                  </Tooltip>
                ))}
              </Space>
            </div>
          )}
        </Space>
      </Card>
    </div>
  )
}
