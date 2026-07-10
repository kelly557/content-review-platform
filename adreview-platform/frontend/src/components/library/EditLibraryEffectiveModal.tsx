import { useState } from 'react'
import {
  DatePicker,
  Form,
  Modal,
  Radio,
  Typography,
  App,
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { librariesApi } from '@/api/libraries'
import type { Library } from '@/types/domain'

const { Text } = Typography

interface EditEffectiveModalProps {
  open: boolean
  library: Library | null
  onClose: () => void
  onSuccess: (updated: Library) => void
}

interface FormValues {
  durationMode: 'permanent' | 'range'
  effectiveRange?: [Dayjs, Dayjs]
}

export default function EditLibraryEffectiveModal({
  open,
  library,
  onClose,
  onSuccess,
}: EditEffectiveModalProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)

  if (!library) return null

  const hasRange = !!(
    library.effective_from || library.effective_until
  )
  const initialMode: 'permanent' | 'range' = hasRange ? 'range' : 'permanent'
  const initialRange: [Dayjs, Dayjs] | undefined =
    hasRange
      ? [
          library.effective_from ? dayjs(library.effective_from) : dayjs(),
          library.effective_until ? dayjs(library.effective_until) : dayjs(),
        ]
      : undefined

  const submit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    const hasRange =
      v.durationMode === 'range' &&
      v.effectiveRange &&
      v.effectiveRange.length === 2
    setSaving(true)
    try {
      const updated = await librariesApi.update(library.id, {
        effective_from: hasRange ? v.effectiveRange![0].toISOString() : null,
        effective_until: hasRange ? v.effectiveRange![1].toISOString() : null,
      })
      message.success(
        hasRange ? '已更新有效时间' : '已恢复永久有效',
      )
      onSuccess(updated as Library)
      onClose()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={
        library.library_type === 'reply'
          ? '编辑有效时间（代答库不支持）'
          : `编辑「${library.name}」的有效时间`
      }
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onCancel={onClose}
      onOk={submit}
      destroyOnHidden
      width={520}
    >
      {library.library_type === 'reply' ? (
        <Text type="secondary">代答库不支持有效时间设置。</Text>
      ) : (
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{
            durationMode: initialMode,
            effectiveRange: initialRange,
          }}
        >
          <Form.Item
            name="durationMode"
            label="有效时间"
            rules={[{ required: true, message: '请选择' }]}
          >
            <Radio.Group buttonStyle="solid">
              <Radio.Button value="permanent">永久</Radio.Button>
              <Radio.Button value="range">自定义区间</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            shouldUpdate={(prev, cur) => prev.durationMode !== cur.durationMode}
            noStyle
          >
            {({ getFieldValue }) =>
              getFieldValue('durationMode') === 'range' ? (
                <Form.Item
                  name="effectiveRange"
                  label="起止时间"
                  rules={[
                    { required: true, message: '请选择起止时间' },
                    {
                      validator: async (_r, value: [Dayjs, Dayjs] | undefined) => {
                        if (!value || value.length !== 2) return
                        if (!value[0].isBefore(value[1])) {
                          throw new Error('起始时间必须早于结束时间')
                        }
                      },
                    },
                  ]}
                >
                  <DatePicker.RangePicker
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                    placeholder={['起始', '结束']}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  选「永久」保存后将清除现有区间，词库一直生效。
                </Text>
              )
            }
          </Form.Item>
        </Form>
      )}
    </Modal>
  )
}
