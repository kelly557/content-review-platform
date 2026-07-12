import { useEffect, useState } from 'react'
import { Alert, Modal, Space, Switch, Typography, App } from 'antd'
import { librariesApi } from '@/api/libraries'
import type { Library } from '@/types/domain'
import { useAuthStore } from '@/store'

const { Text } = Typography

interface EditPlatformToggleModalProps {
  open: boolean
  library: Library | null
  onClose: () => void
  onSuccess: (updated: Library) => void
}

export default function EditPlatformToggleModal({
  open,
  library,
  onClose,
  onSuccess,
}: EditPlatformToggleModalProps) {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const [saving, setSaving] = useState(false)
  const [targetValue, setTargetValue] = useState<boolean>(false)

  useEffect(() => {
    if (open && library) {
      setTargetValue(!!library.is_platform)
    }
  }, [open, library])

  if (!library) return null
  if (user?.role !== 'superadmin') return null

  const isChanging = targetValue !== library.is_platform

  const submit = async () => {
    if (!isChanging) {
      onClose()
      return
    }
    setSaving(true)
    try {
      const updated = await librariesApi.update(library.id, {
        is_platform: targetValue,
      })
      message.success(targetValue ? '已设为通用平台库' : '已改为个性化库')
      onSuccess(updated as Library)
      onClose()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`切换「${library.name}」归属`}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onCancel={onClose}
      onOk={submit}
      okButtonProps={{ disabled: !isChanging, danger: targetValue }}
      destroyOnHidden
      width={520}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Switch
            checked={targetValue}
            onChange={setTargetValue}
            checkedChildren="通用平台"
            unCheckedChildren="个性化"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前:{library.is_platform ? '通用平台库' : '个性化库'}
            {isChanging
              ? ` → 将切换为:${targetValue ? '通用平台库' : '个性化库'}`
              : ''}
          </Text>
        </Space>
        {targetValue && (
          <Alert
            type="warning"
            showIcon
            message="设为通用平台库后,普通用户将无法看到此库;其他角色的编辑/删除权限会被锁定。"
          />
        )}
        {!targetValue && library.is_platform && (
          <Alert
            type="info"
            showIcon
            message="改为个性化库后,所有用户都能看到并使用此库;引用关系不变。"
          />
        )}
      </Space>
    </Modal>
  )
}