create table if not exists feed_scenario_state (
    id smallint primary key,
    overlays_json text not null,
    updated_at timestamptz not null,
    updated_by varchar(64) not null
);

insert into feed_scenario_state (id, overlays_json, updated_at, updated_by)
values (1, '[]', now(), 'system')
on conflict (id) do nothing;
