/**
 * supabase.js — Singleton Supabase client for Scrapswift.
 *
 * Usage:
 *   import { supabase, isSupabaseConfigured } from '../lib/supabase'
 *
 * In Option-B (layered) mode:
 *   - `isSupabaseConfigured` is true when VITE_SUPABASE_URL is set.
 *   - When false, all supabaseAuth calls are no-ops and the app falls back
 *     to the existing FastAPI JWT path.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/** True when the Supabase env vars are present — gates all Supabase code. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/**
 * Singleton client. Always safe to import — if Supabase is not configured,
 * the client is created with placeholder values and `isSupabaseConfigured`
 * will be false so callers skip the Supabase path entirely.
 */
export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      // Persist the session in localStorage so the user stays logged in
      // across page refreshes.
      persistSession: true,
      autoRefreshToken: true,
      // Use the hash-based router: store the token in localStorage, not the URL.
      detectSessionInUrl: false,
    },
  }
)

/* ------------------------------------------------------------------ helpers */

/**
 * Map a Supabase auth user + metadata into the same shape the existing
 * api.js `UserOut` / `auth.me()` response uses, so the rest of the app
 * doesn't need to know which auth backend answered.
 *
 * @param {import('@supabase/supabase-js').User | null} sbUser
 * @returns {object | null}
 */
export function mapSupabaseUser(sbUser) {
  if (!sbUser) return null
  const meta = sbUser.user_metadata ?? {}
  return {
    id: sbUser.id,                                     // UUID from Supabase Auth
    email: sbUser.email ?? '',
    role: meta.role ?? 'collector',
    name: meta.name ?? sbUser.email?.split('@')[0] ?? '',
    language: meta.language ?? 'hi',
    // profile_id / location come from the public.users / collectors tables;
    // they are fetched separately when needed. Set null here so the shape
    // matches UserOut without requiring an extra DB call at login time.
    profile_id: meta.profile_id ?? null,
    location: meta.operating_location ?? null,
    latitude: meta.latitude ?? null,
    longitude: meta.longitude ?? null,
  }
}

/**
 * Restore a session from localStorage (called on app boot).
 * Returns the mapped user or null.
 */
export async function restoreSession() {
  if (!isSupabaseConfigured) return null
  const { data: { session } } = await supabase.auth.getSession()
  return mapSupabaseUser(session?.user ?? null)
}

/**
 * Sign in with email + password.
 * Returns { user: MappedUser, token: string } to match the existing TokenOut shape.
 */
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  return {
    token: data.session?.access_token ?? '',
    user: mapSupabaseUser(data.user),
  }
}

/**
 * Sign up a new user.
 * `payload` matches RegisterIn: { name, email, password, language, operating_location, role }
 * Stores everything needed in user_metadata so mapSupabaseUser can reconstruct UserOut.
 */
export async function signUpWithEmail(payload) {
  const { name, email, password, language = 'hi', operating_location = 'Pune', role = 'collector' } = payload

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, role, language, operating_location },
    },
  })
  if (error) throw new Error(error.message)

  // Insert into public.users so the DB schema and RLS policies work.
  // This runs after the auth row is created. Ignore conflicts (idempotent).
  if (data.user) {
    const { error: dbErr } = await supabase.from('users').upsert({
      id: data.user.id,
      email: email.toLowerCase().trim(),
      role,
      name,
      language,
    }, { onConflict: 'id' })
    if (dbErr) console.warn('[supabase] public.users insert failed:', dbErr.message)

    // Create the collector profile row if role is collector.
    if (role === 'collector') {
      const { error: colErr } = await supabase.from('collectors').upsert({
        user_id: data.user.id,
        display_name: name,
        language,
        operating_location,
        latitude: payload.latitude ?? 0,
        longitude: payload.longitude ?? 0,
      }, { onConflict: 'user_id' })
      if (colErr) console.warn('[supabase] collectors insert failed:', colErr.message)
    }
  }

  return {
    token: data.session?.access_token ?? '',
    user: mapSupabaseUser(data.user),
  }
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  if (!isSupabaseConfigured) return
  await supabase.auth.signOut()
}

/**
 * Subscribe to auth state changes (LOGIN, LOGOUT, TOKEN_REFRESHED, etc.).
 * Returns the unsubscribe function.
 *
 * @param {(user: object|null) => void} callback
 */
export function onAuthChange(callback) {
  if (!isSupabaseConfigured) return () => {}
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(mapSupabaseUser(session?.user ?? null))
  })
  return () => subscription.unsubscribe()
}
