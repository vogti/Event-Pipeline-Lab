-- Strict reconciliation:
-- 1) Every discovered physical device (epldNN...) gets exactly one student group account.
-- 2) Every discovered physical device gets exactly one mapped virtual device (eplvdNN...).
-- 3) Student groups and virtual devices without a corresponding physical device are removed.

insert into auth_account (username, pin_code, role, group_key, enabled)
select
    ds.device_id as username,
    lpad((floor(random() * 10000))::int::text, 4, '0') as pin_code,
    'STUDENT' as role,
    ds.device_id as group_key,
    true as enabled
from device_status ds
where ds.device_id ~ '^epld[0-9]+$'
  and not exists (
      select 1
      from auth_account aa
      where aa.username = ds.device_id
  );

update auth_account aa
set group_key = aa.username,
    enabled = true
where aa.role = 'STUDENT'
  and aa.username ~ '^epld[0-9]+$'
  and exists (
      select 1
      from device_status ds
      where ds.device_id = aa.username
        and ds.device_id ~ '^epld[0-9]+$'
  )
  and (aa.group_key is distinct from aa.username or aa.enabled is false);

delete from auth_session s
where s.username in (
    select aa.username
    from auth_account aa
    where aa.role = 'STUDENT'
      and (
          aa.username !~ '^epld[0-9]+$'
          or not exists (
              select 1
              from device_status ds
              where ds.device_id = aa.username
                and ds.device_id ~ '^epld[0-9]+$'
          )
      )
);

delete from group_state gs
where gs.group_key !~ '^epld[0-9]+$'
   or not exists (
       select 1
       from device_status ds
       where ds.device_id = gs.group_key
         and ds.device_id ~ '^epld[0-9]+$'
   );

delete from auth_account aa
where aa.role = 'STUDENT'
  and (
      aa.username !~ '^epld[0-9]+$'
      or not exists (
          select 1
          from device_status ds
          where ds.device_id = aa.username
            and ds.device_id ~ '^epld[0-9]+$'
      )
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
    regexp_replace(ds.device_id, '^epld', 'eplvd') as device_id,
    ds.device_id as group_key,
    true as online,
    0 as rssi,
    'virtual' as ip_address,
    22.5 as temperature_c,
    46.0 as humidity_pct,
    1.65 as brightness,
    0 as counter_value,
    false as button_red_pressed,
    false as button_black_pressed,
    false as led_green_on,
    false as led_orange_on,
    now() as updated_at
from device_status ds
where ds.device_id ~ '^epld[0-9]+$'
  and not exists (
      select 1
      from virtual_device_state v
      where v.device_id = regexp_replace(ds.device_id, '^epld', 'eplvd')
  );

update virtual_device_state v
set group_key = regexp_replace(v.device_id, '^eplvd', 'epld'),
    online = true
where v.device_id ~ '^eplvd[0-9]+$'
  and exists (
      select 1
      from device_status ds
      where ds.device_id = regexp_replace(v.device_id, '^eplvd', 'epld')
        and ds.device_id ~ '^epld[0-9]+$'
  )
  and (
      v.group_key is distinct from regexp_replace(v.device_id, '^eplvd', 'epld')
      or v.online is false
  );

delete from virtual_device_state v
where v.group_key !~ '^epld[0-9]+$'
   or not exists (
       select 1
       from device_status ds
       where ds.device_id = v.group_key
         and ds.device_id ~ '^epld[0-9]+$'
   );
