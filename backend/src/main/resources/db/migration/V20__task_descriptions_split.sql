alter table task_definition_state
    add column if not exists active_description_de text;

alter table task_definition_state
    add column if not exists active_description_en text;

update task_definition_state
set active_description_de = description_de
where active_description_de is null;

update task_definition_state
set active_description_en = description_en
where active_description_en is null;

alter table task_definition_state
    alter column active_description_de set not null;

alter table task_definition_state
    alter column active_description_en set not null;
