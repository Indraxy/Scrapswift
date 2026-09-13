/**
 * supabaseDb.js — Real Supabase data layer for Scrapswift.
 *
 * Mirrors the demo engine's function signatures exactly so api.js can route
 * to this as a drop-in third path:
 *
 *   call(fastApiFn, demoFn, supabaseFn)
 *
 * Every function here talks directly to the Supabase database via the
 * authenticated client. RLS policies on each table enforce that users can
 * only see / write their own data.
 */
import { supabase } from './supabase'

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Return the signed-in Supabase user UUID, or null. */
async function uid() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

/** Fetch the collector profile row for the current user. */
async function myCollector() {
  const userId = await uid()
  if (!userId) throw new Error('Not logged in')
  const { data, error } = await supabase
    .from('collectors')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error || !data) throw new Error('Collector profile not found. Please log in again.')
  return data
}

/** Fetch the recycler profile row for the current user. */
async function myRecycler() {
  const userId = await uid()
  if (!userId) throw new Error('Not logged in')
  const { data, error } = await supabase
    .from('recyclers')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error || !data) throw new Error('Recycler profile not found. Please log in again.')
  return data
}

/** Append a status-change row to lot_events (fire-and-forget — never throws). */
async function addEvent(lotId, status, note = '', actor = 'system') {
  try {
    await supabase.from('lot_events').insert({ lot_id: lotId, status, note, actor })
  } catch { /* non-critical audit trail */ }
}

/** Haversine distance in km, rounded to 1 decimal. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10
}

/** Short random ID suffix for lot_id / reference_number. */
function randId(len = 6) {
  return Math.random().toString(36).substr(2, len).toUpperCase()
}

// ─── Static reference data ─────────────────────────────────────────────────────

const MATERIAL_ICONS = {
  PCB: '🔌', Cable: '🔗', Battery: '🔋', 'LCD/LED panel': '🖥️',
  CRT: '📺', 'Motor & magnet-bearing': '⚙️', 'Mixed plastic': '♻️', Other: '♻️',
}

/** Base buy rates (₹/kg) used when the prices table is empty. */
const BASE_RATES = {
  PCB: 150, Cable: 575, Battery: 130, 'LCD/LED panel': 75,
  CRT: 55, 'Motor & magnet-bearing': 120, 'Mixed plastic': 28, Other: 50,
}

const CONDITION_FACTOR = {
  good: 1, intact: 1, mixed: 0.92, partial: 0.92, damaged: 0.82, broken: 0.82,
}
const SOURCE_FACTOR = {
  household: 1, commercial: 1.03, industrial: 1.05, scrap_collection: 0.98,
  household_pickup: 1, office_clearance: 1.03, repair_shop: 0.98, bulk_tender: 1.02,
}

const MATCH_WEIGHTS = { authorization: 0.4, price: 0.25, distance: 0.15, pickup: 0.1, material: 0.1 }

// ─── Prices ───────────────────────────────────────────────────────────────────

/**
 * Price board for the Prices page and Home screen.
 * Queries the prices table; falls back to computed base rates when empty.
 */
export async function priceBoard(_location) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data: rows } = await supabase
    .from('prices')
    .select('material_category, buying_price, date')
    .gte('date', since)
    .order('date', { ascending: false })

  if (rows && rows.length > 0) {
    // Aggregate per category: min/max of the last 7 days.
    const byCategory = {}
    rows.forEach(r => {
      if (!byCategory[r.material_category]) byCategory[r.material_category] = []
      byCategory[r.material_category].push(r.buying_price)
    })
    // Also fetch 14-day-old data for trend calculation.
    const older = new Date(Date.now() - 21 * 86_400_000).toISOString()
    const { data: oldRows } = await supabase
      .from('prices')
      .select('material_category, buying_price, date')
      .lt('date', since)
      .gte('date', older)

    const oldByCategory = {}
    ;(oldRows ?? []).forEach(r => {
      if (!oldByCategory[r.material_category]) oldByCategory[r.material_category] = []
      oldByCategory[r.material_category].push(r.buying_price)
    })

    return Object.entries(byCategory).map(([category, prices]) => {
      const sorted = [...prices].sort((a, b) => a - b)
      const min_price = Math.round(sorted[0])
      const max_price = Math.round(sorted[sorted.length - 1])
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length
      const oldPrices = oldByCategory[category] ?? []
      let change_pct = 0
      let trend = 'stable'
      if (oldPrices.length) {
        const oldAvg = oldPrices.reduce((a, b) => a + b, 0) / oldPrices.length
        change_pct = Math.round(((avg - oldAvg) / oldAvg) * 1000) / 10
        trend = change_pct > 2.5 ? 'rising' : change_pct < -2.5 ? 'falling' : 'stable'
      }
      return { category, icon: MATERIAL_ICONS[category] ?? '♻️', unit: 'kg', min_price, max_price, trend, change_pct }
    })
  }

  // ── Fallback: base rates, no trend data ──────────────────────────────────────
  return Object.entries(BASE_RATES).map(([category, base]) => ({
    category, icon: MATERIAL_ICONS[category] ?? '♻️', unit: 'kg',
    min_price: Math.round(base * 0.9), max_price: Math.round(base * 1.1),
    trend: 'stable', change_pct: 0,
  }))
}

/**
 * 45-day price history for the chart on the Prices page.
 * Falls back to synthetic noise-over-base-rate when table is empty.
 */
export async function priceHistory(category, days = 45) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data: rows } = await supabase
    .from('prices')
    .select('date, buying_price')
    .eq('material_category', category)
    .gte('date', since)
    .order('date', { ascending: true })

  if (rows && rows.length > 0) {
    // Bucket by calendar day.
    const buckets = {}
    rows.forEach(r => {
      const key = r.date.slice(0, 10)
      if (!buckets[key]) buckets[key] = []
      buckets[key].push(r.buying_price)
    })
    return Object.entries(buckets).map(([date, prices]) => ({
      date,
      price: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 10) / 10,
    }))
  }

  // ── Fallback: deterministic synthetic history ────────────────────────────────
  const base = BASE_RATES[category] ?? 100
  // Use a seeded-like sequence so refresh doesn't flicker.
  let s = category.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
  return Array.from({ length: days + 1 }, (_, i) => {
    const date = new Date(Date.now() - (days - i) * 86_400_000).toISOString().slice(0, 10)
    return { date, price: Math.round(base * (0.92 + rng() * 0.16) * 10) / 10 }
  })
}

/**
 * Price estimate used by NewLot and Estimate pages.
 */
export async function estimate({ category, weight, condition = 'good', source_type = 'household' }) {
  const board = await priceBoard()
  const mat = board.find(m => m.category === category)
  const rateMin = mat?.min_price ?? Math.round((BASE_RATES[category] ?? 100) * 0.9)
  const rateMax = mat?.max_price ?? Math.round((BASE_RATES[category] ?? 100) * 1.1)
  const factor = (CONDITION_FACTOR[condition] ?? 1) * (SOURCE_FACTOR[source_type] ?? 1)
  return {
    estimated_min: Math.round(rateMin * weight * factor),
    estimated_max: Math.round(rateMax * weight * factor),
    rate_min: rateMin, rate_max: rateMax,
    trend: mat?.trend ?? 'stable', change_pct: mat?.change_pct ?? 0,
    condition_factor: Math.round(factor * 1000) / 1000,
    informal_estimate: Math.round(rateMax * weight * factor * 0.88),
  }
}

// ─── Recyclers ────────────────────────────────────────────────────────────────

/**
 * Public recycler list — used by the FindRecycler and Recyclers pages.
 * Returns verified recyclers; filtered by city if provided.
 */
export async function listRecyclers({ city, material } = {}) {
  let q = supabase
    .from('recyclers')
    .select('recycler_id,name,location,latitude,longitude,accepted_materials,authorization_id,authorization_status,contact,offered_rate,pickup_available,service_area_km,rating,city')
    .eq('authorization_status', 'verified')
  if (city) q = q.eq('city', city)
  const { data, error } = await q.order('rating', { ascending: false })
  if (error) throw new Error(error.message)
  // Normalise JSON columns that might come back as strings.
  return (data ?? []).map(normaliseRecycler)
}

function normaliseRecycler(r) {
  return {
    ...r,
    accepted_materials: parseJson(r.accepted_materials, []),
    offered_rate: parseJson(r.offered_rate, {}),
  }
}

function parseJson(val, fallback) {
  if (Array.isArray(val) || (val && typeof val === 'object')) return val
  try { return JSON.parse(val) } catch { return fallback }
}

// ─── Lots ─────────────────────────────────────────────────────────────────────

/**
 * Create a new lot in the database for the current collector.
 * Computes the estimate, inserts the lot row, and writes two audit events.
 */
export async function createLot(payload) {
  const collector = await myCollector()
  const est = await estimate({
    category: payload.material_category, weight: payload.weight,
    condition: payload.condition, source_type: payload.source_type,
  })
  const lotId = `KC-${new Date().getFullYear()}-${randId(6)}`
  const { data, error } = await supabase.from('lots').insert({
    lot_id: lotId,
    collector_id: collector.collector_id,
    material_category: payload.material_category,
    material_code: payload.material_code ?? '',
    sub_category: payload.sub_category ?? '',
    city: (collector.operating_location ?? '').split(',').pop().trim(),
    input_method: payload.input_method ?? 'photo',
    voice_transcript: payload.voice_transcript ?? '',
    created_offline: payload.created_offline ?? false,
    description: payload.description ?? '',
    photo: payload.photo ?? '',
    weight: payload.weight,
    condition: payload.condition ?? 'good',
    source_type: payload.source_type ?? 'household',
    estimated_min: est.estimated_min,
    estimated_max: est.estimated_max,
    quoted_price: 0,
    ai_prediction: payload.ai_prediction ?? {},
    location: payload.location || collector.operating_location,
    latitude: payload.latitude ?? collector.latitude ?? 0,
    longitude: payload.longitude ?? collector.longitude ?? 0,
    status: 'LOT_CREATED',
    client_ref: payload.client_ref ?? '',
  }).select().single()

  if (error) throw new Error(error.message)
  await addEvent(lotId, 'LOT_CREATED', `${payload.weight} kg ${payload.material_category}`, collector.display_name)
  await addEvent(lotId, 'PRICE_ESTIMATED', `₹${est.estimated_min} – ₹${est.estimated_max}`)
  return data
}

/**
 * List all lots belonging to the current collector, newest first.
 */
export async function listLots() {
  const collector = await myCollector()
  const { data, error } = await supabase
    .from('lots')
    .select(`
      lot_id, material_category, weight, condition, source_type,
      estimated_min, estimated_max, quoted_price, status,
      location, photo, created_at, recycler_id,
      recyclers!lots_recycler_id_fkey(name)
    `)
    .eq('collector_id', collector.collector_id)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(l => ({ ...l, recycler_name: l.recyclers?.name ?? null }))
}

/**
 * Fetch a single lot with its audit timeline and latest transaction.
 */
export async function getLot(lotId) {
  const { data: lot, error } = await supabase
    .from('lots')
    .select(`
      *,
      recyclers!lots_recycler_id_fkey(name, location, contact, authorization_id)
    `)
    .eq('lot_id', lotId)
    .single()
  if (error) throw new Error(error.message)

  const [{ data: events }, { data: txns }] = await Promise.all([
    supabase.from('lot_events').select('*').eq('lot_id', lotId).order('created_at', { ascending: true }),
    supabase.from('transactions').select('*').eq('lot_id', lotId).order('created_at', { ascending: false }).limit(1),
  ])

  return {
    ...lot,
    recycler_name: lot.recyclers?.name ?? null,
    timeline: (events ?? []).map(e => ({ ...e, at: new Date(e.created_at).getTime() })),
    transaction: txns?.[0] ?? null,
  }
}

/**
 * Match open recyclers to a lot using the weighted scoring algorithm.
 * The matching logic runs in the browser using Supabase-fetched recycler data.
 */
export async function getMatches(lotId) {
  const { data: lot, error: lotErr } = await supabase
    .from('lots').select('*').eq('lot_id', lotId).single()
  if (lotErr) throw new Error(lotErr.message)

  const { data: recyclers } = await supabase
    .from('recyclers')
    .select('*')
    .eq('authorization_status', 'verified')
  const allRecyclers = (recyclers ?? []).map(normaliseRecycler)

  const candidates = allRecyclers.filter(r =>
    r.accepted_materials.includes(lot.material_category)
  )
  const informalEstimate = Math.round(lot.estimated_max * 0.88)

  if (candidates.length === 0) {
    return { lot_id: lotId, weights: MATCH_WEIGHTS, informal_estimate: informalEstimate, matches: [] }
  }

  const bestRate = Math.max(...candidates.map(r => r.offered_rate[lot.material_category] ?? 0), 1)

  const matches = candidates
    .map(r => {
      const rate = r.offered_rate[lot.material_category] ?? 0
      const distance = haversineKm(lot.latitude, lot.longitude, r.latitude, r.longitude)
      if (rate <= 0 || distance > Math.max(r.service_area_km, 5) * 1.5) return null
      const sPrice = Math.min(rate / bestRate, 1)
      const sDist = Math.max(0, 1 - distance / Math.max(r.service_area_km, 1))
      const sPickup = r.pickup_available ? 1 : 0.35
      const breakdown = {
        authorization: Math.round(MATCH_WEIGHTS.authorization * 100 * 10) / 10,
        price:         Math.round(MATCH_WEIGHTS.price * sPrice * 100 * 10) / 10,
        distance:      Math.round(MATCH_WEIGHTS.distance * sDist * 100 * 10) / 10,
        pickup:        Math.round(MATCH_WEIGHTS.pickup * sPickup * 100 * 10) / 10,
        material:      Math.round(MATCH_WEIGHTS.material * 100 * 10) / 10,
      }
      const score = Object.values(breakdown).reduce((a, b) => a + b, 0)
      const offerValue = Math.round(rate * lot.weight)
      return {
        ...r, distance_km: distance, rate_for_material: rate,
        offer_value: offerValue, match_score: Math.round(score * 10) / 10, breakdown,
        extra_vs_informal: offerValue - informalEstimate,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.match_score - a.match_score || b.rate_for_material - a.rate_for_material)
    .slice(0, 6)

  return { lot_id: lotId, weights: MATCH_WEIGHTS, informal_estimate: informalEstimate, matches }
}

/**
 * Collector selects a recycler for their lot.
 * Updates the lot, creates a transaction, and writes two audit events.
 */
export async function selectRecycler(lotId, recyclerId) {
  const { data: lot } = await supabase.from('lots').select('*').eq('lot_id', lotId).single()
  const { data: r }   = await supabase.from('recyclers').select('*').eq('recycler_id', recyclerId).single()
  const recycler = normaliseRecycler(r)
  if (!recycler || recycler.authorization_status !== 'verified') {
    throw new Error('That recycler is not authorised on the platform')
  }

  const rate = recycler.offered_rate[lot.material_category] ?? 0
  const quotedPrice = Math.round(rate * lot.weight)

  await supabase.from('lots').update({ recycler_id: recyclerId, quoted_price: quotedPrice, status: 'MATCHED' }).eq('lot_id', lotId)

  const { data: txn, error: txnErr } = await supabase.from('transactions').insert({
    lot_id: lotId, collector_id: lot.collector_id, recycler_id: recyclerId,
    quoted_price: quotedPrice, final_price: 0, final_weight: 0,
    declared_weight: lot.weight, collection_location: lot.location,
    handover_location: '', payment_status: 'PENDING', transaction_status: 'MATCHED',
    anomaly_flag: false, anomaly_type: '', anomaly_reason: '',
  }).select().single()
  if (txnErr) throw new Error(txnErr.message)

  await addEvent(lotId, 'RECYCLER_MATCHED', `${recycler.name} at ₹${rate}/kg`)
  await addEvent(lotId, 'HANDOVER_PENDING', 'Waiting for recycler to scan the lot QR')

  return { ...lot, status: 'MATCHED', recycler_id: recyclerId, quoted_price: quotedPrice, qr_payload: `/verify/${lotId}`, transaction_id: txn.transaction_id }
}

// ─── Earnings ─────────────────────────────────────────────────────────────────

/**
 * Collector earnings summary — totals, this-month, pending, and transaction list.
 */
export async function earnings() {
  const collector = await myCollector()
  const { data: txns, error } = await supabase
    .from('transactions')
    .select('*, lots!transactions_lot_id_fkey(material_category, weight)')
    .eq('collector_id', collector.collector_id)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const rows = txns ?? []
  const paid = rows.filter(t => t.payment_status === 'PAID')
  const pending = rows.filter(t =>
    t.payment_status !== 'PAID' &&
    ['HANDED_OVER', 'COMPLETED'].includes(t.transaction_status)
  )
  const now = new Date()
  const thisMonth = paid.filter(t => {
    const d = new Date(t.updated_at ?? t.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })

  return {
    total_earnings:   Math.round(paid.reduce((a, t) => a + (t.final_price ?? 0), 0)),
    this_month:       Math.round(thisMonth.reduce((a, t) => a + (t.final_price ?? 0), 0)),
    pending:          Math.round(pending.reduce((a, t) => a + (t.final_price || t.quoted_price || 0), 0)),
    total_weight_kg:  Math.round(paid.reduce((a, t) => a + (t.final_weight ?? 0), 0) * 10) / 10,
    transactions: rows.map(t => ({
      lot_id: t.lot_id,
      material: t.lots?.material_category ?? '',
      weight: t.final_weight || t.lots?.weight || 0,
      amount: t.final_price || t.quoted_price || 0,
      payment_status: t.payment_status,
      transaction_status: t.transaction_status,
      date: t.updated_at ?? t.created_at,
    })),
  }
}

// ─── Offers ───────────────────────────────────────────────────────────────────

/**
 * Recycler: list all open lots that match their accepted materials,
 * enriched with distance from their facility.
 */
export async function openLots() {
  const recycler = normaliseRecycler(await myRecycler())
  const mats = recycler.accepted_materials

  const { data, error } = await supabase
    .from('lots')
    .select('*, collectors!lots_collector_id_fkey(display_name, operating_location)')
    .eq('status', 'LOT_CREATED')
    .in('material_category', mats)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const suggested = recycler.offered_rate ?? {}
  return (data ?? []).map(l => ({
    ...l,
    collector_name: l.collectors?.display_name ?? '',
    distance_km: haversineKm(recycler.latitude, recycler.longitude, l.latitude, l.longitude),
    suggested_rate: suggested[l.material_category] ?? 0,
    offer_count: 0, // offers table lookup omitted for performance
    my_offer: null,
  }))
}

/** Collector: get all offers on a lot. */
export async function offersForLot(lotId) {
  const { data, error } = await supabase
    .from('offers')
    .select('*, recyclers!offers_recycler_id_fkey(name, location, authorization_id, latitude, longitude)')
    .eq('lot_id', lotId)
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []).map(o => ({
    ...o,
    recycler_name: o.recyclers?.name ?? '',
    recycler_location: o.recyclers?.location ?? '',
    authorization_id: o.recyclers?.authorization_id ?? '',
  }))
}

/** Recycler: post a bid on an open lot. */
export async function makeOffer(lotId, { rate_per_kg, pickup_offered = false, note = '' }) {
  const recycler = await myRecycler()
  const { data: lot } = await supabase.from('lots').select('weight').eq('lot_id', lotId).single()
  const amount = Math.round(rate_per_kg * (lot?.weight ?? 0))

  const { data, error } = await supabase.from('offers').insert({
    lot_id: lotId, recycler_id: recycler.recycler_id,
    rate_per_kg, amount, note, pickup_offered, status: 'PENDING',
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

/** Collector: accept an offer → same outcome as selectRecycler. */
export async function acceptOffer(offerId) {
  const { data: offer } = await supabase.from('offers').select('*').eq('offer_id', offerId).single()
  if (!offer) throw new Error('Offer not found')
  // Mark others rejected, accept this one
  await supabase.from('offers').update({ status: 'REJECTED' }).eq('lot_id', offer.lot_id).neq('offer_id', offerId)
  await supabase.from('offers').update({ status: 'ACCEPTED' }).eq('offer_id', offerId)
  return selectRecycler(offer.lot_id, offer.recycler_id)
}

/** Recycler: get their own open offers. */
export async function myOffers() {
  const recycler = await myRecycler()
  const { data, error } = await supabase
    .from('offers')
    .select('*, lots!offers_lot_id_fkey(material_category, weight, status)')
    .eq('recycler_id', recycler.recycler_id)
    .order('created_at', { ascending: false })
  if (error) return []
  return data ?? []
}

// ─── Recycler operations ───────────────────────────────────────────────────────

/**
 * Recycler dashboard: stats + incoming lots + recent transactions.
 * Matches the exact shape that RecyclerDashboard.jsx reads.
 */
export async function recyclerDashboard() {
  const recycler = normaliseRecycler(await myRecycler())

  const [{ data: lotsData }, { data: txnsData }] = await Promise.all([
    supabase.from('lots').select('*').eq('recycler_id', recycler.recycler_id).order('created_at', { ascending: false }),
    supabase.from('transactions').select('*').eq('recycler_id', recycler.recycler_id).order('created_at', { ascending: false }),
  ])

  const lots = lotsData ?? []
  const txns = txnsData ?? []
  const completed  = txns.filter(t => t.transaction_status === 'COMPLETED')
  const today      = new Date(); today.setHours(0, 0, 0, 0)
  const todayTxns  = completed.filter(t => new Date(t.updated_at) >= today)

  return {
    recycler,
    cards: {
      active_lots:       lots.filter(l => ['MATCHED', 'HANDOVER_PENDING'].includes(l.status)).length,
      pending_handover:  lots.filter(l => l.status === 'HANDOVER_PENDING').length,
      completed:         completed.length,
      today_collection_kg: Math.round(todayTxns.reduce((a, t) => a + (t.final_weight ?? 0), 0) * 10) / 10,
      total_paid:        Math.round(completed.reduce((a, t) => a + (t.final_price ?? 0), 0)),
    },
    incoming: lots.filter(l => ['MATCHED', 'HANDOVER_PENDING'].includes(l.status)),
    recent: txns.slice(0, 20).map(t => ({ ...t, at: t.updated_at ?? t.created_at })),
  }
}

/**
 * Recycler: load a lot for QR verification.
 */
export async function verifyLot(lotId) {
  const [{ data: lot, error: lotErr }, { data: events }, { data: txns }, { data: handovers }] = await Promise.all([
    supabase.from('lots').select('*').eq('lot_id', lotId).single(),
    supabase.from('lot_events').select('*').eq('lot_id', lotId).order('created_at', { ascending: true }),
    supabase.from('transactions').select('*').eq('lot_id', lotId).order('created_at', { ascending: false }).limit(1),
    supabase.from('handovers').select('*').eq('lot_id', lotId).limit(1),
  ])
  if (lotErr) throw new Error(`No lot with ID ${lotId}`)
  const txn = txns?.[0] ?? null
  const { data: payments } = txn
    ? await supabase.from('payments').select('*').eq('transaction_id', txn.transaction_id).limit(1)
    : { data: [] }
  return {
    lot, transaction: txn, handover: handovers?.[0] ?? null, payment: payments?.[0] ?? null,
    timeline: (events ?? []).map(e => ({ ...e, at: new Date(e.created_at).getTime() })),
  }
}

/**
 * Recycler: record the physical handover (weight + photo + GPS).
 */
export async function confirmHandover({ lot_id, final_weight, final_price, scale_photo = '', handover_location = '', gps_location = '' }) {
  const recycler = normaliseRecycler(await myRecycler())
  const { data: txns } = await supabase.from('transactions').select('*').eq('lot_id', lot_id).limit(1)
  const txn = txns?.[0]
  if (!txn) throw new Error('Transaction not found for this lot')

  const ref = `HR-${new Date().getFullYear()}-${randId(5)}`
  const now = new Date().toISOString()

  await Promise.all([
    supabase.from('handovers').insert({
      reference_number: ref, lot_id, transaction_id: txn.transaction_id,
      scale_photo, weight: final_weight, gps_location,
      handover_location: handover_location || recycler.location,
      recycler_confirmation: true, status: 'VERIFIED', timestamp: now,
      captured_offline: false, confirmation_method: 'qr_scan',
      downstream_status: 'awaiting_confirmation', epr_credit_reference: '',
    }),
    supabase.from('transactions').update({
      final_weight, final_price, handover_location: handover_location || recycler.location,
      transaction_status: 'HANDED_OVER', payment_status: 'PENDING', updated_at: now,
    }).eq('transaction_id', txn.transaction_id),
    supabase.from('lots').update({ status: 'HANDOVER_PENDING' }).eq('lot_id', lot_id),
  ])

  await addEvent(lot_id, 'RECYCLER_VERIFIED', `QR verified by ${recycler.name}`, recycler.name)
  await addEvent(lot_id, 'HANDED_OVER', `${final_weight} kg at ₹${final_price} · ref ${ref}`, recycler.name)

  return {
    reference_number: ref, lot_id, final_weight, final_price,
    quoted_price: txn.quoted_price, recycler: recycler.name,
    status: 'VERIFIED', transaction_id: txn.transaction_id, timestamp: Date.now(),
  }
}

/**
 * Recycler decides (accept / reject) an incoming lot.
 */
export async function decideOnLot(lotId, decision) {
  const newStatus = decision === 'accept' ? 'MATCHED' : 'LOT_CREATED'
  await supabase.from('lots').update({ status: newStatus, recycler_id: decision === 'reject' ? null : undefined }).eq('lot_id', lotId)
  if (decision === 'reject') {
    await supabase.from('transactions').delete().eq('lot_id', lotId)
    await addEvent(lotId, 'LOT_CREATED', 'Recycler rejected — lot re-opened')
  }
  return { lot_id: lotId, decision }
}

/**
 * Recycler: update their own rates / profile fields.
 */
export async function updateRecyclerProfile(patch) {
  const recycler = await myRecycler()
  const { data, error } = await supabase
    .from('recyclers')
    .update(patch)
    .eq('recycler_id', recycler.recycler_id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return normaliseRecycler(data)
}

// ─── Payment ──────────────────────────────────────────────────────────────────

/**
 * Record a cash/UPI payment and mark the transaction + lot as completed.
 */
export async function markPaid({ transaction_id, mode }) {
  const { data: txn } = await supabase.from('transactions').select('*').eq('transaction_id', transaction_id).single()
  if (!txn) throw new Error('Transaction not found')
  const now = new Date().toISOString()

  await Promise.all([
    supabase.from('payments').insert({ transaction_id, amount: txn.final_price, mode, status: 'PAID', timestamp: now }),
    supabase.from('transactions').update({ payment_status: 'PAID', transaction_status: 'COMPLETED', updated_at: now }).eq('transaction_id', transaction_id),
    supabase.from('lots').update({ status: 'COMPLETED' }).eq('lot_id', txn.lot_id),
  ])
  await addEvent(txn.lot_id, 'COMPLETED', `₹${txn.final_price} via ${mode.toUpperCase()}`)

  return { transaction_id, amount: txn.final_price, mode, status: 'PAID', lot_id: txn.lot_id }
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function adminStats() {
  const [lotsRes, colRes, recRes, txnRes] = await Promise.all([
    supabase.from('lots').select('*', { count: 'exact', head: true }),
    supabase.from('collectors').select('*', { count: 'exact', head: true }),
    supabase.from('recyclers').select('*', { count: 'exact', head: true }),
    supabase.from('transactions').select('final_price, final_weight, payment_status'),
  ])
  const txns = txnRes.data ?? []
  const paid = txns.filter(t => t.payment_status === 'PAID')
  const pendingVer = await supabase.from('recyclers').select('*', { count: 'exact', head: true }).eq('authorization_status', 'pending')
  return {
    total_lots:         lotsRes.count ?? 0,
    total_collectors:   colRes.count ?? 0,
    total_recyclers:    recRes.count ?? 0,
    total_transactions: txns.length,
    total_volume_kg:    Math.round(paid.reduce((a, t) => a + (t.final_weight ?? 0), 0) * 10) / 10,
    total_payout:       Math.round(paid.reduce((a, t) => a + (t.final_price ?? 0), 0)),
    pending_verification: pendingVer.count ?? 0,
  }
}

export async function adminCharts() {
  // Volume by category over last 30 days
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: lots } = await supabase.from('lots').select('material_category, weight, created_at').gte('created_at', since)
  const byCategory = {}
  ;(lots ?? []).forEach(l => { byCategory[l.material_category] = (byCategory[l.material_category] ?? 0) + (l.weight ?? 0) })
  return { volume_by_category: Object.entries(byCategory).map(([name, kg]) => ({ name, kg: Math.round(kg * 10) / 10 })) }
}

export async function adminRecyclers() {
  const { data, error } = await supabase.from('recyclers').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(normaliseRecycler)
}

export async function verifyRecycler(id, decision) {
  const status = decision === 'approve' ? 'verified' : 'rejected'
  await supabase.from('recyclers').update({ authorization_status: status }).eq('recycler_id', id)
  return { recycler_id: id, authorization_status: status }
}

export async function adminAnomalies() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, lots!transactions_lot_id_fkey(material_category, weight, collector_id)')
    .eq('anomaly_flag', true)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(t => ({ ...t, material: t.lots?.material_category }))
}

export async function adminTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, lots!transactions_lot_id_fkey(material_category, weight), recyclers!transactions_recycler_id_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map(t => ({
    ...t, material: t.lots?.material_category, recycler_name: t.recyclers?.name,
  }))
}

export async function adminPrices() {
  const { data } = await supabase.from('prices').select('*').order('date', { ascending: false }).limit(200)
  return data ?? []
}

export async function adminMap() {
  const [{ data: recs }, { data: cols }, { data: openLts }] = await Promise.all([
    supabase.from('recyclers').select('name, latitude, longitude, authorization_status, city'),
    supabase.from('collectors').select('display_name, latitude, longitude'),
    supabase.from('lots').select('latitude, longitude, material_category, status').eq('status', 'LOT_CREATED'),
  ])
  return { recyclers: recs ?? [], collectors: cols ?? [], active_lots: openLts ?? [] }
}

export async function trace(lotId) {
  return getLot(lotId)
}
