/*
 * Voice output.
 *
 * Two things broke Bengali before:
 *
 *  1. `speechSynthesis.getVoices()` returns an EMPTY array on the first call
 *     in Chrome — the list arrives asynchronously and fires `voiceschanged`.
 *     The old code called it immediately, matched nothing, and let the browser
 *     pick its default voice (usually en-US), which reads Devanagari as
 *     gibberish or stays silent. We now wait for the list.
 *
 *  2. Very few systems ship an bn-IN voice at all. Matching failed, so it fell
 *     through to English. Bengali and Hindi share the Devanagari script and a
 *     hi-IN voice reads Bengali text intelligibly, so that is the fallback —
 *     and `lastVoiceNote()` reports when a substitute was used, rather than
 *     pretending it spoke Bengali.
 */
import { MATERIAL_NAMES } from '../i18n'

export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

let voicesPromise = null

/** Resolve once the browser has actually published its voice list. */
function loadVoices() {
  if (!canSpeak()) return Promise.resolve([])
  if (voicesPromise) return voicesPromise
  voicesPromise = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices()
    if (existing.length) return resolve(existing)
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener?.('voiceschanged', done, { once: true })
    // Safari sometimes never fires the event; do not hang forever.
    setTimeout(done, 1200)
  })
  return voicesPromise
}

// Bengali -> Hindi is a genuine substitute (same script). Never fall back to
// an English voice for Devanagari text: it is worse than silence.
const FALLBACK_LANGS = {
  'bn-IN': ['bn-IN', 'bn', 'hi-IN', 'hi'],
  'hi-IN': ['hi-IN', 'hi', 'bn-IN', 'bn'],
  'en-IN': ['en-IN', 'en-GB', 'en-US', 'en'],
}

let lastNote = ''
/** '' when the requested language was spoken, otherwise what was used instead. */
export function lastVoiceNote() { return lastNote }

function pickVoice(voices, langCode) {
  const chain = FALLBACK_LANGS[langCode] || [langCode, langCode.split('-')[0]]
  for (const want of chain) {
    const exact = voices.find((v) => v.lang?.replace('_', '-') === want)
    if (exact) return { voice: exact, wanted: chain[0] }
    const prefix = voices.find((v) => v.lang?.replace('_', '-').startsWith(want))
    if (prefix) return { voice: prefix, wanted: chain[0] }
  }
  return { voice: null, wanted: chain[0] }
}

export async function speak(text, langCode = 'hi-IN') {
  if (!canSpeak() || !text) return
  try {
    window.speechSynthesis.cancel()
    const voices = await loadVoices()
    const { voice } = pickVoice(voices, langCode)

    lastNote = ''
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.9
    u.pitch = 1

    if (voice) {
      u.voice = voice
      u.lang = voice.lang
      const base = langCode.split('-')[0]
      if (!voice.lang?.toLowerCase().startsWith(base)) {
        lastNote = `Spoken with a ${voice.lang} voice — no ${langCode} voice on this device.`
      }
    } else {
      // No usable voice: still set the language and let the browser try.
      u.lang = langCode
      lastNote = `No ${langCode} voice is installed on this device.`
    }
    window.speechSynthesis.speak(u)
  } catch {
    /* speech unsupported — the text is always on screen too */
  }
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel()
}

const TREND_WORD = {
  hi: { rising: 'भाव बढ़ रहा है', falling: 'भाव गिर रहा है', stable: 'भाव स्थिर है' },
  bn: { rising: 'দাম বাড়ছে', falling: 'দাম কমছে', stable: 'দাম স্থিতিশীল' },
  en: { rising: 'the rate is rising', falling: 'the rate is falling', stable: 'the rate is stable' },
}

/** "PCB ka aaj ka approximate rate 180 se 200 rupaye prati kilogram hai." */
export function priceSentence({ category, min, max, trend }, lang = 'hi') {
  const name = MATERIAL_NAMES[category]?.[lang] ?? category
  const t = TREND_WORD[lang]?.[trend] ?? ''
  if (lang === 'hi') return `${name} का आज का अनुमानित भाव ${min} से ${max} रुपये प्रति কেজিग्राम है। ${t}।`
  if (lang === 'bn') return `${name} এর আজকের আনুমানিক দাম ${min} থেকে ${max} টাকা প্রতি কেজি। ${t}.`
  return `Today's approximate rate for ${name} is ${min} to ${max} rupees per kilogram. ${t}.`
}

export function valueSentence({ category, weight, min, max }, lang = 'hi') {
  const name = MATERIAL_NAMES[category]?.[lang] ?? category
  if (lang === 'hi') return `${weight} কেজি ${name} की अनुमानित कीमत ${min} से ${max} रुपये है।`
  if (lang === 'bn') return `${weight} কেজি ${name} এর আনুমানিক দাম ${min} থেকে ${max} টাকা।`
  return `${weight} kilograms of ${name} is worth approximately ${min} to ${max} rupees.`
}

/** Spoken read-back of what the voice input understood, before committing. */
export function confirmSentence({ category, weight, min, max }, lang = 'hi') {
  const name = MATERIAL_NAMES[category]?.[lang] ?? category
  if (lang === 'hi') return `${weight} কেজি ${name}। दाम लगभग ${min} से ${max} रुपये। सही है?`
  if (lang === 'bn') return `${weight} কেজি ${name}। দাম আনুমানিক ${min} থেকে ${max} টাকা। ঠিক আছে?`
  return `${weight} kilograms of ${name}. Around ${min} to ${max} rupees. Is that correct?`
}

/** Spoken alarm when the recycler's figures do not match what was declared. */
export function fairnessSentence({ declared, final, kind }, lang = 'hi') {
  if (kind === 'weight') {
    if (lang === 'hi') return `ध्यान दीजिए। आपने ${declared} কেজি दिया था, ${final} কেজি लिखा जा रहा है। रुकिए और तौल दोबारा देखिए।`
    if (lang === 'bn') return `লক্ষ্য করুন। আপনি ${declared} কেজি दिले होথেকে, ${final} কেজি লেখা হচ্ছে। থামুন এবং ওজন আবার চেক করুন।`
    return `Careful. You declared ${declared} kilograms but ${final} is being recorded. Check the scale.`
  }
  if (lang === 'hi') return `ध्यान दीजिए। जो दाम लिखा जा रहा है वह बाज़ार भाव से काफी कम है।`
  if (lang === 'bn') return `লক্ষ্য করুন। লেখা দাম বাজার দরের চেয়ে অনেক কম।`
  return `Careful. The price being recorded is well below the market rate.`
}

