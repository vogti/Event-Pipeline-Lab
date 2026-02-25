alter table app_settings
    add column if not exists student_virtual_device_visible boolean not null default true;

update app_settings
set student_virtual_device_visible = true
where student_virtual_device_visible is null;

create table if not exists virtual_device_state (
    device_id varchar(128) primary key,
    group_key varchar(128) not null,
    online boolean not null,
    rssi integer not null,
    ip_address varchar(64) not null,
    temperature_c double precision not null,
    humidity_pct double precision not null,
    brightness double precision not null,
    counter_value bigint not null,
    button_red_pressed boolean not null,
    button_black_pressed boolean not null,
    led_green_on boolean not null,
    led_orange_on boolean not null,
    updated_at timestamptz not null
);

insert into virtual_device_state (
    device_id,
    group_key,
    online,
    rssi,
    ip_address,
    temperature_c,
    humidity_pct,
    brightness,
    counter_value,
    button_red_pressed,
    button_black_pressed,
    led_green_on,
    led_orange_on,
    updated_at
)
select
    'eplvd' || lpad(gs::text, 2, '0') as device_id,
    'epld' || lpad(gs::text, 2, '0') as group_key,
    true as online,
    (-55 - gs) as rssi,
    '10.42.0.' || (100 + gs) as ip_address,
    22.5 as temperature_c,
    46.0 as humidity_pct,
    240.0 as brightness,
    0 as counter_value,
    false as button_red_pressed,
    false as button_black_pressed,
    false as led_green_on,
    false as led_orange_on,
    now() as updated_at
from generate_series(1, 10) as gs
on conflict (device_id) do nothing;
