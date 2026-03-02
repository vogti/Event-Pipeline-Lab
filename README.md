# Event Pipeline Lab (EPL)

A reliable, interactive teaching platform for **event-driven data pipelines**.

EPL is designed for live classroom use with physical EPLD devices, virtual backup devices, real-time collaboration, and didactically controlled scenarios.

## Table of Contents

- [Overview](#overview)
- [Core Capabilities](#core-capabilities)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Quick Start (One Command)](#quick-start-one-command)
- [First Login and Device Provisioning](#first-login-and-device-provisioning)
- [MQTT Topics and Canonical Events](#mqtt-topics-and-canonical-events)
- [Pipeline Builder View (PBV)](#pipeline-builder-view-pbv)
- [External Stream Sources](#external-stream-sources)
- [Operations](#operations)
- [Cloudflare Tunnel (Optional Public Access)](#cloudflare-tunnel-optional-public-access)
- [Local Development and Tests](#local-development-and-tests)
- [Troubleshooting](#troubleshooting)

## Overview

EPL is a modular monolith with:

- **Backend**: Java 25 + Spring Boot 4
- **Frontend**: React + Vite + TypeScript
- **Infrastructure**: PostgreSQL, Mosquitto MQTT, optional Redpanda (Kafka-compatible), optional cloudflared tunnel

The platform supports:

- real EPLD device ingestion over MQTT
- canonical event normalization and persistence
- real-time WebSocket updates for student and admin UIs
- group-shared state and multi-user synchronization
- configurable tasks/capabilities
- disturbance/scenario simulation for teaching
- pipeline modeling with constrained block-based processing

## Core Capabilities

### Reliability and Observability

- bounded in-memory event buffers (backend and frontend)
- PostgreSQL persistence for canonical events
- health endpoints and system status dashboard
- backend rolling file logs (`/app/logs/epl-backend.log`)
- admin audit logging for critical actions

### User Roles and Collaboration

- `ADMIN` and `STUDENT` roles
- multiple concurrent student sessions per group account
- real-time group synchronization across browser tabs/devices
- pseudonym/display-name support for students
- DE/EN language switching

### Device Handling

- physical device health/status (online/offline, last seen, RSSI)
- strict provisioning workflow for discovered devices
- virtual devices per physical group with live controls
- optional virtual-device mirror mode to physical topics

### Event Processing and Teaching Controls

- task activation and server-side capability gating
- disturbance overlays (duplicates, delay, drops, out-of-order)
- event feed modes (before pipeline / after pipeline)
- pipeline builder with configurable processing blocks and sink blocks
- per-block observability (in/out/drop/error/latency/state)

### Admin Platform Features

- device overview and commands
- groups overview + reset group progress
- task management (create/edit/reorder/delete where allowed)
- disturbances page and global scenario control
- stream source management (Wikimedia EventStream integration)
- system status page with DB size, event-rate graph, CPU/RAM, websocket sessions
- data export/import (ZIP archive with schema + selected parts)

## Architecture

Communication model:

1. `EPLD <-> MQTT broker`
2. `Backend <-> MQTT broker`
3. `Frontend <-> Backend (HTTP + WebSocket)`

Authority model:

- backend is **server-authoritative**
- permissions/capabilities are enforced backend-side

Persistence model:

- PostgreSQL for events, auth/session, task/group state, app settings
- Flyway for schema migration

## Technology Stack

- Java 25
- Spring Boot 4.x
- Spring Web / WebSocket / Security / Data JPA / Validation / Actuator
- Eclipse Paho MQTT client
- PostgreSQL + Flyway
- React + Vite + TypeScript
- Docker Compose
- Mosquitto (MQTT)
- Redpanda (optional Kafka-compatible log mode)
- cloudflared (optional public tunnel)

Backend package namespace: `ch.marcovogt.epl`

Build tool: **Gradle**

Configuration style: classical config files and Compose environment variables.

## Repository Structure

```text
Event-Pipeline-Lab/
  backend/
    src/main/java/ch/marcovogt/epl/
      admin/
      authsession/
      deviceregistryhealth/
      eventfeedquery/
      eventingestionnormalization/
      externalsources/
      groupcollaborationsync/
      mqttgateway/
      pipelinebuilder/
      realtimewebsocket/
      taskscenarioengine/
      virtualdevice/
    src/main/resources/
      application.yml
      db/migration/
    build.gradle
    Dockerfile
  frontend/
    src/
    Dockerfile
    nginx.conf
  infra/
    mosquitto/mosquitto.conf
    cloudflared/config.yml.example
  docker-compose.yml
  README.md
```

## Quick Start (One Command)

### Prerequisites

- Docker + Docker Compose
- 4+ GB RAM available for containers

### Start everything

```bash
docker compose up -d --build
```

This starts:

- `postgres`
- `mosquitto`
- `backend`
- `frontend`

Optional services:

- `kafka` via profile `logmode`
- `cloudflared` via profile `public`

### Access

- Frontend: <http://localhost:5173>
- Backend health: <http://localhost:8080/actuator/health>

### Verify runtime status

```bash
docker compose ps
docker compose logs backend --tail=120
docker compose logs frontend --tail=120
```

## First Login and Device Provisioning

### Default admin account

- Username: `admin`
- PIN: `admin123`

### Student accounts

Student accounts are provisioned automatically for discovered physical devices.

Provisioning behavior:

1. a physical device `epldNN...` is discovered from MQTT traffic
2. backend creates/aligns:
   - student account `epldNN...`
   - group key `epldNN...`
   - random 4-digit PIN (on first creation)
   - virtual device `eplvdNN...`
3. admin can view/change PIN in UI or via admin device PIN API

If a physical device is configured as **admin device**, student login for that device is disabled, but its virtual device remains available.

## MQTT Topics and Canonical Events

### Inbound topic support (examples)

- canonical-style: `epld/{deviceId}/event/...`, `epld/{deviceId}/status/...`
- Shelly-style: `{deviceId}/events/rpc`, `{deviceId}/telemetry`, `{deviceId}/online`

### Canonical event model (stored in PostgreSQL)

Key fields include:

- `id` (UUID)
- `deviceId`
- `source`
- `topic`
- `eventType`
- `category`
- `payloadJson`
- `deviceTs` and `ingestTs`
- `valid`, `validationErrors`
- `isInternal`
- `scenarioFlags`
- `groupKey`
- `sequenceNo`

Feed API:

- `GET /api/events/feed`
- stage param: `BEFORE_PIPELINE` or `AFTER_PIPELINE`

## Pipeline Builder View (PBV)

PBV models event flow as:

- **Input**
- **Processing**
- **Sink / Output**

### Processing blocks

Current block library:

- `FILTER_SOURCE` (backend type: `FILTER_DEVICE`)
- `FILTER_TOPIC`
- `EXTRACT_VALUE`
- `TRANSFORM_PAYLOAD`
- `FILTER_RATE_LIMIT`
- `DEDUP`
- `WINDOW_AGGREGATE`
- `MICRO_BATCH`

### Sink blocks

- `EVENT_FEED` (always present)
- `VIRTUAL_SIGNAL` (always present)
- `SEND_EVENT` (multiple allowed)
- `SHOW_PAYLOAD` (single)

### Collaboration and synchronization

- per-task/per-group pipeline state
- real-time updates via WebSocket
- autosave behavior in UI (no manual save required)

### Log mode (optional)

Enable Kafka-compatible log mode:

```bash
docker compose --profile logmode up -d --build
```

Admin endpoints:

- `GET /api/admin/pipeline/log-mode/status`
- `POST /api/admin/pipeline/log-mode/replay`

## External Stream Sources

Admin page: **Stream Sources**

Current built-in source:

- Wikimedia EventStream (`wikimedia.eventstream`)

Capabilities:

- enable/disable source
- configure endpoint URL
- online/offline status
- event counter since reset
- reset counter

API:

- `GET /api/admin/stream-sources`
- `POST /api/admin/stream-sources/{sourceId}/enable`
- `POST /api/admin/stream-sources/{sourceId}/disable`
- `POST /api/admin/stream-sources/{sourceId}/config`
- `POST /api/admin/stream-sources/{sourceId}/counter/reset`

## Operations

### Update running deployment

```bash
git pull
docker compose build backend frontend
docker compose up -d backend frontend
```

Or one-step rebuild/restart:

```bash
docker compose up -d --build
```

### Stop / start / restart

```bash
docker compose stop
docker compose start
docker compose restart backend frontend
```

### Logs

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mosquitto
docker compose logs -f postgres
```

Backend file logs are written to:

- container path: `/app/logs/epl-backend.log`
- compose volume: `backend_logs`

### Health checks

```bash
docker compose ps
docker run --rm --network epl_default curlimages/curl:8.12.1 -sS http://backend:8080/actuator/health
```

### Data export/import

In Admin UI: `System Status` page.

- export selected sections as ZIP
- verify import archive first
- selectively apply imported sections

Archive format:

- `schema.json` metadata
- per-part JSON payloads under `parts/`

## Cloudflare Tunnel (Optional Public Access)

Public hostname target: `epl.marcovogt.ch`

### Start with tunnel profile

```bash
export CLOUDFLARE_TUNNEL_TOKEN='<your-token>'
export EPL_CLOUDFLARE_ENABLED=true
export EPL_CLOUDFLARE_HOSTNAME=epl.marcovogt.ch
docker compose --profile public up -d --build
```

### Tunnel checks

```bash
docker compose --profile public ps
docker compose logs cloudflared --tail=120
```

### Temporarily disable tunnel

```bash
docker compose --profile public stop cloudflared
```

or fully remove it:

```bash
docker compose --profile public rm -sf cloudflared
```


## Local Development and Tests

### Frontend (local)

```bash
npm --prefix frontend install
npm --prefix frontend run dev
npm --prefix frontend run test
npm --prefix frontend run build
```

### Backend tests

```bash
cd backend
./gradlew test
```

### Full stack smoke check

```bash
docker compose up -d --build
docker compose ps
```

## Troubleshooting

### 1) Login returns 502 / Bad Gateway

- Check backend health:

```bash
docker compose ps
docker compose logs backend --tail=200
```

- Ensure frontend proxy can reach backend (`backend:8080` inside compose network).

### 2) WebSocket disconnected in UI

- Check `/ws` proxy path in `frontend/nginx.conf`
- Check backend websocket handler logs
- Verify no reverse proxy timeout is interrupting upgraded connections

### 3) Events appear to “stop” after some seconds

Typical causes:

- active topic/source filters in feed view
- pipeline blocks intentionally dropping/filtering events
- disturbances (delay/drop/out-of-order) affecting visible timing/order

Quick checks:

- switch feed topic filter to empty
- compare `BEFORE_PIPELINE` and `AFTER_PIPELINE`
- inspect PBV block counters (`in/out/drop`) and drop reasons

### 4) No student accounts visible

Student accounts are created for discovered physical devices.
If no device has published MQTT events yet, no student groups will be provisioned.

### 5) Cloudflare tunnel up but hostname unreachable

- verify Cloudflare DNS route for tunnel
- verify token and profile usage
- verify cloudflared origin target is `frontend:80` (not `localhost:5173` inside container)

