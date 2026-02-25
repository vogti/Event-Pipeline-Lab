create table if not exists canonical_event (
    id uuid primary key,
    device_id varchar(128) not null,
    topic varchar(256) not null,
    event_type varchar(128) not null,
    category varchar(32) not null,
    payload_json jsonb not null,
    device_ts timestamptz null,
    ingest_ts timestamptz not null,
    valid boolean not null,
    validation_errors text null,
    is_internal boolean not null,
    scenario_flags jsonb not null,
    group_key varchar(128) null,
    sequence_no bigint null
);

create index if not exists idx_canonical_event_ingest_ts
    on canonical_event (ingest_ts desc);

create index if not exists idx_canonical_event_device_ingest_ts
    on canonical_event (device_id, ingest_ts desc);

create index if not exists idx_canonical_event_category_ingest_ts
    on canonical_event (category, ingest_ts desc);

create table if not exists device_status (
    device_id varchar(128) primary key,
    online boolean not null,
    last_seen timestamptz not null,
    rssi integer null,
    wifi_payload_json jsonb null,
    updated_at timestamptz not null
);

create index if not exists idx_device_status_online_last_seen
    on device_status (online, last_seen);
