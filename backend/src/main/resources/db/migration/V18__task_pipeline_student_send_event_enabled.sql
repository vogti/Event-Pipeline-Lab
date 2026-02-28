alter table task_pipeline_config
    add column if not exists student_send_event_enabled boolean not null default false;
