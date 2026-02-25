update virtual_device_state
set brightness = greatest(
    0.0,
    least(
        3.3,
        case
            when brightness > 3.3 then brightness / 100.0
            else brightness
        end
    )
)
where brightness < 0.0
   or brightness > 3.3;
