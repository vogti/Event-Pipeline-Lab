alter table task_pipeline_config
    add column if not exists scenario_overlays_json text;
