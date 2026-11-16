export const TEMPERATURE_HISTORY_WINDOW_MS = 4 * 60 * 60_000
export const TEMPERATURE_HISTORY_PERSIST_INTERVAL_MS = 15 * 60_000
export const MAX_TEMPERATURE_HISTORY_SAMPLES = 1024

export function isTemperatureHistoryPersistDue(lastPersistAtMs: number, nowMs: number, writeInFlight: boolean = false): boolean {
  return !writeInFlight && Number.isFinite(lastPersistAtMs) && Number.isFinite(nowMs) &&
    nowMs - lastPersistAtMs >= TEMPERATURE_HISTORY_PERSIST_INTERVAL_MS
}

export interface TemperatureHistorySample {
  date: Date
  temperature: number
}

/** Append a chronological sample while retaining only the useful bounded control window. */
export function appendBoundedTemperatureSample(
  history: TemperatureHistorySample[],
  date: Date,
  temperature: number,
  nowMs: number = date.getTime()
): boolean {
  const timestamp = date.getTime()
  if (!Number.isFinite(timestamp) || !Number.isFinite(temperature) || !Number.isFinite(nowMs)) return false

  const cutoff = nowMs - TEMPERATURE_HISTORY_WINDOW_MS
  if (timestamp < cutoff) return false

  const last = history[history.length - 1]
  if (last && timestamp <= last.date.getTime()) return false

  history.push({ date, temperature })
  while (history.length > 0 && history[0].date.getTime() < cutoff) history.shift()
  if (history.length > MAX_TEMPERATURE_HISTORY_SAMPLES) {
    history.splice(0, history.length - MAX_TEMPERATURE_HISTORY_SAMPLES)
  }
  return true
}
