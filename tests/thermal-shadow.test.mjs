import assert from 'node:assert/strict'
import test from 'node:test'

const moduleUnderTest = await import('../src/services/thermal-shadow.ts').catch(() => null)

function response(transition, outdoorTempC, deltaHeatIndexC, index) {
  return {
    transition,
    transitionAtMs: index * 60_000,
    initialHeatIndexC: 20,
    initialRawTemperatureC: 20.5,
    extremeAtMs: (index + 10) * 60_000,
    extremeHeatIndexC: 20 + deltaHeatIndexC,
    extremeRawAtMs: (index + 10) * 60_000,
    extremeRawTemperatureC: 20.5 + deltaHeatIndexC,
    deltaHeatIndexC,
    deltaRawTemperatureC: deltaHeatIndexC,
    timeToExtremeMinutes: 10,
    responseLagMinutes: 10,
    reversalConfirmed: true,
    censored: false,
    reversalConfirmedAtMs: (index + 15) * 60_000,
    outdoorTempC,
    targetTemperatureC: 20,
    phaseDurationMinutes: 30,
    sampleCount: 20
  }
}

const history = [
  ...[0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((drop, i) => response('HEAT_ON', 10, -drop, i)),
  ...[0.02, 0.04, 0.06, 0.08, 0.1, 0.12].map((rise, i) => response('HEAT_OFF', 10, rise, 100 + i))
]

const input = overrides => ({
  instanceName: 'living room',
  nowMs: Date.UTC(2026, 0, 1),
  lifecycle: 'running',
  currentRawTemperatureC: 19.9,
  currentHeatIndexC: 19.85,
  relativeHumidityPct: 45,
  targetHeatIndexC: 20,
  outdoorTempC: 10,
  targetMode: 'HEAT',
  currentState: 'OFF',
  sensorFresh: true,
  sampleAgeMs: 5000,
  baselineHeatingMinC: 19.725,
  baselineHeatingMaxC: 20.4125,
  phaseResponses: history,
  currentPhase: { state: 'OFF', elapsedMinutes: 12, heatIndexDeltaC: 0.1 },
  errorStatus: null,
  ...overrides
})

test('builds a shadow transcript with p90 offsets, baseline comparison, and explicit no-actuation status', () => {
  assert.ok(moduleUnderTest, 'thermal shadow helper should exist')
  const transcript = moduleUnderTest.buildShadowTranscript(input())

  assert.equal(transcript.profile.ready, true)
  assert.equal(transcript.profile.heatOn.cases, 6)
  assert.equal(transcript.profile.heatOn.p90PostSwitchDropC, 0.3)
  assert.equal(transcript.profile.heatOff.p90PostSwitchRiseC, 0.12)
  assert.equal(transcript.thresholds.baseline.heatingMinC, 19.725)
  assert.equal(transcript.thresholds.shadow.heatingMinC, 20)
  assert.equal(transcript.baselineAction, 'SHADOW_HOLD')
  assert.equal(transcript.shadowAction, 'SHADOW_WOULD_START_HEAT')
  assert.equal(transcript.actuation, 'none')
  assert.match(transcript.transcript.join('\n'), /p90/)
})

test('uses baseline and explains unknown-weather or insufficient-history fallback', () => {
  assert.ok(moduleUnderTest, 'thermal shadow helper should exist')
  const transcript = moduleUnderTest.buildShadowTranscript(input({ outdoorTempC: 0 }))
  assert.equal(transcript.profile.ready, false)
  assert.equal(transcript.thresholds.shadow.heatingMinC, transcript.thresholds.baseline.heatingMinC)
  assert.equal(transcript.shadowAction, 'BASELINE_ONLY')
  assert.match(transcript.reason, /unknown|insufficient/i)
})

test('publishes to a retained status topic at QoS 1', async () => {
  assert.ok(moduleUnderTest, 'thermal shadow helper should exist')
  assert.equal(
    moduleUnderTest.mqttShadowStatusTopic('home', 'living room'),
    'home/thermostat/living%20room/preheat-shadow/status'
  )
  let captured
  const client = {
    publish(topic, payload, options, callback) {
      captured = { topic, payload, options }
      callback(null)
    }
  }
  await moduleUnderTest.publishRetainedShadowStatus(client, 'home/status', '{"actuation":"none"}')
  assert.deepEqual(captured, {
    topic: 'home/status',
    payload: '{"actuation":"none"}',
    options: { qos: 1, retain: true }
  })
})
