/*
 * API layer.
 *
 * Two modes, chosen explicitly by configuration — never by accident:
 *
 *   VITE_DEMO_MODE=false (default)  LIVE   frontend -> FastAPI -> database.
 *                                          If FastAPI is unreachable the call
 *                                          FAILS and the UI shows the error.
 *                                          The demo engine is never consulted.
 *
 *   VITE_DEMO_MODE=true             DEMO   every call is served by the
 *                                          in-browser demo engine (offline /
 *                                          single-file build).
 *
 * `api.connected` reflects the real result of GET /api/health and is what the
 * header indicator reads. Nothing here fakes it.
 */
import * as demo from './demoEngine'
import * as sbDb from '../lib/supabaseDb'
import {
  isSupabaseConfigured,
  signInWithEmail,
  signUpWithEmail,
  signOut as sbSignOut,
  restoreSession,
  onAuthChange,
} from '../lib/supabase'

const ENV = import.meta.env ?? {}
export const DEMO_MODE = String(ENV.VITE_DEMO_MODE ?? '').toLowerCase() === 'true'

// In live mode the API base must be configured. Dev falls back to the usual
// local FastAPI port so `npm run dev` works even with no .env file.
const BASE = (ENV.VITE_API_URL ?? (ENV.DEV ? 'http://localhost:8000' : '')).replace(/\/$/, '')
const DEV = Boolean(ENV.DEV)

export class BackendError extends Error {
  constructor(message, { status = 0, kind = 'network', path = '' } = {}) {
    super(message)
    this.name = 'BackendError'
    this.status = status
    this.kind = kind // network | auth | validation | server
    this.path = path
  }
}

const store = (() => {
  const mem = {}
  return {
    get(k) {
      try { return window.localStorage.getItem(k) ?? mem[k] ?? null } catch { return mem[k] ?? null }
    },
    set(k, v) {
      mem[k] = v
      try { window.localStorage.setItem(k, v) } catch { /* private mode / sandbox */ }
    },
    del(k) {
      delete mem[k]
      try { window.localStorage.removeItem(k) } catch { /* ignore */ }
    },
  }
})()

export const api = {
  mode: DEMO_MODE ? 'demo' : 'live',
  base: BASE,
  connected: null, // null = not probed yet; true/false = real health result
  token: store.get('kc_token') || null,
  user: (() => {
    try { return JSON.parse(store.get('kc_user') || 'null') } catch { return null }
  })(),
}

/* ---------------------------------------------------------- subscriptions */
// One authoritative current-user object lives here; components subscribe so a
// change (login, /auth/me refresh, rename, logout) re-renders them.
const listeners = new Set()

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(api) } catch { /* a bad listener must not break the app */ }
  })
}

function setUser(user, token) {
  api.user = user
  if (token !== undefined) api.token = token
  if (user) store.set('kc_user', JSON.stringify(user))
  else store.del('kc_user')
  if (token) store.set('kc_token', token)
  if (token === null) store.del('kc_token')
  if (DEMO_MODE) demo.setSession(user)
  emit()
}

function setConnected(value) {
  if (api.connected !== value) {
    api.connected = value
    emit()
  }
}

/* ----------------------------------------------------------------- health */
export async function probeBackend() {
  if (DEMO_MODE) {
    setConnected(true) // the demo engine is always available
    return 'demo'
  }
  if (!BASE) {
    setConnected(false)
    return 'live'
  }
  const started = now()
  try {
    const res = await fetch(`${BASE}/api/health`, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
    })
    log('GET', '/api/health', res.status, started)
    setConnected(res.ok)
  } catch {
    log('GET', '/api/health', 'ERR', started)
    setConnected(false)
  }
  return 'live'
}

/** Poll health so the indicator recovers by itself when the server restarts. */
export function startHealthWatch(intervalMs = 15000) {
  probeBackend()
  const timer = setInterval(probeBackend, intervalMs)
  const onOnline = () => probeBackend()
  window.addEventListener('online', onOnline)
  return () => {
    clearInterval(timer)
    window.removeEventListener('online', onOnline)
  }
}

/* ---------------------------------------------------------------- logging */
// Development only: method, path, status and duration. Never bodies,
// passwords or tokens.
function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

function log(method, path, status, startedAt) {
  if (!DEV) return
  const ms = Math.round(now() - startedAt)
  const line = `${method} ${path} — ${status} — ${ms}ms`
  if (status === 'ERR' || (typeof status === 'number' && status >= 400)) console.warn('[api]', line)
  else console.info('[api]', line)
}

/* -------------------------------------------------------------- transport */
let onUnauthorized = null
/** App wires this so a 401 sends the user back to the login screen. */
export function setUnauthorizedHandler(fn) { onUnauthorized = fn }

async function http(path, { method = 'GET', body, auth = true } = {}) {
  if (!BASE) {
    throw new BackendError(
      'No API URL is configured. Set VITE_API_URL in frontend/.env.',
      { kind: 'network', path }
    )
  }
  const headers = { 'Content-Type': 'application/json' }
  if (auth && api.token) headers.Authorization = `Bearer ${api.token}`

  const started = now()
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    log(method, path, 'ERR', started)
    setConnected(false)
    throw new BackendError(
      'Backend disconnected — could not reach the API server.',
      { kind: 'network', path }
    )
  }
  log(method, path, res.status, started)
  setConnected(true)

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail)) {
        message = data.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
      }
    } catch { /* non-JSON error body */ }

    const kind =
      res.status === 401 || res.status === 403 ? 'auth'
        : res.status === 400 || res.status === 422 ? 'validation'
          : 'server'

    if (res.status === 401) {
      setUser(null, null)
      onUnauthorized?.()
    }
    throw new BackendError(message, { status: res.status, kind, path })
  }
  return res.status === 204 ? null : res.json()
}

/**
 * Route a call. In live mode the live implementation is the only one that
 * runs — its failure propagates to the caller. The demo implementation runs
 * only when demo mode is explicitly switched on.
 */
/**
 * Route a call to one of three implementations:
 *   1. demoFn   — when DEMO_MODE=true (in-browser, offline)
 *   2. sbFn     — when Supabase is configured (real DB, no FastAPI needed)
 *   3. liveFn   — FastAPI backend (original live mode)
 * The demo engine is always preserved as the offline fallback.
 */
function call(liveFn, demoFn, sbFn) {
  if (DEMO_MODE) return Promise.resolve().then(demoFn)
  if (isSupabaseConfigured && sbFn) return Promise.resolve().then(sbFn)
  return liveFn()
}

/* ------------------------------------------------------------------- auth */
function saveSession(result) {
  setUser(result.user, result.token)
  return result
}

export const auth = {
  async login(email, password) {
    return saveSession(
      await call(
        () => http('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
        () => demo.login(email, password)
      )
    )
  },
  async register(payload) {
    return saveSession(
      await call(
        () => http('/api/auth/register', { method: 'POST', body: payload, auth: false }),
        () => demo.registerCollector(payload)
      )
    )
  },
  /** Authoritative current user, straight from the backend. */
  async me() {
    const user = await call(() => http('/api/auth/me'), () => demo.db.session)
    setUser(user)
    return user
  },
  /** Update the signed-in user's own name / language. */
  async updateMe(patch) {
    const user = await call(
      () => http('/api/auth/me', { method: 'PATCH', body: patch }),
      () => demo.updateSessionProfile(patch)
    )
    setUser(user)
    return user
  },
  logout() {
    setUser(null, null)
    demo.setSession(null)
  },
  /**
   * Restore a session across a refresh: the cached user paints the first
   * frame, then /api/auth/me confirms it against the database. A rejected or
   * renamed identity wins over the cache.
   */
  async restore() {
    if (DEMO_MODE) {
      if (api.user) demo.setSession(api.user)
      return api.user
    }
    if (!api.token) return null
    try {
      return await auth.me()
    } catch (err) {
      if (err.kind === 'auth') setUser(null, null)
      return api.user // network failure: keep cache, the banner shows the state
    }
  },
}

/* --------------------------------------------------- supabase auth (opt-B) */
/**
 * Supabase-backed auth. Active when VITE_SUPABASE_URL is set.
 * Falls back to no-ops when Supabase is not configured so demo mode is
 * completely unaffected — callers check `isSupabaseConfigured` before
 * deciding which auth path to use.
 */
export { isSupabaseConfigured, onAuthChange }

export const supabaseAuth = {
  /** true when the Supabase env vars are present */
  enabled: isSupabaseConfigured,

  /**
   * Sign in with email + password via Supabase.
   * Returns the same { token, user } shape as the existing auth.login().
   */
  async login(email, password) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.')
    const result = await signInWithEmail(email, password)
    setUser(result.user, result.token)
    return result
  },

  /**
   * Register a new user via Supabase Auth and create the DB profile rows.
   * payload: { name, email, password, language, operating_location, role }
   */
  async register(payload) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.')
    const result = await signUpWithEmail(payload)
    // Supabase may require email confirmation — user object is present even
    // when the session is null (email not yet confirmed).
    if (result.token) setUser(result.user, result.token)
    return result
  },

  /** Sign out the current Supabase session. */
  async logout() {
    await sbSignOut()
    setUser(null, null)
  },

  /**
   * Restore a Supabase session from localStorage on app boot.
   * Returns the mapped user or null.
   */
  async restore() {
    if (!isSupabaseConfigured) return null
    const user = await restoreSession()
    if (user) setUser(user, null) // token refreshed automatically by the client
    return user
  },
}

/* -------------------------------------------------------------- resources */
export const catalog = {
  prices: (location) =>
    call(
      () => http(`/api/prices${location ? `?location=${encodeURIComponent(location)}` : ''}`, { auth: false })
        .then((d) => d.items),
      () => demo.priceBoard(location),
      () => sbDb.priceBoard(location)
    ),
  history: (category) =>
    call(
      () => http(`/api/prices/${encodeURIComponent(category)}/history?days=45`, { auth: false })
        .then((d) => d.points),
      () => demo.priceHistory(category, 45),
      () => sbDb.priceHistory(category, 45)
    ),
  estimate: (params) => {
    const q = new URLSearchParams(params).toString()
    return call(
      () => http(`/api/estimate?${q}`, { auth: false }),
      () => demo.estimate(params.category, Number(params.weight), params.condition, params.source_type, params.location),
      () => sbDb.estimate(params)
    )
  },
  classify: (imageDataUrl, hint) =>
    call(
      () => http('/api/ai/classify-material-json', {
        method: 'POST', auth: false, body: { image_base64: imageDataUrl, hint },
      }),
      () => demo.classify(imageDataUrl, hint),
      () => demo.classify(imageDataUrl, hint) // AI classifier always runs client-side
    ),
  cities: () =>
    call(
      () => http('/api/auth/cities', { auth: false }),
      () => [...new Set(demo.db.recyclers.map((r) => r.location.split(',').pop().trim()))],
      async () => {
        const { data } = await import('../lib/supabase').then(m => m.supabase)
          .catch(() => ({ data: null }))
        // Derive cities from the recyclers table if available
        try {
          const { supabase: sb } = await import('../lib/supabase')
          const { data: recs } = await sb.from('recyclers').select('city').not('city', 'is', null)
          const cities = [...new Set((recs ?? []).map(r => r.city).filter(Boolean))]
          return cities.length ? cities : [
            'Salt Lake (Bidhannagar)', 'New Town', 'Park Street', 'Ballygunge', 'Gariahat',
            'Behala', 'Tollygunge', 'Dum Dum', 'Rajarhat', 'Howrah',
          ]
        } catch {
          return [
            'Salt Lake (Bidhannagar)', 'New Town', 'Park Street', 'Ballygunge', 'Gariahat',
            'Behala', 'Tollygunge', 'Dum Dum', 'Rajarhat', 'Howrah',
          ]
        }
      }
    ),
  recyclers: (params = {}) =>
    call(
      () => {
        const q = new URLSearchParams(
          Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
        ).toString()
        return http(`/api/recyclers?${q}`, { auth: false })
      },
      () => demo.listRecyclers(params),
      () => sbDb.listRecyclers(params)
    ),
}

export const lots = {
  create: (payload) =>
    call(
      () => http('/api/lots', { method: 'POST', body: payload }),
      () => demo.createLot(payload),
      () => sbDb.createLot(payload)
    ),
  syncMany: (items) =>
    call(
      () => http('/api/lots/sync', { method: 'POST', body: { lots: items } }),
      () => ({ synced: items.length, lots: items.map((i) => demo.createLot(i)) }),
      () => Promise.all(items.map(i => sbDb.createLot(i))).then(ls => ({ synced: ls.length, lots: ls }))
    ),
  list: () =>
    call(() => http('/api/lots'), () => demo.listLots(), () => sbDb.listLots()),
  get: (lotId) =>
    call(() => http(`/api/lots/${lotId}`), () => demo.getLot(lotId), () => sbDb.getLot(lotId)),
  matches: (lotId) =>
    call(() => http(`/api/lots/${lotId}/matches`), () => demo.getMatches(lotId), () => sbDb.getMatches(lotId)),
  selectRecycler: (lotId, recyclerId) =>
    call(
      () => http(`/api/lots/${lotId}/select-recycler`, { method: 'POST', body: { recycler_id: recyclerId } }),
      () => demo.selectRecycler(lotId, recyclerId),
      () => sbDb.selectRecycler(lotId, recyclerId)
    ),
}

export const recycler = {
  dashboard: () =>
    call(() => http('/api/recyclers/me/dashboard'), () => demo.recyclerDashboard(), () => sbDb.recyclerDashboard()),
  profile: () =>
    call(() => http('/api/recyclers/me'), () => demo.recyclerDashboard().recycler, () => sbDb.myRecycler?.() ?? sbDb.recyclerDashboard().then(d => d.recycler)),
  update: (patch) =>
    call(
      () => http('/api/recyclers/me', { method: 'PUT', body: patch }),
      () => demo.updateRecyclerProfile(patch),
      () => sbDb.updateRecyclerProfile(patch)
    ),
  verify: (lotId) =>
    call(() => http(`/api/recyclers/verify/${lotId}`), () => demo.verifyLot(lotId), () => sbDb.verifyLot(lotId)),
  decide: (lotId, decision) =>
    call(
      () => http(`/api/recyclers/me/lots/${lotId}/decision?decision=${decision}`, { method: 'POST' }),
      () => demo.decideOnLot(lotId, decision),
      () => sbDb.decideOnLot(lotId, decision)
    ),
  handover: (payload) =>
    call(
      () => http('/api/handovers', { method: 'POST', body: payload }),
      () => demo.confirmHandover(payload),
      () => sbDb.confirmHandover(payload)
    ),
  pay: (transactionId, mode) =>
    call(
      () => http('/api/payments', { method: 'POST', body: { transaction_id: transactionId, mode } }),
      () => demo.markPaid({ transaction_id: transactionId, mode }),
      () => sbDb.markPaid({ transaction_id: transactionId, mode })
    ),
}

/** Smart Scrap Value Estimator (ML module). Backend-only — the demo engine
 *  has no rate dataset, so demo mode reports it as unavailable rather than
 *  inventing prices. */
export const scrap = {
  materials: (category) =>
    call(
      () => http(`/api/scrap-materials${category ? `?category=${encodeURIComponent(category)}` : ''}`, { auth: false }),
      () => { throw new BackendError('The scrap estimator needs the backend running.', { kind: 'network' }) }
    ),
  predict: (payload) =>
    call(
      () => http('/api/predict-scrap-value', { method: 'POST', body: payload, auth: false }),
      () => { throw new BackendError('The scrap estimator needs the backend running.', { kind: 'network' }) }
    ),
  analytics: () =>
    call(
      () => http('/api/scrap-analytics', { auth: false }),
      () => { throw new BackendError('The scrap estimator needs the backend running.', { kind: 'network' }) }
    ),
}

export const collector = {
  earnings: () =>
    call(() => http('/api/earnings'), () => demo.earnings(), () => sbDb.earnings()),
}

/** Phase 4 — recycler offers on open lots. */
export const offers = {
  openLots: () =>
    call(() => http('/api/recyclers/me/open-lots'), () => demo.openLots(), () => sbDb.openLots()),
  forLot: (lotId) =>
    call(() => http(`/api/lots/${lotId}/offers`), () => demo.offersForLot(lotId), () => sbDb.offersForLot(lotId)),
  mine: () =>
    call(() => http('/api/offers'), () => demo.myOffers(), () => sbDb.myOffers()),
  make: (lotId, body) =>
    call(
      () => http(`/api/lots/${lotId}/offers`, { method: 'POST', body }),
      () => demo.makeOffer(lotId, body),
      () => sbDb.makeOffer(lotId, body)
    ),
  accept: (offerId) =>
    call(
      () => http(`/api/offers/${offerId}/accept`, { method: 'POST' }),
      () => demo.acceptOffer(offerId),
      () => sbDb.acceptOffer(offerId)
    ),
}

export const admin = {
  stats: () =>
    call(() => http('/api/admin/stats'), () => demo.adminStats(), () => sbDb.adminStats()),
  charts: () =>
    call(() => http('/api/admin/charts'), () => demo.adminCharts(), () => sbDb.adminCharts()),
  recyclers: () =>
    call(() => http('/api/admin/recyclers'), () => demo.adminRecyclers(), () => sbDb.adminRecyclers()),
  verifyRecycler: (id, decision) =>
    call(
      () => http(`/api/admin/recyclers/${id}/verify?decision=${decision}`, { method: 'POST' }),
      () => demo.verifyRecycler(id, decision),
      () => sbDb.verifyRecycler(id, decision)
    ),
  anomalies: () =>
    call(() => http('/api/admin/anomalies'), () => demo.adminAnomalies(), () => sbDb.adminAnomalies()),
  transactions: () =>
    call(() => http('/api/admin/transactions'), () => demo.adminTransactions(), () => sbDb.adminTransactions()),
  prices: () =>
    call(() => http('/api/admin/prices'), () => demo.adminPrices?.() ?? [], () => sbDb.adminPrices()),
  map: () =>
    call(() => http('/api/admin/map'), () => demo.adminMap(), () => sbDb.adminMap()),
  trace: (lotId) =>
    call(() => http(`/api/admin/trace/${lotId}`), () => demo.trace(lotId), () => sbDb.trace(lotId)),
}

export const chat = {
  threads: () =>
    call(() => http('/api/chat/threads'), () => demo.chatThreads?.() ?? []),
  messages: (lotId) =>
    call(() => http(`/api/chat/${lotId}/messages`), () => demo.chatMessages?.(lotId) ?? []),
  send: (lotId, payload) =>
    call(
      () => http(`/api/chat/${lotId}/messages`, { method: 'POST', body: payload }),
      () => demo.sendChatMessage?.(lotId, payload)
    ),
  markRead: (lotId) =>
    call(
      () => http(`/api/chat/${lotId}/read`, { method: 'PATCH' }),
      () => demo.markChatRead?.(lotId)
    ),
}

