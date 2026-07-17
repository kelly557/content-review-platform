/**
 * 结构化 Prompt 编辑器（仅适用于 LLM 类文件）。
 *
 * - 单栏 Markdown 编辑器（CodeMirror, 无 lang，纯文本模式）
 * - 「仅保存」与「保存并重新解析」两个动作
 */
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Modal,
  Space,
  Spin,
  Typography,
} from 'antd'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'

import { uploadedDocumentsApi } from '@/api/uploadedDocuments'
import type { UploadedDocument } from '@/types/domain'

const { Text } = Typography

interface Props {
  open: boolean
  itemId: number
  packageCode: string
  document: UploadedDocument | null
  onClose: () => void
  onSaved: (doc: UploadedDocument) => void
}

export default function PromptEditorModal({
  open,
  itemId,
  packageCode,
  document,
  onClose,
  onSaved,
}: Props) {
  const { message, modal } = App.useApp()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const lastDocIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (open && document && document.id !== lastDocIdRef.current) {
      setValue(document.prompt_markdown ?? '')
      lastDocIdRef.current = document.id
    }
  }, [open, document])

  const handleSave = async (reparse: boolean) => {
    if (!document) return
    setSaving(true)
    try {
      const saved = await uploadedDocumentsApi.updatePrompt(
        packageCode,
        itemId,
        document.id,
        { prompt_markdown: value },
      )
      if (reparse) {
        const reparsed = await uploadedDocumentsApi.reparse(
          packageCode,
          itemId,
          document.id,
        )
        message.success('Prompt 已保存并触发重新解析')
        onSaved(reparsed)
      } else {
        message.success('Prompt 已保存')
        onSaved(saved)
      }
      onClose()
    } catch {
      // toast handled by interceptor
    } finally {
      setSaving(false)
    }
  }

  if (!document) return null

  return (
    <Modal
      open={open}
      onCancel={() => {
        if (saving) return
        onClose()
      }}
      title={`编辑 Prompt — ${document.original_filename}`}
      width={820}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={saving}>
          取消
        </Button>,
        <Button
          key="save"
          loading={saving}
          onClick={() => void handleSave(false)}
        >
          仅保存
        </Button>,
        <Button
          key="save-reparse"
          type="primary"
          loading={saving}
          onClick={() => {
            modal.confirm({
              title: '确认重新解析？',
              content:
                '该文件已生成的审核点将被清空，并使用最新 Prompt 重新解析。',
              okText: '确认',
              cancelText: '取消',
              onOk: () => void handleSave(true),
            })
          }}
        >
          保存并重新解析
        </Button>,
      ]}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Prompt 用于指导大模型从文档中提取审核点"
          description={
            <span>
              支持 Markdown；建议在「# 角色」段落描述专家身份，
              在「# 输出要求」段落说明 label_cn / scope_text 字段含义，
              并在「# 输出格式」段落给出 JSON 示例。
            </span>
          }
        />
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
          <CodeMirror
            value={value}
            onChange={setValue}
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
            extensions={[EditorView.lineWrapping]}
            height="420px"
            theme="light"
          />
        </div>
        {saving && (
          <div style={{ textAlign: 'center' }}>
            <Spin />
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {value.length} 字符
        </Text>
      </Space>
    </Modal>
  )
}