import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from '@/store'
import type { UserRole } from '@/types/auth'

export function ProtectedRoute({ allow }: { allow?: UserRole[] }) {
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
  if (allow && !allow.includes(user.role)) {
    return <Navigate to="/overview" replace />
  }
  return <Outlet />
}
