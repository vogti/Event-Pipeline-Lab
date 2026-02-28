alter table canonical_event
    add column if not exists source varchar(128) null;

update canonical_event
set source = device_id
where source is null;

