import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from '@/store'
import { isPlatformAdmin } from '@/lib/tenantAuth'
import type { UserRole } from '@/types/auth'

export function ProtectedRoute({
  allow,
  platformOnly,
}: {
  allow?: UserRole[]
  platformOnly?: boolean
}) {
  const { user, initialized, fetchMe } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (!initialized) fetchMe()
  }, [initialized, fetchMe])

  if (!initialized) {
    return <Spin style={{ display: 'block', margin: '20vh auto' }} />
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (platformOnly) {
    if (!isPlatformAdmin(user)) {
      return <Navigate to="/overview" replace />
    }
    return <Outlet />
  }

  if (allow) {
    if (user.role === 'root_admin') return <Outlet />
    const effectiveRole =
      user.role === 'superadmin' && !isPlatformAdmin(user)
        ? ('admin' as UserRole)
        : user.role
    if (!allow.includes(effectiveRole)) {
      return <Navigate to="/overview" replace />
    }
  }
  return <Outlet />
}
