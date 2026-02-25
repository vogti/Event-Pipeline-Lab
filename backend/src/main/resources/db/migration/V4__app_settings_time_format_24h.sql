alter table app_settings
    add column if not exists time_format_24h boolean not null default true;

update app_settings
set time_format_24h = true
where time_format_24h is null;
