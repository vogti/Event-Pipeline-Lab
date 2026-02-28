alter table app_settings
    add column if not exists virtual_device_topic_mode varchar(32) not null default 'OWN_TOPIC';

update app_settings
set virtual_device_topic_mode = 'OWN_TOPIC'
where virtual_device_topic_mode is null
   or btrim(virtual_device_topic_mode) = '';
