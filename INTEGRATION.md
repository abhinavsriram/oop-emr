# OOP EMR — Integration Guide

Audience: the engineer (or agent) building the service that *produces* encounter payloads and posts them to OOP EMR. This document is everything you need to finish that service without reading the EMR's source code.

- **Live EMR**: https://oop-emr.vercel.app
- **Source**: https://github.com/abhinavsriram/oop-emr
- **Canonical reference payloads**: `fixtures/initial.json`, `fixtures/update.json` in this repo

---

## 1. What you're integrating with

OOP EMR is a mock trauma EHR. It has no clinical logic of its own — it only displays what you send it. Every connected browser tab shows the same encounter, rendering updates in real time as your service streams them in.

Your service is the source of truth. The EMR is a sink.

### Data model at a glance

- One **encounter** per patient arrival, identified by a stable `encounter_id` that you generate.
- You send one **initial payload** when the encounter starts, then zero or more **update payloads** with the same `encounter_id` as new information becomes available.
- Each payload is a single JSON POST. No streaming, no chunking, no WebSocket.
- The EMR merges your updates server-side (arrays append, scalars overwrite) and pushes the delta to all viewing browsers over SSE.

---

## 2. Base URL, auth, content type

| | |
|---|---|
| Base URL (prod) | `https://oop-emr.vercel.app` |
| Base URL (local) | `http://localhost:3000` — see §10 |
| Content type | `application/json; charset=utf-8` |
| Auth on writes | `x-api-key: <key>` header |
| Auth on reads | none |
| Body size limit | 50 MB |
| CORS | open (`*`) |

Ask the EMR operator for the API key. It's a 64-hex-char random string kept in the EMR's Vercel env vars; there is only one key and it's shared across all writers.

---

## 3. Endpoints

Every endpoint returns JSON unless otherwise noted.

### 3.1 `POST /api/encounter` — ingest an encounter payload

The main endpoint. Use this for both initial and update payloads; the `event_type` field inside the body tells the EMR which is which.

Headers:
- `Content-Type: application/json`
- `x-api-key: <key>` — required when the EMR has `API_KEY` set (always true in prod)

Body: the full JSON payload as described in §5.

Responses:

```
200 OK
{
  "ok": true,
  "encounter_id": "TRX-20480418-001",
  "receivedAt": "2026-04-19T04:32:31.213Z"
}
```

```
400 Bad Request  — schema violation
{
  "error": "Invalid payload",
  "issues": [ ...Zod issues array, see §9... ]
}
```

```
401 Unauthorized — missing or wrong x-api-key
{ "error": "Invalid or missing API key" }
```

```
405 Method Not Allowed — use POST
```

`receivedAt` is the EMR's server clock at ingest, in ISO 8601 UTC. Use it if you want to correlate ingest timing with your own logs.

Example:

```bash
curl -X POST https://oop-emr.vercel.app/api/encounter \
  -H "Content-Type: application/json" \
  -H "x-api-key: $OOP_EMR_API_KEY" \
  -d @initial.json
```

### 3.2 `GET /api/encounter/:id` — fetch current merged state

Returns the full merged state for one encounter. Useful for:
- Reconciling your service's view with what the EMR actually has
- Late-joining clients
- End-to-end tests

```
GET /api/encounter/TRX-20480418-001  →  200 { ...merged state... }
GET /api/encounter/DOES-NOT-EXIST   →  404 { "error": "not found" }
```

The response shape is identical to an initial payload, plus all accumulated array entries from subsequent updates (see §6 for merge semantics).

### 3.3 `GET /api/events` — SSE stream

Optional. If your service wants to observe what the EMR is doing (e.g. for dashboards, replaying events to another system, confirming your writes landed), subscribe here.

```
GET /api/events
Accept: text/event-stream
```

Emits:

```
event: encounter_event
data: {"payload": { ...the exact payload you posted... }, "receivedAt": "2026-04-19T..."}

event: demo_reset
data: {}
```

The stream sends a `: ping\n\n` comment every 20s to keep intermediate proxies alive. Vercel closes each SSE connection at 5 min; an `EventSource` client auto-reconnects transparently.

### 3.4 `POST /api/demo-reset` — wipe all encounters

Auth required. Use between test runs.

```
POST /api/demo-reset
x-api-key: <key>
→ 200 { "ok": true, "cleared": 3 }
```

Deletes every encounter from Redis and broadcasts a `demo_reset` SSE event — every browser tab returns to the AWAITING splash screen.

### 3.5 `POST /api/trigger-call` — queue an outbound call (stub)

Auth required. Accepts one field.

```
POST /api/trigger-call
Content-Type: application/json
x-api-key: <key>

{ "phone_number": "+15555550123" }

→ 202 { "ok": true, "phone_number": "+15555550123", "status": "queued", "note": "call pipeline not yet wired up" }
```

The call pipeline isn't implemented yet — this endpoint currently logs and acknowledges only. The schema is stable (`{ phone_number: string }`) so you can start integrating against it now; implementation comes later.

### 3.6 `GET /api/health`

```
GET /api/health → 200 { "status": "ok" }
```

Use for liveness checks in your CI / monitoring.

---

## 4. Event types — initial vs update

Every payload has an `event_type` field. The server's behavior:

| `event_type` | Behavior |
|---|---|
| `"initial"` | Replaces any existing state for that `encounter_id`. Use on first contact or when explicitly resetting. |
| `"update"` | Merges into existing state: arrays append, scalars overwrite. If no existing state exists for the `encounter_id`, treated like `initial`. |

**Rule of thumb:** send `"initial"` exactly once per encounter. Send `"update"` for every change after that.

---

## 5. Payload schema

The canonical reference is `lib/schema.js` (Zod, discriminated on `event_type`). Human-readable version:

### 5.1 Required on every payload

| Field | Type | Notes |
|---|---|---|
| `encounter_id` | string (non-empty) | Your stable ID. Suggested format: `TRX-YYYYMMDD-NNN` but any unique string works. |
| `timestamp` | ISO 8601 string | Your clock when the payload was authored. Not used for ordering — the server uses its own clock for that. |
| `event_type` | `"initial"` \| `"update"` | See §4. |
| `patient` | object | `{ estimated_age: string, sex: string, mrn: string }`. Never merged — the initial payload's patient block sticks. Include it on updates anyway; it's ignored but required by the schema. |

### 5.2 Clinical content (required on initial, optional on update)

| Field | Type | Merge | Notes |
|---|---|---|---|
| `mechanism` | string | overwrite | Injury mechanism, e.g. "GSW left anterior chest, 4th ICS mid-clavicular". |
| `primary_diagnosis` | string | overwrite | Can change across updates (e.g. as imaging reveals tamponade). |
| `trauma_level` | `1` \| `2` | overwrite | Drives badge color. |
| `status` | `"stable"` \| `"borderline"` \| `"peri-arrest"` \| `"post-rosc"` | overwrite | Drives banner color + chime intensity. |
| `vitals_timeline[]` | `{ time, hr, sbp, dbp, spo2, rr }` (all numeric except `time` which is a label like `"T+2:00"`) | **append** | Each new POST's entries are added to the chart — don't resend old points. |
| `procedures[]` | `{ time, description }` | **append** | Clinical procedures performed. |
| `medications[]` | `{ time, description }` | **append** | Drugs given. |
| `resuscitation_events[]` | `{ time, description }` | **append** | CPR, ROSC, defibrillation, etc. The UI's resuscitation card is hidden until this array has ≥ 1 item. |
| `clinical_note` | string (multi-line OK) | overwrite | Full note text. Typically append the new addendum in your service and send the whole note. |
| `icd10_codes[]` | string[] | overwrite | Full current list, not a delta. |
| `ais_score` | number | overwrite | Abbreviated Injury Scale. |
| `hospital_notification_summary` | string | overwrite | The "what the trauma team needs to know right now" summary shown in the notification card. |
| `transcript` | string | overwrite | EMS radio / call transcript. |
| `images[]` | string[] (URL or base64 data URL) | **append** | Scene or clinical images. |

### 5.3 What "optional on update" means in practice

In an update payload, omit any field that hasn't changed. The EMR keeps whatever it already has. This is how you avoid sending duplicate vitals or re-sending a long clinical note every time one field in it changes.

Minimal valid update:

```json
{
  "encounter_id": "TRX-20480418-001",
  "timestamp": "2026-04-19T04:32:41Z",
  "event_type": "update",
  "patient": { "estimated_age": "30s", "sex": "Male", "mrn": "TRX-20480418" },
  "status": "post-rosc"
}
```

That flips status on every open tab and triggers the UPDATED state transition. Nothing else changes.

---

## 6. Merge semantics (authoritative)

From `lib/merge.js`:

```js
const APPEND_ARRAYS = [
  'vitals_timeline', 'procedures', 'medications',
  'resuscitation_events', 'images',
];

const OVERWRITE_SCALARS = [
  'status', 'trauma_level', 'primary_diagnosis', 'mechanism',
  'clinical_note', 'icd10_codes', 'ais_score',
  'hospital_notification_summary', 'transcript',
];
```

- For every key in `APPEND_ARRAYS`, an update's entries are concatenated to the existing array.
- For every key in `OVERWRITE_SCALARS`, the update's value replaces the existing value (if the update omits the field, the existing value is kept).
- `patient` is never merged. The initial payload's patient block sticks.
- Anything outside these two lists is treated as-if it doesn't exist.

### Consequence: `icd10_codes` is an overwrite

If you want to *add* an ICD code on an update, you must send the full current list. The old list is replaced. This is the one field where integrators get tripped up — it looks like an array but behaves like a scalar.

### Consequence: you cannot *remove* array entries

Once a vitals point or procedure is posted, it's there forever for that encounter. If you mis-send, call `/api/demo-reset` and start over.

---

## 7. State machine — what the UI does (FYI)

Not something you drive directly, but useful to know when writing integration tests:

```
AWAITING ──(initial payload)──▶ INITIAL ──(update payload)──▶ UPDATED
    ▲                                                             │
    └──────────────── POST /api/demo-reset ────────────────────────┘
```

| UI state | Trigger | Visual effect |
|---|---|---|
| AWAITING | page load with no encounter | Splash screen, gray banner "Awaiting inbound…" |
| INITIAL | first payload for an encounter_id | Full render, ascending chime, amber banner |
| UPDATED | any payload with `event_type: "update"` for same encounter_id | Append to chart/tables, descending chime, red banner. Resuscitation card reveals if `resuscitation_events` becomes non-empty. |

---

## 8. End-to-end sequence examples

### 8.1 A clean demo (two POSTs, nothing else)

Exactly what `npm run demo` does:

```bash
# T+0: initial contact
curl -X POST $BASE/api/encounter -H "x-api-key: $KEY" -d @fixtures/initial.json

# T+10: patient decompensates, full update
sleep 10
curl -X POST $BASE/api/encounter -H "x-api-key: $KEY" -d @fixtures/update.json
```

### 8.2 A realistic streaming integration

Typical for a prehospital AI pipeline:

```
T+00:00  POST initial with patient block, mechanism, one vitals row, initial note
T+00:30  POST update with { vitals_timeline: [<new row>] }                     — 1 item appended
T+01:00  POST update with { vitals_timeline: [<new row>], procedures: [<tube>] } — appends to both
T+01:15  POST update with { medications: [<TXA>] }
T+02:00  POST update with { vitals_timeline: [<new row>] }
...
T+08:00  POST update with { status: "post-rosc", resuscitation_events: [<ROSC>], clinical_note: "<addendum>" }
```

Every field sent is a delta. The EMR maintains the accumulated state.

### 8.3 Sanity-check your work

```bash
curl https://oop-emr.vercel.app/api/encounter/TRX-20480418-001 | jq '{
  vitals: (.vitals_timeline | length),
  procs:  (.procedures | length),
  meds:   (.medications | length),
  resus:  (.resuscitation_events | length),
  status
}'
```

---

## 9. Error envelope & handling

All error responses are JSON.

| Status | When | Body | What to do |
|---|---|---|---|
| 400 | Schema validation failed | `{ error, issues: [...] }` | Inspect `issues[].path` + `issues[].message`. Fix your payload. Do not retry the same body. |
| 401 | Missing / wrong `x-api-key` | `{ error }` | Reload the key from secret storage. Do not retry without fixing. |
| 404 | `GET /api/encounter/:id` for an unknown id | `{ error: "not found" }` | Maybe the encounter was reset. Check with operator. |
| 405 | Wrong HTTP method | — | Fix the client. |
| 5xx | Infrastructure (Vercel, Upstash, Redis) | may be HTML | Retry with backoff. After 3 failures, surface an alert. These should be rare. |

A Zod `issues[]` entry looks like:

```json
{
  "code": "invalid_type",
  "expected": "number",
  "received": "string",
  "path": ["vitals_timeline", 0, "hr"],
  "message": "Expected number, received string"
}
```

`path` tells you exactly which field is wrong.

---

## 10. Running the EMR locally for integration tests

The same code that runs on Vercel runs under Express locally.

```bash
git clone https://github.com/abhinavsriram/oop-emr
cd oop-emr
npm install
npm run dev     # http://localhost:3000
```

With no `.env`, the server uses an in-memory store and disables auth — every write succeeds without a key. Perfect for CI and local dev.

To exercise the production path locally (Redis + auth), copy `.env.example` → `.env` and fill in:

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
UPSTASH_REDIS_URL=rediss://...
API_KEY=devkey
```

Point your service at `http://localhost:3000` and you're off.

### Using the fixtures as test cases

```bash
BASE_URL=http://localhost:3000 npm run demo
```

Replays `fixtures/initial.json` then `fixtures/update.json` with a 5s gap. `GAP_MS=10000` to widen it; `API_KEY=...` if your local server requires auth.

Your service should, at minimum, be able to produce payloads that match the shape of these fixtures. Run them through your own code path first, diff against the canonical files — if the diff is small and semantic, you're on track.

---

## 11. Rate limits, payload size, durability

- **No application-level rate limits.** Vercel imposes concurrency limits per plan; Upstash free tier allows 10k Redis commands/day. Each POST costs ~3 commands (get + set + sadd + publish). ~2,500 POSTs/day is the practical ceiling on the free tier.
- **Max body: 50 MB.** Limit set by `express.json({ limit: '50mb' })`. You will hit the payload cap way before the rate cap when embedding base64 images.
- **Durability: none.** Redis is ephemeral. Treat the EMR as volatile — don't rely on it for long-term record storage. If an encounter matters, persist it on your side.
- **SSE timeout: 5 min.** Vercel's `maxDuration` for `/api/events`. Clients reconnect automatically.

---

## 12. Implementation checklist for the caller

- [ ] Generate a unique `encounter_id` per encounter. Keep it stable across updates.
- [ ] Send exactly one `event_type: "initial"` payload per encounter. Always first.
- [ ] Send `event_type: "update"` for every subsequent change.
- [ ] Include `encounter_id`, `timestamp`, `event_type`, and `patient` on every payload.
- [ ] For updates: include only the fields that changed.
- [ ] For `vitals_timeline` / `procedures` / `medications` / `resuscitation_events` / `images`: each update should contain **only the new entries**, not the full accumulated list. The server appends.
- [ ] For `icd10_codes`: send the **full current list** on every update that touches it. The server overwrites.
- [ ] For `clinical_note`: send the **full current text** on every update that touches it. The server overwrites.
- [ ] Handle 400 by logging the `issues[]` path and surfacing to a dev queue — do not retry.
- [ ] Handle 401 by reloading secrets — do not retry.
- [ ] Handle 5xx with exponential backoff, max ~3 retries.
- [ ] Test against `fixtures/` locally before hitting prod.
- [ ] Validate your own schema before POSTing — `lib/schema.js` is the canonical shape; copy it if it helps.
- [ ] Decide your policy for `status` transitions — the UI responds very differently to `stable` vs `post-rosc`.
- [ ] Decide how often you want to flush updates. 1 POST every 5–30 seconds is a good range for most integrations; the UI handles append-without-flicker so higher rates are fine.

---

## 13. Common pitfalls

- **Treating `icd10_codes` like an append array** — it overwrites. Send the full list.
- **Re-sending all historical vitals on every update** — they will duplicate. Send only new points.
- **Including a different `patient` block on an update and expecting it to update** — it won't. `patient` is locked to the initial payload.
- **Forgetting `encounter_id`** — 400. No fallback.
- **Relying on `timestamp` for ordering** — the server uses its own wall clock (`receivedAt`) for merging. Your `timestamp` is displayed but not used for ordering logic.
- **Hitting `/api/encounter` with GET** — that's a different endpoint shape (`/api/encounter/:id`). Trailing `/:id` matters.
- **Long-lived POST connections** — don't. Each POST is a single request/response. If you need realtime observation, use `/api/events`.

---

## 14. Contact / escalation

Operator: whoever holds the `API_KEY` and the Upstash credentials.
Repo: https://github.com/abhinavsriram/oop-emr — file issues there.
