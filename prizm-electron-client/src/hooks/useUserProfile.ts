/**
 * 用户画像（显示名称、希望的语气）— 从服务端获取并可在设置中更新
 */
import { useState, useEffect, useCallback } from 'react'
import type { UserProfile } from '@prizm/client-core'
import { usePrizmContext } from '../context/PrizmContext'

export function useUserProfile(): {
  profile: UserProfile | null
  loading: boolean
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>
  refresh: () => Promise<void>
} {
  const { manager } = usePrizmContext()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const http = manager?.getHttpClient?.() ?? null

  const fetchProfile = useCallback(async () => {
    if (!http?.getUserProfile) {
      setProfile(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const p = await http.getUserProfile()
      setProfile(p ?? null)
    } catch {
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [http])

  useEffect(() => {
    void fetchProfile()
  }, [fetchProfile])

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>) => {
      if (!http?.updateUserProfile) return
      const updated = await http.updateUserProfile(patch)
      setProfile(updated ?? null)
    },
    [http]
  )

  return { profile, loading, updateProfile, refresh: fetchProfile }
}
