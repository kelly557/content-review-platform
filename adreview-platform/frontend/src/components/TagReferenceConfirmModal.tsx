// 标签被引用清单二次确认弹窗 — 顶层 Modal,触发于 TagsAdminPage 列表行
// 的「停用 / 删除」按钮之前。
// 用法:
//   TagReferenceConfirmModal.open({ refs, onForceDelete: async () => {...} })
import { useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Alert, Button, Modal, Space, Tag as AntdTag, Typography } from 'antd'
import {
  ApiOutlined,
  AuditOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import type { TagReferences } from '@/types/domain'

const { Text } = Typography

type Opts = {
  refs: TagReferences
  /** 当 can_delete=true(理论上不触发此弹窗)时提供强删入口;默认无 */
  onForceDelete?: () => Promise<void>
  /** 弹窗标题;默认根据 scope 推断 */
  title?: string
  /**
   * 引用范围决定底部提示文案与默认标题:
   * - 'strategy':只检查审核策略引用(关闭启用场景),提示文案只提"审核策略"
   * - 'all':检查所有引用(删除场景),提示文案"审核策略"+"模型管理"
   * 默认 'all'
   */
  scope?: 'strategy' | 'all'
}

interface OpenState {
  opts: Opts
  resolver: () => void
}

let hostEl: HTMLDivElement | null = null
let hostRoot: Root | null = null
let currentState: OpenState | null = null
let renderTick = 0

export const TagReferenceConfirmModal = {
  /**
   * 打开引用确认弹窗。
   * 返回 Promise<void>:用户点「取消」或「我已知晓,仍然删除」完成后 resolve。
   */
  open(opts: Opts): Promise<void> {
    ensureHost()
    return new Promise<void>((resolve) => {
      currentState = { opts, resolver: resolve }
      renderTick++
      rerender()
    })
  },
}

function ensureHost() {
  if (hostEl && hostRoot) return
  hostEl = document.createElement('div')
  hostEl.id = 'tag-reference-confirm-host'
  document.body.appendChild(hostEl)
  hostRoot = createRoot(hostEl)
}

function rerender() {
  if (!hostRoot) return
  hostRoot.render(<DialogHost />)
}

function close() {
  if (currentState) {
    currentState.resolver()
    currentState = null
    renderTick++
    rerender()
  }
}

function DialogHost() {
  // 用 renderTick 让 React 知道需要重新订阅
  void renderTick
  if (!currentState) return null
  return <Dialog opts={currentState.opts} onClose={close} />
}

interface DialogProps {
  opts: Opts
  onClose: () => void
}

function Dialog({ opts, onClose }: DialogProps) {
  const { refs, onForceDelete, title, scope = 'all' } = opts
  const [confirming, setConfirming] = useState(false)
  const [forceVisible, setForceVisible] = useState(false)

  useEffect(() => {
    if (refs.can_delete && onForceDelete) {
      setForceVisible(true)
    }
  }, [refs.can_delete, onForceDelete])

  const handleForce = async () => {
    if (!onForceDelete) {
      onClose()
      return
    }
    setConfirming(true)
    try {
      await onForceDelete()
      onClose()
    } catch {
      // 错误已被调用方 toast,这里不处理;保持弹窗打开
    } finally {
      setConfirming(false)
    }
  }

  const defaultTitle =
    scope === 'strategy'
      ? '该标签被启用的审核策略引用,无法停用'
      : '该标签存在引用,无法删除'
  const hintMessage =
    scope === 'strategy'
      ? '请先在「审核策略」中解除对本标签的引用,然后再回来执行此操作。'
      : '请先在「审核策略」或「模型管理」中解除对本标签的引用,然后再回来执行此操作。'

  return (
    <Modal
      open
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#faad14' }} />
          {title ?? defaultTitle}
        </Space>
      }
      onCancel={onClose}
      footer={
        forceVisible ? (
          [
            <Button key="cancel" onClick={onClose}>
              取消
            </Button>,
            <Button
              key="force"
              danger
              loading={confirming}
              onClick={handleForce}
            >
              我已知晓,仍然删除
            </Button>,
          ]
        ) : (
          <Button onClick={onClose}>取消</Button>
        )
      }
      width={560}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">标签:&nbsp;</Text>
          <Text strong>{refs.tag_path}</Text>
        </div>

        {refs.strategies.length > 0 && (
          <div>
            <Space style={{ marginBottom: 8 }}>
              <AuditOutlined />
              <Text strong>审核策略 ({refs.strategies.length})</Text>
            </Space>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {refs.strategies.map((s) => (
                <div
                  key={s.strategy_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: '#fafafa',
                    borderRadius: 4,
                  }}
                >
                  <Space>
                    <Text>{s.strategy_name}</Text>
                    <AntdTag color={s.status === 'active' ? 'green' : 'default'}>
                      {s.status === 'active' ? '启用中' : '已停用'}
                    </AntdTag>
                  </Space>
                  {s.services.length > 0 && (
                    <Text type="secondary">服务: {s.services.join(' / ')}</Text>
                  )}
                </div>
              ))}
            </Space>
          </div>
        )}

        {refs.models.length > 0 && (
          <div>
            <Space style={{ marginBottom: 8 }}>
              <ApiOutlined />
              <Text strong>绑定模型 ({refs.models.length})</Text>
            </Space>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {refs.models.map((m) => (
                <div
                  key={m.model_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: '#fafafa',
                    borderRadius: 4,
                  }}
                >
                  <Text>{m.model_name}</Text>
                  {m.model_version && <AntdTag>{m.model_version}</AntdTag>}
                </div>
              ))}
            </Space>
          </div>
        )}

        <Alert
          type="info"
          showIcon
          message={hintMessage}
        />
      </Space>
    </Modal>
  )
}