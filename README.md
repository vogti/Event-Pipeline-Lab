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
        V5__virtual_devices.sql
        V6__virtual_device_brightness_voltage.sql
        V7__reconcile_groups_and_virtual_devices_to_physical_devices.sql
        V8__cleanup_virtual_rows_from_device_status.sql
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

## Default Credentials

- Admin: `admin` / `admin123`

Student group accounts are **not** pre-seeded with fixed PINs anymore.
They are provisioned automatically when a physical device is first discovered via MQTT.

## Strict Device Provisioning Procedure

1. Physical device sends first MQTT message (for example `epld/epld07/status/heartbeat`).
2. Backend auto-creates (if missing):
   - Student account `epld07` (group `epld07`, enabled)
   - Random 4-digit PIN (for first creation only)
   - Virtual device `eplvd07` mapped to `epld07`
3. Admin retrieves or changes PIN:
   - UI: device settings modal in admin device page
   - API:

```bash
ADMIN_TOKEN=$(docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","pin":"admin123"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/api/admin/devices/epld07/pin -H "X-EPL-Session: ${ADMIN_TOKEN}"
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/admin/devices/epld07/pin -H "X-EPL-Session: ${ADMIN_TOKEN}" -H 'Content-Type: application/json' -d '{"pin":"1234"}'
```

Flyway migration `V7__reconcile_groups_and_virtual_devices_to_physical_devices.sql` enforces strict alignment on deployment updates:

- removes student groups/virtual devices without a discovered physical `epldNN...`
- creates missing student groups/virtual devices for discovered physical devices
- normalizes account-to-group mapping (`username == group_key`)

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
# ensure physical device epld01 is discovered at least once
docker compose exec -T mosquitto mosquitto_pub -h localhost -t epld/epld01/status/heartbeat -m '{"online":true}'
# ensure PIN first (replace 1234 as needed)
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/admin/devices/epld01/pin -H "X-EPL-Session: ${ADMIN_TOKEN}" -H 'Content-Type: application/json' -d '{"pin":"1234"}'
STUDENT_TOKEN=$(docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"epld01","pin":"1234"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/api/student/bootstrap -H "X-EPL-Session: ${STUDENT_TOKEN}"

# Student config update (capability-gated)
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/student/config -H "X-EPL-Session: ${STUDENT_TOKEN}" -H 'Content-Type: application/json' -d '{"config":{"displayMode":"compact","commandPanel":true}}'

# Student command (allowed for own group device)
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/student/command -H "X-EPL-Session: ${STUDENT_TOKEN}" -H 'Content-Type: application/json' -d '{"deviceId":"epld01","command":"LED_GREEN","on":true}'

# System status (admin)
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/api/admin/system-status -H "X-EPL-Session: ${ADMIN_TOKEN}"

# Reset stored events (admin, destructive)
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST http://backend:8080/api/admin/system-status/events/reset -H "X-EPL-Session: ${ADMIN_TOKEN}" -H 'Content-Type: application/json' -d '{"confirm":true}'
```

## System Data Export / Import

UI path:

- `System Status` -> `Data export` / `Data import`
- Select which sections should be exported/imported.
- Import flow is 2-step: `Verify import` first, then `Import selected`.

Archive format:

- Export produces a ZIP archive.
- `schema.json` contains format/schema metadata and the list of exported parts.
- Each selected part is stored as its own JSON file under `parts/`.

CLI example:

```bash
# Export selected sections to a ZIP archive
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS -X POST \
  http://backend:8080/api/admin/system-status/export \
  -H "X-EPL-Session: ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"parts":["APP_SETTINGS","TASK_STATE","GROUP_STATE","AUTH_ACCOUNTS","DEVICE_STATUS","VIRTUAL_DEVICE_STATE","EVENT_DATA"]}' \
  > /tmp/epl-system-export.zip

# Verify an import archive (multipart upload)
docker run --rm --network epl_default -v /tmp:/tmp curlimages/curl:8.12.1 -sS -X POST \
  http://backend:8080/api/admin/system-status/import/verify \
  -H "X-EPL-Session: ${ADMIN_TOKEN}" \
  -F "file=@/tmp/epl-system-export.zip;type=application/zip"

# Apply selected sections from the import archive (multipart upload)
docker run --rm --network epl_default -v /tmp:/tmp curlimages/curl:8.12.1 -sS -X POST \
  http://backend:8080/api/admin/system-status/import/apply \
  -H "X-EPL-Session: ${ADMIN_TOKEN}" \
  -F "file=@/tmp/epl-system-export.zip;type=application/zip" \
  -F "selectedParts=APP_SETTINGS" \
  -F "selectedParts=TASK_STATE" \
  -F "selectedParts=GROUP_STATE"
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
