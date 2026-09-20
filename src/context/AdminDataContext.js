import { createContext, useContext } from 'react'

export const AdminDataContext = createContext(null)

export function useAdminData() {
  const ctx = useContext(AdminDataContext)
  if (!ctx) throw new Error('useAdminData must be used within AdminLayout')
  return ctx
}
