package ch.marcovogt.epl.virtualdevice;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.admin.VirtualDeviceTopicMode;
import ch.marcovogt.epl.common.DeviceIdMapping;
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

    private static final double DEFAULT_TEMPERATURE_C = 22.5;
    private static final double DEFAULT_HUMIDITY_PCT = 46.0;
    private static final double DEFAULT_BRIGHTNESS = 1.65;
    private static final long DEFAULT_COUNTER = 0L;
    private static final boolean DEFAULT_BUTTON_RED_PRESSED = false;
    private static final boolean DEFAULT_BUTTON_BLACK_PRESSED = false;
    private static final boolean DEFAULT_LED_GREEN_ON = false;
    private static final boolean DEFAULT_LED_ORANGE_ON = false;
    private static final int DEFAULT_RSSI = 0;
    private static final String DEFAULT_IP_ADDRESS = "virtual";

    private final VirtualDeviceStateRepository virtualDeviceStateRepository;
    private final AppSettingsService appSettingsService;
    private final MqttGatewayClient mqttGatewayClient;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public VirtualDeviceService(
            VirtualDeviceStateRepository virtualDeviceStateRepository,
            AppSettingsService appSettingsService,
            MqttGatewayClient mqttGatewayClient,
            ObjectMapper objectMapper
    ) {
        this.virtualDeviceStateRepository = virtualDeviceStateRepository;
        this.appSettingsService = appSettingsService;
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

    @Transactional(readOnly = true)
    public boolean hasGroupProgress(String groupKey) {
        if (groupKey == null || groupKey.isBlank()) {
            return false;
        }
        return virtualDeviceStateRepository.findByGroupKey(groupKey.trim())
                .map(state -> !matchesDefaults(state))
                .orElse(false);
    }

    @Transactional
    public boolean resetGroupProgress(String groupKey) {
        if (groupKey == null || groupKey.isBlank()) {
            return false;
        }
        Optional<VirtualDeviceState> existing = virtualDeviceStateRepository.findByGroupKey(groupKey.trim());
        if (existing.isEmpty()) {
            return false;
        }
        VirtualDeviceState state = existing.get();
        if (matchesDefaults(state)) {
            return false;
        }

        applyPatch(state.getDeviceId(), defaultControlRequest());
        VirtualDeviceState refreshed = virtualDeviceStateRepository.findById(state.getDeviceId()).orElse(state);
        if (refreshed.getRssi() != DEFAULT_RSSI || !DEFAULT_IP_ADDRESS.equals(refreshed.getIpAddress())) {
            refreshed.setRssi(DEFAULT_RSSI);
            refreshed.setIpAddress(DEFAULT_IP_ADDRESS);
            virtualDeviceStateRepository.save(refreshed);
        }
        return true;
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

        if (changes.buttonRed) {
            publishNotifyStatus(
                    state,
                    Map.of("input:0", Map.of("state", state.isButtonRedPressed())),
                    now
            );
        }

        if (changes.buttonBlack) {
            publishNotifyStatus(
                    state,
                    Map.of("input:1", Map.of("state", state.isButtonBlackPressed())),
                    now
            );
        }

        if (changes.temperature || changes.humidity) {
            publishNotifyStatus(
                    state,
                    Map.of(
                            "temperature:100",
                            Map.of("tC", state.getTemperatureC(), "value", state.getTemperatureC()),
                            "humidity:100",
                            Map.of("rh", state.getHumidityPct(), "value", state.getHumidityPct())
                    ),
                    now
            );
        }

        if (changes.brightness) {
            publishNotifyStatus(
                    state,
                    Map.of(
                            "voltmeter:100",
                            Map.of("voltage", state.getBrightness(), "value", state.getBrightness())
                    ),
                    now
            );
        }

        if (changes.counter) {
            publishNotifyStatus(
                    state,
                    Map.of(
                            "input:2", Map.of("state", true),
                            "counter:0", Map.of("value", state.getCounterValue())
                    ),
                    now
            );
        }

        if (changes.ledGreen) {
            publishNotifyStatus(state, Map.of("switch:0", Map.of("output", state.isLedGreenOn())), now);
        }

        if (changes.ledOrange) {
            publishNotifyStatus(state, Map.of("switch:1", Map.of("output", state.isLedOrangeOn())), now);
        }
    }

    private void publishNotifyStatus(VirtualDeviceState state, Map<String, Object> statusFragment, Instant now) {
        Map<String, Object> params = new HashMap<>();
        params.putAll(statusFragment);
        params.put("ts", now.toEpochMilli() / 1000.0);

        mqttGatewayClient.publish(
                resolvePublishTopic(state),
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

    private String resolvePublishTopic(VirtualDeviceState state) {
        VirtualDeviceTopicMode topicMode = appSettingsService.getVirtualDeviceTopicMode();
        if (topicMode == VirtualDeviceTopicMode.PHYSICAL_TOPIC) {
            String physicalDeviceId = DeviceIdMapping.physicalDeviceIdForVirtual(state.getDeviceId())
                    .orElseGet(() -> state.getGroupKey() == null ? "" : state.getGroupKey().trim());
            if (!physicalDeviceId.isBlank()) {
                return physicalDeviceId + "/events/rpc";
            }
        }
        return state.getDeviceId() + "/events/rpc";
    }

    private String toJson(Object payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Failed to serialize virtual device payload", ex);
        }
    }

    private VirtualDeviceControlRequest defaultControlRequest() {
        return new VirtualDeviceControlRequest(
                DEFAULT_BUTTON_RED_PRESSED,
                DEFAULT_BUTTON_BLACK_PRESSED,
                DEFAULT_LED_GREEN_ON,
                DEFAULT_LED_ORANGE_ON,
                DEFAULT_TEMPERATURE_C,
                DEFAULT_HUMIDITY_PCT,
                DEFAULT_BRIGHTNESS,
                DEFAULT_COUNTER
        );
    }

    private boolean matchesDefaults(VirtualDeviceState state) {
        return state.isOnline()
                && state.getRssi() == DEFAULT_RSSI
                && DEFAULT_IP_ADDRESS.equals(state.getIpAddress())
                && Double.compare(state.getTemperatureC(), DEFAULT_TEMPERATURE_C) == 0
                && Double.compare(state.getHumidityPct(), DEFAULT_HUMIDITY_PCT) == 0
                && Double.compare(state.getBrightness(), DEFAULT_BRIGHTNESS) == 0
                && state.getCounterValue() == DEFAULT_COUNTER
                && state.isButtonRedPressed() == DEFAULT_BUTTON_RED_PRESSED
                && state.isButtonBlackPressed() == DEFAULT_BUTTON_BLACK_PRESSED
                && state.isLedGreenOn() == DEFAULT_LED_GREEN_ON
                && state.isLedOrangeOn() == DEFAULT_LED_ORANGE_ON;
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
