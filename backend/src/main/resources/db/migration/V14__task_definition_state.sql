create table if not exists task_definition_state (
    task_id varchar(64) primary key,
    custom_task boolean not null,
    title_de varchar(255) not null,
    title_en varchar(255) not null,
    description_de text not null,
    description_en text not null,
    student_capabilities_json text,
    pipeline_json text,
    updated_at timestamptz not null,
    updated_by varchar(64) not null
);
