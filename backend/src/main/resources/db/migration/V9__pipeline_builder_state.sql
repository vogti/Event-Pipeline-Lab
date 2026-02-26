create table if not exists pipeline_state (
    task_id varchar(64) not null,
    owner_type varchar(16) not null,
    owner_key varchar(128) not null,
    state_json text not null,
    revision bigint not null,
    updated_at timestamptz not null,
    updated_by varchar(64) not null,
    primary key (task_id, owner_type, owner_key)
);

create index if not exists idx_pipeline_state_owner
    on pipeline_state (owner_type, owner_key);
