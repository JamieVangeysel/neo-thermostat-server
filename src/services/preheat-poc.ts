export interface PreheatSample {
  timestampMs: number
  /** Use the thermostat's apparent-temperature control value, not raw air temperature. */
  heatIndexC: number
  rawTemperatureC?: number
  outdoorTempC: number
  /** This is the thermostat's logged HEAT request/state, not independent pump feedback. */
  heatingOn: boolean
  targetTemperatureC?: number
}

export interface PreheatInput {
  history: PreheatSample[]
  current: Pick<PreheatSample, 'heatIndexC' | 'outdoorTempC' | 'heatingOn'>
  targetHeatIndexC: number
  baselineHeatingMinC: number
  minSegmentMinutes?: number
  maxSampleGapMinutes?: number
  outdoorMatchRangeC?: number
  maxAdvanceC?: number
  maxLeadMinutes?: number
}

export interface PreheatEstimate {
  ready: boolean
  reason?: string
  coolingRateCPerHour: number
  heatUpRateCPerHour: number
  heatingLeadMinutes: number
  baselineTriggerC: number
  preheatTriggerC: number
  advanceC: number
  projectedHeatIndexAtLeadC: number
  baselineWouldRequestHeat: boolean
  shouldRequestHeat: boolean
  matchedCoolingSegments: number
  matchedHeatingSegments: number
}

interface Segment {
  heatingOn: boolean
  meanOutdoorTempC: number
  heatIndexSlopeCPerHour: number
}

const DEFAULT_MIN_SEGMENT_MINUTES = 30
const DEFAULT_MAX_SAMPLE_GAP_MINUTES = 60
const DEFAULT_OUTDOOR_MATCH_RANGE_C = 5
const DEFAULT_MAX_ADVANCE_C = 0.6
const DEFAULT_MAX_LEAD_MINUTES = 120

/** Mirrors the existing thermostat's fixed lower heating threshold for the POC. */
export function existingHeatingMinC(targetHeatIndexC: number): number {
  const maxTemperatureCycleDelta = 1.1
  const correctionTemp = maxTemperatureCycleDelta / 4
  return targetHeatIndexC - (maxTemperatureCycleDelta / 2) + correctionTemp
}

/**
 * Estimate room heat loss and recovery from historical OFF/HEAT periods.
 * This is a read-only POC: it returns a suggestion and never commands a relay.
 */
export function estimatePreheat(input: PreheatInput): PreheatEstimate {
  const {
    history,
    current,
    targetHeatIndexC,
    baselineHeatingMinC
  } = input
  const baselineWouldRequestHeat = !current.heatingOn && current.heatIndexC <= baselineHeatingMinC
  const fallback = (reason: string): PreheatEstimate => ({
    ready: false,
    reason,
    coolingRateCPerHour: 0,
    heatUpRateCPerHour: 0,
    heatingLeadMinutes: 0,
    baselineTriggerC: baselineHeatingMinC,
    preheatTriggerC: baselineHeatingMinC,
    advanceC: 0,
    projectedHeatIndexAtLeadC: current.heatIndexC,
    baselineWouldRequestHeat,
    shouldRequestHeat: baselineWouldRequestHeat,
    matchedCoolingSegments: 0,
    matchedHeatingSegments: 0
  })

  if (!Number.isFinite(current.heatIndexC) || !Number.isFinite(current.outdoorTempC) ||
      !Number.isFinite(targetHeatIndexC) || !Number.isFinite(baselineHeatingMinC) ||
      baselineHeatingMinC > targetHeatIndexC) {
    return fallback('Invalid current or target temperature values')
  }

  const minSegmentMs = (input.minSegmentMinutes ?? DEFAULT_MIN_SEGMENT_MINUTES) * 60_000
  const maxGapMs = (input.maxSampleGapMinutes ?? DEFAULT_MAX_SAMPLE_GAP_MINUTES) * 60_000
  const matchRange = input.outdoorMatchRangeC ?? DEFAULT_OUTDOOR_MATCH_RANGE_C
  const segments = buildSegments(history, minSegmentMs, maxGapMs)
    .filter(segment => Math.abs(segment.meanOutdoorTempC - current.outdoorTempC) <= matchRange)
  const coolingSegments = segments.filter(segment => !segment.heatingOn && segment.heatIndexSlopeCPerHour < 0)
  const heatingSegments = segments.filter(segment => segment.heatingOn && segment.heatIndexSlopeCPerHour > 0)

  if (coolingSegments.length === 0 || heatingSegments.length === 0) {
    return fallback('Need valid heat-off cooling and heat-on recovery periods at similar outdoor temperatures')
  }

  const coolingRate = median(coolingSegments.map(segment => -segment.heatIndexSlopeCPerHour))
  const heatUpRate = median(heatingSegments.map(segment => segment.heatIndexSlopeCPerHour))
  if (!(coolingRate > 0) || !(heatUpRate > 0)) {
    return fallback('Observed cooling or recovery rate is not usable')
  }

  const requiredRecoveryC = Math.max(0, targetHeatIndexC - baselineHeatingMinC)
  const maxLeadMinutes = input.maxLeadMinutes ?? DEFAULT_MAX_LEAD_MINUTES
  const leadMinutes = Math.min(maxLeadMinutes, (requiredRecoveryC / heatUpRate) * 60)
  const maxAdvanceC = input.maxAdvanceC ?? DEFAULT_MAX_ADVANCE_C
  const advanceC = Math.min(maxAdvanceC, coolingRate * (leadMinutes / 60))
  const preheatTriggerC = Math.min(targetHeatIndexC, baselineHeatingMinC + advanceC)
  const projectedHeatIndexAtLeadC = current.heatIndexC - coolingRate * (leadMinutes / 60)

  return {
    ready: true,
    coolingRateCPerHour: coolingRate,
    heatUpRateCPerHour: heatUpRate,
    heatingLeadMinutes: leadMinutes,
    baselineTriggerC: baselineHeatingMinC,
    preheatTriggerC,
    advanceC: preheatTriggerC - baselineHeatingMinC,
    projectedHeatIndexAtLeadC,
    baselineWouldRequestHeat,
    shouldRequestHeat: !current.heatingOn && current.heatIndexC <= preheatTriggerC,
    matchedCoolingSegments: coolingSegments.length,
    matchedHeatingSegments: heatingSegments.length
  }
}

/** Parse the current thermostat CSV schema; ignores COOL/AUTO and malformed rows. */
export function parseThermostatCsv(csv: string): PreheatSample[] {
  const lines = csv.replace(/^\uFEFF/, '').replace(/\u0000/g, '').split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(header => header.trim().toLowerCase())
  const columns = {
    date: headers.indexOf('date'),
    state: headers.indexOf('state'),
    targetState: headers.indexOf('target-state'),
    rawTemperature: headers.indexOf('temperature'),
    target: headers.indexOf('target-temperature'),
    outdoor: headers.indexOf('outside-temperature'),
    heatIndex: headers.indexOf('heat-index')
  }
  if (Object.values(columns).some(index => index < 0)) {
    throw new Error('CSV must contain date,state,target-state,temperature,target-temperature,outside-temperature,heat-index columns')
  }

  const samples: PreheatSample[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(cell => cell.trim())
    if (cells.length < headers.length) continue
    const dateText = cells[columns.date].replace(' ', 'T')
    const timestampMs = Date.parse(dateText)
    const state = cells[columns.state].trim() === '' ? Number.NaN : Number(cells[columns.state])
    const targetState = cells[columns.targetState].trim() === '' ? Number.NaN : Number(cells[columns.targetState])
    const rawTemperatureC = cells[columns.rawTemperature].trim() === '' ? Number.NaN : Number(cells[columns.rawTemperature])
    const targetTemperatureC = cells[columns.target].trim() === '' ? Number.NaN : Number(cells[columns.target])
    const outdoorTempC = cells[columns.outdoor].trim() === '' ? Number.NaN : Number(cells[columns.outdoor])
    const heatIndexC = cells[columns.heatIndex].trim() === '' ? Number.NaN : Number(cells[columns.heatIndex])
    if (!Number.isFinite(timestampMs) || ![0, 1].includes(state) || targetState !== 1 ||
        !Number.isFinite(rawTemperatureC) ||
        !Number.isFinite(targetTemperatureC) || !Number.isFinite(outdoorTempC) || !Number.isFinite(heatIndexC)) continue

    samples.push({
      timestampMs,
      heatIndexC,
      rawTemperatureC,
      outdoorTempC,
      heatingOn: state === 1,
      targetTemperatureC
    })
  }
  return samples.sort((left, right) => left.timestampMs - right.timestampMs)
}

function buildSegments(history: PreheatSample[], minSegmentMs: number, maxGapMs: number): Segment[] {
  const valid = history
    .filter(sample => Number.isFinite(sample.timestampMs) && Number.isFinite(sample.heatIndexC) &&
      Number.isFinite(sample.outdoorTempC) && typeof sample.heatingOn === 'boolean')
    .slice()
    .sort((left, right) => left.timestampMs - right.timestampMs)
  const groups: PreheatSample[][] = []
  for (const sample of valid) {
    const group = groups[groups.length - 1]
    const previous = group?.[group.length - 1]
    if (!group || sample.heatingOn !== previous.heatingOn || sample.timestampMs - previous.timestampMs > maxGapMs) {
      groups.push([sample])
    } else if (sample.timestampMs > previous.timestampMs) {
      group.push(sample)
    }
  }

  const segments: Segment[] = []
  for (const group of groups) {
    if (group.length < 3) continue
    const durationMs = group[group.length - 1].timestampMs - group[0].timestampMs
    if (durationMs < minSegmentMs) continue
    const slope = linearSlopeCPerHour(group)
    if (!Number.isFinite(slope)) continue
    let outdoorTotal = 0
    for (const sample of group) outdoorTotal += sample.outdoorTempC
    segments.push({
      heatingOn: group[0].heatingOn,
      meanOutdoorTempC: outdoorTotal / group.length,
      heatIndexSlopeCPerHour: slope
    })
  }
  return segments
}

function linearSlopeCPerHour(samples: PreheatSample[]): number {
  const origin = samples[0].timestampMs
  const xs = samples.map(sample => (sample.timestampMs - origin) / 3_600_000)
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = samples.reduce((sum, sample) => sum + sample.heatIndexC, 0) / samples.length
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < samples.length; index++) {
    numerator += (xs[index] - meanX) * (samples[index].heatIndexC - meanY)
    denominator += (xs[index] - meanX) ** 2
  }
  return denominator === 0 ? Number.NaN : numerator / denominator
}

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}
