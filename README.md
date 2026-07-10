# Fish Cross Tag

Mobile-first koi annotation tooling for line-based fish tagging, dataset management, and iterative YOLO training.

The current production-style GitHub Pages tagger should stay on `main`. The dashboard/API/Railway work lives on the `tanstack-dashboard` branch.

## Branches

- `main`: current GitHub Pages tagger app.
- `tanstack-dashboard`: dashboard, workflow, Bun API, SQLite, and future Railway deployment work.

Keep GitHub Pages pointed at `main` until the dashboard branch is ready to become a separate deployed app.

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the current React app:

```bash
pnpm dev
```

Open:

```txt
http://127.0.0.1:5185/
http://127.0.0.1:5185/dashboard
http://127.0.0.1:5185/parent-demo
```

Run the Bun API:

```bash
pnpm dev:api
```

API defaults:

```txt
http://localhost:3000/api/health
http://localhost:3000/api/dashboard
http://localhost:3000/api/sessions/:id
```

For a one-process local check after building:

```bash
pnpm build
pnpm start
```

Then open:

```txt
http://localhost:3000/
http://localhost:3000/parent-demo
```

## Current App Shape

Frontend routes are currently simple pathname switches:

- `/`: mobile tagger
- `/affine`: older geometry prototype
- `/dashboard`: image manager / workflow dashboard
- `/parent-demo`: local proof that a parent app can create and embed a tagger session
- `/s/:sessionId`: standalone tagger session route

The dashboard currently uses seed data. The Bun API uses in-memory sessions for the first Railway proof and has endpoint skeletons for:

- image batches
- images
- queues
- annotation tasks
- annotation results
- model predictions
- consensus annotations
- dataset versions
- training runs
- model versions
- tagger sessions

## Standalone Tagger Proof

The `tanstack-dashboard` branch now includes a minimal standalone tagger proof.

Run both processes:

```bash
pnpm dev
pnpm dev:api
```

Open:

```txt
http://127.0.0.1:5185/parent-demo
```

The parent demo:

1. accepts a photo URL
2. creates a tagger session through `POST /api/sessions`
3. embeds `/s/:sessionId` in an iframe
4. lets the user tag the image with the current tagger UI
5. saves the completed result through `POST /api/sessions/:id/complete`
6. receives a browser message from the iframe and displays the completed JSON

This proves the standalone service shape without implementing webhook delivery yet.

The parent demo can also run from GitHub Pages while using a Railway API. Open the GH Pages `/parent-demo` page and paste the Railway service URL into the `API URL` field:

```txt
https://your-railway-service.up.railway.app
```

When a session is created, the iframe/new-tab tagger stays on the static site, but all `/api/sessions/*` calls go to Railway. The API URL is stored in browser local storage and also passed to `/s/:sessionId` as an `apiBase` query parameter.

Current session endpoints:

```txt
POST /api/sessions
GET  /api/sessions/:sessionId
POST /api/sessions/:sessionId/draft
POST /api/sessions/:sessionId/complete
```

Automatic caller logging and webhook delivery are intentionally deferred. The next step is to add caller identity, webhook signing, retryable delivery records, and manager-side webhook handling.

## Railway Plan

Use Railway for orchestration, not GPU training.

First deployment:

```txt
fishcross-tagger
  Bun server
  serves /api/*
  serves the built React app from dist/
  stores sessions in memory
```

Railway build/start:

```txt
Build command: pnpm build
Start command: pnpm start
```

Railway sets `PORT` automatically. No SQLite volume is needed for this proof.

Important limitation: in-memory sessions disappear when the service restarts. That is acceptable for proving the parent-app/session workflow, but not for production tagging.

After Railway deploys, test:

```txt
https://your-railway-service.up.railway.app/api/health
https://your-railway-service.up.railway.app/parent-demo
```

To test from GitHub Pages instead, open the GH Pages `/parent-demo` route and use the same Railway URL in the `API URL` field.

Later production deployment:

```txt
fishcross-tagger
  Bun API + React app
  SQLite or Postgres metadata store
  object storage credentials
```

Future persistent storage variables:

```txt
SQLITE_PATH=/data/koi-tag-line.sqlite
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_PUBLIC_BASE_URL=
```

If SQLite is used later, mount a Railway volume at:

```txt
/data
```

Do not store original images or trained models in SQLite. SQLite stores metadata and annotation JSON. Object storage stores originals, thumbnails, dataset archives, model weights, metrics files, and exported artifacts.

## Training Workflow

The intended workflow:

1. User uploads a batch of photos.
2. Original photos go to object storage.
3. SQLite records image metadata, checksum, dimensions, source batch, and split.
4. Current YOLO model optionally creates model predictions.
5. Users correct/add/delete fish annotations in queues.
6. Hard cases can require 2, 3, or 4 independent annotation results.
7. Agreement scoring creates or flags consensus annotations.
8. Approved consensus annotations are frozen into a dataset version.
9. Railway creates a dataset archive in object storage.
10. A temporary GPU worker downloads the archive locally, trains, uploads results, and shuts down.
11. Railway records metrics and model artifacts.

GPU providers like RunPod/Vast should receive a frozen dataset archive, not thousands of image URLs during training.

## Validation Buckets

Bucket labels should be derived from line geometry and polygon/crop geometry where possible.

Examples:

- `has_fin_line`
- `no_fin_line`
- `one_sided_fin`
- `two_sided_fin`
- `bent_body`
- `straight_body`
- `edge_cut`
- `small_fish`
- `large_fish`
- `wide_crop_needed`

These buckets are useful for validation coverage, active learning, and model comparison. They should be derived metadata, not manually entered truth.

## Embedding The Tagger

We want the core tagger to be reusable from a parent image manager/dashboard. There are two realistic integration styles.

### Recommended: iframe or new tab with `postMessage`

This is the best default for mobile-first use.

Benefits:

- isolates touch/pointer/zoom behavior from the parent app
- avoids CSS conflicts with dashboard layouts
- lets the tagger run full screen on mobile
- works from another app, a dashboard, or a future customer portal
- easier to keep the tagger deployable as its own GitHub Pages app

Use this when the parent app wants to call the tagger, pass in a photo, and get annotation data back.

Parent opens:

```txt
/tagger-session?sessionId=...&returnMode=postMessage
```

or embeds:

```html
<iframe src="/tagger-session?sessionId=abc" />
```

Parent sends an init message:

```ts
iframe.contentWindow?.postMessage(
  {
    type: "koiTagger:init",
    sessionId: "abc",
    image: {
      id: "image_123",
      name: "pond-photo.jpg",
      url: "https://storage.example.com/originals/pond-photo.jpg",
      width: 1920,
      height: 1080
    },
    options: {
      requireFinLine: false,
      allowOneSidedFin: true,
      returnThumbnails: true
    }
  },
  "https://tagger.example.com"
);
```

Tagger responds:

```ts
window.parent.postMessage(
  {
    type: "koiTagger:complete",
    sessionId: "abc",
    imageId: "image_123",
    annotations: [
      {
        fishId: "fish_1",
        bodyLine: [{ x: 0.12, y: 0.82 }, { x: 0.4, y: 0.2 }],
        finLine: [{ x: 0.18, y: 0.55 }, { x: 0.32, y: 0.56 }],
        finMode: "one-sided-visible",
        correctedBox: { x: 0.1, y: 0.2, width: 0.2, height: 0.6 },
        correctedPolygon: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.2 },
          { x: 0.3, y: 0.8 },
          { x: 0.1, y: 0.8 }
        ],
        buckets: ["has_fin_line", "one_sided_fin", "bent_body"]
      }
    ],
    thumbnails: [
      {
        fishId: "fish_1",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,..."
      }
    ]
  },
  "https://dashboard.example.com"
);
```

Use strict origin checks on both sides. Never accept messages from `*` in production.

Suggested message types:

```txt
koiTagger:init
koiTagger:saveDraft
koiTagger:complete
koiTagger:cancel
koiTagger:error
```

Draft saves can let the dashboard persist progress while a user works through a queue.

### Alternative: React component import

This is useful if the tagger and parent dashboard are always built and deployed together.

Benefits:

- direct function callbacks
- shared React state/types
- no iframe messaging
- easier unit-level integration

Costs:

- mobile pointer/pinch/zoom interactions can conflict with parent scroll/layout
- CSS and z-index conflicts are more likely
- harder to use the tagger from another app
- harder to keep GitHub Pages tagger independent

Use this only if the dashboard becomes the only host app and we no longer need the tagger as a standalone tool.

## Recommended Integration Decision

Build the tagger core as a session-based embeddable page first.

The parent app should create a tagging session, open the tagger in a full-screen iframe or new tab, and receive results through `postMessage` and/or API persistence.

For mobile, full-screen iframe/new-tab is likely better than component embedding because the tagger owns the entire gesture surface.

## Tagger Session API Shape

Future endpoints:

```txt
POST /api/tagger-sessions
GET  /api/tagger-sessions/:id
POST /api/tagger-sessions/:id/draft
POST /api/tagger-sessions/:id/complete
```

Session record should contain:

```json
{
  "id": "session_abc",
  "imageId": "image_123",
  "imageUrl": "https://...",
  "status": "open",
  "returnMode": "postMessage",
  "parentOrigin": "https://dashboard.example.com",
  "annotationJson": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

## Near-Term Implementation Steps

1. Make `/dashboard` fetch live `/api/dashboard` data.
2. Add `tagger-sessions` table and API endpoints.
3. Add `/tagger-session` route that loads one session.
4. Add `postMessage` init/complete/cancel contract.
5. Move annotation result serialization into shared code.
6. Add upload pipeline and object storage adapter.
7. Add dataset export job.
8. Add training-run orchestration.

Keep the current GitHub Pages tagger stable on `main`. Build dashboard/API/session orchestration on `tanstack-dashboard`.
