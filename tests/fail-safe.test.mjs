import test from 'node:test'
import assert from 'node:assert/strict'

const safety = await import('../src/services/sensor-safety.ts').catch(() => null)

test('sensor-safety module is available for control decisions', () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
})

test('accepts a valid fresh sensor message and normalizes numeric strings', () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  const result = safety.validateSensorPayload(
    Buffer.from(JSON.stringify({ temperature: '20.5', humidity: '45', sampledAt: '2026-11-13T10:00:00.000Z' })),
    1794564000000,
    15 * 60_000,
    false
  )
  assert.equal(result.ok, true)
  assert.equal(result.sample.temperatureC, 20.5)
  assert.equal(result.sample.relativeHumidityPct, 45)
})

test('rejects malformed payloads and out-of-range readings', () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  assert.equal(safety.validateSensorPayload(Buffer.from('{'), 1000, 10000, false).code, 'SENSOR_INVALID')
  assert.equal(
    safety.validateSensorPayload(Buffer.from('{"temperature":90,"humidity":40}'), 1000, 10000, false).code,
    'SENSOR_INVALID'
  )
  assert.equal(
    safety.validateSensorPayload(Buffer.from('{"temperature":20,"humidity":101}'), 1000, 10000, false).code,
    'SENSOR_INVALID'
  )
})

test('rejects old, future-dated, and timestamp-free retained sensor messages', () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  assert.equal(
    safety.validateSensorPayload(Buffer.from('{"temperature":20,"humidity":40,"sampledAt":1000}'), 20_000, 10_000, false).code,
    'SENSOR_STALE'
  )
  assert.equal(
    safety.validateSensorPayload(Buffer.from('{"temperature":20,"humidity":40,"sampledAt":3000}'), 2000, 10_000, false).code,
    'SENSOR_INVALID'
  )
  assert.equal(
    safety.validateSensorPayload(Buffer.from('{"temperature":20,"humidity":40}'), 2000, 10_000, true).code,
    'SENSOR_STALE'
  )
})

test('automatic control is inhibited until a first valid sensor sample arrives', () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  assert.equal(safety.hasFreshSensorSample(undefined, 1000, 15_000), false)
  assert.equal(safety.hasFreshSensorSample(1000, 11_000, 15_000), true)
  assert.equal(safety.hasFreshSensorSample(1000, 16_000, 15_000), false)
  assert.equal(safety.hasFreshSensorSample(2000, 1000, 15_000), false)
})

test('watchdog trips only after the last valid sample or startup grace expires', () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  assert.equal(safety.isSensorStale(1000, 500, 10_999, 10_000), false)
  assert.equal(safety.isSensorStale(1000, 500, 11_000, 10_000), true)
  assert.equal(safety.isSensorStale(undefined, 500, 10_499, 10_000), false)
  assert.equal(safety.isSensorStale(undefined, 500, 10_500, 10_000), true)
})

test('a relay command resolves only after the MQTT broker callback succeeds at QoS 1', async () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  const seen = []
  const client = {
    connected: true,
    publish(topic, payload, options, callback) {
      seen.push({ topic, payload, options })
      callback()
    }
  }
  await safety.publishWithBrokerAck(client, 'home/relais/1', 'OFF')
  assert.deepEqual(seen, [{
    topic: 'home/relais/1',
    payload: 'OFF',
    options: { qos: 1, retain: false }
  }])
})

test('relay command rejects on disconnection or MQTT publish error', async () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  await assert.rejects(
    safety.publishWithBrokerAck({ connected: false, publish() {} }, 'home/relais/1', 'OFF'),
    /not connected/
  )
  await assert.rejects(
    safety.publishWithBrokerAck({ connected: true, publish(_topic, _payload, _options, callback) { callback(new Error('PUBACK failed')) } }, 'home/relais/1', 'OFF'),
    /PUBACK failed/
  )
})

test('relay transition plans do not command the Arduino-owned heat element or retired water valve', () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  const switches = [
    { pinIndex: 1, type: 'HEAT', active: false },
    { pinIndex: 2, type: 'HEAT_VALVE', active: false },
    { pinIndex: 3, type: 'HEAT_ELEMENT', active: false },
    { pinIndex: 4, type: 'COOL', active: true },
    { pinIndex: 5, type: 'COOL_ELEMENT', active: true },
    { pinIndex: 6, type: 'WATER_VALVE', active: true }
  ]
  const heat = safety.relayTransitionPlan(switches, 'HEAT')
  assert.deepEqual(heat.turnOn.map(x => x.pinIndex), [1, 2])
  assert.deepEqual(heat.turnOff.map(x => x.pinIndex), [4, 5])
  const water = safety.relayTransitionPlan(switches, 'WATER_VALVE')
  assert.deepEqual(water, { turnOn: [], turnOff: [] })
})

test('fault shutdown continues across publish failures and reports all requested outputs', async () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  const zone = [
    { pinIndex: 1, type: 'HEAT_VALVE', active: true },
    { pinIndex: 2, type: 'HEAT_ELEMENT', active: true },
    { pinIndex: 3, type: 'WATER_VALVE', active: true },
    { pinIndex: 4, type: 'COOL', active: true }
  ]
  const sent = []
  const result = await safety.executeFaultShutdown(zone, async relay => {
    sent.push(relay.pinIndex)
    if (relay.pinIndex === 1) throw new Error('broker unavailable')
  })
  assert.deepEqual(sent, [1, 4])
  assert.deepEqual(result.requestedPinIndexes, [1, 4])
  assert.deepEqual(result.failures, [{ pinIndex: 1, message: 'broker unavailable' }])
})

test('fault shutdown turns off only this zone HVAC relays and never controls deprecated shared/hot-water relays', () => {
  assert.ok(safety, 'sensor-safety helpers should be implemented')
  const heatValve = { pinIndex: 1, type: 'HEAT_VALVE', active: true }
  const sharedElement = { pinIndex: 2, type: 'HEAT_ELEMENT', active: true }
  const coolValve = { pinIndex: 3, type: 'COOL_VALVE', active: true }
  const coolElement = { pinIndex: 4, type: 'COOL_ELEMENT', active: true }
  const waterValve = { pinIndex: 5, type: 'WATER_VALVE', active: true }
  const vent = { pinIndex: 6, type: 'VENT', active: true }

  assert.deepEqual(
    safety.faultShutdownPlan([heatValve, sharedElement, coolValve, coolElement, waterValve, vent]).map(x => x.pinIndex),
    [1, 3, 4, 6]
  )
})
