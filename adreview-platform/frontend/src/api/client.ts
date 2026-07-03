/**
 * API client (axios) with token interceptor + error normalization.
 */
import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'
import { getMessage } from '@/lib/messageHolder'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

const TOKEN_KEY = 'adreview.token'
const REFRESH_KEY = 'adreview.refresh'
const EXPIRES_KEY = 'adreview.token_expires_at'

/** 7 天免登录 — 前后端一致（后端 jwt_access_ttl_min = 60*24*7） */
export const LOGIN_TTL_DAYS = 7

export const tokenStore = {
  get access() { return localStorage.getItem(TOKEN_KEY) },
  get refresh() { return localStorage.getItem(REFRESH_KEY) },
  /** token 过期时间（ms epoch），null 表示无记录 */
  get expiresAt() {
    const v = localStorage.getItem(EXPIRES_KEY)
    return v ? Number(v) : null
  },
  isValid() {
    const exp = this.expiresAt
    if (!exp) return false
    return Date.now() < exp
  },
  set(access: string, refresh: string, ttlDays: number = LOGIN_TTL_DAYS) {
    localStorage.setItem(TOKEN_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
    localStorage.setItem(EXPIRES_KEY, String(Date.now() + ttlDays * 24 * 60 * 60 * 1000))
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(EXPIRES_KEY)
  },
}

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
})

api.interceptors.request.use((config) => {
  const token = tokenStore.access
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

interface ApiErrorBody {
  detail?: string | { msg: string }[]
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const msg = getMessage()
    if (error.response) {
      const { status, data } = error.response
      const detail = typeof data?.detail === 'string' ? data.detail : null
      if (status === 401 || !tokenStore.isValid()) {
        tokenStore.clear()
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login'
        }
      } else if (status === 403) {
        msg.error(detail || '没有权限执行此操作')
      } else if (status >= 500) {
        msg.error('服务异常，请稍后重试')
      } else if (detail) {
        msg.error(detail)
      }
    } else if (error.code === 'ECONNABORTED') {
      msg.error('请求超时')
    } else {
      msg.error('网络错误')
    }
    return Promise.reject(error)
  },
)
