# OOP EMR

Live: **https://oop-emr.vercel.app** · Integration guide: [`INTEGRATION.md`](./INTEGRATION.md)

A mock trauma EMR that any external service can write into. You POST a JSON payload describing an encounter to `/api/encounter`; every connected browser sees the clinical UI populate in real time. Subsequent `update` payloads for the same `encounter_id` are merged server-side (arrays append, scalars overwrite) and streamed out as deltas so the UI never flickers.

Built to run unchanged on Vercel (serverless functions + Upstash Redis for state and pub/sub fan-out) or locally (Express + in-memory fallback).

---

## How it works

```
  ┌──────────────┐    POST /api/encounter      ┌─────────────────┐
  │ caller (EMS, │ ──────────────────────────▶ │ api/encounter   │
  │ AI pipeline, │   x-api-key + JSON body     │ - verify key    │
  │ curl, ...)   │                             │ - Zod validate  │
  └──────────────┘                             │ - merge w/ prev │
                                               │ - write Redis   │
                                               │ - PUBLISH delta │
                                               └────────┬────────┘
                                                        │
                                          Redis channel │ "encounter:events"
                                                        │
                                               ┌────────▼────────┐
                                               │ api/events      │
                                               │ (long-lived SSE)│
                                               │ - SUBSCRIBE     │
                                               │ - forward as    │
                                               │   text/event-   │
                                               │   stream        │
                                               └────────┬────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │ public/         │
                                               │ index.html      │
                                               │ EventSource →   │
                                               │ renderInitial / │
                                               │ renderUpdate    │
                                               └─────────────────┘
```

Two reads you need to know:

- **Merge is on the server, not the client.** The browser only ever receives deltas. The same delta produces the same visual change in every connected tab (no drift, no refetch).
- **State survives page refresh.** Reload with `?encounterId=TRX-...` and the UI calls `GET /api/encounter/:id` to rehydrate from Redis before the next SSE delta arrives.

### State machine (UI)

```
AWAITING ──(first payload with a new encounter_id)──▶ INITIAL
                                                       │
                           (payload with event_type=   │
                            "update" for same id)      │
                                                       ▼
                                                    UPDATED
                                                       │
                               POST /api/demo-reset ───┘ returns to AWAITING
```

Each transition plays a chime (ascending for initial, descending for updates), shifts the banner color, and either paints or appends to the vitals chart / tables.

### Merge semantics

| Behavior                  | Fields                                                                                             |
|---------------------------|----------------------------------------------------------------------------------------------------|
| **Append to array**       | `vitals_timeline`, `procedures`, `medications`, `resuscitation_events`, `images`                   |
| **Overwrite scalar**      | `status`, `trauma_level`, `primary_diagnosis`, `mechanism`, `clinical_note`, `icd10_codes`, `ais_score`, `hospital_notification_summary`, `transcript` |
| **Keep from initial**     | `patient` block (never merged)                                                                     |

Send only what changed in an update. Canonical reference: `lib/merge.js`.

---

## Repo layout

```
api/                      Vercel serverless functions (also mounted by server.js locally)
├── encounter.js          POST — ingest (auth → Zod validate → merge → write Redis → publish)
├── encounter/[id].js     GET  — current merged state (for refresh recovery / external polling)
├── encounter/[id]/images.js  POST — append images by URL / data URI (JSON)
├── encounter/[id]/image.js   POST — upload raw image bytes (image/* body)
├── events.js             GET  — long-lived SSE; subscribes to Redis pub/sub, forwards events
├── demo-reset.js         POST — clear Redis + publish demo_reset (every tab returns to AWAITING)
├── health.js             GET  — { status: "ok" }
└── trigger-call.js       POST — stub for outbound call (accepts { phone_number })

lib/
├── schema.js             Zod discriminated union for initial / update payloads
├── merge.js              Pure merge function (append arrays, overwrite scalars)
├── redis.js              Upstash REST + ioredis TCP; falls back to in-memory for local dev
└── auth.js               x-api-key verifier (no-op when API_KEY is unset)

public/
└── index.html            Single-page UI. Chart.js + vanilla JS. EventSource client.

fixtures/
├── initial.json          Canonical initial payload (also consumed by the demo script)
└── update.json           Canonical update payload

scripts/
└── demo.js               Replays both fixtures against BASE_URL with a 5s gap

server.js                 Local dev shim — thin Express app that requires the same
                          api/* handlers and mounts them at matching paths.

vercel.json               Sets maxDuration: 300 on api/events (SSE needs long-lived responses)
.env.example              Env var template
```

---

## Local quickstart

```bash
npm install
npm run dev                 # http://localhost:3000
```

In another terminal:

```bash
npm run demo                # POSTs fixtures/initial.json then fixtures/update.json (5s gap)
```

You should see the UI transition `AWAITING → INITIAL → UPDATED` with the vitals chart extending and a resuscitation card revealing on the update.

With no `.env` the server uses an in-memory store and disables auth — fine for a single-process demo. To exercise the production path locally, set Upstash credentials in `.env` and the server will switch to Redis automatically.

To test auth enforcement locally:

```bash
# in .env
API_KEY=devkey

# then
API_KEY=devkey npm run demo
```

---

## API reference

| Method | Path                  | Auth          | Purpose                                         |
|--------|-----------------------|---------------|-------------------------------------------------|
| POST   | `/api/encounter`      | `x-api-key`   | Ingest an initial or update payload             |
| GET    | `/api/encounter/:id`  | —             | Fetch current merged state                      |
| POST   | `/api/encounter/:id/image`  | `x-api-key` | Upload a single image as raw bytes (`Content-Type: image/*`) |
| POST   | `/api/encounter/:id/images` | `x-api-key` | Append images by URL or data URI (JSON array) |
| GET    | `/api/events`         | —             | SSE — `encounter_event`, `demo_reset`           |
| POST   | `/api/demo-reset`     | `x-api-key`   | Wipe Redis + broadcast reset to every tab       |
| POST   | `/api/trigger-call`   | `x-api-key`   | Queue an outbound call (pipeline TBD — stub)    |
| GET    | `/api/health`         | —             | Liveness probe                                  |

`x-api-key` is only enforced when the `API_KEY` env var is set on the server. Unset it for a fully-open demo.

### Error envelope

```json
{ "error": "Invalid payload", "issues": [ /* Zod issues[] */ ] }
```

`400` on schema failure, `401` on auth failure, `404` on missing encounter (GET only), `405` on wrong method.

---

## Payload schema

Two shapes, discriminated by `event_type`.

| Field                             | Type                                                          | Notes                                       |
|-----------------------------------|---------------------------------------------------------------|---------------------------------------------|
| `encounter_id`                    | string                                                        | Stable key across initial + updates         |
| `timestamp`                       | ISO 8601                                                      |                                             |
| `event_type`                      | `"initial"` \| `"update"`                                     | Drives the state machine                    |
| `patient.estimated_age`           | string (e.g. `"30s"`)                                         | Patient block never merged                  |
| `patient.sex`                     | string                                                        |                                             |
| `patient.mrn`                     | string                                                        |                                             |
| `mechanism`                       | string                                                        | overwrite                                   |
| `primary_diagnosis`               | string                                                        | overwrite                                   |
| `trauma_level`                    | `1` \| `2`                                                    | overwrite                                   |
| `status`                          | `"stable"` \| `"borderline"` \| `"peri-arrest"` \| `"post-rosc"` | overwrite                             |
| `vitals_timeline[]`               | `{ time, hr, sbp, dbp, spo2, rr }` — numbers except `time`    | append                                      |
| `procedures[]`                    | `{ time, description }`                                       | append                                      |
| `medications[]`                   | `{ time, description }`                                       | append                                      |
| `resuscitation_events[]`          | `{ time, description }`                                       | append — UI card reveals when non-empty     |
| `clinical_note`                   | string (multi-line)                                           | overwrite                                   |
| `icd10_codes[]`                   | string[]                                                      | overwrite                                   |
| `ais_score`                       | number                                                        | overwrite                                   |
| `hospital_notification_summary`   | string                                                        | overwrite                                   |
| `transcript`                      | string                                                        | overwrite                                   |
| `images[]`                        | string[] (URL or base64)                                      | append                                      |

For `event_type: "update"` every field except `encounter_id`, `timestamp`, `event_type`, and `patient` is optional — send only what changed.

---

## Deploying to Vercel

The app is Vercel-native: `api/*` become serverless functions, `public/*` is served as static, and Upstash Redis is the shared state + pub/sub layer.

See the step-by-step walkthrough in this repo's deploy notes or the development conversation. High-level:

1. Create an Upstash Redis database (`console.upstash.com`). Copy the REST URL, REST token, and TCP connection string.
2. `vercel link` this directory to a Vercel project named **rural-ehr** so the default URL is `rural-ehr.vercel.app`.
3. Set four env vars on the Vercel project: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_URL`, `API_KEY`.
4. `vercel --prod`.
5. Verify: `BASE_URL=https://rural-ehr.vercel.app API_KEY=<key> npm run demo`, watching the site in a browser tab.

---

## Implementation notes

- **Why SSE and not WebSockets / Socket.io?** Vercel serverless functions don't hold persistent bidirectional connections well; SSE is a single long GET that the browser's `EventSource` auto-reconnects when the function hits its `maxDuration`. All traffic is server → client anyway — we don't need a duplex channel.
- **Why Upstash?** Two matching endpoints from the same database: a REST API used by the stateless handlers (fits the serverless execution model) and a Redis TCP endpoint used only by the SSE handler's `SUBSCRIBE` (the one place we need a real Redis connection).
- **Why a Zod discriminated union?** Initial payloads are strict (all meaningful fields required or defaulted); update payloads are lax (everything optional). The discriminator on `event_type` gets us both shapes with shared field definitions and exhaustive type-checking at the handler.
- **Redis key scheme**: `encounter:{id}` stores JSON-stringified merged state; `encounters:active` is a SET used only by `/api/demo-reset` to enumerate what to delete.
- **Local dev without Upstash**: `lib/redis.js` swaps in an in-memory backend with an EventEmitter-backed pub/sub. Same interface, single-process only.
