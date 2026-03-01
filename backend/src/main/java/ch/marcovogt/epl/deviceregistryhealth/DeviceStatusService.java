package ch.marcovogt.epl.deviceregistryhealth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEvent;
import ch.marcovogt.epl.realtimewebsocket.AdminWebSocketBroadcaster;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DeviceStatusService {

    private static final Logger log = LoggerFactory.getLogger(DeviceStatusService.class);

    private final DeviceStatusRepository deviceStatusRepository;
    private final DeviceDiscoveryProvisioningService deviceDiscoveryProvisioningService;
    private final ObjectMapper objectMapper;
    private final AdminWebSocketBroadcaster adminWebSocketBroadcaster;
    private final RealtimeSyncService realtimeSyncService;
    private final Clock clock;
    private final Duration offlineTimeout;

    public DeviceStatusService(
            DeviceStatusRepository deviceStatusRepository,
            DeviceDiscoveryProvisioningService deviceDiscoveryProvisioningService,
            ObjectMapper objectMapper,
            AdminWebSocketBroadcaster adminWebSocketBroadcaster,
            RealtimeSyncService realtimeSyncService,
            @Value("${epl.device.offline-timeout:PT25S}") Duration offlineTimeout
    ) {
        this.deviceStatusRepository = deviceStatusRepository;
        this.deviceDiscoveryProvisioningService = deviceDiscoveryProvisioningService;
        this.objectMapper = objectMapper;
        this.adminWebSocketBroadcaster = adminWebSocketBroadcaster;
        this.realtimeSyncService = realtimeSyncService;
        this.offlineTimeout = offlineTimeout;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public DeviceStatus upsertFromInbound(CanonicalEvent event, JsonNode payloadNode, Boolean explicitOnline) {
        String deviceId = event.getDeviceId();
        if (deviceId == null || deviceId.isBlank() || "unknown".equals(deviceId)) {
            return null;
        }
        if (!DeviceIdMapping.isPhysicalDeviceId(deviceId)) {
            return null;
        }

        deviceDiscoveryProvisioningService.ensureProvisionedForPhysicalDevice(deviceId);

        Optional<DeviceStatus> existing = deviceStatusRepository.findById(deviceId);
        DeviceStatus status = existing
                .orElseGet(() -> new DeviceStatus(deviceId));
        boolean changed = false;
        boolean shouldTouchPresence = shouldAffectPresence(event, payloadNode, explicitOnline);

        if (explicitOnline != null) {
            if (explicitOnline) {
                Instant nextSeen = event.getIngestTs();
                if (!Objects.equals(status.getLastSeen(), nextSeen)) {
                    status.setLastSeen(nextSeen);
                    changed = true;
                }
            }
            if (status.isOnline() != explicitOnline) {
                status.setOnline(explicitOnline);
                changed = true;
            }
        } else if (shouldTouchPresence) {
            Instant nextSeen = event.getIngestTs();
            if (!Objects.equals(status.getLastSeen(), nextSeen)) {
                status.setLastSeen(nextSeen);
                changed = true;
            }
            if (!status.isOnline()) {
                status.setOnline(true);
                changed = true;
            }
        }

        Optional<Integer> rssi = extractRssi(payloadNode);
        if (rssi.isPresent() && !Objects.equals(status.getRssi(), rssi.get())) {
            status.setRssi(rssi.get());
            changed = true;
        }

        Optional<String> wifiPayload = extractWifiPayload(payloadNode);
        if (wifiPayload.isPresent() && !Objects.equals(status.getWifiPayloadJson(), wifiPayload.get())) {
            status.setWifiPayloadJson(wifiPayload.get());
            changed = true;
        }

        if (existing.isEmpty() && !changed) {
            return null;
        }
        if (existing.isPresent() && !changed) {
            return status;
        }

        return deviceStatusRepository.save(status);
    }

    private boolean shouldAffectPresence(CanonicalEvent event, JsonNode payloadNode, Boolean explicitOnline) {
        if (explicitOnline != null) {
            return true;
        }

        String eventType = event.getEventType() == null ? "" : event.getEventType().trim().toLowerCase();
        if (eventType.startsWith("command.") || "simple_control.command".equals(eventType)) {
            return false;
        }

        String payloadDeviceId = payloadNode == null ? null : text(payloadNode, "deviceId");
        if (payloadDeviceId != null && !payloadDeviceId.isBlank()) {
            if (!payloadDeviceId.equalsIgnoreCase(event.getDeviceId())) {
                return false;
            }
            if (DeviceIdMapping.isVirtualDeviceId(payloadDeviceId)
                    && DeviceIdMapping.isPhysicalDeviceId(event.getDeviceId())) {
                return false;
            }
        }

        return true;
    }

    private String text(JsonNode node, String key) {
        if (node == null || key == null || key.isBlank()) {
            return null;
        }
        JsonNode value = node.get(key);
        if (value == null || value.isNull() || !value.isTextual()) {
            return null;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? null : text.trim();
    }

    @Transactional(readOnly = true)
    public List<DeviceStatusDto> listAll() {
        return deviceStatusRepository.findAllByOrderByDeviceIdAsc()
                .stream()
                .filter(status -> !DeviceIdMapping.isVirtualDeviceId(status.getDeviceId()))
                .map(DeviceStatusDto::from)
                .toList();
    }

    @Scheduled(fixedDelayString = "${epl.device.offline-check-delay-ms:5000}")
    @Transactional
    public void markStaleDevicesOffline() {
        Instant cutoff = Instant.now(clock).minus(offlineTimeout);
        List<DeviceStatus> staleOnlineDevices = deviceStatusRepository.findByOnlineTrueAndLastSeenBefore(cutoff);
        if (staleOnlineDevices.isEmpty()) {
            return;
        }

        List<DeviceStatus> stalePhysicalDevices = staleOnlineDevices.stream()
                .filter(status -> !DeviceIdMapping.isVirtualDeviceId(status.getDeviceId()))
                .toList();
        if (stalePhysicalDevices.isEmpty()) {
            return;
        }

        stalePhysicalDevices.forEach(status -> status.setOnline(false));
        List<DeviceStatus> saved = deviceStatusRepository.saveAll(stalePhysicalDevices);
        for (DeviceStatus status : saved) {
            DeviceStatusDto dto = DeviceStatusDto.from(status);
            adminWebSocketBroadcaster.broadcastDeviceStatus(dto);
            realtimeSyncService.broadcastDeviceStatusToStudents(dto);
        }
        log.info("Marked {} stale devices offline (cutoff={})", stalePhysicalDevices.size(), cutoff);
    }

    private Optional<Integer> extractRssi(JsonNode payloadNode) {
        JsonNode rssiNode = payloadNode.at("/rssi");
        if (rssiNode.isNumber()) {
            return Optional.of(rssiNode.asInt());
        }

        rssiNode = payloadNode.at("/wifi/rssi");
        if (rssiNode.isNumber()) {
            return Optional.of(rssiNode.asInt());
        }

        rssiNode = payloadNode.at("/params/mqtt/rssi");
        if (rssiNode.isNumber()) {
            return Optional.of(rssiNode.asInt());
        }

        return Optional.empty();
    }

    private Optional<String> extractWifiPayload(JsonNode payloadNode) {
        JsonNode wifi = payloadNode.get("wifi");
        if (wifi != null && !wifi.isNull()) {
            try {
                return Optional.of(objectMapper.writeValueAsString(wifi));
            } catch (JsonProcessingException ignored) {
                return Optional.empty();
            }
        }

        if (payloadNode.has("rssi") || payloadNode.has("ssid") || payloadNode.has("ip")) {
            try {
                return Optional.of(objectMapper.writeValueAsString(payloadNode));
            } catch (JsonProcessingException ignored) {
                return Optional.empty();
            }
        }

        return Optional.empty();
    }
}
