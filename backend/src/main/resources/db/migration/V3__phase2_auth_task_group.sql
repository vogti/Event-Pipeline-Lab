create table if not exists auth_account (
    username varchar(64) primary key,
    pin_code varchar(128) not null,
    role varchar(16) not null,
    group_key varchar(128) null,
    enabled boolean not null default true
);

create table if not exists auth_session (
    session_token uuid primary key,
    username varchar(64) not null references auth_account(username),
    role varchar(16) not null,
    group_key varchar(128) null,
    display_name varchar(64) null,
    created_at timestamptz not null,
    last_seen timestamptz not null,
    expires_at timestamptz not null,
    active boolean not null
);

create index if not exists idx_auth_session_active_expires
    on auth_session (active, expires_at);

create index if not exists idx_auth_session_group_active_last_seen
    on auth_session (group_key, active, last_seen desc);

create table if not exists group_state (
    group_key varchar(128) primary key,
    config_json text not null,
    revision bigint not null,
    updated_at timestamptz not null,
    updated_by varchar(64) not null
);

create table if not exists task_state (
    id smallint primary key,
    active_task_id varchar(64) not null,
    updated_at timestamptz not null,
    updated_by varchar(64) not null
);

create table if not exists app_settings (
    id smallint primary key,
    default_language_mode varchar(32) not null,
    updated_at timestamptz not null,
    updated_by varchar(64) not null
);

create table if not exists audit_entry (
    id bigserial primary key,
    action varchar(128) not null,
    actor varchar(64) not null,
    details_json text not null,
    created_at timestamptz not null
);

insert into auth_account (username, pin_code, role, group_key, enabled)
values ('admin', 'admin123', 'ADMIN', null, true)
on conflict (username) do nothing;

insert into auth_account (username, pin_code, role, group_key, enabled)
select
    'epld' || lpad(gs::text, 2, '0') as username,
    '1234' as pin_code,
    'STUDENT' as role,
    'epld' || lpad(gs::text, 2, '0') as group_key,
    true as enabled
from generate_series(1, 12) as gs
on conflict (username) do nothing;

insert into task_state (id, active_task_id, updated_at, updated_by)
values (1, 'task_intro', now(), 'system')
on conflict (id) do nothing;

insert into app_settings (id, default_language_mode, updated_at, updated_by)
values (1, 'BROWSER_EN_FALLBACK', now(), 'system')
on conflict (id) do nothing;
