package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusDto;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/devices")
public class AdminDeviceController {

    private final DeviceStatusService deviceStatusService;

    public AdminDeviceController(DeviceStatusService deviceStatusService) {
        this.deviceStatusService = deviceStatusService;
    }

    @GetMapping
    public List<DeviceStatusDto> listDevices() {
        return deviceStatusService.listAll();
    }
}
