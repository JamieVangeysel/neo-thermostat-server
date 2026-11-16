export interface ThermalTransitionSample {
  timestampMs: number
  heatIndexC: number
  rawTemperatureC?: number
  outdoorTempC: number
  targetTemperatureC: number
  heatingOn: boolean
}

export type ThermalTransitionKind = 'HEAT_ON' | 'HEAT_OFF'

export interface ThermalTransitionResponse {
  transition: ThermalTransitionKind
  transitionAtMs: number
  initialHeatIndexC: number
  initialRawTemperatureC: number | null
  extremeAtMs: number
  extremeHeatIndexC: number
  extremeRawAtMs: number | null
  extremeRawTemperatureC: number | null
  deltaHeatIndexC: number
  deltaRawTemperatureC: number | null
  timeToExtremeMinutes: number
  /** Null when the expected rebound/decay was not observed before the next state change. */
  responseLagMinutes: number | null
  reversalConfirmed: boolean
  censored: boolean
  reversalConfirmedAtMs: number | null
  outdoorTempC: number
  targetTemperatureC: number
  phaseDurationMinutes: number
  sampleCount: number
}

export interface ThermalTransitionOptions {
  binMinutes?: number
  reversalThresholdC?: number
  confirmationBins?: number
  maxSampleGapMinutes?: number
}

interface Phase {
  samples: ThermalTransitionSample[]
  transition?: ThermalTransitionKind
}

interface TemperatureBin {
  timestampMs: number
  heatIndexC: number
  rawTemperatureC: number | null
  outdoorTempC: number
  targetTemperatureC: number
}

/**
 * Measure room-temperature coast after each heating-state transition.
 * HEAT_ON looks for continued cooling followed by a sustained rebound;
 * HEAT_OFF looks for residual warming followed by sustained cooling.
 * This is a deterministic analysis helper and never controls hardware.
 */
export function analyzeThermalTransitions(
  samples: ThermalTransitionSample[],
  options: ThermalTransitionOptions = {}
): ThermalTransitionResponse[] {
  const binMs = (options.binMinutes ?? 5) * 60_000
  const reversalThresholdC = options.reversalThresholdC ?? 0.1
  const confirmationBins = options.confirmationBins ?? 3
  const maxGapMs = (options.maxSampleGapMinutes ?? 10) * 60_000
  const ordered = samples
    .filter(sample => Number.isFinite(sample.timestampMs) && Number.isFinite(sample.heatIndexC) &&
      Number.isFinite(sample.outdoorTempC) && Number.isFinite(sample.targetTemperatureC) &&
      (sample.rawTemperatureC === undefined || Number.isFinite(sample.rawTemperatureC)) &&
      typeof sample.heatingOn === 'boolean')
    .slice()
    .sort((left, right) => left.timestampMs - right.timestampMs)

  const phases: Phase[] = []
  for (const sample of ordered) {
    const phase = phases[phases.length - 1]
    const previous = phase?.samples[phase.samples.length - 1]
    if (!phase || sample.timestampMs - previous.timestampMs > maxGapMs) {
      phases.push({ samples: [sample] })
    } else if (sample.timestampMs === previous.timestampMs) {
      continue
    } else if (sample.heatingOn !== previous.heatingOn) {
      phases.push({
        samples: [sample],
        transition: sample.heatingOn ? 'HEAT_ON' : 'HEAT_OFF'
      })
    } else {
      phase.samples.push(sample)
    }
  }

  const responses: ThermalTransitionResponse[] = []
  for (const phase of phases) {
    if (!phase.transition || phase.samples.length < 2) continue
    const bins = makeBins(phase.samples, binMs)
    if (bins.length < 2) continue
    const isHeatOn = phase.transition === 'HEAT_ON'
    let extremeIndex = 0
    for (let index = 1; index < bins.length; index++) {
      const moreExtreme = isHeatOn
        ? bins[index].heatIndexC < bins[extremeIndex].heatIndexC
        : bins[index].heatIndexC > bins[extremeIndex].heatIndexC
      if (moreExtreme) extremeIndex = index
    }

    const extreme = bins[extremeIndex]
    let rawExtremeIndex = -1
    for (let index = 0; index < bins.length; index++) {
      if (bins[index].rawTemperatureC === null) continue
      if (rawExtremeIndex < 0) {
        rawExtremeIndex = index
        continue
      }
      const rawMoreExtreme = isHeatOn
        ? (bins[index].rawTemperatureC as number) < (bins[rawExtremeIndex].rawTemperatureC as number)
        : (bins[index].rawTemperatureC as number) > (bins[rawExtremeIndex].rawTemperatureC as number)
      if (rawMoreExtreme) rawExtremeIndex = index
    }
    const rawExtreme = rawExtremeIndex < 0 ? null : bins[rawExtremeIndex]
    const reversalConfirmedAtMs = findSustainedReversal(
      bins,
      extremeIndex,
      isHeatOn ? 1 : -1,
      extreme.heatIndexC,
      reversalThresholdC,
      confirmationBins
    )
    const reversalConfirmed = reversalConfirmedAtMs !== null
    const start = phase.samples[0]
    const phaseEnd = phase.samples[phase.samples.length - 1]
    const contextSamples: ThermalTransitionSample[] = []
    for (const sample of phase.samples) {
      if (sample.timestampMs - start.timestampMs > 30 * 60_000) break
      contextSamples.push(sample)
    }

    responses.push({
      transition: phase.transition,
      transitionAtMs: start.timestampMs,
      initialHeatIndexC: start.heatIndexC,
      initialRawTemperatureC: start.rawTemperatureC ?? null,
      extremeAtMs: extreme.timestampMs,
      extremeHeatIndexC: extreme.heatIndexC,
      extremeRawAtMs: rawExtreme?.timestampMs ?? null,
      extremeRawTemperatureC: rawExtreme?.rawTemperatureC ?? null,
      deltaHeatIndexC: extreme.heatIndexC - start.heatIndexC,
      deltaRawTemperatureC: rawExtreme && start.rawTemperatureC !== undefined && rawExtreme.rawTemperatureC !== null
        ? rawExtreme.rawTemperatureC - start.rawTemperatureC
        : null,
      timeToExtremeMinutes: (extreme.timestampMs - start.timestampMs) / 60_000,
      responseLagMinutes: reversalConfirmed
        ? (extreme.timestampMs - start.timestampMs) / 60_000
        : null,
      reversalConfirmed,
      censored: !reversalConfirmed,
      reversalConfirmedAtMs,
      outdoorTempC: median(contextSamples.map(sample => sample.outdoorTempC)),
      targetTemperatureC: start.targetTemperatureC,
      phaseDurationMinutes: (phaseEnd.timestampMs - start.timestampMs) / 60_000,
      sampleCount: phase.samples.length
    })
  }
  return responses
}

function makeBins(samples: ThermalTransitionSample[], binMs: number): TemperatureBin[] {
  const start = samples[0].timestampMs
  const grouped: ThermalTransitionSample[][] = []
  for (const sample of samples) {
    const index = Math.floor((sample.timestampMs - start) / binMs)
    while (grouped.length <= index) grouped.push([])
    grouped[index].push(sample)
  }

  const bins: TemperatureBin[] = []
  for (const group of grouped) {
    if (group.length === 0) continue
    const rawTemperatures = group
      .filter(sample => sample.rawTemperatureC !== undefined)
      .map(sample => sample.rawTemperatureC as number)
    bins.push({
      timestampMs: group[Math.floor(group.length / 2)].timestampMs,
      heatIndexC: median(group.map(sample => sample.heatIndexC)),
      rawTemperatureC: rawTemperatures.length > 0 ? median(rawTemperatures) : null,
      outdoorTempC: median(group.map(sample => sample.outdoorTempC)),
      targetTemperatureC: median(group.map(sample => sample.targetTemperatureC))
    })
  }
  return bins
}

function findSustainedReversal(
  bins: TemperatureBin[],
  extremeIndex: number,
  direction: 1 | -1,
  extremeC: number,
  thresholdC: number,
  confirmationBins: number
): number | null {
  let consecutive = 0
  for (let index = extremeIndex + 1; index < bins.length; index++) {
    const reversed = direction === 1
      ? bins[index].heatIndexC >= extremeC + thresholdC
      : bins[index].heatIndexC <= extremeC - thresholdC
    consecutive = reversed ? consecutive + 1 : 0
    if (consecutive >= confirmationBins) return bins[index].timestampMs
  }
  return null
}

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}
