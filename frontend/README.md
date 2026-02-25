# Frontend (Phase 2)

React + Vite TypeScript frontend for EPL Phase 2.

Implemented features:

- Auth login/logout with backend session token
- Role-aware dashboards (ADMIN / STUDENT)
- Student view:
  - active task + capabilities
  - display name update
  - group-shared config editor
  - group presence list
  - capability-gated command panel
  - live bounded event feed
- Admin view:
  - task activation
  - default language mode setting
  - device overview + command buttons
  - group overview
  - live bounded event feed with filters
- WebSocket live updates for `/ws/student` and `/ws/admin`
- Manual DE/EN language switch
- Default language mode support (`DE`, `EN`, `BROWSER_EN_FALLBACK`)

## Local run

From repo root:

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

With backend running on `localhost:8080`, Vite proxy is preconfigured for `/api` and `/ws`.

## Docker run (one-command stack)

The root `docker-compose.yml` includes a `frontend` service that serves the built app via Nginx.

- UI is exposed at `http://localhost:5173`
- `/api` and `/ws` are reverse-proxied to `backend:8080` inside Docker

## Build

```bash
npm --prefix frontend run build
```
