alter table feed_scenario_state
    add column if not exists student_device_view_disturbed boolean not null default false;
