export const DEFAULT_SENSOR_STALE_AFTER_MS = 15 * 60 * 1000

export interface ValidSensorSample {
  temperatureC: number
  relativeHumidityPct: number
  sampledAtMs: number
  receivedAtMs: number
}

export type SensorPayloadResult =
  | { ok: true; sample: ValidSensorSample }
  | { ok: false; code: 'SENSOR_INVALID' | 'SENSOR_STALE'; message: string }

export interface FaultRelay {
  pinIndex: number
  type: string
  active: boolean
}

interface MqttPublisher {
  connected: boolean
  publish(
    topic: string,
    payload: string,
    options: { qos: 1; retain: false },
    callback: (error?: Error | null) => void
  ): unknown
}

function fail(code: 'SENSOR_INVALID' | 'SENSOR_STALE', message: string): SensorPayloadResult {
  return { ok: false, code, message }
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() === '') return undefined
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? number : undefined
}

export function validateSensorPayload(
  payload: Buffer | string,
  nowMs: number,
  maxAgeMs: number,
  retained: boolean
): SensorPayloadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'))
  } catch {
    return fail('SENSOR_INVALID', 'MQTT sensor payload is not valid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('SENSOR_INVALID', 'MQTT sensor payload must be an object')
  }

  const data = parsed as Record<string, unknown>
  const temperatureC = finiteNumber(data.temperature)
  const relativeHumidityPct = finiteNumber(data.humidity)

  if (temperatureC === undefined || temperatureC < -20 || temperatureC > 60) {
    return fail('SENSOR_INVALID', 'Temperature is missing, non-finite, or outside -20..60 C')
  }
  if (relativeHumidityPct === undefined || relativeHumidityPct < 0 || relativeHumidityPct > 100) {
    return fail('SENSOR_INVALID', 'Relative humidity is missing, non-finite, or outside 0..100%')
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return fail('SENSOR_INVALID', 'Sensor clock or maximum sample age is invalid')
  }

  let sampledAtMs: number
  if (data.sampledAt === undefined || data.sampledAt === null || data.sampledAt === '') {
    if (retained) {
      return fail('SENSOR_STALE', 'Retained sensor payload has no source timestamp')
    }
    // Non-retained legacy payloads have no source clock; receiver time is the best available age.
    sampledAtMs = nowMs
  } else if (typeof data.sampledAt === 'string') {
    sampledAtMs = Date.parse(data.sampledAt)
  } else {
    sampledAtMs = finiteNumber(data.sampledAt) ?? NaN
  }

  if (!Number.isFinite(sampledAtMs) || sampledAtMs > nowMs) {
    return fail('SENSOR_INVALID', 'Sensor source timestamp is invalid or in the future')
  }
  if (nowMs - sampledAtMs >= maxAgeMs) {
    return fail('SENSOR_STALE', 'Sensor sample is older than the configured maximum age')
  }

  return {
    ok: true,
    sample: { temperatureC, relativeHumidityPct, sampledAtMs, receivedAtMs: nowMs }
  }
}

export function isSensorStale(
  lastValidAtMs: number | undefined,
  startupAtMs: number,
  nowMs: number,
  maxAgeMs: number
): boolean {
  const referenceAtMs = lastValidAtMs ?? startupAtMs
  const ageMs = nowMs - referenceAtMs
  return !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= maxAgeMs
}

export function hasFreshSensorSample(
  lastValidAtMs: number | undefined,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (lastValidAtMs === undefined) return false
  const ageMs = nowMs - lastValidAtMs
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < maxAgeMs
}

/**
 * Return only outputs owned by this thermostat zone that should be switched off
 * on a sensor fault. The Arduino, not this service, now owns HEAT_ELEMENT;
 * WATER_VALVE is legacy and no longer controlled here.
 */
export function faultShutdownPlan<T extends FaultRelay>(zoneSwitches: readonly T[]): T[] {
  const zoneValves = zoneSwitches.filter(relay =>
    relay.type === 'HEAT_VALVE' || relay.type === 'COOL_VALVE'
  )
  const zoneEquipment = zoneSwitches.filter(relay =>
    ['HEAT', 'COOL', 'COOL_ELEMENT', 'VENT'].includes(relay.type)
  )
  return [...zoneValves, ...zoneEquipment]
}

export function executeFaultShutdown<T extends FaultRelay>(
  zoneSwitches: readonly T[],
  commandOff: (relay: T) => Promise<void>
): Promise<{ requestedPinIndexes: number[]; failures: { pinIndex: number; message: string }[] }> {
  const plan = faultShutdownPlan(zoneSwitches)
  return (async () => {
    const failures: { pinIndex: number; message: string }[] = []
    for (const relay of plan) {
      try {
        await commandOff(relay)
      } catch (error) {
        failures.push({
          pinIndex: relay.pinIndex,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    return { requestedPinIndexes: plan.map(relay => relay.pinIndex), failures }
  })()
}

export function relayTransitionPlan<T extends FaultRelay>(
  zoneSwitches: readonly T[],
  mode: string
): { turnOn: T[]; turnOff: T[] } {
  const typesToTurnOn: string[] = mode === 'HEAT'
    ? ['HEAT', 'HEAT_VALVE', 'VENT']
    : mode === 'COOL'
      ? ['COOL', 'COOL_ELEMENT', 'COOL_VALVE', 'VENT']
      : []
  const typesToTurnOff: string[] = mode === 'HEAT'
    ? ['COOL', 'COOL_ELEMENT', 'COOL_VALVE']
    : mode === 'COOL'
      ? ['HEAT', 'HEAT_VALVE']
      : mode === 'NONE'
        ? ['HEAT', 'HEAT_VALVE', 'COOL', 'COOL_ELEMENT', 'COOL_VALVE', 'VENT']
        : []

  return {
    turnOn: zoneSwitches.filter(relay => typesToTurnOn.includes(relay.type)),
    turnOff: zoneSwitches.filter(relay => typesToTurnOff.includes(relay.type))
  }
}

/**
 * Waits for the MQTT broker's QoS 1 PUBACK only. This is not proof that a
 * physical relay received or applied the command.
 */
export function publishWithBrokerAck(
  client: MqttPublisher,
  topic: string,
  payload: string
): Promise<void> {
  if (!client.connected) return Promise.reject(new Error('MQTT client is not connected'))

  return new Promise<void>((resolve, reject) => {
    try {
      client.publish(topic, payload, { qos: 1, retain: false }, error => {
        if (error) reject(error)
        else resolve()
      })
    } catch (error) {
      reject(error)
    }
  })
}
