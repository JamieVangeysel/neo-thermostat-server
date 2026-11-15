# Neo Thermostat Server: implementation roadmap

Status: Recommendations 2 and 4 have been applied to source and the generated bundle. Neither change has been deployed or exercised against live hardware. Recommendations 5 and 6 remain proposals.

This document records the completed Recommendation 2 and 4 slices; Recommendations 5 and 6 remain proposed. Earlier Recommendation 2 and 4 code sketches are historical; applied source is authoritative. Future changes should use tests-first and be reviewed before deployment.

Assumptions and constraints:

- Production credentials are managed separately from repository credentials. This plan does not rotate or reproduce any credentials; production values must continue to come from the deployment's secret mechanism.
- The app controls real heating/cooling equipment. Software cannot guarantee a safe physical state if a relay, broker, power supply, or actuator fails. Preserve independent plant protections and a manual cutoff.
- The Arduino now manages the shared heating element from zone heat demand; the thermostat must not command `HEAT_ELEMENT`. Hot-water relay 4 is retired; `WATER_VALVE` is deprecated and must not be controlled. On sensor fault, switch OFF only this thermostat zone's configured HVAC outputs.
- The current firmware files do not define the live production MQTT contract. Confirm the production sensor and relay message formats before changing them. Some proposed acknowledgements require matching firmware/controller changes.

## Current implementation facts used by this plan

- `src/services/thermostat.ts` now validates MQTT temperature/humidity, tracks sample freshness, inhibits control until an accepted sample, uses room temperature for control, and reports sensor/relay errors.
- `src/services/relais.ts` now serializes transition publishes and awaits QoS 1 broker callbacks. This proves broker acceptance only, not physical state. MQTT-reported relay state is shown as ON/OFF/UNKNOWN; there is no device command acknowledgement.
- `src/platform.ts` starts asynchronous initialization in the constructor and attaches an async `initialized` event handler. `EventEmitter.emit()` does not await that handler.
- `ConfigService.initialize()` emits a config rather than returning it. A v2 config is upgraded only in memory.
- `DatabaseService` dereferences `config.mongoDB` even though `IConfigV3.mongoDB` is optional. The default v3 config omits it.
- `src/services/http-listener.ts` is a raw HTTP server with no authorization; `src/services/api/index.ts` binds Fastify to `0.0.0.0`, sets `trustProxy` true, and registers only the incomplete valves controller.
- `WeatherInfoService` uses fixed coordinates. The existing CO2/air-quality files are a separate, incomplete path; there is no complete CO2-to-thermostat integration.

## Delivery order and approval gates

Do not combine all four changes in one release.

1. Foundation: `npm test` now runs isolated tests without hardware connections. TypeScript/Fastify toolchain alignment remains a separate follow-up.
2. Recommendation 4 is implemented; keep startup/config regression tests in the suite.
3. Recommendation 5: require authentication on both HTTP servers and make listener binding explicit. Deploy only after the calling client/reverse-proxy path is ready to send credentials.
4. Recommendation 2 is implemented in source. Run the offline tests/build, then bench-test against a simulator before any supervised hardware testing.
5. Recommendation 6: telemetry and comfort schedules in read-only/shadow mode first; only then allow scheduled setpoints to feed the existing controller.

At each gate: review the diff, run unit tests and the bundle build to a temporary output, back up the deployment config, record the previous build/config version, and require explicit approval before touching a live service or relay. `index.min.js` was rebuilt for Recommendations 2 and 4; rebuild and review it again after future source changes.

## Foundation: tests and compiler compatibility

`npm test` uses Node 22's built-in test runner and TypeScript stripping. The project typecheck remains blocked by its TypeScript 4.9.5/Fastify 5.5.0 declaration mismatch and other existing type errors. The tests use temporary config files and loopback-only HTTP; they do not construct `Platform`, connect to MQTT/Mongo, or touch hardware.

## Recommendation 2: fail safe on bad/stale sensors and relay failures — applied

Implemented in `src/services/sensor-safety.ts`, `src/services/thermostat.ts`, `src/services/relais.ts`, `src/services/http-listener.ts`, and the relay/config type definitions. The generated bundle is refreshed as part of this change; no service was started and no live broker/relay was contacted.

- Validate JSON payloads, finite temperature (`-20..60 C`) and RH (`0..100%`), source timestamps, clock skew, sample age, retained messages without a timestamp, and non-advancing timestamps before updating thermostat state.
- Default sample timeout is 15 minutes; a first valid sample is required before automatic control can act. Invalid samples trigger the same zone shutdown immediately. Sensor faults clear when a fresh valid sample arrives.
- Control continues to use `HeatIndex` as the user's intended apparent-temperature/comfort value. Raw sensor temperature is validated for data safety but does not replace the control variable.
- On a fault, send non-retained QoS 1 OFF commands to this zone's `HEAT`, `HEAT_VALVE`, `COOL`, `COOL_VALVE`, `COOL_ELEMENT`, and `VENT` outputs. Do not command `HEAT_ELEMENT` (Arduino-owned) or `WATER_VALVE` (retired). Retry broker-level failures at most three attempts, at 30-second intervals.
- Relay transition commands are serialized. Broker publish errors and offline/subscription failures are reported. The service waits for QoS 1 broker PUBACK but cannot verify physical actuation. MQTT status is exposed as ON/OFF/UNKNOWN and must not be described as a device-correlated acknowledgement.
- `GET /<instance>/` includes `errorStatus`; `GET /<instance>/error-status` returns the detailed fault and latest MQTT-reported relay states.
- `npm test` covers parsing/range/freshness, startup gating, stale retained payloads, zone-only shutdown planning, deprecated output exclusion, continued OFF attempts after failures, and broker publish callbacks. These are offline unit tests, not hardware tests.

Remaining limitation: without a source timestamp, a non-retained message is aged from local receipt time; delayed-but-non-retained sensor messages cannot be recognized as old. A retained message without a source timestamp is rejected, so a fresh live sample is needed after subscription. The code cannot prove the relay physically changed state; hardware testing and independent cutoffs remain required before deployment.

## Recommendation 4: deterministic startup, config validation, optional database, graceful shutdown — applied

Implemented in `src/services/config-service.ts`, `src/platform.ts`, `src/index.ts`, `src/services/database.ts`, `src/services/http-listener.ts`, `src/services/api/index.ts`, `src/services/thermostat.ts`, `src/services/relais.ts`, and `src/services/weather-info.ts`. The design snippets below describe the original proposal; the applied code is authoritative. No production config or live service was opened.

### Configuration service

Make configuration loading return a value instead of using an async event listener. `ConfigService` should have a single `load(): Promise<IConfigV3>` path that reads, parses, validates, migrates, and returns config. It must never emit an event whose async listener is expected to finish initialization.

Proposed shape for `src/services/config.ts`:

```ts
export class ConfigService {
  async load(): Promise<IConfigV3> {
    const fileExists = await filesystem.exists('./config.json')
    const raw = fileExists
      ? filesystem.checkBuffer(await filesystem.readFile('./config.json'))
      : this.defaultConfig()
    if (!raw) throw new Error('config.json is invalid JSON or has no supported version')

    const migrated = raw.version === 2
      ? this.migrateV2ToV3(raw as IConfig)
      : raw as IConfigV3
    validateConfig(migrated)
    if (!fileExists) await this.writeConfigAtomically(migrated)
    return migrated
  }
}
```

Keep v2 migration pure and tested. Do not write a migrated file until validation passes; before persisting a migration, write a `config.json.bak` copy and use a temp-file-plus-rename strategy. Never replace a malformed existing file with defaults: fail closed with a useful error and preserve the original.

Add explicit validation before any service/client/server is constructed. Validate version, host/port, instances non-empty, unique instance names, non-empty sensor mapping, unique switch identity, supported switch enum, finite setpoint and state enums. Validate `mongoDB` only when present and enabled. Avoid logging config objects or secrets.

### Platform lifecycle

Replace constructor-triggered async startup with an awaited factory. Proposed `src/platform.ts` pattern:

```ts
export class Platform {
  private constructor(private readonly _config: IConfigV3) {
    this.configService = new ConfigService()
    this.http = new HttpListener(this)
  }

  static async create(): Promise<Platform> {
    const config = await new ConfigService().load()
    const platform = new Platform(config)
    await platform.start()
    return platform
  }

  private async start(): Promise<void> {
    this.database = new DatabaseService(this)
    await this.database.init() // no-op when Mongo is omitted
    this.api = new API(this, this.config.port + 1)
    await this.api.listen()
    this.thermostats = this.config.instances.map(
      instance => new Thermostat(this, instance.name ?? 'default')
    )
    await this.http.listen(this.config.hostname, this.config.port)
    for (const thermostat of this.thermostats) await thermostat.start()
  }

  async stop(): Promise<void> {
    await Promise.all(this.thermostats.map(thermostat => thermostat.stop()))
    await this.http.close()
    await this.api.close()
    await this.database.close()
  }

  get config(): IConfigV3 { return this._config }
}
```

Make startup ordering explicit: validate config; initialize optional persistence; create platform/service objects; establish relay/sensor state safely; then listen for control requests. If any mandatory startup step fails, close already-started resources in reverse order and reject startup. `listen()` must reject on bind errors instead of logging and swallowing them. Add idempotent shutdown methods for HTTP, Fastify, MQTT, timers, and Mongo.

Remove network/timer side effects from constructors while doing this. `Thermostat` currently creates `Relais`, starts weather polling, and connects its sensor MQTT client in its constructor; `Relais` also connects in its constructor. Constructors should only store validated dependencies. Add awaited `start()` methods for `Relais`, `WeatherInfoService`, and `Thermostat`, and `stop()` methods that close clients/clear timers. This lets `Platform.start()` control order and clean up partial startup.

Update `src/index.ts`:

```ts
async function main(): Promise<void> {
  const platform = await Platform.create()
  const shutdown = async () => {
    await platform.stop()
    process.exitCode = 0
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('Thermostat startup failed', err)
  process.exitCode = 1
})
```

Do not restart the process inside `uncaughtException`; log and exit nonzero so the service manager can restart it after the hardware outputs are handled by the independent safety policy.

### Optional database behavior

In `src/services/database.ts`, do not construct a URL from absent Mongo settings. The omitted setting must mean database disabled, not a startup exception:

```ts
constructor(platform: Platform) {
  this.platform = platform
  this.config = platform.config
  this.url = this.config.mongoDB
    ? this.dbUrl
    : ''
}

async init(): Promise<void> {
  if (!this.url) {
    this._enabled = false
    this.platform.logger.info('MongoDB not configured; persistence disabled')
    return
  }
  // Connect and validate using the existing driver, then set _enabled.
}
```

Change `dbName`/`dbUrl` to only access `mongoDB` after the guard. Database operations should return a clear disabled error (or a typed optional result) and always close resources in `finally`. Do not make Mongo availability mandatory for thermostat control unless the operator explicitly configures it as such.

### Tests and acceptance

- Config tests: absent file creates a valid default; valid v2 migrates; valid v3 loads; malformed JSON, unsupported version, invalid ports/instances, duplicate IDs, and invalid switch types fail without overwriting the source config; omitted Mongo remains disabled.
- Lifecycle tests: awaited startup completes only after listeners and thermostats are ready; injected DB/MQTT/listener failure rejects and closes prior resources; stop is idempotent and closes each resource once.
- Acceptance: no async event ordering; no startup network listener before config validation; no production config secret is logged; service manager receives nonzero exit on fatal startup failure.

## Recommendation 5: authenticated APIs and explicit network binding

### Access policy

Protect both HTTP surfaces. CORS is not authorization. The plain Node listener and Fastify server are separate listeners and both need the same policy. Require an API token from the deployment environment; never put it in source, `config.json`, the browser bundle, or logs. Keep the existing production secret source; do not assume local/repository values are production values.

Use TLS at a trusted reverse proxy or use an authenticated private network/VPN between clients and this service. A bearer token over plain HTTP can be intercepted; binding restrictions do not replace TLS. Do not store a long-lived server token in frontend JavaScript/localStorage. If a browser app needs access, use a server-side authenticated proxy/session (or another reviewed identity mechanism) that injects the service credential.

Set the Fastify bind address from the same explicit configuration/env override used by the legacy listener. Require a token before either listener can bind. For local-only operation use loopback; LAN operation is allowed only with token + TLS/private-network controls. Remove `trustProxy = config.trustProxy || true`; only enable trusted proxy support when specific proxy hops are configured.

### Shared authorization helper

Add `src/services/api/auth.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'

export function hasValidBearerToken(
  authorization: string | string[] | undefined,
  expectedToken: string | undefined
): boolean {
  if (!expectedToken || Array.isArray(authorization)) return false
  const match = /^Bearer ([^ ]+)$/.exec(authorization ?? '')
  if (!match) return false

  const supplied = Buffer.from(match[1])
  const expected = Buffer.from(expectedToken)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export function requireApiToken(value: string | undefined): string {
  if (!value || value.length < 32) {
    throw new Error('THERMOSTAT_API_TOKEN must be set to a high-entropy token before HTTP startup')
  }
  return value
}
```

Tests should inject tokens directly; do not check in any usable token. Compare equal-length buffers only after checking lengths. Do not return which part of the credential failed.

### Apply it to both listeners

In `src/services/http-listener.ts`, add authorization at the top of the request handler, before route lookup or state changes:

```ts
if (!hasValidBearerToken(req.headers.authorization, this.apiToken)) {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer'
  })
  res.end(JSON.stringify({ error: 'unauthorized' }))
  return
}
```

Pass the validated token into the listener constructor; do not read it from a file or echo it. Add a request body size limit and return 400/413 for malformed/oversized bodies while touching this handler.

In `src/services/api/index.ts`, register a Fastify `onRequest` hook before route registration:

```ts
this.server.addHook('onRequest', async (request, reply) => {
  // CORS plugin validates the preflight origin/method/headers; actual calls still require auth.
  if (request.method === 'OPTIONS') return
  if (!hasValidBearerToken(request.headers.authorization, this.apiToken)) {
    return reply.code(401).header('WWW-Authenticate', 'Bearer')
      .send({ error: 'unauthorized' })
  }
})
```

Browser CORS preflights do not carry the bearer token. Register the strict CORS plugin before the auth hook, and allow only valid `OPTIONS` preflights from the configured origin/method/header allowlist; preflight returns no application data and cannot perform a state change. Require the bearer token on the actual request. Do not exempt other methods. Correct the currently always-true `trustProxy` setting. Apply authentication to every controller, including future status/air routes, not only valves. Also fix routes that currently dereference missing platform/thermostat properties before treating the API as deployable.

Listener configuration should be explicit, for example:

```ts
const bindHost = process.env.THERMOSTAT_BIND_HOST ?? config.hostname
const apiToken = requireApiToken(process.env.THERMOSTAT_API_TOKEN)
await api.listen(bindHost, config.port + 1)
await http.listen(bindHost, config.port)
```

Refuse startup if the token is missing or too short. Log only the host/port and whether TLS is terminated at a configured proxy; never log authorization headers. A reverse proxy should bind to the application loopback interface and expose only its authenticated TLS endpoint.

### Tests and rollout

- Test helper: missing token, wrong scheme, wrong token, array header, and correct token.
- Integration tests against both listeners: every existing GET/POST/PUT route returns 401 without token; authorized reads work; unauthorized mutations do not change target state or call a relay; malformed authorization is rejected; preflight behavior is explicitly tested.
- Test startup refuses to listen with missing token and that host selection is identical for both servers.
- Acceptance: network scan from an untrusted segment cannot access the internal app ports; TLS/auth is verified at the public proxy; no browser bundle contains the server token. Keep a tested rollback configuration and do not roll back to an unauthenticated listener on a reachable network.

## Recommendation 6: measured comfort features, per-room schedules, humidity, CO2, and solar gains

Implement this as an observability-first feature. Current `IThermostatInstanceConfig` is per thermostat and sensor selection is hard-coded in `Thermostat`; `air.js` is not a complete sensor integration. Do not make CO2, outdoor weather, or a predicted comfort score directly switch heating/cooling in the first release.

### 6A. Define sensor/zone configuration and calibrate observations

Extend the per-instance config with explicit sensor topics, calibration, limits, and an optional comfort profile. Keep backward migration for v2 and existing v3 files:

```ts
export interface ISensorConfig {
  topic: string
  calibrationOffsetC: number
  maxAgeMs: number
}

export interface ISchedulePeriod {
  daysOfWeek: number[] // 0=Sunday through 6=Saturday
  start: string        // local 24-hour HH:mm
  targetTemperatureC: number
}

export interface IComfortConfig {
  timeZone: string     // IANA timezone, e.g. Europe/Brussels
  schedule: ISchedulePeriod[]
  occupiedTargetC: number
  awayTargetC: number
  humidityLowPct?: number
  humidityHighPct?: number
  co2AdvisoryPpm?: number
}

export interface IThermostatInstanceConfig {
  name?: string
  temperatureSensor: string
  sensor?: ISensorConfig
  comfort?: IComfortConfig
  thermostatState: ThermostatState
  switches: IRelaisSwitch[]
}
```

`topic` must be explicit per instance; remove the hash-to-topic conditional in `Thermostat` only after config migration and the producer/consumer topic contract are verified. Add a sensor-ID-to-zone uniqueness check. Add the calibration offset to measured temperature before state/logging, but preserve both raw and corrected readings in telemetry for diagnosis.

New `src/services/comfort.ts` pure helpers:

```ts
export function calibratedTemperatureC(rawC: number, offsetC: number): number {
  if (!Number.isFinite(rawC) || !Number.isFinite(offsetC)) {
    throw new Error('Temperature and calibration offset must be finite')
  }
  return rawC + offsetC
}

export function dewPointC(temperatureC: number, relativeHumidityPct: number): number {
  if (!Number.isFinite(temperatureC) ||
      !Number.isFinite(relativeHumidityPct) ||
      relativeHumidityPct <= 0 || relativeHumidityPct > 100) {
    throw new Error('Temperature/RH outside dew-point calculation domain')
  }
  const a = 17.62
  const b = 243.12
  const gamma = Math.log(relativeHumidityPct / 100) + (a * temperatureC) / (b + temperatureC)
  return (b * gamma) / (a - gamma)
}
```

Tests cover calibration sign, invalid input, 50%/100% humidity behavior, and known reference examples. Treat dew point as a displayed advisory first; never use it as an unreviewed cooling actuator command.

### 6B. Add a deterministic schedule engine; keep it out of relay control initially

Add a pure `targetForLocalTime(schedule, timeZone, now)` helper. Use `Intl.DateTimeFormat` with the configured IANA zone, not the host machine timezone. Validate day numbers, `HH:mm`, temperature bounds, duplicate/overlapping periods, timezone existence, gaps, and daylight-saving transitions. Document whether overnight schedules belong to their starting or ending weekday and test that rule.

The scheduler computes the desired target and passes it to the existing setpoint API only after validation. Manual override has priority until an explicit expiry/clear action; occupancy input is optional and unavailable data defaults to the conservative configured schedule, not an assumption that the home is empty.

Shadow-mode record fields (one timestamp format, UTC):

- raw/corrected room temperature, relative humidity, derived dew point;
- target and target source (manual/schedule/occupancy override);
- per-room sample age/quality and relay observed state;
- CO2 ppm and outdoor temperature/solar estimate only when the respective sensor/feed is valid;
- occupant feedback (too warm/comfortable/too cool) if provided.

The first schedule release must record the target it would choose without changing the active target. After reviewing at least a representative week including occupancy and wake/sleep cycles, enable one room at a time with a one-click manual override.

### 6C. Integrate CO2/ventilation and outdoor/solar data as advice

Add a separate typed air-quality measurement source and freshness handling; do not infer CO2 from the existing `coSensor.getRating` helper alone. That file's rating thresholds are project-specific and should be reviewed against the actual sensor/measurement method. Validate units, timestamps, sensor identity, and sensor warm-up/fault states. `co2AdvisoryPpm` should be user-configured, with alert text such as “consider ventilation”; it must not directly set HVAC heat/cool mode.

Move weather coordinates into validated local configuration (or a deployment environment variable). The current weather request is a single point and has no solar irradiance. For solar gain, prefer a real local irradiance/illuminance sensor or a clearly labeled forecast estimate. Store raw feed/source and quality; do not apply weather compensation to setpoint/relay logic until shadow-mode errors and room response have been reviewed.

Comfort strategy for slow radiant/underfloor heating:

- learn warm-up/coast-down times from per-room history;
- use a modest schedule transition and gentle preheat, avoiding large abrupt setbacks;
- respect minimum on/off times, heating/cooling deadband, floor-surface limits, and the independent safety matrix;
- do not optimize energy at the expense of an occupant's manual override or comfort report.

### Tests and acceptance

- Per-zone config/topic mapping and v2/v3 migration preserve old target/mode/switch assignments.
- Schedule tests cover weekdays/weekends, midnight crossing, timezone, DST changes, manual override expiry, and invalid schedules.
- Comfort helper tests cover calibration and humidity/dew point boundaries.
- CO2 tests ensure stale/invalid readings produce “unknown”/no advisory and never a relay action.
- Shadow mode proves schedule and weather values are recommendations only; manual override is immediate and durable.
- Enable automatic schedule updates for one selected room only after operator review; roll out to other zones after comfort feedback.

## Cross-feature acceptance and rollback

Before any live deployment:

1. Add the tests first and observe each new test fail for the expected reason.
2. Run unit/integration tests with fake MQTT and fake clocks; run typecheck after resolving the TS/Fastify mismatch.
3. Build to a temporary path, compare/review the output, then explicitly rebuild the tracked bundle only when approved.
4. Test startup/shutdown with the real config copied to a private staging location; redact secrets from logs and test reports.
5. Test authentication and network binding from both trusted and untrusted network locations.
6. Test sensor loss, broker loss, relay controller loss, stuck/mismatched relay, restart, and recovery with the heat plant electrically disconnected or in a controlled bench setup.
7. Review the plant-specific safe-state matrix with the responsible HVAC/electrical operator. Verify independent high limits and manual disconnects physically.
8. Deploy one release at a time with an operator present. Monitor actual relay feedback, fault status, room temperature, and comfort reports. Stop if observed relay state differs from the controller's requested state.

Rollback restores the prior code/config snapshot and service version, but it must not restore an unauthenticated externally reachable service. If the new process cannot verify hardware state, disable software automation and use the plant's approved manual/safety controls; do not blindly replay stored relay commands on rollback.
