# Railway production architecture

Current beta: web/API `0.1.1` is deployed at <https://vibe-curator-production.up.railway.app> as one Railway service and one replica with Postgres and a mounted `/data` volume. `/api/health` is the deployment health check. Production releases currently use an explicit Railway CLI upload from the tested `main` worktree; GitHub auto-deploy is not assumed.

## Decision

Ship in two deliberate stages. The first deployment is a single Railway web
service with one mounted volume. It is the quickest durable beta and preserves
the current browser API. The production migration then replaces JSON metadata
with Postgres and binary files with a private Railway Bucket.

## Target topology

```text
Browser / installed PWA
  ├─ IndexedDB: local cache, offline playback, pending upload queue
  └─ HTTPS: same-origin API
        │
Railway Web service
  ├─ static Vite application
  ├─ authentication and project API
  ├─ Living Still director
  ├─ generation job submission
  └─ signed asset URL API
        ├─ Railway Postgres (metadata, ownership, manifests, jobs)
        ├─ Railway Bucket (images, masks, audio, video, exports)
        └─ Worker service (slow image/music/video generation)
```

Only the web service is publicly reachable. Postgres and workers communicate
over Railway private networking. The bucket remains private; the web API issues
short-lived presigned upload/download URLs.

## What is cached where

### Browser

- IndexedDB keeps recently opened full assets and unsynced user uploads.
- Cache Storage/service worker should keep the app shell, thumbnails, masks,
  animation recipes and small ambience packs.
- A local project change is written immediately with a client mutation id and
  uploaded in the background. The UI never waits on object storage to feel saved.
- Full masters use an LRU quota; thumbnails and manifests remain pinned.

### Railway web service

- No generated asset is kept on the container filesystem.
- HTTP responses use immutable cache headers for content-addressed assets.
- Short-lived in-memory caches may hold capability catalogs and signed URLs,
  but correctness never depends on them.

### Object storage

- Keys are content addressed: `assets/{sha256}/{variant}`.
- Original, preview, thumbnail, masks, audio stems and exports are independent
  variants so clients download only what the current view needs.
- Database rows contain keys and metadata, never image/audio bytes.

## Core database tables

- `users`: identity and plan
- `projects`: owner, title, current revision, visibility
- `project_revisions`: immutable Living Still manifest snapshots
- `assets`: object key, hash, MIME type, dimensions/duration, bytes, provenance
- `project_assets`: role (`source`, `mask`, `music`, `ambience`, `preview`)
- `generation_jobs`: provider-neutral request, status, cost, retry and result
- `market_collections` / `market_items`: curated discovery metadata
- `idempotency_keys`: prevents duplicate saves and paid generations

Every row that belongs to a user carries `owner_id`. Authorization is checked
before issuing any signed object URL.

## Download and offline policy

1. Market grid downloads metadata and small thumbnails only.
2. Opening an item downloads its manifest, preview and shared ambience pack.
3. Saving/offline-pinning downloads the full master and all required layers.
4. The browser verifies each content hash before marking an item available.
5. Cache pressure removes unpinned full masters first; the cloud copy remains.

## Generation flow

1. Browser uploads the source directly to a presigned bucket URL.
2. Web service creates a `generation_job` after validating ownership and quota.
3. Worker claims the job, calls the provider, validates output, stores variants,
   and commits a new immutable project revision.
4. Browser polls initially; server-sent events can replace polling later.
5. Provider keys exist only on web/worker services and never in browser bundles.

Ordinary Living Still playback performs no model calls. The model produces a
bounded manifest; trusted runtime recipes render the motion locally.

## Deployment phases

### Phase 1 — durable Railway beta (implemented in this repository)

- Railpack builds the Vite bundle and starts the preview host with API middleware.
- `/api/health` supports Railway health checks.
- Attach one volume at `/data` and set `VIBE_DATA_DIR=/data`.
- Run exactly one replica while binary assets remain on the attached volume.
- Schedule daily volume backups.

Better Auth and ownership-scoped project/folder metadata now use Railway
Postgres. Every visitor receives an anonymous authenticated identity; linking a
Google account transfers that guest library to the permanent identity. The API
always derives `owner_id` from the HttpOnly session cookie rather than accepting
one from the browser. Binary assets are stored under a per-owner volume path and
their authorization metadata is stored in Postgres.

### Phase 2 — object storage and revision history

- Provision a private Railway Bucket in the same region.
- Add a storage interface with volume and S3 adapters.
- Backfill `.vibe-data` metadata/assets into Postgres/Bucket.
- Switch reads, verify hashes/counts, then switch writes.
- Preserve the same session-derived ownership checks when signed URLs replace
  authenticated asset proxying.

### Phase 3 — generation workers

- Move provider calls into a separately scalable worker.
- Add job leasing, timeouts, retry budgets, cancellation and cost accounting.
- Keep the public web service responsive during long image/music/video jobs.

## Railway setup checklist

1. Create a Railway project and web service from this repository.
2. Generate a public Railway domain.
3. Add a volume mounted at `/data`.
4. Set `VIBE_DATA_DIR=/data` plus server-only provider keys.
5. Do not prefix secrets with `VITE_`.
6. Deploy one replica and enable daily volume backups.
7. Verify `/api/health`, create a project, upload an asset, redeploy, and confirm
   both survive before inviting users.

## Repeat deployment

From a clean worktree at the same commit as `origin/main`:

```sh
npm run build
npm run verify:chrome
npm run test:native
npm run check:native
railway up --detach -y --service vibe-curator --environment production --message "<release>"
railway deployment list --limit 1
```

Wait for `SUCCESS`, inspect build/deploy logs, then smoke-test `/api/health`, `/`, and `/desktop`. A successful Git push alone does not deploy this service under its current CLI-upload configuration.
