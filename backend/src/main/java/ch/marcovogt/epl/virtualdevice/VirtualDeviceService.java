package ch.marcovogt.epl.virtualdevice;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.mqttgateway.MqttGatewayClient;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class VirtualDeviceService {

    private final VirtualDeviceStateRepository virtualDeviceStateRepository;
    private final MqttGatewayClient mqttGatewayClient;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public VirtualDeviceService(
            VirtualDeviceStateRepository virtualDeviceStateRepository,
            MqttGatewayClient mqttGatewayClient,
            ObjectMapper objectMapper
    ) {
        this.virtualDeviceStateRepository = virtualDeviceStateRepository;
        this.mqttGatewayClient = mqttGatewayClient;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    @Transactional(readOnly = true)
    public List<VirtualDeviceStateDto> listAll() {
        return virtualDeviceStateRepository.findAllByOrderByDeviceIdAsc().stream()
                .map(VirtualDeviceStateDto::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public VirtualDeviceStateDto getByDeviceId(String deviceId) {
        return virtualDeviceStateRepository.findById(deviceId)
                .map(VirtualDeviceStateDto::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown virtual device: " + deviceId));
    }

    @Transactional(readOnly = true)
    public VirtualDeviceStateDto getByGroupKey(String groupKey) {
        return virtualDeviceStateRepository.findByGroupKey(groupKey)
                .map(VirtualDeviceStateDto::from)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "No virtual device mapped to group: " + groupKey
                ));
    }

    @Transactional(readOnly = true)
    public Optional<VirtualDeviceStateDto> findByGroupKey(String groupKey) {
        return virtualDeviceStateRepository.findByGroupKey(groupKey).map(VirtualDeviceStateDto::from);
    }

    @Transactional
    public VirtualDeviceStateDto applyPatch(String deviceId, VirtualDeviceControlRequest patch) {
        if (patch == null || patch.isEmptyPatch()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Patch must include at least one field");
        }

        VirtualDeviceState state = virtualDeviceStateRepository.findById(deviceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown virtual device: " + deviceId));

        ChangeSet changes = new ChangeSet();

        if (patch.buttonRedPressed() != null && state.isButtonRedPressed() != patch.buttonRedPressed()) {
            state.setButtonRedPressed(patch.buttonRedPressed());
            changes.buttonRed = true;
        }
        if (patch.buttonBlackPressed() != null && state.isButtonBlackPressed() != patch.buttonBlackPressed()) {
            state.setButtonBlackPressed(patch.buttonBlackPressed());
            changes.buttonBlack = true;
        }
        if (patch.ledGreenOn() != null && state.isLedGreenOn() != patch.ledGreenOn()) {
            state.setLedGreenOn(patch.ledGreenOn());
            changes.ledGreen = true;
        }
        if (patch.ledOrangeOn() != null && state.isLedOrangeOn() != patch.ledOrangeOn()) {
            state.setLedOrangeOn(patch.ledOrangeOn());
            changes.ledOrange = true;
        }
        if (patch.temperatureC() != null && Double.compare(state.getTemperatureC(), patch.temperatureC()) != 0) {
            state.setTemperatureC(patch.temperatureC());
            changes.temperature = true;
        }
        if (patch.humidityPct() != null && Double.compare(state.getHumidityPct(), patch.humidityPct()) != 0) {
            state.setHumidityPct(patch.humidityPct());
            changes.humidity = true;
        }
        if (patch.brightness() != null && Double.compare(state.getBrightness(), patch.brightness()) != 0) {
            state.setBrightness(patch.brightness());
            changes.brightness = true;
        }
        if (patch.counterValue() != null && state.getCounterValue() != patch.counterValue()) {
            state.setCounterValue(patch.counterValue());
            changes.counter = true;
        }

        if (!changes.hasAnyChange()) {
            return VirtualDeviceStateDto.from(state);
        }

        state.setOnline(true);
        VirtualDeviceState saved = virtualDeviceStateRepository.save(state);
        publishChanges(saved, changes);
        return VirtualDeviceStateDto.from(saved);
    }

    private void publishChanges(VirtualDeviceState state, ChangeSet changes) {
        Instant now = Instant.now(clock);
        String canonicalPrefix = "epld/" + state.getDeviceId();

        if (changes.buttonRed) {
            mqttGatewayClient.publish(
                    canonicalPrefix + "/event/button",
                    toJson(Map.of(
                            "deviceId", state.getDeviceId(),
                            "groupKey", state.getGroupKey(),
                            "button", "red",
                            "action", state.isButtonRedPressed() ? "press" : "release",
                            "pressed", state.isButtonRedPressed(),
                            "ts", now.toEpochMilli() / 1000.0
                    )),
                    1,
                    false
            );
        }

        if (changes.buttonBlack) {
            mqttGatewayClient.publish(
                    canonicalPrefix + "/event/button",
                    toJson(Map.of(
                            "deviceId", state.getDeviceId(),
                            "groupKey", state.getGroupKey(),
                            "button", "black",
                            "action", state.isButtonBlackPressed() ? "press" : "release",
                            "pressed", state.isButtonBlackPressed(),
                            "ts", now.toEpochMilli() / 1000.0
                    )),
                    1,
                    false
            );
        }

        if (changes.temperature || changes.humidity) {
            mqttGatewayClient.publish(
                    canonicalPrefix + "/event/sensor/dht22",
                    toJson(Map.of(
                            "deviceId", state.getDeviceId(),
                            "groupKey", state.getGroupKey(),
                            "temperature", state.getTemperatureC(),
                            "humidity", state.getHumidityPct(),
                            "ts", now.toEpochMilli() / 1000.0
                    )),
                    1,
                    false
            );
        }

        if (changes.brightness) {
            mqttGatewayClient.publish(
                    canonicalPrefix + "/event/sensor/ldr",
                    toJson(Map.of(
                            "deviceId", state.getDeviceId(),
                            "groupKey", state.getGroupKey(),
                            "brightness", state.getBrightness(),
                            "lux", state.getBrightness(),
                            "ts", now.toEpochMilli() / 1000.0
                    )),
                    1,
                    false
            );
        }

        if (changes.counter) {
            mqttGatewayClient.publish(
                    canonicalPrefix + "/event/counter",
                    toJson(Map.of(
                            "deviceId", state.getDeviceId(),
                            "groupKey", state.getGroupKey(),
                            "counter", state.getCounterValue(),
                            "value", state.getCounterValue(),
                            "ts", now.toEpochMilli() / 1000.0
                    )),
                    1,
                    false
            );
        }

        if (changes.ledGreen) {
            publishNotifyStatus(state, Map.of("switch:0", Map.of("output", state.isLedGreenOn())), now);
        }

        if (changes.ledOrange) {
            publishNotifyStatus(state, Map.of("switch:1", Map.of("output", state.isLedOrangeOn())), now);
        }

        Map<String, Object> wifiPayload = new HashMap<>();
        wifiPayload.put("deviceId", state.getDeviceId());
        wifiPayload.put("groupKey", state.getGroupKey());
        wifiPayload.put("rssi", state.getRssi());
        wifiPayload.put("ip", state.getIpAddress());
        wifiPayload.put("wifi", Map.of(
                "rssi", state.getRssi(),
                "ip", state.getIpAddress(),
                "ssid", "EPL-VIRTUAL"
        ));

        mqttGatewayClient.publish(
                canonicalPrefix + "/status/wifi",
                toJson(wifiPayload),
                1,
                false
        );

        mqttGatewayClient.publish(
                canonicalPrefix + "/status/heartbeat",
                toJson(Map.of(
                        "deviceId", state.getDeviceId(),
                        "groupKey", state.getGroupKey(),
                        "online", true,
                        "ts", now.toEpochMilli() / 1000.0
                )),
                1,
                false
        );
    }

    private void publishNotifyStatus(VirtualDeviceState state, Map<String, Object> statusFragment, Instant now) {
        Map<String, Object> params = new HashMap<>();
        params.putAll(statusFragment);
        params.put("ts", now.toEpochMilli() / 1000.0);

        mqttGatewayClient.publish(
                state.getDeviceId() + "/events/rpc",
                toJson(Map.of(
                        "deviceId", state.getDeviceId(),
                        "groupKey", state.getGroupKey(),
                        "method", "NotifyStatus",
                        "params", params
                )),
                1,
                false
        );
    }

    private String toJson(Object payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Failed to serialize virtual device payload", ex);
        }
    }

    private static final class ChangeSet {
        private boolean buttonRed;
        private boolean buttonBlack;
        private boolean ledGreen;
        private boolean ledOrange;
        private boolean temperature;
        private boolean humidity;
        private boolean brightness;
        private boolean counter;

        private boolean hasAnyChange() {
            return buttonRed || buttonBlack || ledGreen || ledOrange || temperature || humidity || brightness || counter;
        }
    }
}
