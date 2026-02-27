alter table task_pipeline_config
    add column if not exists student_event_visibility_scope varchar(32);

alter table task_pipeline_config
    add column if not exists student_command_target_scope varchar(32);
