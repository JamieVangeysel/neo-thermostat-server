import assert from 'node:assert/strict'
import test from 'node:test'

const topicsModule = await import('../src/services/mqtt-topic-compat.ts').catch(() => null)

test('keeps the legacy sensor topic and adds configured site-layout subscriptions', () => {
  assert.ok(topicsModule, 'MQTT topic compatibility helper should exist')
  const instance = {
    temperatureSensor: '68bc45c0f8dd63bd13a54c511242b2eead672bcbb3358c2e747a95b189bff31e1450908a61ed6ea3f33efb69c2b510f7',
    mqttTopics: { temperature: ['site/home/master-bedroom/climate/temperature'] }
  }
  assert.deepEqual(topicsModule.resolveTemperatureTopics(instance), [
    '3B2702/sensor',
    'site/home/master-bedroom/climate/temperature'
  ])
})

test('does not synthesize thermostat status topics; publishes exactly configured paths', () => {
  assert.ok(topicsModule, 'MQTT topic compatibility helper should exist')
  assert.deepEqual(topicsModule.resolveThermostatStatusTopics({
    name: 'default',
    mqttTopics: { thermostatStatus: ['site/home/living-space/climate/thermostat'] }
  }), ['site/home/living-space/climate/thermostat'])
  assert.deepEqual(topicsModule.resolveThermostatStatusTopics({ name: 'apt' }), [])
})

test('deduplicates configured legacy/site sensor paths', () => {
  assert.ok(topicsModule, 'MQTT topic compatibility helper should exist')
  assert.deepEqual(topicsModule.resolveTemperatureTopics({
    temperatureSensor: 'other-id',
    mqttTopics: { temperature: ['03D3CE/sensor', 'site/apt/living-room/climate/temperature'] }
  }), ['03D3CE/sensor', 'site/apt/living-room/climate/temperature'])
})
