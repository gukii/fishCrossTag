# Fish Cross Tag

Mobile-first koi annotation tooling for line-based fish tagging, dataset management, and iterative YOLO training.

The current production-style GitHub Pages tagger should stay on `main`. The Railway session service lives on `railway-session-service`.

## Branches

- `main`: current GitHub Pages static tagger app.
- `railway-session-service`: Bun API, embeddable session route, parent-demo, webhook delivery, and Railway deployment config.
- `tanstack-dashboard`: old working branch name kept for now; use `railway-session-service` for new Railway deployments.

Keep GitHub Pages pointed at `main`. Point Railway at `railway-session-service`.

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

The local one-process check is the closest match to Railway because Bun serves both `/api/*` and the built React app.

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

## Current Deployments

GitHub Pages static tagger:

```txt
https://gukii.github.io/fishCrossTag/
```

Railway session service:

```txt
https://fishcrosstag.up.railway.app/
https://fishcrosstag.up.railway.app/api/health
https://fishcrosstag.up.railway.app/parent-demo
```

Use Railway for the parent/session proof. GitHub Pages currently hosts only the stable static tagger on `main`.

## Standalone Session Flow

The `railway-session-service` branch includes the standalone tagger/session proof.

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
3. embeds `/s/:sessionId` in an iframe or opens it in a new tab
4. lets the user tag the image with the current tagger UI
5. saves the completed result through `POST /api/sessions/:id/complete` when the green checkmark is clicked
6. receives a browser message, SSE event, or polling update
7. hides/closes the tagger UI and displays corrected fish previews plus the completed JSON

This proves the standalone service shape. If `webhookUrl` is included when creating the session, the API also POSTs the completed result to that URL.

In the Railway parent demo use:

```txt
API URL: https://fishcrosstag.up.railway.app
Webhook URL: leave empty for normal browser demo testing
```

The new-tab path uses `window.open(...)` so the tagger tab keeps `window.opener`. Do not add `rel="noreferrer"` to the parent link/button because that prevents the tagger tab from sending the result back and closing itself.

For production integration, the caller should usually pass a `webhookUrl` when creating the session. That makes completion server-to-server and avoids depending on the browser staying open.

The current webhook delivery is intentionally simple: one POST attempt when the tagger completes. The session records the delivery status. Retry queues, signatures, and caller authentication are still future work.

## Security Status

The current Railway proof does not use a secret.

Current behavior:

- `POST /api/sessions` is open.
- Webhook delivery is not signed.
- Image URLs are trusted as provided by the caller.
- `parentOrigin` is passed in the tagger URL and used for browser `postMessage`.
- Sessions are stored in memory and disappear on restart/sleep.

This is acceptable for trusted testing, but not production.

Production controls to add:

- Require an API key when creating sessions:

```txt
Authorization: Bearer <FISHCROSS_API_KEY>
```

- Sign webhook payloads with HMAC:

```txt
X-FishCross-Signature: sha256=...
```

- Use short-lived signed launch URLs if the parent opens a one-step `/tag?imageUrl=...` URL.
- Persist sessions and webhook delivery records.
- Validate allowed caller origins instead of accepting arbitrary `parentOrigin` values.

To test webhook delivery without a parent backend:

1. Open `https://webhook.site/`.
2. Copy the unique URL.
3. Paste it into `Webhook URL`.
4. Create a session, tag a fish, and click the green checkmark.
5. Confirm webhook.site received the POST.

Webhook payload:

```json
{
  "type": "fishcross.session.completed",
  "sessionId": "session_...",
  "image": {
    "id": "image_123",
    "url": "https://..."
  },
  "metadata": {},
  "result": {
    "sessionId": "session_...",
    "imageId": "image_123",
    "annotations": [
      {
        "fishId": "...",
        "bodyLine": [],
        "finLine": [],
        "correctedBox": {},
        "cropBox": {},
        "rotationDeg": 0,
        "rotationPivot": { "x": 0.5, "y": 0.5 },
        "correctedPolygon": [],
        "buckets": [],
        "preview": {
          "dataUrl": "data:image/jpeg;base64,...",
          "width": 120,
          "height": 360,
          "mimeType": "image/jpeg"
        }
      }
    ],
    "completedAt": "..."
  },
  "deliveredAt": "..."
}
```

Current session endpoints:

```txt
POST /api/sessions
GET  /api/sessions/:sessionId
GET  /api/sessions/:sessionId/events
POST /api/sessions/:sessionId/draft
POST /api/sessions/:sessionId/complete
```

SSE is still kept for browser-only demos because GitHub Pages cannot receive inbound webhook requests. A real parent backend can use the webhook as the primary completion channel.

## Railway Plan

Use Railway for orchestration, not GPU training.

Current first deployment:

```txt
fishcross-tagger
  Bun server
  serves /api/*
  serves the built React app from dist/
  stores sessions in memory
```

Railway build/start:

```txt
Branch: railway-session-service
Builder: Dockerfile
Build command: empty
Start command: bun server/api.ts
```

The repository includes:

```txt
Dockerfile
railway.json
```

The Dockerfile pins:

```txt
node:22-bookworm-slim
pnpm@10.18.3
bun@1.2.5
```

Railway sets `PORT` automatically. `server/api.ts` reads it and starts Bun on that port. No SQLite volume is needed for this proof.

Important limitation: in-memory sessions disappear when the service restarts. That is acceptable for proving the parent-app/session workflow, but not for production tagging.

After Railway deploys, test:

```txt
https://your-railway-service.up.railway.app/api/health
https://your-railway-service.up.railway.app/parent-demo
```

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

We want the core tagger to be reusable from a parent image manager/dashboard.

### Recommended: session page in iframe or new tab

This is the best default for mobile-first use.

Benefits:

- isolates touch/pointer/zoom behavior from the parent app
- avoids CSS conflicts with dashboard layouts
- lets the tagger run full screen on mobile
- works from another app, a dashboard, or a future customer portal
- easier to keep the tagger deployable as its own GitHub Pages app

Use this when the parent app wants to call the tagger, pass in a photo, and get annotation data back.

### Minimal Parent App Integration

The API does not open the tagger UI by itself. The parent app creates the session, then opens the returned tagger route in a tab or iframe.

Create a session:

```ts
const response = await fetch("https://fishcrosstag.up.railway.app/api/sessions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    image: {
      id: "photo_123",
      url: "https://your-app.example/photos/pond-photo.jpg",
      name: "pond-photo.jpg"
    },
    metadata: {
      source: "your-parent-app",
      userId: "user_1"
    },
    webhookUrl: "https://your-parent-app.example/api/fishcross/webhook"
  })
});

const { session, taggerUrl } = await response.json();
```

Open as a new tab:

```ts
const fullTaggerUrl =
  `https://fishcrosstag.up.railway.app${taggerUrl}` +
  `?parentOrigin=${encodeURIComponent(window.location.origin)}` +
  `&closeOnComplete=true`;

window.open(fullTaggerUrl, "_blank");
```

Or embed as an iframe:

```tsx
<iframe src={fullTaggerUrl} title="FishCross tagger" />
```

Listen for browser completion:

```ts
window.addEventListener("message", (event) => {
  if (event.origin !== "https://fishcrosstag.up.railway.app") return;
  if (event.data?.type !== "fishcross-tagger:complete") return;

  const result = event.data.payload;
  console.log(result.annotations);
});
```

If `webhookUrl` is provided, the same completion payload is also sent server-to-server. Use the browser message for immediate UI feedback and the webhook for durable backend handoff.

Parent creates a session:

```http
POST /api/sessions
Content-Type: application/json

{
  "image": {
    "id": "image_123",
    "name": "pond-photo.jpg",
    "url": "https://storage.example.com/originals/pond-photo.jpg",
    "width": 1920,
    "height": 1080
  },
  "metadata": {
    "queueId": "needs-first-pass",
    "userId": "annotator_1"
  },
  "webhookUrl": "https://parent.example.com/api/fishcross/webhook",
  "options": {
    "allowOneSidedFin": true,
    "returnThumbnails": true
  }
}
```

API responds with:

```json
{
  "session": {
    "id": "session_..."
  },
  "taggerUrl": "/s/session_..."
}
```

Parent opens or embeds:

```txt
https://fishcrosstag.up.railway.app/s/session_...?parentOrigin=https%3A%2F%2Fparent.example.com&closeOnComplete=true
```

For an iframe, use the same URL in `src`.

For a new tab, use `window.open(taggerUrl, "_blank")`. Do not use `noreferrer`; the tagger needs `window.opener` to send the browser message back and close the tab.

When the user clicks the green checkmark, the tagger:

1. posts the result to `POST /api/sessions/:sessionId/complete`
2. sends `fishcross-tagger:complete` to `window.parent` or `window.opener`
3. attempts to close the tab if opened by the parent and `closeOnComplete` is not `false`
4. sends the webhook server-to-server if the session has `webhookUrl`

Browser message:

```ts
{
  type: "fishcross-tagger:complete",
  sessionId: "session_...",
  payload: {
    sessionId: "session_...",
    imageId: "image_123",
    annotations: [
      {
        fishId: "fish_1",
        bodyLine: [{ x: 0.12, y: 0.82 }, { x: 0.4, y: 0.2 }],
        finLine: [{ x: 0.18, y: 0.55 }, { x: 0.32, y: 0.56 }],
        finMode: "one-sided-visible",
        correctedBox: { x: 0.1, y: 0.2, width: 0.2, height: 0.6 },
        cropBox: { x: 0.1, y: 0.2, width: 0.2, height: 0.6 },
        rotationDeg: 12.5,
        rotationPivot: { x: 0.2, y: 0.5 },
        correctedPolygon: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.2 },
          { x: 0.3, y: 0.8 },
          { x: 0.1, y: 0.8 }
        ],
        buckets: ["has_fin_line", "one_sided_fin", "bent_body"],
        preview: {
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,...",
          width: 120,
          height: 360
        }
      }
    ],
    metadata: {},
    completedAt: "..."
  }
}
```

Use strict origin checks on both sides. Never accept messages from `*` in production.

Current message type:

```txt
fishcross-tagger:complete
```

The API also supports SSE on `/api/sessions/:sessionId/events` and polling through `GET /api/sessions/:sessionId`. These are mainly for browser-only demos and fallback behavior. A production parent backend should prefer the webhook.

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

## Tagger Session API

```txt
GET  /api/health
POST /api/sessions
GET  /api/sessions/:sessionId
GET  /api/sessions/:sessionId/events
POST /api/sessions/:sessionId/draft
POST /api/sessions/:sessionId/complete
```

The current session store is memory-only. Sessions survive while the Railway process is awake. They disappear on restart or sleep.

That is acceptable for the proof. Persistent storage should be added before production use.

## Near-Term Implementation Steps

1. Add persistent session storage, likely SQLite on a Railway volume first.
2. Add API-key authentication for session creation.
3. Add webhook signing, retry records, and a resend endpoint.
4. Add caller identity so sessions can be tied to a parent app/user/queue.
5. Add signed launch URLs for one-step `/tag?imageUrl=...` integration.
6. Add upload pipeline and object storage adapter for originals and exports.
7. Move large previews/exports out of JSON payloads and into object storage URLs.
8. Make `/dashboard` fetch live queue/session/training data.
9. Add dataset export jobs for YOLO training.
10. Add training-run orchestration for RunPod/Vast workers.

Keep the current GitHub Pages tagger stable on `main`. Build Railway session orchestration on `railway-session-service`.
