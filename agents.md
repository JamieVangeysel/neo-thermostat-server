# Agent instructions

## Safety and scope

- This repository controls real heating/cooling relays. Treat relay, thermostat, MQTT, firmware, and deployment changes as safety-sensitive. Never connect to a live broker, publish a relay command, flash a device, restart the deployed service, or change a real setpoint unless the user explicitly asks for that specific operation.
- Keep tests isolated and use mocked/fake sensors and relays. Before proposing or implementing control changes, preserve a manual cutoff and consider safe boot/reconnect behavior, stale sensor data, actuator acknowledgement, thermal limits, and heat/cool interlocks.
- Do not expose, copy into documentation, or print credentials, API keys, sensor IDs, home-network details, or runtime configuration. `config.json`, logs, and history files are ignored local data; do not add them to Git or alter them unless asked.
- Embedded firmware has contained credentials. Never repeat them. Recommend rotation if any may be active; do not perform credential rotation without the user's direction.

## Repository map and source of truth

- `src/` is the primary Node/TypeScript service. It also contains older JavaScript controllers and incomplete API/plugin code.
- `index.min.js` is a checked-in generated bundle and is currently stale versus a fresh build from `src/`. Source changes belong in `src/`. `npm run build` overwrites this artifact; do not run it unless the user expects the bundle to be updated, and review the generated diff.
- `sensor/*.ino` and `relais-outlet/*.ino` are experimental historical sketches, not a verified current firmware toolchain. The stand-alone relay web-server fragment is not a buildable sketch.
- `index.html`, CSV files, and runtime JSON are experimental/demo or local data, not authoritative control configuration.
- No automated tests, lint script, Arduino build, or validated deployment recipe is currently present. Do not imply that a code path or device was tested when only static inspection/build was done.

## Working conventions

- Preserve the existing mixed TypeScript/JavaScript style unless a focused refactor is requested. Keep config types and runtime validation aligned.
- Avoid broad rewrites of thermostat state/control logic. First add isolated tests for boundary conditions, actuator failures, stale data, and multi-zone shared relays; then change the implementation.
- Validate every external input (configuration, HTTP body/path, MQTT payload, sensor readings, timestamps) before it can affect a relay.
- Keep secret material out of logs, examples, commits, and generated documentation. Use placeholders only.
- Document any current behavior as observed in code, distinguishing working paths from historical plans and incomplete code.

## Validation

- `npm ci` installs lockfile dependencies.
- `npm run build` builds `src/index.ts` into the tracked `index.min.js`; use a temporary output path when checking the bundle without changing the checked-in artifact.
- `npx tsc --noEmit` currently fails while parsing installed Fastify 5 declaration files with the declared TypeScript 4.9 toolchain. Report that limitation; do not conceal it by excluding dependencies unless the task includes a deliberate toolchain fix.
- Do not claim runtime/hardware safety from a successful bundle build. No live MQTT, HTTP control, database, or Arduino interactions without explicit authorization.
