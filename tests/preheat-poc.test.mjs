import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { syntheticPreheatSamples } from './fixtures/preheat-synthetic.mjs'

const preheatModule = await import('../src/services/preheat-poc.ts').catch(() => null)

test('cold-weather sample predicts heat before the existing lower trigger', () => {
  assert.ok(preheatModule, 'preheat POC module should exist')
  const result = preheatModule.estimatePreheat({
    history: syntheticPreheatSamples,
    current: { heatIndexC: 19.8, outdoorTempC: -5, heatingOn: false },
    targetHeatIndexC: 20,
    baselineHeatingMinC: 19.725
  })

  assert.equal(result.ready, true)
  assert.ok(Math.abs(result.coolingRateCPerHour - 0.3) < 0.01)
  assert.ok(Math.abs(result.heatUpRateCPerHour - 0.45) < 0.01)
  assert.ok(result.preheatTriggerC > result.baselineTriggerC)
  assert.equal(result.baselineWouldRequestHeat, false)
  assert.equal(result.shouldRequestHeat, true)
})

test('predictor falls back to the baseline when there is not enough history', () => {
  assert.ok(preheatModule, 'preheat POC module should exist')
  const result = preheatModule.estimatePreheat({
    history: syntheticPreheatSamples.slice(0, 2),
    current: { heatIndexC: 19.7, outdoorTempC: -5, heatingOn: false },
    targetHeatIndexC: 20,
    baselineHeatingMinC: 19.725
  })

  assert.equal(result.ready, false)
  assert.equal(result.preheatTriggerC, result.baselineTriggerC)
  assert.equal(result.shouldRequestHeat, true)
})

test('CSV adapter tolerates stray NUL bytes without dropping valid samples', async () => {
  assert.ok(preheatModule, 'preheat POC module should exist')
  const csv = await readFile(new URL('../tests/fixtures/preheat-synthetic.csv', import.meta.url), 'utf8')
  const dirtyCsv = csv.replace('19.4', `19.4${String.fromCharCode(0)}`)
  assert.equal(preheatModule.parseThermostatCsv(dirtyCsv).length, 3)
})

test('CSV adapter uses heat-index and heating-state columns, not raw temperature', async () => {
  assert.ok(preheatModule, 'preheat POC module should exist')
  const csv = await readFile(new URL('../tests/fixtures/preheat-synthetic.csv', import.meta.url), 'utf8')
  const samples = preheatModule.parseThermostatCsv(csv)

  assert.equal(samples.length, 3)
  assert.equal(samples[0].heatIndexC, 19.4)
  assert.equal(samples[0].rawTemperatureC, 18)
  assert.equal(samples[0].heatingOn, false)
  assert.equal(samples[1].heatingOn, true)
})
