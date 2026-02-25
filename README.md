# Event Pipeline Lab (EPL) - Phase 1 + Phase 2 Foundation

This repository currently delivers:

- **Phase 1**: reliable MQTT ingestion, canonical normalization, persistence, bounded live feeds, device health
- **Phase 2**: auth/session, task activation + capability gating, group shared config + presence sync, admin/student REST APIs, authenticated WebSocket channels, and React frontend dashboards

Backend package namespace: `ch.marcovogt.epl`.
Build system: **Gradle**.
Configuration style: classical config files and Docker Compose service env values (no `.env` files required).

## Stack

- Java 25
- Spring Boot 4.x
- Spring Web, WebSocket, Security, Data JPA, Validation, Actuator
- Eclipse Paho MQTT client
- PostgreSQL + Flyway
- React + Vite + TypeScript frontend (`frontend/`)
- Docker Compose with `postgres`, `mosquitto`, `backend`, optional `cloudflared`

## Project Structure

```text
Event-Pipeline-Lab/
  backend/
    src/main/java/ch/marcovogt/epl/
      admin/
      authsession/
      deviceregistryhealth/
      mqttgateway/
      eventingestionnormalization/
      eventfeedquery/
      realtimewebsocket/
      taskscenarioengine/
      groupcollaborationsync/
      auditlogging/
      config/
    src/main/resources/
      application.yml
      db/migration/
        V1__init_phase1_schema.sql
        V2__json_columns_to_text.sql
        V3__phase2_auth_task_group.sql
        V4__app_settings_time_format_24h.sql
      static/admin-test.html
    Dockerfile
    build.gradle
    settings.gradle
  frontend/
    Dockerfile
    nginx.conf
  infra/
    mosquitto/mosquitto.conf
    cloudflared/config.yml.example
  docker-compose.yml
```

## Docker Compose Services

1. `postgres`
2. `mosquitto`
3. `backend`
4. `frontend`
5. `cloudflared` (optional, profile: `public`)

## Run Locally

```bash
docker compose up --build -d
```

## Update Running Deployment

Run these commands from the repository root on the target VM.

### Standard update (recommended)

```bash
git pull
docker compose build backend frontend
docker compose up -d backend frontend
```

### One-command update

```bash
docker compose up -d --build
```

### Verify after update

```bash
docker compose ps
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/actuator/health
docker compose logs backend --tail=80
```

Notes:

- Flyway migrations run automatically when backend starts.
- Existing Postgres data is kept (no volume deletion in the commands above).
- If you use the optional public tunnel, also update/restart it with:

```bash
docker compose --profile public up -d cloudflared
```

Frontend UI:

- [http://localhost:5173](http://localhost:5173)

Backend API (direct, optional):

- [http://localhost:8080](http://localhost:8080)

Health check:

```bash
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/actuator/health
```

Expected: `{"status":"UP",...}`

## Frontend Run (Phase 2 UI)

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Vite runs on `http://localhost:5173` and proxies `/api` + `/ws` to backend.
For one-command stack startup, prefer Docker Compose.

## Default Phase 2 Credentials (dev seed)

- Admin: `admin` / `admin123`
- Student groups: `epld01..epld12` / `1234`

Seed data is created by Flyway migration `V3__phase2_auth_task_group.sql`.

## MQTT Ingestion Test

Publish canonical EPL event:

```bash
docker compose exec -T mosquitto mosquitto_pub -h localhost -t epld/epld01/event/button -m '{"button":"black","action":"press"}'
```

Check admin events feed (auth required):

```bash
ADMIN_TOKEN=$(docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","pin":"admin123"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS "http://backend:8080/api/admin/events?limit=20" -H "X-EPL-Session: ${ADMIN_TOKEN}"
```

## Phase 2 API Smoke Test

```bash
# Admin login
ADMIN_TOKEN=$(docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","pin":"admin123"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')

# Admin task list + activate

docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/api/admin/tasks -H "X-EPL-Session: ${ADMIN_TOKEN}"
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/admin/task/activate -H "X-EPL-Session: ${ADMIN_TOKEN}" -H 'Content-Type: application/json' -d '{"taskId":"task_commands"}'

# Student login + bootstrap
STUDENT_TOKEN=$(docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"epld01","pin":"1234"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/api/student/bootstrap -H "X-EPL-Session: ${STUDENT_TOKEN}"

# Student config update (capability-gated)
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/student/config -H "X-EPL-Session: ${STUDENT_TOKEN}" -H 'Content-Type: application/json' -d '{"config":{"displayMode":"compact","commandPanel":true}}'

# Student command (allowed for own group device)
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/student/command -H "X-EPL-Session: ${STUDENT_TOKEN}" -H 'Content-Type: application/json' -d '{"deviceId":"epld01","command":"LED_GREEN","on":true}'
```

## WebSocket Channels

- Admin: `ws://localhost:8080/ws/admin?token=<adminSessionToken>`
- Student: `ws://localhost:8080/ws/student?token=<studentSessionToken>`

Server push event types include:

- `task.updated`
- `capabilities.updated`
- `group.presence.updated`
- `group.config.updated`
- `event.feed.append`
- `device.status.updated`
- `admin.groups.updated`
- `settings.updated`
- `ws.ping`
- `error.notification`

## Admin Test Page

A lightweight authenticated test client is served by backend:

- [http://localhost:8080/admin-test.html](http://localhost:8080/admin-test.html)

Use the login form on the page (defaults: `admin/admin123`) before loading feeds.

## Logging

Backend writes rolling file logs to:

- container path: `/app/logs/epl-backend.log`
- compose volume: `backend_logs`

Also available via:

```bash
docker compose logs -f backend
```

## Cloudflare Tunnel (optional)

```bash
docker compose --profile public up -d cloudflared
```

Config file:

- `infra/cloudflared/config.yml.example`

Local fallback remains `http://localhost:8080`.
