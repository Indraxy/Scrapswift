# Scrapswift

**Fair prices. Authorised recyclers. Traceable handover.**

A working prototype for **Smart India Hackathon PS 26229 — "Kabadiwala Connect: Bringing the
Informal Collector into the Formal Recycling Chain."**

A mobile-first PWA that lets an informal e-waste collector photograph a lot, get a fair price
range from recorded market data, find an authorised recycler ranked by a weighted match score,
hand the lot over against a QR code, and end up with a paid, traceable digital record that an
administrator can look up by lot ID.

> **All data in this repository is fictional prototype data.** The recyclers, authorisation IDs
> and price records are generated for demonstration. Nothing here is real field data, and no
> recycler shown is a genuinely government-authorised business.

---

## 1. What actually works

The complete end-to-end flow runs, and has been tested through the API:

```
collector login → photo → AI material suggestion → confirm/correct → weight → condition → source
→ fair price estimate → weighted recycler match → select recycler → lot ID + QR
→ recycler scans QR → /verify/<lot id> → final weight + final price → confirm handover
→ payment (cash/UPI) → collector earnings update → admin traceability search
```

| Feature | Status |
|---|---|
| Lot creation (6 steps, camera or gallery) | working |
| AI material identification | working — **rule-based placeholder, not a trained model**; rejects non-e-waste |
| Camera capture — native camera intent on phones, in-app preview on desktop | working |
| Preview → retake → use-photo confirmation before classification | working |
| Fair price engine from historical price records | working |
| Price board + 45-day Recharts history | working |
| Weighted recycler matching (40/25/15/10/10) with score breakdown | working |
| "You could earn more" formal vs informal comparison | working (labelled estimate) |
| QR generation (`/verify/<lot id>` only) | working |
| QR scanning via browser camera (html5-qrcode) + manual lot-ID fallback | working |
| Handover record, `HR-YYYY-NNNNN` reference | working |
| Payment (cash / UPI mode) + earnings ledger | working |
| 9-state traceability timeline | working |
| Admin dashboard, recycler verification, anomaly alerts, traceability search | working |
| Hindi / Bengali / English UI + speech synthesis | working |
| PWA install, service worker, IndexedDB offline drafts + sync | working (basic) |
| Leaflet + OpenStreetMap maps | working |
| Browser Geolocation stamped onto lots | working (falls back to registered area) |
| Recycler accept / reject on incoming lots | working (reject releases the lot) |
| Find Recycler directory with distance + map | working |

---

## 2. Project structure

```
kabadiwala-connect/
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   └── app/
│       ├── main.py                 FastAPI app, CORS, router mounting
│       ├── config.py               settings, SQLite fallback
│       ├── database.py             engine / session / Base
│       ├── models/models.py        User, Collector, Material, Recycler, Price, Lot,
│       │                           LotEvent, Transaction, Handover, Payment
│       ├── schemas/schemas.py      Pydantic request/response validation
│       ├── routes/                 auth, prices+ai, lots, recyclers, transactions, admin
│       ├── services/               security, pricing, matching, anomaly, common
│       ├── ai/classifier.py        pluggable classification service
│       └── seed/seed.py            demo dataset generator
└── frontend/
    ├── index.html  vite.config.js  tailwind.config.js  .env.example
    ├── public/     manifest.webmanifest, sw.js, icons
    └── src/
        ├── App.jsx  main.jsx  index.css
        ├── i18n/                   en / hi / bn dictionaries
        ├── services/               api.js, demoEngine.js, voice.js
        ├── offline/                db.js (Dexie), sync.js
        ├── components/             ui, Shell, QRBlock, Scanner, MapView, Charts
        └── pages/                  Login, collector/*, recycler/*, admin/*
```

---

## 3. Run it

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate

# or

python -m venv .venv ; .venv\Scripts\activate


pip install -r requirements.txt
cp .env.example .env                                   # optional
python -m app.seed.seed                                # creates + seeds the database
uvicorn app.main:app --reload --port 8000
```

API docs: <http://localhost:8000/docs> · health: <http://localhost:8000/api/health>

### Frontend

```bash
cd frontend
npm install
cp .env.example .env        # already present in this archive
npm run dev
```

Open <http://localhost:5173>.

**The frontend talks to FastAPI and nothing else.** `frontend/.env` controls it:

```
VITE_API_URL=http://localhost:8000
VITE_DEMO_MODE=false
```

With `VITE_DEMO_MODE=false` (the default) every call goes to the backend. If the API is down
the header shows 🔴 **Backend disconnected**, a banner explains it, and requests fail visibly —
the app does **not** quietly serve demo data. Set `VITE_DEMO_MODE=true` and restart the dev
server to use the in-browser demo dataset deliberately; `npm run build:single` does this for you
via `.env.demo`, which is what makes the single-file build work with no server.

### Database

**Default is SQLite** (`backend/kabadiwala.db`) so the prototype runs with zero database setup.
The models are PostgreSQL-compatible — to use Postgres, create the database and set
`DATABASE_URL` in `backend/.env`:

```bash
createdb kabadiwala
# backend/.env
DATABASE_URL=postgresql+psycopg2://kc_user:kc_pass@localhost:5432/kabadiwala
```

then re-run `python -m app.seed.seed`. No other change is needed.

### Environment variables

| File | Variable | Purpose |
|---|---|---|
| `backend/.env` | `DATABASE_URL` | blank → SQLite; else any SQLAlchemy URL |
| `backend/.env` | `SECRET_KEY` | token signing key |
| `backend/.env` | `CORS_ORIGINS` | comma-separated allowed origins |
| `frontend/.env` | `VITE_API_URL` | API base; blank → run on the built-in demo dataset |

### No-setup demo build

```bash
cd frontend && npm run build:single
```

produces `dist-single/index.html` — one self-contained file you can double-click, email, or put
on a phone. It runs the whole app against an in-browser copy of the dataset and matching logic,
with no server at all. Useful as a backup if the venue Wi-Fi fails during judging.

---

## 4. Demo accounts

All use password `password123`. Clearly labelled as demo accounts on the login screen.

| Role | Email |
|---|---|
| Collector | `collector@demo.com` |
| Recycler (Green Recyclers) | `recycler@demo.com` |
| Admin | `admin@demo.com` |

---

## 5. Exact SIH demo script (5 minutes)

On the recycler dashboard you can also **Accept** or **Reject** an incoming lot before scanning —
rejecting clears the assignment and sends the lot back to the collector to choose again.

**Collector — phone**
1. Sign in as `collector@demo.com`. Switch the language to **हिंदी** to show the UI change.
2. Tap **ई-कचरा बेचें** (Sell e-waste) → take or upload a photo of a circuit board.
3. The classifier returns **PCB, ~91% confidence** → tap **सही है** (Correct).
4. Weight **8.5**, condition **Good**, source **Household**.
5. Estimated value appears (**≈ ₹1,480 – ₹1,700** at current seeded rates). Tap 🔊 to hear it in
   Hindi. Point out the "estimated range, not a guaranteed price" line.
6. Optional: allow location when prompted — the coordinates are stamped onto the lot.
7. Tap through to matching. **Green Recyclers ₹195/kg · 7.3 km · pickup · authorised · ~95% match**
   is the best match. Open "how this score is built" to show the 40/25/15/10/10 weights.
8. Show the **You could earn more** card: informal estimate vs formal offer **₹1,658**.
9. Choose the recycler → lot ID **KC-2026-0000xx** and its QR appear.

**Recycler — laptop or second phone**
10. Sign in as `recycler@demo.com` → **Scan lot QR** → scan the collector's screen
   (or type the lot ID — the fallback field is there for venues with no camera permission).
11. The verification page opens with the photo, declared weight, quoted price and timeline.
12. Enter final weight **8.4**, final price **1638** → **Confirm handover** →
    handover reference **HR-2026-000xx**, status **VERIFIED**.
13. Payment mode **Cash** → **Mark as paid**.

**Collector**
14. Open **My earnings** — the ₹1,638 is there and the lot is **Completed**.

**Admin**
15. Sign in as `admin@demo.com` → **Traceability** → paste the lot ID → the whole chain appears:
    collector, photo, material, weights, price estimate, recycler, handover reference, GPS,
    payment, and the 9-step timeline, with the collection and facility points on a map.
16. Optional: **Verification** tab — approve a pending recycler and show it appearing for
    collectors. **Transactions · Anomalies** tab — two seeded flagged transactions with reasons.
17. Optional (shows the dataset is live): as the recycler, change the PCB rate on **Buying rates**,
    then reload the collector's price board and the admin price dataset — a new price record with
    source `recycler_update` is there and the estimates move.

---

## 6. Seeded dataset

`python -m app.seed.seed` creates:

| Table | Rows |
|---|---|
| Collectors | 10 |
| Recyclers | 10 (8 approved, 2 pending verification) |
| Materials | 8 categories |
| Price history | 2,184 records (8 materials × 3 locations × 91 days) |
| Lots | 40 |
| Transactions | 36 (27 completed, 9 in flight) |
| Handovers | 30 |
| Payments | 26 |
| Flagged anomalies | 2 |

Rates are tuned so the live board reads close to the problem statement's example:
PCB ₹178–196 rising, Cable ₹535–605 stable, Battery ₹90–102 falling, LCD ₹70–80,
CRT ₹52–58, Motor ₹139–158 rising.

---

## 6a. Mock vs. genuinely implemented

Asked directly, here is the honest split.

**Genuinely implemented** — real code, real database writes, reallogic:
lot creation, price engine, weighted matching, QR generation and camera scanning,
handover records, payments and ledger, traceability timeline, anomaly detection,
recycler verification, role-based access and ownership checks, i18n, speech synthesis,
PWA install/service worker/IndexedDB drafts and sync, geolocation, Leaflet maps.

**Mock or simulated, by design:**
- *Material classification* — an explainable rule engine (`heuristic-demo-v2`), not a trained
  model. It rejects photos that are clearly not e-waste (foliage, petals, sky, skin, blank
  surfaces) and declines to name a material when it is not confident, rather than guessing.
- *Recyclers and authorisation IDs* — fictional; approval is a prototype workflow.
- *Price history* — synthetic, generated with seeded trend + noise.
- *UPI* — a recorded payment mode; no gateway.
- *Informal-market comparison* — a stated 12% assumption, labelled in the UI.

---

## 6b. AI/ML module — Smart Scrap Value Estimator

**Why.** Collectors need a number before they weigh anything. The estimator turns published
Jaipur scrap rates into an estimated value for a given item, quantity, area and condition.

**Data source.** <https://www.thekabadiwala.com/scrap-rates/Jaipur>, transcribed from the public
rate cards on 2026-08-31. No login, CAPTCHA or access control was bypassed. **Not real-time.**

Two findings that shape the whole design, and which must not be misrepresented:

1. The page publishes **one rate per material** — there is no historical time series.
2. Every Jaipur locality page (`/jaipur/malviya-nagar` etc.) serves the **identical** rate list.
   There is no real locality-level price variation in this source.

That leaves **37 usable real numbers**, which is nowhere near enough to train a market model.

**So the estimator is a hybrid, not a black box:**

```
published reference rate (REAL)  ->  ML adjustment for locality / quality /
quantity (SYNTHETIC training)  ->  estimated rate  ->  x quantity  ->  value
```

The reference rate is the anchor; the ML layer only adjusts around it and is capped at ±35% of
the published rate. An unknown material returns the category median, clearly labelled, rather
than an invented price.

**Datasets** — real and synthetic are kept in separate files and every row carries a `synthetic`
flag.

| File | Rows | `synthetic` |
|---|---|---|
| `data/jaipur_scrap_rates.csv` | 39 (19 plastic, 20 e-waste) | `false` — transcribed |
| `data/jaipur_scrap_rates_clean.csv` | 39, 37 usable | `false` |
| `data/synthetic_scrap_training_data.csv` | 3,330 | `true` — generated |
| `data/scrap_transactions.csv` | grows | real platform transactions |

**Model.** GradientBoostingRegressor (compared against RandomForestRegressor).
Features: material, category, item_type, locality, unit, quality, quantity, days_index.
Target: `price`. `base_reference_price` is deliberately **excluded** — it generated the target,
so including it would leak the answer.

**Metrics** (`ml/model_metrics.json`), on the synthetic set: R² 0.995, MAE ₹7.6/kg for kg items
and ₹43.6/piece for piece items. **Read that honestly:** it means the regressor recovered the
generator rules we wrote, not that it predicts real Jaipur prices. The script also runs an
**unseen-material check** — holding out whole materials gives **R² = −0.18**, which is the point:
this is a reference-anchored estimator that interpolates around known rates and cannot price a
material it has never seen.

**Limitations.** No real transaction history; locality variation is modelled, not observed;
rates are an aggregator's published buying prices, not verified transactions; accuracy against
real trades is unmeasured because no real trades exist yet.

**How it improves.** Every completed platform payment appends a row to
`data/scrap_transactions.csv`. Once enough real rows accumulate, retrain on those instead of the
synthetic set and the metrics become meaningful.

**Retrain:**

```bash
cd ml
python collect_data.py      # --live to re-fetch the page
python preprocess.py
python make_synthetic.py
python train_model.py
python evaluate.py
```

**API:**

```bash
curl -X POST http://localhost:8000/api/predict-scrap-value \
  -H 'Content-Type: application/json' \
  -d '{"category":"Plastic","material":"PET Bottle","quantity":8,"unit":"kg","locality":"Jaipur"}'
```

```json
{"material":"PET Bottle","category":"Plastic","unit":"kg","quantity":8.0,
 "reference_rate":20.0,"predicted_rate":21.73,"estimated_value":174,"currency":"INR",
 "confidence":"Reference-based estimate, ML-adjusted","method":"reference+ml",
 "disclaimer":"Estimated from published Jaipur scrap rates. Actual kabadiwala rates vary..."}
```

Also: `GET /api/scrap-materials?category=Plastic` (rate list, highest paying first — this powers
Smart Material Recommendation) and `GET /api/scrap-analytics` (average rate per category, top
plastic and e-waste items).

Collector UI: **🧮 Value estimator** tile on the home screen → `/app/estimate`.

---

## 7. API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` `/api/auth/register` · GET `/api/auth/me` | signed-token auth |
| GET | `/api/materials` `/api/prices` `/api/prices/{category}/history` `/api/estimate` | public |
| POST | `/api/ai/classify-material` (multipart) · `/api/ai/classify-material-json` | classifier |
| POST/GET | `/api/lots` · GET `/api/lots/{lot_id}` | collector-scoped |
| POST | `/api/lots/sync` | offline draft batch, idempotent via `client_ref` |
| GET | `/api/lots/{lot_id}/matches` · POST `/api/lots/{lot_id}/select-recycler` | matching |
| GET | `/api/recyclers` `/api/recyclers/me` `/api/recyclers/me/dashboard` · PUT `/api/recyclers/me` | |
| GET | `/api/recyclers/verify/{lot_id}` | **QR target** |
| POST | `/api/handovers` `/api/payments` · GET `/api/earnings` | |
| POST | `/api/recyclers/me/lots/{lot_id}/decision?decision=accept\|reject` | accept / release a lot |
| GET | `/api/admin/stats` `/charts` `/recyclers` `/anomalies` `/transactions` `/prices` `/map` `/trace/{lot_id}` | admin only |

The paths listed in the brief are also mounted as aliases onto the same handlers, so either
shape works: `POST /auth/login`, `GET /materials`, `POST /lots/{lot_id}/price-estimate`,
`GET /recyclers/match?lot_id=`, `PUT /recyclers/{id}/rates`, `POST /handover`,
`GET /handover/{reference}`, `POST /payments`, `GET /collector/earnings`, `GET /transactions`,
`GET /traceability/{lot_id}`, `POST /ai/anomaly-detection`.

### How the algorithms work

- **Price engine** (`services/pricing.py`) — 10th/90th percentile of buying prices recorded in the
  last 7 days for that material (falling back to 45 days), adjusted by condition (good 1.0 /
  mixed 0.92 / damaged 0.82) and source. Trend compares the recent mean against the prior fortnight.
- **Matching** (`services/matching.py`) — unauthorised recyclers and material mismatches are removed
  first, then scored: authorisation 40%, price 25%, distance 15% (relative to the recycler's own
  service radius), pickup 10%, material fit 10%. Distance is haversine.
- **Anomaly detection** (`services/anomaly.py`) — flags a transaction when its per-kg price is a
  statistical outlier (|z| > 2 low / 2.5 high) against the last 45 days **and** deviates more than
  15% from the mean, or when the final weight differs from the declared weight by over 25%.
- **Classifier** (`ai/classifier.py`) — `BaseClassifier.predict(image_bytes, hint)`. The active
  implementation reads average colour and hashes the image for a deterministic, repeatable
  suggestion. Replace `ACTIVE_CLASSIFIER` with a TensorFlow/PyTorch implementation of the same
  interface and nothing else changes.

---

## 8. Prototype limitations (please read before demoing)

1. **The AI classifier is not a trained model.** `heuristic-demo-v2` is a rule engine over simple
   image statistics — edge density, saturation, hue fractions, neutral-pixel fraction — computed
   on a 96x96 downscale. It does two things honestly: it **rejects** photos that are not e-waste
   (foliage, flowers, sky, skin, blank frames), and it **abstains** below 45% confidence instead
   of naming a material. Confidence is margin-based and capped at 0.85, because a rule engine
   over 96x96 statistics never deserves 0.95. Category accuracy on real photographs is still
   weak — treat the suggestion as a prompt for the collector to confirm, which is exactly how
   the UI presents it. Swap `ACTIVE_CLASSIFIER` in `backend/app/ai/classifier.py` for a real
   model when training data exists; the interface does not change.
2. **Recyclers are fictional.** Authorisation IDs are invented; approving one in the admin panel is
   a prototype workflow, not a CPCB/SPCB registration check.
3. **Prices are synthetic.** The history is generated with a seeded trend and noise. It is
   structured like real market data but is not real market data.
4. **UPI is a payment mode, not a payment.** No gateway is connected; marking a transaction paid
   records the mode and updates the ledger.
5. **Auth is prototype-grade** — PBKDF2 passwords with HMAC-signed tokens, no refresh tokens, no
   rate limiting, no OTP. Do not reuse as-is.
6. **Offline support is deliberately basic.** The app shell, last price board and recycler list are
   cached, and lots drafted offline are stored in IndexedDB and synced when connectivity returns.
   Matching, handover and payment need the network — the app says so rather than pretending.
7. **Camera behaviour differs by device.** "Take Photo" uses the phone's own camera app via
   `<input type="file" accept="image/*" capture="environment">` on touch devices — the most
   reliable route on entry-level Android, and it works over plain http on a LAN IP. Desktop
   browsers ignore `capture` and would just show a file dialog, so there the app opens an in-app
   `getUserMedia` preview instead (this one does need https or localhost). Either way the photo
   goes through the same preview → confirm → classify pipeline as a gallery upload, and if no
   camera is available the gallery option always remains.
8. **Map tiles need internet.** Markers still render without tiles, but the basemap will be blank
   on an offline machine.
9. **Speech synthesis quality varies by device.** Hindi and Bengali voices exist on most Android
   and recent desktop browsers; where a voice is missing the browser falls back or stays silent —
   the text is always on screen.
10. **GPS is optional.** The lot screen asks for browser geolocation and stamps the coordinates on
   the lot; if permission is denied the collector's registered area is used instead. Handover
   coordinates come from the recycler's facility record.
11. **Photos are stored as downscaled data URLs** in the database for demo simplicity, not in
    object storage.

---

## 9. Licence and attribution

Prototype built for SIH PS 26229. Maps © OpenStreetMap contributors. Icons by Lucide.



