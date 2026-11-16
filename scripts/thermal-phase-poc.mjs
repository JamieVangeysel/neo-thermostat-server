import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { analyzeThermalTransitions } from '../src/services/thermal-response-poc.ts'
import { parseThermostatCsv } from '../src/services/preheat-poc.ts'

const csvIndex = process.argv.indexOf('--csv')
const csvPath = csvIndex >= 0 ? process.argv[csvIndex + 1] : undefined
if (!csvPath) throw new Error('Usage: npm run thermal:phase-poc -- --csv <data-log.csv>')

const samples = parseThermostatCsv(await readFile(path.resolve(csvPath), 'utf8'))
const monthOf = sample => new Date(sample.timestampMs).getMonth() + 1
const formatTimestamp = timestampMs => {
  const date = new Date(timestampMs)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
const train = samples.filter(sample => monthOf(sample) === 1)
const test = samples.filter(sample => monthOf(sample) === 2)
const options = { binMinutes: 5, reversalThresholdC: 0.1, confirmationBins: 3, maxSampleGapMinutes: 5 }
const trainingResponses = analyzeThermalTransitions(train, options)
const evaluationResponses = analyzeThermalTransitions(test, options)

function outdoorBand(outdoorC) {
  if (!Number.isFinite(outdoorC) || outdoorC === 0) return 'unknown (0 may be missing-weather sentinel)'
  if (outdoorC < 0) return 'freezing (<0°C)'
  if (outdoorC <= 5) return 'cold (0..5°C)'
  return 'mild (>5°C)'
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function quantile(values, probability) {
  const sorted = values.slice().sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(probability * sorted.length) - 1))
  return sorted[index]
}

function summarize(responses) {
  const groups = new Map()
  for (const response of responses) {
    const key = `${response.transition}|${outdoorBand(response.outdoorTempC)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(response)
  }
  const result = []
  for (const [key, cases] of groups) {
    const confirmed = cases.filter(item => item.reversalConfirmed)
    const censored = cases.filter(item => item.censored)
    const adverseHeatIndexDeltas = confirmed.map(item => item.transition === 'HEAT_ON'
      ? Math.max(0, -item.deltaHeatIndexC)
      : Math.max(0, item.deltaHeatIndexC))
    result.push({
      group: key,
      cases: cases.length,
      confirmedReversals: confirmed.length,
      censoredNoReversal: censored.length,
      medianResponseLagMinutes: median(confirmed.map(item => item.responseLagMinutes)),
      p90ResponseLagMinutes: quantile(confirmed.map(item => item.responseLagMinutes), 0.9),
      maxResponseLagMinutes: confirmed.length > 0
        ? Math.max(...confirmed.map(item => item.responseLagMinutes))
        : null,
      medianConfirmedDeltaHeatIndexC: median(confirmed.map(item => item.deltaHeatIndexC)),
      medianConfirmedDeltaRawTemperatureC: median(confirmed.map(item => item.deltaRawTemperatureC).filter(value => value !== null)),
      p90AdverseHeatIndexDriftC: quantile(adverseHeatIndexDeltas, 0.9),
      maxAdverseHeatIndexDriftC: adverseHeatIndexDeltas.length > 0 ? Math.max(...adverseHeatIndexDeltas) : null,
      medianCensoredPhaseMinutes: median(censored.map(item => item.phaseDurationMinutes)),
      medianCensoredDeltaHeatIndexC: median(censored.map(item => item.deltaHeatIndexC)),
      longestConfirmedCases: confirmed.slice().sort((a, b) => b.timeToExtremeMinutes - a.timeToExtremeMinutes).slice(0, 3).map(item => ({
        transitionAt: formatTimestamp(item.transitionAtMs),
        outdoorTempC: item.outdoorTempC,
        targetC: item.targetTemperatureC,
        initialHeatIndexC: item.initialHeatIndexC,
        initialRawTemperatureC: item.initialRawTemperatureC,
        extremeHeatIndexC: item.extremeHeatIndexC,
        extremeRawTemperatureC: item.extremeRawTemperatureC,
        deltaHeatIndexC: item.deltaHeatIndexC,
        deltaRawTemperatureC: item.deltaRawTemperatureC,
        responseLagMinutes: item.timeToExtremeMinutes,
        phaseDurationMinutes: item.phaseDurationMinutes
      })),
      largestAdverseDrifts: confirmed.slice().sort((a, b) => {
        const impactA = a.transition === 'HEAT_ON' ? -a.deltaHeatIndexC : a.deltaHeatIndexC
        const impactB = b.transition === 'HEAT_ON' ? -b.deltaHeatIndexC : b.deltaHeatIndexC
        return impactB - impactA
      }).slice(0, 3).map(item => ({
        transitionAt: formatTimestamp(item.transitionAtMs),
        outdoorTempC: item.outdoorTempC,
        targetC: item.targetTemperatureC,
        deltaHeatIndexC: item.deltaHeatIndexC,
        responseLagMinutes: item.timeToExtremeMinutes
      })),
      worstCensoredCases: censored.slice().sort((a, b) => {
        const impactA = a.transition === 'HEAT_ON' ? -a.deltaHeatIndexC : a.deltaHeatIndexC
        const impactB = b.transition === 'HEAT_ON' ? -b.deltaHeatIndexC : b.deltaHeatIndexC
        return impactB - impactA
      }).slice(0, 3).map(item => ({
        transitionAt: formatTimestamp(item.transitionAtMs),
        outdoorTempC: item.outdoorTempC,
        targetC: item.targetTemperatureC,
        initialHeatIndexC: item.initialHeatIndexC,
        extremeHeatIndexC: item.extremeHeatIndexC,
        deltaHeatIndexC: item.deltaHeatIndexC,
        observedPhaseMinutes: item.phaseDurationMinutes
      }))
    })
  }
  return result.sort((a, b) => a.group.localeCompare(b.group))
}

const janSummary = summarize(trainingResponses)
const febSummary = summarize(evaluationResponses)
const trainingByKey = new Map(janSummary.map(group => [group.group, group]))
const evaluation = []
for (const group of febSummary) {
  const trained = trainingByKey.get(group.group)
  if (!trained || trained.confirmedReversals < 3 || group.confirmedReversals === 0) continue
  const matching = evaluationResponses.filter(item =>
    `${item.transition}|${outdoorBand(item.outdoorTempC)}` === group.group && item.reversalConfirmed)
  evaluation.push({
    group: group.group,
    trainCases: trained.cases,
    testCases: group.cases,
    trainMedianLagMinutes: trained.medianResponseLagMinutes,
    testMedianLagMinutes: group.medianResponseLagMinutes,
    medianAbsoluteLagErrorMinutes: median(matching.map(item => Math.abs(item.responseLagMinutes - trained.medianResponseLagMinutes))),
    trainMedianDeltaHeatIndexC: trained.medianConfirmedDeltaHeatIndexC,
    testMedianDeltaHeatIndexC: group.medianConfirmedDeltaHeatIndexC,
    medianAbsoluteDeltaErrorC: median(matching.map(item => Math.abs(item.deltaHeatIndexC - trained.medianConfirmedDeltaHeatIndexC)))
  })
}

console.log(JSON.stringify({
  method: 'Deterministic 5-minute median bins; find post-switch extremum and require three consecutive bins reversing by >=0.1°C',
  split: 'Train on January 2026; evaluate on February 2026; no February observations enter training summaries',
  samples: { january: train.length, february: test.length },
  januaryTraining: janSummary,
  februaryEvaluation: febSummary,
  holdoutErrors: evaluation
}, null, 2))
