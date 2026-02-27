alter table task_state
    add column if not exists task_order_json text;

alter table task_definition_state
    add column if not exists deleted boolean not null default false;
