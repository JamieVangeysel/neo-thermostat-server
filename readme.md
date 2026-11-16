# Neo Thermostat Server

A personal home-automation project for reading temperature/humidity sensors and controlling heating/cooling relays. The main service is TypeScript/Node.js; the repository also contains older ESP8266/Arduino sketches and a few experimental dashboard/data files.

This software can switch real heating equipment. Treat it as a prototype until the safety, reliability, and security issues listed below are addressed and the complete system has been bench-tested. Do not expose its APIs or MQTT broker to the public internet.

## What is in the repository

- `src/` — Node.js service, thermostat control logic, filesystem/configuration, MQTT integration, HTTP listeners, and an incomplete Fastify API.
- `sensor/` — two historical ESP8266 sketches. They are not a maintained, verified firmware build.
- `relais-outlet/` — an ESP8266 relay/web-server sketch and a detached HTML response fragment.
- `index.html` — a local, experimental CO2/air-quality chart; it requests a development endpoint.
- `testing.csv` — sample/simulation data, not live telemetry.
- `index.min.js` — checked-in minified bundle generated from `src/index.ts`; rebuild and review it after source changes.
- `config.json`, `data-log*.csv`, `temperature-history.json`, and `airQualityLog.csv` — runtime/local data. These are intentionally ignored by Git and must not be committed.

The original design notes described a shared heat element and hot-water relay. The current installation has changed: the Arduino now manages the shared heating element automatically from heat demand, and hot-water relay 4 is retired. The thermostat must not command `HEAT_ELEMENT` or `WATER_VALVE`.

## Architecture and data flow

1. `src/index.ts` awaits `Platform.create()`; configuration is loaded and validated before services are constructed or listeners are opened.
2. `ConfigService.load()` parses and validates `./config.json`. Version-2 configs are backed up and atomically migrated to v3. A missing file gets an inert v3 template with no thermostat instances; malformed/invalid files fail before services start.
3. Each configured thermostat's `start()` creates its relay/sensor MQTT clients and subscribes to a temperature topic. Current topic selection is hard-coded around one sensor ID; it is not a general mapping from configured sensor IDs to MQTT topics.
4. Temperature messages update in-memory state, append a CSV row, enter a four-hour temperature window capped at 1,024 samples, and call `evaluateChanges()`. `temperature-history.json` snapshots are persisted no more than once every 15 minutes.
5. `evaluateChanges()` uses a fresh validated sensor sample and `HeatIndex` as the comfort/control value. Commands go to `relais.hostname/relais/<pin>` at QoS 1; incoming ON/OFF messages are the available MQTT-reported relay state. A broker PUBACK is not proof of physical relay actuation.
6. `WeatherInfoService` optionally polls OpenWeatherMap every five minutes. The coordinates are currently hard-coded in `src/services/weather-info.ts`.
7. The plain Node HTTP listener binds to the configured host/port. A separate Fastify server binds to `0.0.0.0` on `port + 1`.

The thermostat MQTT connection currently targets `mqtt://localhost:1883` without authentication; the relay MQTT client also targets localhost and contains an in-source credential. `relais.hostname` is used as a topic prefix, not as the broker hostname. The `secure` relay option is not used by the active MQTT code.

## Requirements and local commands

- Node.js and npm (Node 22 is required by the built-in test command; package metadata declares TypeScript 4.9 and Fastify 5).
- An MQTT broker on the same host, listening on port 1883, with topics/payloads matching the code and firmware.
- A local `config.json` with valid sensor IDs, switch assignments, target state, and relay topic prefix. Keep credentials and device identifiers out of Git.
- Optional: OpenWeatherMap key and MongoDB settings, subject to the limitations below.

Install dependencies and build the service bundle:

```sh
npm ci
npm test
npm run build
node index.min.js
```

`npm run build` overwrites the tracked `index.min.js`. Review that generated diff before committing. There is no lint or start script. The project has no checked-in Arduino build configuration, so the sketches have not been shown to compile as part of the Node build.

Development mode makes the Fastify route prefix `/test`; production uses `/v1` unless `APP_VERSION` is set. The Fastify listener is on port `config.port + 1` (default 8081 when `config.port` is 8080). The plain HTTP listener uses `config.hostname` and `config.port`.

Predictive preheat prototypes are shadow-only and issue no relay commands. Run `npm run preheat:poc` for the synthetic threshold example; run `npm run thermal:phase-poc -- --csv /path/to/data-log.csv` for deterministic per-switch coast/lag analysis with January training and February holdout. The runtime shadow transcript is published retained (QoS 1) to each exact per-instance `mqttTopics.thermostatStatus` entry; configure the sensor subscriptions in `mqttTopics.temperature`. The legacy sensor subscription and relay command/status topics remain supported. Example home topics: `site/home/master-bedroom/climate/temperature` and `site/home/living-space/climate/thermostat`. See [`docs/preheat-poc.md`](docs/preheat-poc.md) and [`docs/thermal-response-poc.md`](docs/thermal-response-poc.md).

## Configuration

`config.json` is ignored by Git. Do not publish it: it can contain a weather API key, sensor/device identifiers, database credentials, and home network details. Relevant version-3 fields are:

- `version`, `hostname`, and `port`
- `weatherMapApiKey`
- `relais.hostname` (legacy relay command/status topic prefix) and `relais.secure`
- `instances[]`: optional `name`, `temperatureSensor`, `mqttTopics.temperature[]` (additional exact sensor topics; legacy sensor topic remains subscribed), `mqttTopics.thermostatStatus[]` (exact retained status destinations), `switches[]`, and `thermostatState`
- `thermostatState`: current/target temperature, current/target mode, humidity, and display units
- `mongoDB` is optional. If omitted, Mongo persistence stays disabled and startup continues; configured Mongo connection failures are logged and treated as optional persistence failure.

Switch types in `src/services/config.ts` include `HEAT`, `HEAT_VALVE`, `COOL`, `COOL_ELEMENT`, `COOL_VALVE`, and `VENT`. `HEAT_ELEMENT` remains only for legacy configuration; the Arduino controls it. `WATER_VALVE` is deprecated and not controlled or listed by the thermostat. Carefully verify which zone output each `pinIndex` controls before enabling the service. MQTT-reported state may be `UNKNOWN` until a status message arrives.

## HTTP endpoints

The legacy plain HTTP listener exposes per-instance routes (for example, `/<instance>/...`):

- `GET /<instance>/` — thermostat state plus `errorStatus` (`null` when healthy).
- `GET /<instance>/error-status` — fault reason/time, last accepted sample and its age, requested OFF pins, broker publish failures, and last MQTT-reported relay states (`ON`, `OFF`, or `UNKNOWN`).
- `GET /<instance>/current-temperature` — returns the calculated heat-index value, not raw dry-bulb temperature.
- `GET /<instance>/current-relative-humidity`
- `GET` and `POST /<instance>/target-temperature`; POST body is `{"value": <number>}`.
- `GET` and `POST /<instance>/target-state`; POST body is `{"value": <mode>}` where modes are `OFF=0`, `HEAT=1`, `COOL=2`, `AUTO=3`.
- `GET /<instance>/current-state`.

The Fastify server currently registers only the valves controller under `/test/valves` in development or `/v1/valves` by default in production. Other controller files and plugin code exist but are not registered by `src/services/api/index.ts`. The valves routes are incomplete and should not be treated as a working, supported interface.

Neither listener implements authentication. Fastify binds to all interfaces; the legacy listener may also bind to all interfaces depending on configuration. CORS is not access control. Restrict these ports to a trusted network and add authentication before connecting clients outside the host/LAN.

## Arduino sketches: known state

These are historical experiments, not release firmware:

- `sensor/senors.ino` is an old DHT22-over-MQTT example with hard-coded network credentials and unfinished/mismatched deep-sleep code (including an undefined wake-up value and ESP-family-specific calls).
- `sensor/sensor_w_ota_mdns.ino` is actually an ESP8266 MQTT light/OTA example, not a temperature sensor. It contains a stray token in the MQTT callback, resets/formats persistent Wi-Fi settings during startup, and uses a fixed OTA password.
- `relais-outlet/relais-outlet.ino` is an unauthenticated HTTP relay experiment; its current source has a missing semicolon and hard-coded Wi-Fi credentials.
- `relais-outlet/webserver http code` is only a fragment, not a standalone sketch.

Do not flash these sketches to equipment without first removing secrets, fixing and compiling for the exact board/libraries, checking relay polarity and boot defaults, and testing with the heater disconnected.

## Important code limitations and recommended fixes

Highest priority:

1. **Credential handling.** Local/example credentials in source are not the production credentials; production secrets are managed separately. Do not copy deployment secrets into source, docs, logs, or this repository.
2. **Fail-safe sensor/relay behavior (implemented in source).** MQTT input is parsed and range/timestamp checked; automatic control is inhibited until a fresh valid sample arrives and a 15-minute watchdog timeout shuts down this zone's thermostat-controlled HVAC outputs. It reports error status at `/<instance>/error-status`. OFF commands are retried at most three times only after broker publish failures. QoS 1 confirms broker receipt, not physical actuation; status remains MQTT-reported/unknown because the relay controller has no command acknowledgement.
3. **Comfort control uses apparent temperature.** `evaluateChanges()` continues to use `HeatIndex` as the comfort/control value, as intended for this installation. Raw room temperature is validated for sensor safety and exposed separately; it does not replace the heat-index target.
4. **Deterministic startup/configuration (implemented).** `Platform.create()` awaits config validation, optional database initialization, thermostat startup, and both listeners; malformed config fails before clients/listeners are opened. Version-2 config is backed up and atomically migrated. Shutdown handles SIGINT/SIGTERM and closes listeners, MQTT clients, timers, and database resources.
5. **Validate the HTTP API.** Reject missing/unknown instances and malformed/out-of-range values with 4xx responses. Add authentication and network binding controls. Several API handlers assume undefined platform/thermostat properties; the Fastify reply helper plugin is not registered, and only the valves controller is currently attached.

Further improvements:

- The service awaits QoS 1 broker publish callbacks and serializes relay transitions, but cannot verify physical actuation. A separate device-side acknowledgement protocol is still needed if hardware confirmation becomes available. The Arduino, not this service, owns the shared heating element.
- Catch malformed MQTT JSON and sensor/API errors; validate finite temperature/humidity values, timestamps, and payload schema. Detect stale, duplicated, or out-of-order samples.
- Fix history handling: `Date` object identity is used for equality, persisted history is not loaded on startup, API timestamp parsing is inconsistent, and min/max over an empty window yields infinities. Use parsed epoch timestamps, bounded storage, and tests around empty windows/restarts.
- Extend automated tests to cover full thermostat/HTTP fault integration, hysteresis boundaries, and device-status behavior. `npm test` currently covers payload validation, stale watchdog logic, relay plans, and broker publish failures. Add a supported TypeScript/Fastify version combination; `tsconfig` uses TypeScript 4.9 while installed Fastify 5 declarations require newer syntax, so `npx tsc --noEmit` currently fails in dependency declarations. The esbuild bundle can still build.
- Remove unused/obsolete dependencies and unfinished files only after checking deployment use. In particular, `express`, `pino`, `@logtail/pino`, and the MSSQL plugin are not part of the active startup path; the MSSQL plugin imports `mssql`, which is not declared in `package.json`.
- Add health/readiness reporting, structured logs without secrets, bounded/rotated CSV logs, and explicit deployment/service-manager instructions.

## Living-comfort ideas

These are measured-control improvements, not a recommendation to raise/lower setpoints without household feedback:

- Use a calibrated temperature sensor in each occupied room, mounted away from direct sun, exterior walls, supply vents, kitchens, and electronics. Compare sensors periodically against a trusted reference.
- Give rooms independent targets and occupancy/time schedules. For slow radiant or underfloor heating, learn each room's warm-up/coast-down time and use gentle preheating rather than large, abrupt setbacks; tune based on comfort and energy measurements.
- Log room temperature, relative humidity, CO2, setpoint, occupancy, outdoor temperature, and relay state on one time base. Use CO2 as a ventilation indicator (not as a direct heating signal) and provide clear alerts when air quality or sensor freshness is poor.
- Use humidity/dew point separately from temperature. For cooling, prevent condensation and avoid over-cooling; for ventilation, prefer outdoor-air conditions that improve indoor humidity/temperature rather than blindly opening windows.
- Account for solar gains, drafts, cold surfaces, and vertical temperature stratification. If complaints persist despite a reasonable air temperature, measure operative/radiant temperature and air movement, not just room-air temperature.
- Optimize comfort with occupant feedback and trends: track when rooms feel too warm/cool, occupancy, and energy use; then adjust schedules, sensor placement, balancing, and hysteresis. Keep mechanical safety limits independent of software comfort logic.

The old room heat-loss notes in the original README are unverified drafts; have building heat loss and emitter capacity checked against actual room dimensions, insulation, ventilation, and design outdoor temperature before using them to size or control equipment.
