import { createContext, useContext } from 'react'

export const MemberDataContext = createContext(null)

export function useMemberData() {
  const ctx = useContext(MemberDataContext)
  if (!ctx) throw new Error('useMemberData must be used within MemberLayout')
  return ctx
}
