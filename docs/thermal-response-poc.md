# Thermal phase-response POC

This deterministic, read-only analysis is also integrated into the running thermostat in shadow mode. It does not alter `Thermostat.evaluateChanges()` or relay commands. Sensor subscriptions retain the legacy topic selected from `temperatureSensor` and add every exact topic in the instance's optional `mqttTopics.temperature` array. The shadow transcript is published retained at QoS 1 only to the exact topics in `mqttTopics.thermostatStatus`; no topic is synthesized from the broker hostname or instance name. Existing relay command/status topics are unchanged.

Add these fields to the relevant existing `instances[]` record (other required instance properties are omitted):

```json
{
  "name": "default",
  "mqttTopics": {
    "temperature": ["site/home/master-bedroom/climate/temperature"],
    "thermostatStatus": ["site/home/living-space/climate/thermostat"]
  }
}
```

For the apartment instance, configure `"thermostatStatus": ["site/apt/living-room/climate/thermostat"]`. Add any legacy status path to the same array if a legacy consumer needs the transcript too. `temperature` accepts multiple exact paths, allowing legacy and `site/...` sensor topics to be listened to simultaneously. If `thermostatStatus` is absent or empty, no transcript is published and the app logs a warning; the old relay topic behavior remains unaffected.

The configured status topic receives the latest transcript at startup, when mode/state/recommendation/fault changes, at least every five minutes, after profile refresh, and during shutdown. The profile reader streams the CSV line-by-line, skips rows older than 365 days before constructing samples, retains only the active phase and a capped 10,000 transition summaries, and never builds a full raw-sample history in memory. MQTT publish acknowledgements only confirm broker acceptance; they do not confirm pump or relay actuation. The transcript includes current inputs, phase drift, profile counts/p90s, baseline and shadow thresholds, comparison/reason, sensor/relay fault status, and `actuation: none`.

Run the offline January-training/February-holdout report with:
```sh
npm run thermal:phase-poc -- --csv /absolute/path/to/data-log.csv
```

The script uses 5-minute median bins, then:

- On `HEAT_ON`, finds the lowest HeatIndex after the transition and how long it took to reach it; a sustained rise confirms the reversal.
- On `HEAT_OFF`, finds the highest HeatIndex after the transition and how long it took to reach it; a sustained fall confirms the reversal.
- Requires three consecutive bins reversing by at least 0.1°C. Phases without that reversal are marked censored rather than assigned a made-up response time.
- Groups outdoor conditions into freezing, cold, and mild bands, and reports medians, p90/max response times, large post-switch drifts, and censored episodes.
- Trains the phase summaries on January 2026 and evaluates them on February 2026. February data never contributes to the January summaries.

All indoor response values use the logged `heat-index` because that is the thermostat's current comfort/control value. The analysis also records raw dry-bulb temperature change at the same phase so the two signals can be compared; raw temperature does not drive the POC. Bins are approximate at five-minute resolution.

## Actual January/February log findings

For the copied log, January had 16 logged HEAT-ON transitions with sub-zero outdoor readings; February had only one. The January freezing HEAT-ON median response lag was about 10 minutes, but the maximum was about 7 hours 22 minutes: on Jan 25, at roughly -2°C outside, HeatIndex fell about 0.73°C and raw temperature about 0.66°C after heat was requested before a sustained recovery. That phase stayed in logged HEAT for about 16.5 hours. A single median would conceal this long-tail case.

January also contained an OFF transition near 0°C where HeatIndex continued rising by about 0.85°C (raw temperature about 0.77°C) for roughly 88 minutes. Other OFF events had far less coast. February's one sub-zero HEAT-ON case is too little data to validate cold-weather behavior independently; January-to-February median errors should not be mistaken for proof that the rare long-lag case is solved.

These are logged thermostat state transitions, not independent pump feedback. A `HEAT` state means the thermostat requested heat; it does not prove circulation or delivered output. Also, exact outdoor-temperature `0` values may be the app's missing-weather fallback, so the analysis marks that value as unknown rather than assuming it was freezing.

The rare multi-hour HEAT-ON drops point to a delivery/capacity or weather-front problem that the usual few-minute switching lag cannot explain by itself. Do not use these summaries to alter active thresholds until actual pump/flow operation and the long-response events have been reviewed.
