package ch.marcovogt.epl.deviceregistryhealth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEvent;
import ch.marcovogt.epl.realtimewebsocket.AdminWebSocketBroadcaster;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
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
    private final ObjectMapper objectMapper;
    private final AdminWebSocketBroadcaster adminWebSocketBroadcaster;
    private final RealtimeSyncService realtimeSyncService;
    private final Clock clock;
    private final Duration offlineTimeout;

    public DeviceStatusService(
            DeviceStatusRepository deviceStatusRepository,
            ObjectMapper objectMapper,
            AdminWebSocketBroadcaster adminWebSocketBroadcaster,
            RealtimeSyncService realtimeSyncService,
            @Value("${epl.device.offline-timeout:PT25S}") Duration offlineTimeout
    ) {
        this.deviceStatusRepository = deviceStatusRepository;
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

        DeviceStatus status = deviceStatusRepository.findById(deviceId)
                .orElseGet(() -> new DeviceStatus(deviceId));

        status.setLastSeen(event.getIngestTs());
        status.setOnline(explicitOnline != null ? explicitOnline : true);

        extractRssi(payloadNode).ifPresent(status::setRssi);
        extractWifiPayload(payloadNode).ifPresent(status::setWifiPayloadJson);

        return deviceStatusRepository.save(status);
    }

    @Transactional(readOnly = true)
    public List<DeviceStatusDto> listAll() {
        return deviceStatusRepository.findAllByOrderByDeviceIdAsc()
                .stream()
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

        staleOnlineDevices.forEach(status -> status.setOnline(false));
        List<DeviceStatus> saved = deviceStatusRepository.saveAll(staleOnlineDevices);
        for (DeviceStatus status : saved) {
            DeviceStatusDto dto = DeviceStatusDto.from(status);
            adminWebSocketBroadcaster.broadcastDeviceStatus(dto);
            realtimeSyncService.broadcastDeviceStatusToStudents(dto);
        }
        log.info("Marked {} stale devices offline (cutoff={})", staleOnlineDevices.size(), cutoff);
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
