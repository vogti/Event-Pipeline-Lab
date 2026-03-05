# EPL Frontend

React + Vite TypeScript frontend for **Event Pipeline Lab (EPL)**.

This app provides the student and admin web UI and talks only to the backend via HTTP (`/api`) and WebSocket (`/ws`).
It does **not** connect directly to MQTT.

## What this frontend includes

- Login and session-based role routing (`ADMIN`, `STUDENT`)
- Student UI:
  - onboarding (display name + language)
  - dashboard, device panel, virtual device panel
  - pipeline builder (task/capability gated)
  - live event feed (bounded in-memory)
- Admin UI:
  - dashboard, devices, virtual devices, tasks, groups, disturbances, settings
  - pipeline builder and event feeds
  - stream sources, system status, import/export controls
- Realtime sync over WebSocket (`/ws/admin`, `/ws/student`)
- DE/EN i18n with runtime language switching

## Tech stack

- React 18
- TypeScript
- Vite 6
- Vitest
- ESLint
- Nginx (container runtime for production/static delivery)

## Prerequisites

- Node.js 22+ and npm
- Backend running on `http://localhost:8080` for local dev mode

## Local development

From repository root:

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Then open:

- [http://localhost:5173](http://localhost:5173)

Vite dev proxy is configured as follows:

- `/api` -> `http://localhost:8080`
- `/ws` -> `ws://localhost:8080`

## Full stack (recommended)

Start the whole EPL system from repository root:

```bash
docker compose up -d --build
```

Frontend is served by Nginx through the `frontend` service and exposed on port `5173` (host mapping defined in root `docker-compose.yml`).

## Production build

```bash
npm --prefix frontend run build
```

Build output:

- `frontend/dist`

Preview built app locally:

```bash
npm --prefix frontend run preview
```

## Quality checks

Lint:

```bash
npm --prefix frontend run lint
```

Tests:

```bash
npm --prefix frontend run test
```

Watch tests:

```bash
npm --prefix frontend run test:watch
```

## Docker image details

The frontend Dockerfile uses a multi-stage build:

1. `node:22-alpine` -> install deps + build static files
2. `nginx:1.27-alpine` -> serve `dist` + reverse proxy `/api` and `/ws` to `backend:8080`

Nginx config file:

- `frontend/nginx.conf`

## Troubleshooting

- If login fails with `502`, check backend health and proxy wiring:
  - `docker compose ps`
  - `docker compose logs backend --tail=200`
  - `docker compose logs frontend --tail=200`
- If live updates are missing, verify WebSocket upgrade path `/ws/*` is reachable via frontend proxy.
