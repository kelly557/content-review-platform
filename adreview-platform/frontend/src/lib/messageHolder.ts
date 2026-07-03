/**
 * Global message holder so non-component code (axios interceptors) can call
 * AntD's contextual message API without importing the static version.
 *
 * The <App /> wrapper in main.tsx registers itself on mount via
 * registerMessage; the api interceptor then calls the registered instance.
 */
import type { MessageInstance } from 'antd/es/message/interface'

let instance: MessageInstance | null = null

export function registerMessage(msg: MessageInstance) {
  instance = msg
}

export function getMessage(): MessageInstance {
  if (!instance) {
    // 静默 fallback 到 console 避免递归报警
    return {
      success: (m: string) => console.log('[success]', m),
      error: (m: string) => console.error('[error]', m),
      info: (m: string) => console.info('[info]', m),
      warning: (m: string) => console.warn('[warning]', m),
      loading: (m: string) => console.log('[loading]', m),
    } as unknown as MessageInstance
  }
  return instance
}
