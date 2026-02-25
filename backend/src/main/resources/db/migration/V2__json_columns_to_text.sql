alter table canonical_event
    alter column payload_json type text using payload_json::text;

alter table canonical_event
    alter column scenario_flags type text using scenario_flags::text;

alter table device_status
    alter column wifi_payload_json type text using wifi_payload_json::text;
