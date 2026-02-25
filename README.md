# Event Pipeline Lab (EPL) - Phase 1 Foundation

Phase 1 delivers a reliable ingestion and live-streaming baseline for the EPL lecture demo:

- Docker Compose stack (`postgres`, `mosquitto`, `backend`, optional `cloudflared`)
- Spring Boot modular monolith foundation (Java 25, Spring Boot 4.x)
- MQTT ingestion + canonical event normalization + PostgreSQL persistence
- Device health tracking (online/offline, last seen, RSSI when available)
- Admin REST endpoints + WebSocket push
- Bounded in-memory live feed buffer
- Classical rolling log files (`logs/epl-backend.log`)

## Project structure

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
      db/migration/V1__init_phase1_schema.sql
      db/migration/V2__json_columns_to_text.sql
      static/admin-test.html
    Dockerfile
    build.gradle
    settings.gradle
  frontend/
    src/
    package.json
    vite.config.ts
  infra/
    mosquitto/mosquitto.conf
    cloudflared/config.yml.example
  docker-compose.yml
```

## Frontend framework confirmation

Chosen frontend framework: **React + Vite + TypeScript** (`/frontend` scaffolded for Phase 2).

Phase 1 live test UI is served by backend at:

- [http://localhost:8080/admin-test.html](http://localhost:8080/admin-test.html)

## Docker Compose services (exact)

1. `postgres`
2. `mosquitto`
3. `backend`
4. `cloudflared` (optional, `public` profile)

## Compose and infra config files

- `/docker-compose.yml`
- `/infra/mosquitto/mosquitto.conf`
- `/infra/cloudflared/config.yml.example`
- `/backend/Dockerfile`
- `/backend/build.gradle`
- `/backend/settings.gradle`
- `/backend/src/main/resources/application.yml`
- `/backend/src/main/resources/db/migration/V1__init_phase1_schema.sql`
- `/backend/src/main/resources/db/migration/V2__json_columns_to_text.sql`

## Run locally

1. Start stack:

```bash
docker compose up --build -d
```

2. Check backend health:

```bash
docker compose exec -T backend sh -lc 'echo OK'
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/actuator/health
```

Expected: `{"status":"UP"...}`

## Classical log files

Backend logs are written to a classical rolling log file:

- container path: `/app/logs/epl-backend.log`
- compose volume: `backend_logs`

Live log stream is still available via:

```bash
docker compose logs -f backend
```

## Test MQTT ingestion locally

### A) Canonical EPL topic schema (`epld/{deviceId}/...`)

Publish a button event:

```bash
docker compose exec -T mosquitto mosquitto_pub -h localhost -t epld/epld01/event/button -m '{"button":"black","action":"press"}'
```

Publish Wi-Fi status update:

```bash
docker compose exec -T mosquitto mosquitto_pub -h localhost -t epld/epld01/status/wifi -m '{"rssi":-61,"ssid":"lab-wifi"}'
```

### B) Shelly capture-compatible topics (supported in Phase 1 normalizer)

Publish online transition:

```bash
docker compose exec -T mosquitto mosquitto_pub -h localhost -t epld01/online -m 'true'
```

Publish `NotifyStatus` button press:

```bash
docker compose exec -T mosquitto mosquitto_pub -h localhost -t epld01/events/rpc -m '{"method":"NotifyStatus","params":{"ts":1772015093.26,"input:0":{"state":true}}}'
```

Publish telemetry payload:

```bash
docker compose exec -T mosquitto mosquitto_pub -h localhost -t epld01/telemetry -m '{"kind":"epl_shelly_telemetry_v1","wifi":{"rssi":-58},"mqtt":{"connected":true}}'
```

## Verify ingestion + live feed

Recent canonical events:

```bash
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS "http://backend:8080/api/admin/events?limit=20"
```

Bounded live buffer snapshot:

```bash
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS "http://backend:8080/api/admin/events/live?limit=20"
```

Device status:

```bash
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS "http://backend:8080/api/admin/devices"
```

Live WebSocket stream:

- URL: `ws://localhost:8080/ws/admin`
- Browser test page: [http://localhost:8080/admin-test.html](http://localhost:8080/admin-test.html)

## Cloudflare tunnel (optional)

The `cloudflared` service now uses file-based config (`infra/cloudflared/config.yml.example`) instead of token environment variables.

Run with public profile:

```bash
docker compose --profile public up -d cloudflared
```

Local fallback remains available at `http://localhost:8080`.

## Phase 1 scope note

Auth/session, task/scenario engine, group collaboration sync, and full React student/admin UIs are intentionally deferred to Phase 2+.
The backend package structure for these modules is scaffolded to keep expansion clean.
