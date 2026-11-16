import { readFile } from 'node:fs/promises'
import path from 'node:path'

const { estimatePreheat, existingHeatingMinC, parseThermostatCsv } = await import('../src/services/preheat-poc.ts')
const csvIndex = process.argv.indexOf('--csv')
let history
let label

if (csvIndex >= 0) {
  const csvPath = path.resolve(process.argv[csvIndex + 1] ?? '')
  if (!process.argv[csvIndex + 1]) throw new Error('Usage: npm run preheat:poc -- --csv <data-log.csv>')
  history = parseThermostatCsv(await readFile(csvPath, 'utf8'))
  label = `CSV ${path.basename(csvPath)}`
} else {
  const fixtureUrl = new URL('../tests/fixtures/preheat-synthetic.mjs', import.meta.url)
  const { syntheticPreheatSamples } = await import(fixtureUrl.href)
  history = syntheticPreheatSamples
  label = 'synthetic demo data'
}

if (history.length === 0) throw new Error('No usable OFF/HEAT samples found')
const last = history[history.length - 1]
const numericArg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : Number(process.argv[index + 1])
}
const targetHeatIndexC = numericArg('--target', last.targetTemperatureC ?? 20)
const isSyntheticDemo = csvIndex < 0
const current = {
  heatIndexC: numericArg('--current-hi', isSyntheticDemo ? 19.8 : last.heatIndexC),
  outdoorTempC: numericArg('--outdoor', isSyntheticDemo ? -5 : last.outdoorTempC),
  heatingOn: last.heatingOn
}
const baselineHeatingMinC = existingHeatingMinC(targetHeatIndexC)
const result = estimatePreheat({ history, current, targetHeatIndexC, baselineHeatingMinC })

console.log(`Preheat POC — ${label} (read-only; no relay commands)`)
console.log(`HeatIndex now: ${current.heatIndexC.toFixed(2)} °C; outside: ${current.outdoorTempC.toFixed(1)} °C; heat call: ${current.heatingOn ? 'ON' : 'OFF'}`)
console.log(`Existing threshold: ${result.baselineTriggerC.toFixed(3)} °C HeatIndex`)
if (!result.ready) {
  console.log(`Model not ready: ${result.reason}`)
  console.log('Fallback suggestion:', result.shouldRequestHeat ? 'request heat at baseline' : 'wait for baseline threshold')
} else {
  console.log(`Estimated OFF cooling: ${result.coolingRateCPerHour.toFixed(2)} °C/h; ON recovery: ${result.heatUpRateCPerHour.toFixed(2)} °C/h`)
  console.log(`Estimated recovery lead: ${result.heatingLeadMinutes.toFixed(0)} min; added trigger margin: ${result.advanceC.toFixed(2)} °C`)
  console.log(`Predictive trigger: ${result.preheatTriggerC.toFixed(2)} °C HeatIndex; projected after lead: ${result.projectedHeatIndexAtLeadC.toFixed(2)} °C`)
  console.log(`Baseline says heat now: ${result.baselineWouldRequestHeat}; predictor says heat now: ${result.shouldRequestHeat}`)
  console.log(`Matched OFF/ON periods: ${result.matchedCoolingSegments}/${result.matchedHeatingSegments}`)
}
