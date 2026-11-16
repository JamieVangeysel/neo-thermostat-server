# Thermal phase-response POC

This deterministic, read-only analysis is also integrated into the running thermostat in shadow mode. It does not alter `Thermostat.evaluateChanges()` or relay commands. The runtime publishes a retained QoS 1 decision transcript to:

```text
<relais.hostname>/thermostat/<encoded-instance-name>/preheat-shadow/status
```

Subscribe remotely to that topic to read the latest status. It is published at startup, when mode/state/recommendation/fault changes, at least every five minutes, after a profile refresh, and during shutdown. MQTT publish acknowledgements only confirm broker acceptance; they do not confirm pump or relay actuation. The runtime reads `data-log-<instance>.csv` (up to 365 days) at startup, adds completed phases as state changes, and reloads the profile daily. The retained transcript includes current inputs, current phase drift, profile counts/p90s, baseline and shadow thresholds, comparison/reason, sensor/relay fault status, and `actuation: none`.

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
