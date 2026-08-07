import { Form, Switch, Alert } from 'antd'
import { useAuthStore } from '@/store'

interface PlatformToggleProps {
  /** 自定义描述文本。默认「通用平台库」。 */
  label?: string
  /** 开关关闭态文案。默认「个性化」。 */
  uncheckedLabel?: string
}

/**
 * 「通用平台库」开关:仅在当前用户为 superadmin 时显示。
 *
 * 服务端会兜底守卫:非超管即使带 true 也会被 422 拒绝;
 * 这里只对超管开放,避免给其他用户提示「可设置但提交会被拒」。
 */
export default function PlatformToggle({
  label = '通用平台库',
  uncheckedLabel = '个性化',
}: PlatformToggleProps) {
  const { user } = useAuthStore()
  if (user?.role !== 'superadmin') return null
  return (
    <>
      <Form.Item
        name="is_platform"
        label={label}
        valuePropName="checked"
        tooltip="勾选后,此库对普通用户不可见,仅超级管理员可查看/编辑/删除"
        initialValue={false}
      >
        <Switch checkedChildren="通用平台" unCheckedChildren={uncheckedLabel} />
      </Form.Item>
      <Form.Item shouldUpdate={(p, c) => p.is_platform !== c.is_platform} noStyle>
        {({ getFieldValue }) =>
          getFieldValue('is_platform') ? (
            <Alert
              type="warning"
              showIcon
              message="设为通用平台库后,普通用户将无法看到此库;其他角色的编辑/删除权限会被锁定。"
              style={{ marginBottom: 12 }}
            />
          ) : null
        }
      </Form.Item>
    </>
  )
}