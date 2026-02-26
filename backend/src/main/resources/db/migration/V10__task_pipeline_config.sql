create table if not exists task_pipeline_config (
    task_id varchar(64) primary key,
    visible_to_students boolean not null,
    slot_count integer not null,
    allowed_processing_blocks_json text not null,
    updated_at timestamptz not null,
    updated_by varchar(64) not null
);
