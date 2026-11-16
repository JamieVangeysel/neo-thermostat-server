import assert from 'node:assert/strict'
import test from 'node:test'

const batch = await import('../src/services/thermal-response-poc.ts').catch(() => null)
const csvParser = await import('../src/services/preheat-poc.ts').catch(() => null)
const stream = await import('../src/services/thermal-response-stream.ts').catch(() => null)

const start = Date.UTC(2026, 0, 1, 0, 0, 0)
const points = [
  [0, 20.0, false], [5, 19.8, true], [10, 19.6, true], [15, 19.4, true], [20, 19.3, true],
  [25, 19.35, true], [30, 19.45, true], [35, 19.6, true], [40, 19.7, true], [45, 19.8, true],
  [50, 19.9, true], [55, 20.0, true], [60, 20.1, false], [65, 20.2, false], [70, 20.3, false],
  [75, 20.4, false], [80, 20.35, false], [85, 20.25, false], [90, 20.2, false], [95, 20.1, false]
]
const samples = points.map(([minute, heatIndexC, heatingOn]) => ({
  timestampMs: start + minute * 60_000,
  heatIndexC,
  rawTemperatureC: heatIndexC + 0.5,
  outdoorTempC: -2,
  targetTemperatureC: 20,
  heatingOn
}))

async function* asAsync(lines) {
  for (const line of lines) yield line
}

function csvRow(sample, targetState = 1) {
  const date = new Date(sample.timestampMs).toISOString().replace('T', ' ').slice(0, 19)
  return [date, Number(sample.heatingOn), targetState, sample.rawTemperatureC, sample.targetTemperatureC, sample.outdoorTempC, sample.heatIndexC].join(',')
}

test('streaming phase accumulator matches batch analysis without retaining the full sample array', () => {
  assert.ok(stream, 'streaming thermal response analyzer should exist')
  assert.ok(batch, 'batch analyzer remains available for offline comparison')
  const accumulator = new stream.ThermalResponseAccumulator({
    binMinutes: 5,
    reversalThresholdC: 0.1,
    confirmationBins: 3,
    maxSampleGapMinutes: 5
  })
  const results = []
  for (const sample of samples) results.push(...accumulator.addSample(sample))
  assert.equal(accumulator.currentPhaseSummary(start + 100 * 60_000).state, 'OFF')
  results.push(...accumulator.finishCurrentPhase())
  assert.deepEqual(results, batch.analyzeThermalTransitions(samples, {
    binMinutes: 5,
    reversalThresholdC: 0.1,
    confirmationBins: 3,
    maxSampleGapMinutes: 5
  }))
})

test('matches batch phase boundaries across duplicate timestamps and data gaps', () => {
  assert.ok(stream, 'streaming thermal response analyzer should exist')
  assert.ok(batch, 'batch analyzer remains available for offline comparison')
  const minutesAndStates = [
    [0, false, 20], [5, true, 19.8], [10, true, 19.6], [15, true, 19.4], [20, true, 19.3],
    [25, true, 19.4], [30, true, 19.5], [35, true, 19.7], [40, true, 19.8], [45, true, 20],
    [50, false, 20.1], [55, false, 20.3], [60, false, 20.4], [65, false, 20.2], [70, false, 20.1],
    [85, true, 20], [90, true, 19.8], [95, true, 19.6], [100, true, 19.4], [105, true, 19.3],
    [110, true, 19.4], [115, true, 19.5], [120, true, 19.7], [125, true, 19.8], [130, false, 20]
  ]
  const fixture = minutesAndStates.map(([minute, heatingOn, heatIndexC]) => ({
    timestampMs: start + minute * 60_000,
    heatIndexC,
    rawTemperatureC: heatIndexC + 0.4,
    outdoorTempC: 3,
    targetTemperatureC: 20,
    heatingOn
  }))
  fixture.splice(4, 0, { ...fixture[3] })
  const options = { binMinutes: 5, reversalThresholdC: 0.1, confirmationBins: 3, maxSampleGapMinutes: 5 }
  const accumulator = new stream.ThermalResponseAccumulator(options)
  const actual = []
  for (const sample of fixture) {
    const completed = accumulator.addSample(sample)
    if (completed) actual.push(...completed)
  }
  actual.push(...accumulator.finishCurrentPhase())
  assert.deepEqual(actual, batch.analyzeThermalTransitions(fixture, options))
})

test('streams CSV rows, filters out-of-window rows before profiling, and tolerates NUL bytes', async () => {
  assert.ok(stream, 'streaming thermal response analyzer should exist')
  const oldSample = { ...samples[0], timestampMs: start - 60_000 }
  const lines = [
    '\uFEFFdate,state,target-state,temperature,target-temperature,outside-temperature,heat-index',
    csvRow(oldSample),
    ...samples.map(sample => `${csvRow(sample)}\u0000`),
    csvRow(samples[5], 0)
  ]
  const cutoffMs = Date.parse(csvRow(samples[0]).split(',')[0].replace(' ', 'T'))
  const expectedSamples = csvParser.parseThermostatCsv(lines.join('\n')).filter(sample => sample.timestampMs >= cutoffMs)
  const report = await stream.analyzeThermostatCsvLines(asAsync(lines), {
    cutoffMs,
    options: { binMinutes: 5, reversalThresholdC: 0.1, confirmationBins: 3, maxSampleGapMinutes: 5 }
  })
  assert.equal(report.sampleCount, expectedSamples.length)
  assert.equal(report.historyStartAtMs, expectedSamples[0].timestampMs)
  assert.equal(report.historyEndAtMs, expectedSamples.at(-1).timestampMs)
  assert.deepEqual(report.responses, batch.analyzeThermalTransitions(expectedSamples, {
    binMinutes: 5,
    reversalThresholdC: 0.1,
    confirmationBins: 3,
    maxSampleGapMinutes: 5
  }).slice(0, -1))
})

test('resets current phase without discarding the completed historical profile', () => {
  assert.ok(stream, 'streaming thermal response analyzer should exist')
  const accumulator = new stream.ThermalResponseAccumulator({ binMinutes: 5, confirmationBins: 3 })
  for (const sample of samples) accumulator.addSample(sample)
  const before = accumulator.completedResponseCount
  accumulator.resetCurrentPhase()
  assert.equal(accumulator.currentPhaseSummary(start + 100 * 60_000), null)
  assert.equal(accumulator.completedResponseCount, before)
})
