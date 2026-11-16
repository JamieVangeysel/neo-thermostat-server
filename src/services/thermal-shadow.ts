import type { ThermalTransitionResponse } from './thermal-response-poc'

export type ShadowAction =
  | 'SHADOW_WOULD_START_HEAT'
  | 'SHADOW_WOULD_STOP_HEAT'
  | 'SHADOW_HOLD'
  | 'BASELINE_ONLY'
  | 'INHIBITED_STALE_SENSOR'
  | 'MODE_NOT_HEAT'

export interface ShadowDecisionInput {
  instanceName: string
  nowMs: number
  lifecycle: 'starting' | 'running' | 'stopping' | 'stopped'
  currentRawTemperatureC: number
  currentHeatIndexC: number
  relativeHumidityPct: number
  targetHeatIndexC: number
  outdoorTempC: number | null
  targetMode: string
  currentState: string
  sensorFresh: boolean
  sampleAgeMs: number | null
  baselineHeatingMinC: number
  baselineHeatingMaxC: number
  phaseResponses: ThermalTransitionResponse[]
  profileBuiltAt?: string | null
  historySampleCount?: number
  historySource?: string
  historyStartAt?: string | null
  historyEndAt?: string | null
  currentPhase?: {
    state: string
    startedAtMs?: number | null
    elapsedMinutes: number
    initialHeatIndexC?: number | null
    currentHeatIndexC?: number | null
    minimumHeatIndexC?: number | null
    maximumHeatIndexC?: number | null
    heatIndexDeltaC: number
    initialRawTemperatureC?: number | null
    currentRawTemperatureC?: number | null
    rawTemperatureDeltaC: number | null
  } | null
  mqttReportedRelays?: { pinIndex: number; type: string; state: 'ON' | 'OFF' | 'UNKNOWN'; reportedAt?: string }[]
  errorStatus?: unknown
  minimumCases?: number
}

interface ResponseStats {
  cases: number
  confirmed: number
  censored: number
  medianLagMinutes: number | null
  p90LagMinutes: number | null
  maxLagMinutes: number | null
  p90AdverseDriftC: number | null
  maxAdverseDriftC: number | null
}

export function outdoorTemperatureBand(outdoorTempC: number | null): string {
  if (!Number.isFinite(outdoorTempC) || outdoorTempC === 0) return 'unknown'
  if ((outdoorTempC as number) < 0) return 'freezing'
  if ((outdoorTempC as number) <= 5) return 'cold'
  return 'mild'
}

export function buildShadowTranscript(input: ShadowDecisionInput): Record<string, any> {
  const band = outdoorTemperatureBand(input.outdoorTempC)
  const matching = band === 'unknown'
    ? []
    : input.phaseResponses.filter(response => outdoorTemperatureBand(response.outdoorTempC) === band)
  const heatOn = responseStats(matching.filter(response => response.transition === 'HEAT_ON'), true)
  const heatOff = responseStats(matching.filter(response => response.transition === 'HEAT_OFF'), false)
  const minimumCases = input.minimumCases ?? 5
  const profileReady = band !== 'unknown' && heatOn.confirmed >= minimumCases && heatOff.confirmed >= minimumCases
  const onAdvanceC = profileReady ? (heatOn.p90AdverseDriftC ?? 0) : 0
  const offAdvanceC = profileReady ? (heatOff.p90AdverseDriftC ?? 0) : 0
  const proposedOnUncappedC = input.baselineHeatingMinC + onAdvanceC
  const proposedOnC = Math.min(input.targetHeatIndexC, proposedOnUncappedC)
  const proposedOffC = input.baselineHeatingMaxC - offAdvanceC
  const thresholdsCompatible = proposedOffC > proposedOnC
  const usableProfile = profileReady && thresholdsCompatible
  const shadowOnC = usableProfile ? proposedOnC : input.baselineHeatingMinC
  const shadowOffC = usableProfile ? proposedOffC : input.baselineHeatingMaxC
  const baselineAction = decide(input, input.baselineHeatingMinC, input.baselineHeatingMaxC)
  let shadowAction: ShadowAction
  if (!input.sensorFresh) shadowAction = 'INHIBITED_STALE_SENSOR'
  else if (input.targetMode !== 'HEAT') shadowAction = 'MODE_NOT_HEAT'
  else if (!usableProfile) shadowAction = 'BASELINE_ONLY'
  else shadowAction = decide(input, shadowOnC, shadowOffC) as ShadowAction

  let reason: string
  if (!input.sensorFresh) {
    reason = 'No fresh validated sensor reading; shadow recommendation is inhibited.'
  } else if (input.targetMode !== 'HEAT') {
    reason = `Target mode is ${input.targetMode}; this shadow profile only evaluates HEAT mode.`
  } else if (band === 'unknown') {
    reason = 'Outdoor temperature band is unknown (exact 0°C is treated as a missing-weather sentinel); baseline thresholds are shown.'
  } else if (!profileReady) {
    reason = `Insufficient confirmed phase cases for ${band}: need ${minimumCases} HEAT_ON and HEAT_OFF cases; using baseline thresholds.`
  } else if (!thresholdsCompatible) {
    reason = 'Suggested HEAT ON/OFF thresholds overlap; no shadow action is recommended from this profile.'
  } else if (shadowAction === baselineAction) {
    reason = `Shadow and baseline agree: ${shadowAction}.`
  } else {
    reason = `Shadow differs from baseline: baseline=${baselineAction}, shadow=${shadowAction}. This is advisory only.`
  }

  const transcript = [
    `Input: HeatIndex=${fixed(input.currentHeatIndexC)}°C; raw=${fixed(input.currentRawTemperatureC)}°C; target=${fixed(input.targetHeatIndexC)}°C; outdoor=${input.outdoorTempC === null ? 'unknown' : `${fixed(input.outdoorTempC)}°C`}; current=${input.currentState}; target mode=${input.targetMode}.`,
    `Sensor: ${input.sensorFresh ? 'fresh' : 'stale/invalid'}${input.sampleAgeMs === null ? '' : `; age=${Math.round(input.sampleAgeMs / 1000)}s`}; humidity=${fixed(input.relativeHumidityPct)}%.`,
    `Baseline thresholds: HEAT ON at/below ${fixed(input.baselineHeatingMinC)}°C HeatIndex; HEAT OFF at/above ${fixed(input.baselineHeatingMaxC)}°C HeatIndex.`,
    `Historical profile: source=${input.historySource ?? 'unavailable'}; samples=${input.historySampleCount ?? 0}; range=${input.historyStartAt ?? '?'} to ${input.historyEndAt ?? '?'}; built=${input.profileBuiltAt ?? 'never'}.`,
    `Current phase: state=${input.currentPhase?.state ?? 'unknown'}; elapsed=${formatMetric(input.currentPhase?.elapsedMinutes ?? null)}min; HeatIndex delta=${formatMetric(input.currentPhase?.heatIndexDeltaC ?? null)}°C; raw delta=${formatMetric(input.currentPhase?.rawTemperatureDeltaC ?? null)}°C.`,
    `MQTT-reported relay states: ${JSON.stringify(input.mqttReportedRelays ?? [])}; these are broker reports, not independent pump/physical feedback.`,
    `Historical ${band} profile: HEAT_ON confirmed=${heatOn.confirmed}/${heatOn.cases}, p90 post-switch drop=${formatMetric(heatOn.p90AdverseDriftC)}°C, p90 response lag=${formatMetric(heatOn.p90LagMinutes)}min; HEAT_OFF confirmed=${heatOff.confirmed}/${heatOff.cases}, p90 residual rise=${formatMetric(heatOff.p90AdverseDriftC)}°C, p90 response lag=${formatMetric(heatOff.p90LagMinutes)}min.`,
    `Shadow thresholds: HEAT ON at/below ${fixed(shadowOnC)}°C (uncapped=${fixed(proposedOnUncappedC)}°C); HEAT OFF at/above ${fixed(shadowOffC)}°C (uncapped=${fixed(proposedOffC)}°C); profileReady=${usableProfile}; thresholdOrderValid=${thresholdsCompatible}.`,
    `Evaluation: baseline=${baselineAction}; shadow=${shadowAction}; ${reason}`,
    'Actuation: none. These values do not alter Thermostat.evaluateChanges() or publish relay commands.'
  ]

  return {
    version: 1,
    kind: 'thermostat-preheat-shadow-decision',
    instance: input.instanceName,
    lifecycle: input.lifecycle,
    computedAt: new Date(input.nowMs).toISOString(),
    targetMode: input.targetMode,
    currentState: input.currentState,
    currentRawTemperatureC: input.currentRawTemperatureC,
    currentHeatIndexC: input.currentHeatIndexC,
    relativeHumidityPct: input.relativeHumidityPct,
    targetHeatIndexC: input.targetHeatIndexC,
    outdoorTempC: input.outdoorTempC,
    outdoorBand: band,
    sensorFresh: input.sensorFresh,
    sampleAgeMs: input.sampleAgeMs,
    errorStatus: input.errorStatus ?? null,
    currentPhase: input.currentPhase ?? null,
    mqttReportedRelays: input.mqttReportedRelays ?? [],
    profile: {
      ready: usableProfile,
      minimumCases,
      builtAt: input.profileBuiltAt ?? null,
      historySampleCount: input.historySampleCount ?? 0,
      historySource: input.historySource ?? 'unavailable',
      historyStartAt: input.historyStartAt ?? null,
      historyEndAt: input.historyEndAt ?? null,
      heatOn: { ...heatOn, p90PostSwitchDropC: heatOn.p90AdverseDriftC },
      heatOff: { ...heatOff, p90PostSwitchRiseC: heatOff.p90AdverseDriftC },
      physicalPumpFeedbackAvailable: false
    },
    thresholds: {
      baseline: { heatingMinC: input.baselineHeatingMinC, heatingMaxC: input.baselineHeatingMaxC },
      shadow: { heatingMinC: shadowOnC, heatingMaxC: shadowOffC },
      uncappedHeatingMinC: proposedOnUncappedC,
      uncappedHeatingMaxC: proposedOffC,
      compatible: thresholdsCompatible
    },
    baselineAction,
    shadowAction,
    reason,
    actuation: 'none',
    transcript
  }
}

export interface RetainedStatusPublisher {
  publish(
    topic: string,
    payload: string,
    options: { qos: 1; retain: true },
    callback: (error?: Error | null) => void
  ): unknown
}

export function publishRetainedShadowStatus(
  client: RetainedStatusPublisher,
  topic: string,
  payload: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1, retain: true }, error => error ? reject(error) : resolve())
  })
}

function decide(input: ShadowDecisionInput, heatOnThresholdC: number, heatOffThresholdC: number): ShadowAction {
  if (!input.sensorFresh) return 'INHIBITED_STALE_SENSOR'
  if (input.targetMode !== 'HEAT') return 'MODE_NOT_HEAT'
  if (input.currentState === 'OFF' && input.currentHeatIndexC <= heatOnThresholdC) return 'SHADOW_WOULD_START_HEAT'
  if (input.currentState === 'HEAT' && input.currentHeatIndexC >= heatOffThresholdC) return 'SHADOW_WOULD_STOP_HEAT'
  return 'SHADOW_HOLD'
}

function responseStats(responses: ThermalTransitionResponse[], isHeatOn: boolean): ResponseStats {
  const confirmed = responses.filter(response => response.reversalConfirmed && response.responseLagMinutes !== null)
  const adverseDrifts = confirmed.map(response => Math.max(0, isHeatOn ? -response.deltaHeatIndexC : response.deltaHeatIndexC))
  return {
    cases: responses.length,
    confirmed: confirmed.length,
    censored: responses.length - confirmed.length,
    medianLagMinutes: median(confirmed.map(response => response.responseLagMinutes as number)),
    p90LagMinutes: quantile(confirmed.map(response => response.responseLagMinutes as number), 0.9),
    maxLagMinutes: confirmed.length ? Math.max(...confirmed.map(response => response.responseLagMinutes as number)) : null,
    p90AdverseDriftC: quantile(adverseDrifts, 0.9),
    maxAdverseDriftC: adverseDrifts.length ? Math.max(...adverseDrifts) : null
  }
}

function median(values: number[]): number | null {
  const sorted = values.slice().sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function quantile(values: number[], probability: number): number | null {
  const sorted = values.slice().sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(probability * sorted.length) - 1))
  return sorted[index]
}

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'unknown'
}

function formatMetric(value: number | null): string {
  return value === null ? 'unavailable' : value.toFixed(1)
}
