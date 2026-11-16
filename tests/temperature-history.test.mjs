import assert from 'node:assert/strict'
import test from 'node:test'

const historyModule = await import('../src/services/temperature-history.ts').catch(() => null)

test('throttles persisted snapshots independently of the sensor sample rate', () => {
  assert.ok(historyModule, 'bounded temperature history helper should exist')
  const interval = 15 * 60_000
  assert.equal(historyModule.isTemperatureHistoryPersistDue(0, interval), true)
  assert.equal(historyModule.isTemperatureHistoryPersistDue(interval, interval + interval - 1), false)
  assert.equal(historyModule.isTemperatureHistoryPersistDue(interval, interval * 2), true)
  assert.equal(historyModule.isTemperatureHistoryPersistDue(0, interval * 3, true), false)
})

test('keeps only the recent four-hour temperature window', () => {
  assert.ok(historyModule, 'bounded temperature history helper should exist')
  const history = []
  const now = Date.UTC(2026, 0, 1, 12)
  assert.equal(historyModule.appendBoundedTemperatureSample(history, new Date(now - 5 * 60 * 60_000), 18, now), false)
  historyModule.appendBoundedTemperatureSample(history, new Date(now - 3 * 60 * 60_000), 19, now)
  historyModule.appendBoundedTemperatureSample(history, new Date(now - 60_000), 20, now)
  assert.deepEqual(history.map(sample => sample.temperature), [19, 20])
})

test('ignores duplicate or out-of-order timestamps and enforces a hard entry cap', () => {
  assert.ok(historyModule, 'bounded temperature history helper should exist')
  const history = []
  const start = Date.UTC(2026, 0, 1)
  assert.equal(historyModule.appendBoundedTemperatureSample(history, new Date(start), 20, start), true)
  assert.equal(historyModule.appendBoundedTemperatureSample(history, new Date(start), 21, start), false)
  assert.equal(historyModule.appendBoundedTemperatureSample(history, new Date(start - 1), 19, start), false)

  for (let index = 1; index <= historyModule.MAX_TEMPERATURE_HISTORY_SAMPLES + 2; index++) {
    historyModule.appendBoundedTemperatureSample(history, new Date(start + index), 20 + index / 100, start + index)
  }
  assert.equal(history.length, historyModule.MAX_TEMPERATURE_HISTORY_SAMPLES)
  assert.equal(history.at(-1).date.getTime(), start + historyModule.MAX_TEMPERATURE_HISTORY_SAMPLES + 2)
})
