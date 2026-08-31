<img src="docs/logo/wordmark.svg" alt="Overlook" height="48">

An open-source, 100% web database editor with the UI/UX of a Notion-style
tool — built around one simple rule: **you should never be able to mistake
a local database for a production one.**

![Table view](docs/screenshots/table-view.png)

## Table of contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration (`.env`)](#configuration-env)
- [Telemetry](#telemetry)
- [Test databases](#test-databases)
- [Production deployment](#production-deployment)
- [Security and known limitations](#security-and-known-limitations)
- [License](#license)

## Features

- **Multiple connections** — PostgreSQL, MySQL, and SQLite, each tagged by
  environment (Local / Dev / Staging / Prod / Custom).
- **Always-visible connection indicator** — a colored badge permanently
  shown in the top bar, plus a colored strip across the whole viewport (red
  for prod), with a switcher listing every saved connection.
- **Production guardrails** — deleting a row, dropping/changing a column
  type, or running a write query against a connection tagged "prod" all
  require typing the connection's name to confirm. The Schema panel is
  read-only by default on these connections.
- **4 views** per table: Table (editable grid), Board (kanban), Calendar,
  Gallery — plus filters, sorting, and grouping.
- **Real schema editing**: add/rename/drop columns, change column types
  (actual `ALTER TABLE` statements).
- **CSV import**, a **SQL console** (Query mode, read-only by default), a
  **command palette** (⌘K), and a **modification history with undo**.

## Screenshots

| | |
|---|---|
| **Table view** — editable grid, resizable/reorderable columns | ![Table view](docs/screenshots/table-view.png) |
| **Detail panel** — edit a row, resizable | ![Detail panel](docs/screenshots/detail-panel.png) |
| **Command palette** (⌘K) — keyboard navigation | ![Command palette](docs/screenshots/command-palette.png) |
| **Export** — SQL/NDJSON, structure/data, table selection | ![Export](docs/screenshots/export-modal.png) |
| **Gallery view** | ![Gallery view](docs/screenshots/gallery-view.png) |
| **Production guardrail** — confirmation by typing the connection name | ![Production guardrail](docs/screenshots/prod-guard.png) |

## Prerequisites

- **Node.js 20+**
- **Docker** and **Docker Compose**, for the test databases only
- No external database is required to get started — Overlook works out of
  the box with SQLite if that's all you have on hand.

## Installation

The quickest way to try Overlook is the prebuilt Docker image — no Node.js
or source checkout needed:

```bash
docker run -d -p 3000:3000 -v overlook-data:/app/data --name overlook imsachacohen/overlook
```

Open [http://localhost:3000](http://localhost:3000). See
[Production deployment](#production-deployment) for the full Docker options
(persistent `APP_SECRET`, building the image yourself, etc.).

To run from source instead (e.g. to contribute):

```bash
git clone <repo-url>
cd overlook
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No external database is
required to start: the connections you create are stored in a local SQLite
file (`data/app-metadata.db`), encrypted at rest.

## Configuration (`.env`)

Copy `.env.example` to `.env` to customize (both variables are optional —
safe defaults apply otherwise):

| Variable | Role | Default |
|---|---|---|
| `APP_SECRET` | Encryption key (AES-256-GCM) for connection passwords stored on disk. | Generated and stored in `data/secret.key` on first run. |
| `DATA_DIR` | Folder holding the metadata file (`app-metadata.db`) and the secret key. | `./data` |
| `NEXT_PUBLIC_DISABLE_TELEMETRY` | Set to `1` to disable anonymous usage analytics entirely. | unset (enabled) |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID` | Point analytics at your own Microsoft Clarity project instead of the shared Overlook dashboard. | Overlook's shared project |

**In production, always set `APP_SECRET` explicitly** (a long random value,
e.g. `openssl rand -hex 32`) and keep it stable: if it changes, previously
encrypted connection passwords become unreadable.

## Telemetry

Overlook loads [Microsoft Clarity](https://clarity.microsoft.com/) to get a
rough sense of how many people run the project and which features get used —
it's how a self-hosted, source-available tool like this can be maintained
without spyware-style tracking. It records anonymous sessions (clicks,
scrolling, no account or personal identifiers) and is **not** a precise
install counter: instances with no outbound internet access (common for
locked-down internal deployments) will never report in.

Anything that can show real database content — the Table, Board, Gallery and
Calendar views, and the row detail panel — is marked `data-clarity-mask` so
Clarity redacts it from recordings regardless of your Clarity project's
default masking setting. Only chrome (menus, toolbars, dialogs) is ever
visible in a recording.

To opt out entirely, set `NEXT_PUBLIC_DISABLE_TELEMETRY=1`. To route data to
your own Clarity project instead, set `NEXT_PUBLIC_CLARITY_PROJECT_ID`.

## Test databases

A `docker-compose.yml` provides a development Postgres and MySQL, pre-seeded
with a small example schema:

```bash
docker compose up -d
```

- Postgres: `localhost:5433`, database `overlook_dev`, user/password `overlook`/`overlook`
- MySQL: `localhost:3307`, database `overlook_dev`, user/password `overlook`/`overlook`

(Ports are shifted from their defaults so they don't clash with an instance
already installed on your machine.)

For SQLite, a sample file can be generated with:

```bash
node dev/seed-sqlite.js
```

## Production deployment

Overlook stores its connections in a local SQLite file
(`data/app-metadata.db`), so it needs a **host with a persistent
filesystem** (VPS, a container with a volume, a regular Node server) —
not a serverless platform like Vercel, whose filesystem is ephemeral.

### Option A — Plain Node (VPS, dedicated server…)

```bash
npm ci
npm run build
APP_SECRET=<long-stable-secret> npm run start
```

Run `npm run start` behind a process manager (`pm2`, `systemd`) and a TLS
reverse proxy (nginx, Caddy).

### Option B — Docker

A prebuilt image is published to Docker Hub at
[`imsachacohen/overlook`](https://hub.docker.com/r/imsachacohen/overlook):

```bash
docker run -d \
  -p 3000:3000 \
  -e APP_SECRET=<long-stable-secret> \
  -v overlook-data:/app/data \
  --name overlook \
  imsachacohen/overlook
```

Or build it yourself from the included `Dockerfile` (multi-stage build,
Next.js `standalone` output):

```bash
docker build -t overlook .
docker run -d \
  -p 3000:3000 \
  -e APP_SECRET=<long-stable-secret> \
  -v overlook-data:/app/data \
  --name overlook \
  overlook
```

The `overlook-data` volume keeps saved connections (and the encryption key,
if `APP_SECRET` isn't provided) across restarts.

> **Connecting to databases running on your host machine:** inside the
> container, `localhost` refers to the container itself, not your host. Use
> `host.docker.internal` as the connection host instead (Overlook detects
> it's running in Docker and suggests this automatically in the connection
> form).

## Security and known limitations

- **No built-in access control.** This tool is meant for use in a trusted
  environment (a local machine or private network). Don't expose it
  publicly without adding an authentication layer.
- Connection passwords are encrypted (AES-256-GCM) before being written to
  disk. The encryption key comes from the `APP_SECRET` environment variable
  if set, otherwise a key is generated and stored in `data/secret.key` on
  first run.
- Connection storage relies on a local SQLite file: great for
  self-hosting (Docker, a Node server), but this file doesn't persist
  across invocations on a serverless platform with an ephemeral filesystem
  (e.g. Vercel) — in that case, this storage would need to move to a
  hosted database.
- Data queries always use parameterized statements; identifiers
  (tables/columns) are always validated against the introspected schema
  before being injected into DDL statements.
- "Formula" columns aren't supported (out of scope); relations (foreign
  keys) are shown but not editable through a dedicated picker.

## License

MIT.
