# Neo Thermostat Server

A personal home-automation project for reading temperature/humidity sensors and controlling heating/cooling relays. The main service is TypeScript/Node.js; the repository also contains older ESP8266/Arduino sketches and a few experimental dashboard/data files.

This software can switch real heating equipment. Treat it as a prototype until the safety, reliability, and security issues listed below are addressed and the complete system has been bench-tested. Do not expose its APIs or MQTT broker to the public internet.

## What is in the repository

- `src/` — Node.js service, thermostat control logic, filesystem/configuration, MQTT integration, HTTP listeners, and an incomplete Fastify API.
- `sensor/` — two historical ESP8266 sketches. They are not a maintained, verified firmware build.
- `relais-outlet/` — an ESP8266 relay/web-server sketch and a detached HTML response fragment.
- `index.html` — a local, experimental CO2/air-quality chart; it requests a development endpoint.
- `testing.csv` — sample/simulation data, not live telemetry.
- `index.min.js` — checked-in minified bundle, but it is currently stale compared with a fresh build from `src/index.ts`; rebuild and review it before deploying source changes.
- `config.json`, `data-log*.csv`, `temperature-history.json`, and `airQualityLog.csv` — runtime/local data. These are intentionally ignored by Git and must not be committed.

The root README historically described a planned setup of two thermostats, three valves, and a shared heat element. That is a design note, not proof that the current code/configuration safely implements that layout.

## Architecture and data flow

1. `src/index.ts` constructs `Platform`.
2. `ConfigService` reads `./config.json`, accepts version 2 or 3, and upgrades a version-2 object to version 3 in memory.
3. Each configured thermostat creates a `Relais` MQTT client and subscribes to a temperature topic. Current topic selection is hard-coded around one sensor ID; it is not a general mapping from configured sensor IDs to MQTT topics.
4. Temperature messages update in-memory state, append a CSV row, update a JSON history file, and call `evaluateChanges()`.
5. `evaluateChanges()` uses configured target/mode and relay state to decide whether to publish relay commands. Relay command publication is MQTT to `relais.hostname/relais/<pin>`; relay status is expected back on `relais.hostname/relais/#`.
6. `WeatherInfoService` optionally polls OpenWeatherMap every five minutes. The coordinates are currently hard-coded in `src/services/weather-info.ts`.
7. The plain Node HTTP listener binds to the configured host/port. A separate Fastify server binds to `0.0.0.0` on `port + 1`.

The thermostat MQTT connection currently targets `mqtt://localhost:1883` without authentication; the relay MQTT client also targets localhost and contains an in-source credential. `relais.hostname` is used as a topic prefix, not as the broker hostname. The `secure` relay option is not used by the active MQTT code.

## Requirements and local commands

- Node.js and npm (the checked-in package metadata declares TypeScript 4.9 and Fastify 5).
- An MQTT broker on the same host, listening on port 1883, with topics/payloads matching the code and firmware.
- A local `config.json` with valid sensor IDs, switch assignments, target state, and relay topic prefix. Keep credentials and device identifiers out of Git.
- Optional: OpenWeatherMap key and MongoDB settings, subject to the limitations below.

Install dependencies and build the service bundle:

```sh
npm ci
npm run build
node index.min.js
```

`npm run build` overwrites the tracked `index.min.js`. Review that generated diff before committing. There is currently no test, lint, or start script. The project has no checked-in Arduino build configuration, so the sketches have not been shown to compile as part of the Node build.

Development mode makes the Fastify route prefix `/test`; production uses `/v1` unless `APP_VERSION` is set. The Fastify listener is on port `config.port + 1` (default 8081 when `config.port` is 8080). The plain HTTP listener uses `config.hostname` and `config.port`.

## Configuration

`config.json` is ignored by Git. Do not publish it: it can contain a weather API key, sensor/device identifiers, database credentials, and home network details. Relevant version-3 fields are:

- `version`, `hostname`, and `port`
- `weatherMapApiKey`
- `relais.hostname` (MQTT topic prefix) and `relais.secure`
- `instances[]`: optional `name`, `temperatureSensor`, `switches[]`, and `thermostatState`
- `thermostatState`: current/target temperature, current/target mode, humidity, and display units
- `mongoDB` is typed as optional, but the current database service dereferences it during construction. A fresh version-3 configuration without `mongoDB` can therefore fail during startup; fix this before relying on clean installs.

Switch types in `src/services/config.ts` include `HEAT`, `HEAT_ELEMENT`, `HEAT_VALVE`, `WATER_VALVE`, `COOL`, `COOL_ELEMENT`, `COOL_VALVE`, and `VENT`. Carefully verify which physical output each `pinIndex` controls before enabling the service. Do not assume the stored `active` value matches the real relay state after boot or a communication failure.

## HTTP endpoints

The legacy plain HTTP listener exposes per-instance routes (for example, `/<instance>/...`):

- `GET /<instance>/` — thermostat state.
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

1. **Remove and rotate embedded secrets.** The repository contains network/MQTT/OTA credentials in firmware and a credential in the relay service. Move secrets to ignored configuration or a secrets manager. If any value has ever been used on a real network, rotate it; if the repository was public, assume it was exposed and consider removing it from Git history.
2. **Make heating control fail-safe.** Add a sensor freshness watchdog, validated input/range checks, safe output state on boot/reconnect, explicit command acknowledgements and timeouts, independent temperature limits, and a documented manual cutoff. Test relay interlocks and shared heat-element logic before connecting the plant.
3. **Use a valid control temperature.** `evaluateChanges()` controls heating/cooling with `HeatIndex`. The heat-index equation is intended for hot-weather apparent-temperature estimates and is not suitable as the room thermostat variable across ordinary indoor temperatures. Use validated room/operative temperature; handle humidity separately and validate any comfort model.
4. **Fix lifecycle and configuration startup.** The async `initialized` event handler is not awaited by `EventEmitter`; `Platform` also starts initialization from its constructor without returning/awaiting it. Validate/migrate configuration before creating services, handle missing MongoDB cleanly, await all startup steps, and implement graceful shutdown for HTTP/MQTT/database connections.
5. **Validate the HTTP API.** Reject missing/unknown instances and malformed/out-of-range values with 4xx responses. Add authentication and network binding controls. Several API handlers assume undefined platform/thermostat properties; the Fastify reply helper plugin is not registered, and only the valves controller is currently attached.

Further improvements:

- Await MQTT publish acknowledgements; do not use un-awaited `forEach(async ...)` for relay transitions. Distinguish desired and confirmed physical state, serialize transitions, enforce heat/cool mutual exclusion, and make shared pump/element behavior explicit across zones.
- Catch malformed MQTT JSON and sensor/API errors; validate finite temperature/humidity values, timestamps, and payload schema. Detect stale, duplicated, or out-of-order samples.
- Fix history handling: `Date` object identity is used for equality, persisted history is not loaded on startup, API timestamp parsing is inconsistent, and min/max over an empty window yields infinities. Use parsed epoch timestamps, bounded storage, and tests around empty windows/restarts.
- Add automated tests for hysteresis boundaries, heat/cool interlocks, relay failures, stale data, and multi-zone shared equipment. Add a supported TypeScript/Fastify version combination; `tsconfig` currently uses TypeScript 4.9 while installed Fastify 5 declarations require newer TypeScript syntax, so `npx tsc --noEmit` fails in dependency declarations. The esbuild bundle can still build.
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
