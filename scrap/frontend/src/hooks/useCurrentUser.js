import { useEffect, useState } from 'react'
import { api, subscribe, onAuthChange, isSupabaseConfigured } from '../services/api'

/**
 * The one authoritative current-user source for components.
 *
 * `api.user` is the single stored identity (set by login, by /api/auth/me on
 * boot, and by a profile rename). This hook subscribes so any screen showing
 * the user's name re-renders the moment that identity changes.
 */
export function useCurrentUser() {
  const [user, setUser] = useState(api.user)
  useEffect(() => subscribe((next) => setUser(next.user)), [])
  return user
}

/** Real backend connection state: true, false, or null before the first probe. */
export function useBackendStatus() {
  const [connected, setConnected] = useState(api.connected)
  useEffect(() => subscribe((next) => setConnected(next.connected)), [])
  return connected
}

/**
 * Listens directly to Supabase auth state changes.
 * Returns the mapped user (same shape as UserOut) or null.
 *
 * Use this hook in components that need to react instantly to Supabase
 * LOGIN / LOGOUT / TOKEN_REFRESHED events. Falls back to useCurrentUser()
 * when Supabase is not configured.
 */
export function useSupabaseUser() {
  const fapiUser = useCurrentUser()
  const [sbUser, setSbUser] = useState(isSupabaseConfigured ? null : undefined)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    // Subscribe to real-time auth state from Supabase
    const unsub = onAuthChange((user) => setSbUser(user))
    return unsub
  }, [])

  // When Supabase is configured: return supabase user (may be null until restored)
  // When not configured: return the FastAPI-backed user seamlessly
  return isSupabaseConfigured ? sbUser : fapiUser
}
