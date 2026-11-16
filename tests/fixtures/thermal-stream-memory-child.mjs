import { analyzeThermostatCsvLines } from '../../src/services/thermal-response-stream.ts'

const rowCount = 773_071
const start = Date.UTC(2025, 0, 1)
const header = 'date,state,target-state,temperature,target-temperature,outside-temperature,heat-index'
async function* rows() {
  yield header
  for (let index = 0; index < rowCount; index++) {
    const timestamp = new Date(start + index * 60_000).toISOString().replace('T', ' ').slice(0, 19)
    const heatingOn = Math.floor(index / 30) % 2 === 1
    const heatIndex = heatingOn ? 19.4 + ((index % 10) / 100) : 20.2 + ((index % 10) / 100)
    yield `${timestamp},${Number(heatingOn)},1,${heatIndex + 0.5},20,5,${heatIndex}`
  }
}

const profile = await analyzeThermostatCsvLines(rows(), {
  options: { binMinutes: 5, reversalThresholdC: 0.1, confirmationBins: 3, maxSampleGapMinutes: 5 },
  maxStoredResponses: 10_000
})
if (profile.sampleCount !== rowCount || profile.responses.length > 10_000 || profile.totalResponseCount <= 10_000) {
  throw new Error(`Unexpected bounded-stream counts: ${JSON.stringify({ sampleCount: profile.sampleCount, stored: profile.responses.length, total: profile.totalResponseCount })}`)
}
console.log(JSON.stringify({ sampleCount: profile.sampleCount, storedResponses: profile.responses.length, totalResponses: profile.totalResponseCount, heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1) }))
