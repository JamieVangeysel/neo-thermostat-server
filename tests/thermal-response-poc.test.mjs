import assert from 'node:assert/strict'
import test from 'node:test'

const moduleUnderTest = await import('../src/services/thermal-response-poc.ts').catch(() => null)

const series = () => {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0)
  const values = [
    [0, 20.0, false],
    [5, 19.8, true],
    [10, 19.6, true],
    [15, 19.4, true],
    [20, 19.3, true],
    [25, 19.35, true],
    [30, 19.45, true],
    [35, 19.6, true],
    [40, 19.7, true],
    [45, 19.8, true],
    [50, 19.9, true],
    [55, 20.0, true],
    [60, 20.1, false],
    [65, 20.2, false],
    [70, 20.3, false],
    [75, 20.4, false],
    [80, 20.35, false],
    [85, 20.25, false],
    [90, 20.2, false],
    [95, 20.1, false]
  ]
  return values.map(([minutes, heatIndexC, heatingOn]) => ({
    timestampMs: start + minutes * 60_000,
    heatIndexC,
    rawTemperatureC: heatIndexC + 0.5,
    outdoorTempC: -2,
    targetTemperatureC: 20,
    heatingOn
  }))
}

test('measures post-ON cooling lag and post-OFF residual warming', () => {
  assert.ok(moduleUnderTest, 'thermal response analyzer should exist')
  const events = moduleUnderTest.analyzeThermalTransitions(series(), {
    binMinutes: 5,
    reversalThresholdC: 0.1,
    confirmationBins: 3
  })
  const on = events.find(event => event.transition === 'HEAT_ON')
  const off = events.find(event => event.transition === 'HEAT_OFF')

  assert.ok(on)
  assert.ok(off)
  assert.equal(on.reversalConfirmed, true)
  assert.equal(on.responseLagMinutes, 15)
  assert.ok(Math.abs(on.deltaHeatIndexC + 0.5) < 0.001)
  assert.ok(Math.abs(on.deltaRawTemperatureC + 0.5) < 0.001)
  assert.equal(off.reversalConfirmed, true)
  assert.equal(off.responseLagMinutes, 15)
  assert.ok(Math.abs(off.deltaHeatIndexC - 0.3) < 0.001)
})

test('reports first-bin extrema as a bin-centered estimate rather than falsely exact zero', () => {
  assert.ok(moduleUnderTest, 'thermal response analyzer should exist')
  const start = Date.UTC(2026, 0, 1, 0, 0, 0)
  const samples = [{ timestampMs: start, heatIndexC: 20, outdoorTempC: -1, targetTemperatureC: 20, heatingOn: false }]
  for (let minute = 5; minute <= 9; minute++) {
    samples.push({ timestampMs: start + minute * 60_000, heatIndexC: 19.8, outdoorTempC: -1, targetTemperatureC: 20, heatingOn: true })
  }
  for (let minute = 10; minute <= 14; minute++) {
    samples.push({ timestampMs: start + minute * 60_000, heatIndexC: 19.9, outdoorTempC: -1, targetTemperatureC: 20, heatingOn: true })
  }
  for (let minute = 15; minute <= 19; minute++) {
    samples.push({ timestampMs: start + minute * 60_000, heatIndexC: 20, outdoorTempC: -1, targetTemperatureC: 20, heatingOn: true })
  }
  for (let minute = 20; minute <= 24; minute++) {
    samples.push({ timestampMs: start + minute * 60_000, heatIndexC: 20.1, outdoorTempC: -1, targetTemperatureC: 20, heatingOn: true })
  }
  const on = moduleUnderTest.analyzeThermalTransitions(samples, { binMinutes: 5, confirmationBins: 3 })
    .find(event => event.transition === 'HEAT_ON')
  assert.ok(on)
  assert.equal(on.timeToExtremeMinutes, 2)
})

test('marks heating that never recovers before OFF as censored, not as a response time', () => {
  assert.ok(moduleUnderTest, 'thermal response analyzer should exist')
  const start = Date.UTC(2026, 0, 1, 0, 0, 0)
  const values = [
    [0, 20, false], [5, 19.8, true], [10, 19.6, true], [15, 19.4, true],
    [20, 19.2, true], [25, 19.0, true], [30, 18.8, true], [35, 18.7, false]
  ]
  const events = moduleUnderTest.analyzeThermalTransitions(values.map(([minutes, heatIndexC, heatingOn]) => ({
    timestampMs: start + minutes * 60_000,
    heatIndexC,
    outdoorTempC: -3,
    targetTemperatureC: 20,
    heatingOn
  })), { binMinutes: 5, confirmationBins: 3 })
  const on = events.find(event => event.transition === 'HEAT_ON')

  assert.ok(on)
  assert.equal(on.reversalConfirmed, false)
  assert.equal(on.responseLagMinutes, null)
  assert.equal(on.censored, true)
})
