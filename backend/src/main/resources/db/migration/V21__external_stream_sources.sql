create table if not exists external_stream_source_state (
    source_id varchar(64) primary key,
    enabled boolean not null,
    endpoint_url text not null,
    counter_reset_at timestamptz not null,
    updated_at timestamptz not null,
    updated_by varchar(128) not null
);

insert into external_stream_source_state (
    source_id,
    enabled,
    endpoint_url,
    counter_reset_at,
    updated_at,
    updated_by
)
values (
    'wikimedia.eventstream',
    false,
    'https://stream.wikimedia.org/v2/stream/recentchange',
    now(),
    now(),
    'system'
)
on conflict (source_id) do nothing;

create index if not exists idx_canonical_event_source_ingest_ts
    on canonical_event (source, ingest_ts desc);
