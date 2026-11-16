import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { ThermalTransitionKind, ThermalTransitionOptions, ThermalTransitionResponse, ThermalTransitionSample } from './thermal-response-poc'

export const MAX_STORED_THERMAL_RESPONSES = 10_000

interface NormalizedOptions {
  binMs: number
  reversalThresholdC: number
  confirmationBins: number
  maxGapMs: number
}

interface BinValues {
  timestamps: number[]
  heatIndex: number[]
  rawTemperature: number[]
  outdoorTemperature: number[]
  targetTemperature: number[]
}

interface TemperatureBin {
  timestampMs: number
  heatIndexC: number
  rawTemperatureC: number | null
  outdoorTempC: number
  targetTemperatureC: number
}

interface PhaseState {
  transition?: ThermalTransitionKind
  start: ThermalTransitionSample
  last: ThermalTransitionSample
  sampleCount: number
  minHeatIndexC: number
  maxHeatIndexC: number
  minRawTemperatureC: number | null
  maxRawTemperatureC: number | null
  outdoorContext: number[]
  binIndex: number
  bin: BinValues
  binCount: number
  extreme?: TemperatureBin
  extremeIndex: number
  rawExtreme?: TemperatureBin
  reversalCount: number
  reversalConfirmedAtMs: number | null
}

/** Keeps a single active phase/bin and emits compact results as phases finish. */
export class ThermalResponseAccumulator {
  private readonly options: NormalizedOptions
  private phase?: PhaseState
  private lastAcceptedTimestampMs?: number
  private completedCount = 0

  constructor(options: ThermalTransitionOptions = {}) {
    this.options = {
      binMs: (options.binMinutes ?? 5) * 60_000,
      reversalThresholdC: options.reversalThresholdC ?? 0.1,
      confirmationBins: options.confirmationBins ?? 3,
      maxGapMs: (options.maxSampleGapMinutes ?? 10) * 60_000
    }
  }

  get completedResponseCount(): number {
    return this.completedCount
  }

  /** Returns null for an invalid/duplicate/out-of-order sample, otherwise any newly completed phase. */
  addSample(sample: ThermalTransitionSample): ThermalTransitionResponse[] | null {
    if (!isValidSample(sample) ||
        (this.lastAcceptedTimestampMs !== undefined && sample.timestampMs <= this.lastAcceptedTimestampMs)) return null

    const emitted: ThermalTransitionResponse[] = []
    const current = this.phase
    if (!current) {
      this.phase = createPhase(sample, undefined)
    } else if (sample.timestampMs - current.last.timestampMs > this.options.maxGapMs) {
      const response = this.finishPhase()
      if (response) emitted.push(response)
      this.phase = createPhase(sample, undefined)
    } else if (sample.heatingOn !== current.last.heatingOn) {
      const response = this.finishPhase()
      if (response) emitted.push(response)
      this.phase = createPhase(sample, sample.heatingOn ? 'HEAT_ON' : 'HEAT_OFF')
    } else {
      this.appendToPhase(sample)
    }
    this.lastAcceptedTimestampMs = sample.timestampMs
    return emitted
  }

  resetCurrentPhase(): void {
    this.phase = undefined
    this.lastAcceptedTimestampMs = undefined
  }

  finishCurrentPhase(): ThermalTransitionResponse[] {
    const response = this.finishPhase()
    return response ? [response] : []
  }

  currentPhaseSummary(nowMs: number, currentHeatIndexC?: number, currentRawTemperatureC?: number) {
    const phase = this.phase
    if (!phase) return null
    const heatIndexC = currentHeatIndexC ?? phase.last.heatIndexC
    const rawTemperatureC = currentRawTemperatureC ?? phase.last.rawTemperatureC ?? null
    return {
      state: phase.last.heatingOn ? 'HEAT' : 'OFF',
      startedAtMs: phase.start.timestampMs,
      elapsedMinutes: Math.max(0, (nowMs - phase.start.timestampMs) / 60_000),
      initialHeatIndexC: phase.start.heatIndexC,
      currentHeatIndexC: heatIndexC,
      minimumHeatIndexC: phase.minHeatIndexC,
      maximumHeatIndexC: phase.maxHeatIndexC,
      heatIndexDeltaC: heatIndexC - phase.start.heatIndexC,
      initialRawTemperatureC: phase.start.rawTemperatureC ?? null,
      currentRawTemperatureC: rawTemperatureC,
      rawTemperatureDeltaC: phase.start.rawTemperatureC === undefined || rawTemperatureC === null
        ? null
        : rawTemperatureC - phase.start.rawTemperatureC,
      minimumRawTemperatureC: phase.minRawTemperatureC,
      maximumRawTemperatureC: phase.maxRawTemperatureC
    }
  }

  private appendToPhase(sample: ThermalTransitionSample): void {
    const phase = this.phase as PhaseState
    phase.last = sample
    phase.sampleCount++
    phase.minHeatIndexC = Math.min(phase.minHeatIndexC, sample.heatIndexC)
    phase.maxHeatIndexC = Math.max(phase.maxHeatIndexC, sample.heatIndexC)
    if (sample.rawTemperatureC !== undefined) {
      phase.minRawTemperatureC = phase.minRawTemperatureC === null
        ? sample.rawTemperatureC
        : Math.min(phase.minRawTemperatureC, sample.rawTemperatureC)
      phase.maxRawTemperatureC = phase.maxRawTemperatureC === null
        ? sample.rawTemperatureC
        : Math.max(phase.maxRawTemperatureC, sample.rawTemperatureC)
    }
    if (sample.timestampMs - phase.start.timestampMs <= 30 * 60_000) phase.outdoorContext.push(sample.outdoorTempC)

    const binIndex = Math.floor((sample.timestampMs - phase.start.timestampMs) / this.options.binMs)
    if (binIndex !== phase.binIndex) {
      this.flushBin(phase)
      phase.binIndex = binIndex
      phase.bin = emptyBin()
    }
    addToBin(phase.bin, sample)
  }

  private flushBin(phase: PhaseState): void {
    if (phase.bin.timestamps.length === 0) return
    const values = phase.bin
    const middle = Math.floor(values.timestamps.length / 2)
    const raw = values.rawTemperature.length > 0 ? medianInPlace(values.rawTemperature) : null
    const bin: TemperatureBin = {
      timestampMs: values.timestamps[middle],
      heatIndexC: medianInPlace(values.heatIndex),
      rawTemperatureC: raw,
      outdoorTempC: medianInPlace(values.outdoorTemperature),
      targetTemperatureC: medianInPlace(values.targetTemperature)
    }

    if (!phase.extreme) {
      phase.extreme = bin
      phase.extremeIndex = phase.binCount
    } else {
      const heatOn = phase.transition === 'HEAT_ON'
      const moreExtreme = heatOn
        ? bin.heatIndexC < phase.extreme.heatIndexC
        : bin.heatIndexC > phase.extreme.heatIndexC
      if (moreExtreme) {
        phase.extreme = bin
        phase.extremeIndex = phase.binCount
        phase.reversalCount = 0
        phase.reversalConfirmedAtMs = null
      } else if (phase.binCount > phase.extremeIndex) {
        const reversed = heatOn
          ? bin.heatIndexC >= phase.extreme.heatIndexC + this.options.reversalThresholdC
          : bin.heatIndexC <= phase.extreme.heatIndexC - this.options.reversalThresholdC
        phase.reversalCount = reversed ? phase.reversalCount + 1 : 0
        if (phase.reversalCount >= this.options.confirmationBins && phase.reversalConfirmedAtMs === null) {
          phase.reversalConfirmedAtMs = bin.timestampMs
        }
      }
    }

    if (bin.rawTemperatureC !== null) {
      if (!phase.rawExtreme) phase.rawExtreme = bin
      else {
        const rawMoreExtreme = phase.transition === 'HEAT_ON'
          ? bin.rawTemperatureC < (phase.rawExtreme.rawTemperatureC as number)
          : bin.rawTemperatureC > (phase.rawExtreme.rawTemperatureC as number)
        if (rawMoreExtreme) phase.rawExtreme = bin
      }
    }
    phase.binCount++
  }

  private finishPhase(): ThermalTransitionResponse | undefined {
    const phase = this.phase
    if (!phase) return undefined
    this.flushBin(phase)
    this.phase = undefined
    if (!phase.transition || phase.binCount < 2 || !phase.extreme) return undefined

    const extreme = phase.extreme
    const rawExtreme = phase.rawExtreme
    const reversalConfirmed = phase.reversalConfirmedAtMs !== null
    this.completedCount++
    return {
      transition: phase.transition,
      transitionAtMs: phase.start.timestampMs,
      initialHeatIndexC: phase.start.heatIndexC,
      initialRawTemperatureC: phase.start.rawTemperatureC ?? null,
      extremeAtMs: extreme.timestampMs,
      extremeHeatIndexC: extreme.heatIndexC,
      extremeRawAtMs: rawExtreme?.timestampMs ?? null,
      extremeRawTemperatureC: rawExtreme?.rawTemperatureC ?? null,
      deltaHeatIndexC: extreme.heatIndexC - phase.start.heatIndexC,
      deltaRawTemperatureC: rawExtreme && phase.start.rawTemperatureC !== undefined && rawExtreme.rawTemperatureC !== null
        ? rawExtreme.rawTemperatureC - phase.start.rawTemperatureC
        : null,
      timeToExtremeMinutes: (extreme.timestampMs - phase.start.timestampMs) / 60_000,
      responseLagMinutes: reversalConfirmed
        ? (extreme.timestampMs - phase.start.timestampMs) / 60_000
        : null,
      reversalConfirmed,
      censored: !reversalConfirmed,
      reversalConfirmedAtMs: phase.reversalConfirmedAtMs,
      outdoorTempC: median(phase.outdoorContext),
      targetTemperatureC: phase.start.targetTemperatureC,
      phaseDurationMinutes: (phase.last.timestampMs - phase.start.timestampMs) / 60_000,
      sampleCount: phase.sampleCount
    }
  }
}

export interface StreamingThermalProfileOptions {
  cutoffMs?: number
  options?: ThermalTransitionOptions
  maxStoredResponses?: number
}

export interface StreamingThermalProfile {
  responses: ThermalTransitionResponse[]
  totalResponseCount: number
  sampleCount: number
  historyStartAtMs: number | null
  historyEndAtMs: number | null
  accumulator: ThermalResponseAccumulator
}

export async function analyzeThermostatCsvLines(
  lines: AsyncIterable<string>,
  profileOptions: StreamingThermalProfileOptions = {}
): Promise<StreamingThermalProfile> {
  const cutoffMs = profileOptions.cutoffMs ?? Number.NEGATIVE_INFINITY
  const accumulator = new ThermalResponseAccumulator(profileOptions.options)
  const maxStoredResponses = Math.max(0, Math.floor(profileOptions.maxStoredResponses ?? MAX_STORED_THERMAL_RESPONSES))
  const responseRing: ThermalTransitionResponse[] = []
  let responseRingIndex = 0
  let columns: CsvColumns | null = null
  let sampleCount = 0
  let historyStartAtMs: number | null = null
  let historyEndAtMs: number | null = null

  for await (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim()
    if (line === '') continue
    if (!columns) {
      columns = parseColumns(line)
      continue
    }
    const sample = parseLine(line, columns, cutoffMs)
    if (!sample) continue
    sampleCount++
    if (historyStartAtMs === null) historyStartAtMs = sample.timestampMs
    historyEndAtMs = sample.timestampMs
    const completed = accumulator.addSample(sample)
    if (completed === null) continue
    for (const response of completed) {
      if (maxStoredResponses === 0) continue
      if (responseRing.length < maxStoredResponses) responseRing.push(response)
      else {
        responseRing[responseRingIndex] = response
        responseRingIndex = (responseRingIndex + 1) % maxStoredResponses
      }
    }
  }

  if (!columns) throw new Error('CSV is empty or missing the header row')
  const responses = responseRing.length < maxStoredResponses || responseRingIndex === 0
    ? responseRing
    : [...responseRing.slice(responseRingIndex), ...responseRing.slice(0, responseRingIndex)]
  return {
    responses,
    totalResponseCount: accumulator.completedResponseCount,
    sampleCount,
    historyStartAtMs,
    historyEndAtMs,
    accumulator
  }
}

export async function analyzeThermostatCsvFile(
  path: string,
  profileOptions: StreamingThermalProfileOptions = {}
): Promise<StreamingThermalProfile> {
  const input = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    return await analyzeThermostatCsvLines(lines, profileOptions)
  } finally {
    lines.close()
    input.destroy()
  }
}

interface CsvColumns {
  date: number
  state: number
  targetState: number
  rawTemperature: number
  target: number
  outdoor: number
  heatIndex: number
}

function parseColumns(line: string): CsvColumns {
  const headers = line.split(',').map(header => header.trim().toLowerCase())
  const columns: CsvColumns = {
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
  return columns
}

function parseLine(line: string, columns: CsvColumns, cutoffMs: number): ThermalTransitionSample | undefined {
  const cells = line.split(',')
  if (cells.length <= Math.max(...Object.values(columns))) return undefined
  const timestampMs = Date.parse(cells[columns.date].trim().replace(' ', 'T'))
  if (!Number.isFinite(timestampMs) || timestampMs < cutoffMs) return undefined
  const state = parseFiniteNumber(cells[columns.state])
  const targetState = parseFiniteNumber(cells[columns.targetState])
  if ((state !== 0 && state !== 1) || targetState !== 1) return undefined
  const rawTemperatureC = parseFiniteNumber(cells[columns.rawTemperature])
  const targetTemperatureC = parseFiniteNumber(cells[columns.target])
  const outdoorTempC = parseFiniteNumber(cells[columns.outdoor])
  const heatIndexC = parseFiniteNumber(cells[columns.heatIndex])
  if (![rawTemperatureC, targetTemperatureC, outdoorTempC, heatIndexC].every(Number.isFinite)) return undefined
  return {
    timestampMs,
    heatIndexC,
    rawTemperatureC,
    outdoorTempC,
    targetTemperatureC,
    heatingOn: state === 1
  }
}

function parseFiniteNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}

function createPhase(sample: ThermalTransitionSample, transition?: ThermalTransitionKind): PhaseState {
  const raw = sample.rawTemperatureC ?? null
  const phase: PhaseState = {
    transition,
    start: sample,
    last: sample,
    sampleCount: 1,
    minHeatIndexC: sample.heatIndexC,
    maxHeatIndexC: sample.heatIndexC,
    minRawTemperatureC: raw,
    maxRawTemperatureC: raw,
    outdoorContext: [sample.outdoorTempC],
    binIndex: 0,
    bin: emptyBin(),
    binCount: 0,
    extremeIndex: 0,
    rawExtreme: undefined,
    reversalCount: 0,
    reversalConfirmedAtMs: null
  }
  addToBin(phase.bin, sample)
  return phase
}

function emptyBin(): BinValues {
  return { timestamps: [], heatIndex: [], rawTemperature: [], outdoorTemperature: [], targetTemperature: [] }
}

function addToBin(bin: BinValues, sample: ThermalTransitionSample): void {
  bin.timestamps.push(sample.timestampMs)
  bin.heatIndex.push(sample.heatIndexC)
  if (sample.rawTemperatureC !== undefined) bin.rawTemperature.push(sample.rawTemperatureC)
  bin.outdoorTemperature.push(sample.outdoorTempC)
  bin.targetTemperature.push(sample.targetTemperatureC)
}

function isValidSample(sample: ThermalTransitionSample): boolean {
  return Number.isFinite(sample.timestampMs) && Number.isFinite(sample.heatIndexC) &&
    Number.isFinite(sample.outdoorTempC) && Number.isFinite(sample.targetTemperatureC) &&
    (sample.rawTemperatureC === undefined || Number.isFinite(sample.rawTemperatureC)) &&
    typeof sample.heatingOn === 'boolean'
}

function medianInPlace(values: number[]): number {
  values.sort((left, right) => left - right)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle]
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
