alter table task_pipeline_config
    add column if not exists student_device_view_disturbed boolean not null default false;
