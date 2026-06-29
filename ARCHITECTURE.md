# Gemma Calendar — Architecture & Flows

A PWA daily-schedule tracker for Gemma with editable time slots and iOS background
push notifications. No build tools, no framework — a single HTML file served from
GitHub Pages, backed by a Cloudflare Worker + KV for the schedule and Web Push.

---

## 1. System architecture

```mermaid
graph TB
    subgraph Phone["📱 iPhone (installed PWA)"]
        APP["index.html<br/>(app UI + editor)"]
        SW["sw.js<br/>(service worker)"]
        LS[("localStorage<br/>schedule cache +<br/>done checkmarks")]
        APP <--> LS
    end

    subgraph GH["☁️ GitHub Pages (static hosting)"]
        PAGES["index.html · sw.js · icon<br/>served from <b>main</b> branch"]
    end

    subgraph CF["⚡ Cloudflare"]
        WORKER["Worker: gemma-calendar<br/>fetch() + scheduled() cron"]
        KV[("KV: SUBSCRIPTIONS<br/>• schedule (events)<br/>• gemma (push sub)<br/>• test_push_at")]
        CRON["Cron trigger<br/>* * * * * (every min)"]
        WORKER <--> KV
        CRON --> WORKER
    end

    APPLE["🍎 Apple Web Push<br/>web.push.apple.com"]

    PAGES -. "install / load app" .-> APP
    APP -- "GET /schedule" --> WORKER
    APP -- "POST /schedule (PIN 7777)" --> WORKER
    APP -- "POST /subscribe" --> WORKER
    WORKER -- "encrypted push (aes128gcm + VAPID)" --> APPLE
    APPLE -- "push event" --> SW
    SW -- "showNotification()" --> Phone
```

**Components**

| Component | Role |
|-----------|------|
| `index.html` | App UI, schedule rendering, PIN-gated editor, push subscription |
| `sw.js` | Service worker — receives background `push` events, shows notifications |
| GitHub Pages | Static hosting (serves from the **`main`** branch for both repos) |
| Cloudflare Worker | HTTP API (`/schedule`, `/subscribe`, …) + every-minute cron |
| Cloudflare KV | Single source of truth: the schedule, the push subscription, test state |
| Apple Web Push | Delivers encrypted notifications to the device, even when the app is closed |

---

## 2. Schedule data model

The schedule is a **flat list of events** stored in KV under the key `schedule`.
This is the single source of truth for **both** the app display and the cron
notifications, so they can never drift apart.

```jsonc
[
  { "id": "e9", "start": "16:30", "end": "18:30", "task": "Tutor Time 📚", "days": [0,1,2,3,4] },
  { "id": "e25","start": "16:30", "end": "18:30", "task": "Art Time 🎨",   "days": [5] }
]
```

- `days` is an array of **0=Mon … 6=Sun** — this is what makes "3 days a week"
  events (e.g. `[0,2,4]` = Mon/Wed/Fri) and weekend-only events trivial.
- `id` is stable, so done-checkmarks survive edits (they track by id, not position).
- If KV has no `schedule` yet, the Worker falls back to a seeded `DEFAULT_SCHEDULE`.

---

## 3. Flow: editing the schedule (PIN-gated)

```mermaid
sequenceDiagram
    actor U as Parent
    participant APP as App (editor)
    participant W as Worker
    participant KV as KV

    U->>APP: Tap version label ×5
    APP->>U: Prompt for PIN
    U->>APP: Enter 7777
    APP->>APP: Open editor (clone current schedule)
    U->>APP: Add / edit / remove events,<br/>toggle days (M T W T F S S)
    U->>APP: Tap Save
    APP->>W: POST /schedule { pin, schedule }
    W->>W: Check PIN == ADMIN_PIN
    W->>W: validateSchedule() (times, days, names)
    W->>KV: put("schedule", events)
    W-->>APP: { ok:true, count }
    APP->>APP: Update localStorage cache + re-render
    Note over APP,KV: Next app load & next cron tick<br/>use the new schedule automatically
```

---

## 4. Flow: app load (offline-friendly)

```mermaid
sequenceDiagram
    participant APP as App
    participant LS as localStorage
    participant W as Worker
    participant KV as KV

    APP->>LS: loadCachedSchedule()
    LS-->>APP: cached events (instant render)
    APP->>APP: renderSchedule()
    APP->>W: GET /schedule (network refresh)
    W->>KV: get("schedule")
    KV-->>W: events (or seed default)
    W-->>APP: events JSON
    APP->>LS: cache fresh copy
    APP->>APP: re-render if changed
```

The cached copy means the app renders instantly and still works offline; the
network fetch quietly refreshes it in the background.

---

## 5. Flow: background notification

```mermaid
sequenceDiagram
    participant CRON as Cron (every min)
    participant W as Worker
    participant KV as KV
    participant A as Apple Push
    participant SW as Service Worker
    actor G as Gemma

    CRON->>W: scheduled()
    W->>KV: get("gemma") subscription
    W->>KV: get("schedule")
    W->>W: today's events = filter by weekday
    W->>W: any event starting in 5 min?
    alt yes
        W->>W: encrypt payload (aes128gcm) + sign VAPID JWT
        W->>A: POST encrypted push
        A->>SW: push event (app can be closed)
        SW->>G: showNotification("Coming up…")
    else no
        W-->>CRON: done (no-op)
    end
```

**Why aes128gcm:** iOS Safari Web Push requires RFC 8188 `aes128gcm` payload
encryption. The Worker derives the content key via ECDH + HKDF and signs requests
with a VAPID JWT (ES256).

---

## 6. Worker HTTP endpoints

| Method & path | Purpose | Auth |
|---------------|---------|------|
| `GET /schedule` | Return current schedule | none |
| `POST /schedule` | Save schedule `{ pin, schedule }` | PIN |
| `POST /subscribe` | Save device push subscription | none |
| `GET /vapid-public-key` | Return VAPID public key | none |
| `GET /test-push` | Send an immediate test push (staging) | none |
| `GET /schedule-push` | Queue a test push ~60s out (staging) | none |
| `GET /debug-sub` | Show saved subscription endpoint (staging) | none |

---

## 7. Deploy topology

```mermaid
graph LR
    DEV["Local edits"] --> STG_REPO["GemmaCalendar-staging<br/>(GitHub)"]
    DEV --> PRD_REPO["GemmaCalendar<br/>(GitHub)"]
    STG_REPO -- "Pages: main" --> STG["staging site"]
    PRD_REPO -- "Pages: main ⚠️" --> PRD["production site"]
    DEV -- "Cloudflare API (multipart PUT)" --> WORKER["Worker: gemma-calendar<br/>(shared by both)"]
```

> ⚠️ **GitHub Pages serves production from `main`, not `master`.** Push production
> changes to `main` (e.g. `git push origin HEAD:main`). The Cloudflare Worker is a
> **single shared deployment** used by both staging and production apps.

---

## 8. Roadmap

- **Calendar import** — pull events from Google/Apple Calendar and map them into the
  same `{ start, end, task, days }` event structure already used here.
