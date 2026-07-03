import { create } from 'zustand'
import { authApi } from '@/api/auth'
import { tokenStore } from '@/api/client'
import type { LoginPayload, User } from '@/types/auth'

interface AuthState {
  user: User | null
  loading: boolean
  initialized: boolean
  error: string | null
  login: (payload: LoginPayload) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  initialized: false,
  error: null,

  async login(payload) {
    set({ loading: true, error: null })
    try {
      const tokens = await authApi.login(payload)
      tokenStore.set(tokens.access_token, tokens.refresh_token)
      const me = await authApi.me()
      set({ user: me, loading: false, initialized: true })
    } catch (e) {
      set({ loading: false, error: '登录失败' })
      throw e
    }
  },

  logout() {
    tokenStore.clear()
    set({ user: null })
  },

  async fetchMe() {
    if (!tokenStore.access || !tokenStore.isValid()) {
      tokenStore.clear()
      set({ user: null, initialized: true })
      return
    }
    try {
      const me = await authApi.me()
      set({ user: me, initialized: true })
    } catch {
      tokenStore.clear()
      set({ user: null, initialized: true })
    }
  },
}))
