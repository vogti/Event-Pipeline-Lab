alter table app_settings
    add column if not exists admin_device_id varchar(64);

update app_settings
set admin_device_id = null
where admin_device_id is not null
  and btrim(admin_device_id) = '';
