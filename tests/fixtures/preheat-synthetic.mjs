// Entirely synthetic cold-weather sample series; no household telemetry.
const start = Date.UTC(2026, 0, 1, 0, 0, 0)
const quarterHour = 15 * 60 * 1000
const samples = []

for (let i = 0; i <= 8; i++) {
  samples.push({
    timestampMs: start + i * quarterHour,
    heatIndexC: 20.4 - 0.075 * i,
    outdoorTempC: -5,
    heatingOn: false
  })
}

for (let i = 0; i <= 8; i++) {
  samples.push({
    timestampMs: start + 2 * 60 * 60 * 1000 + quarterHour + i * quarterHour,
    heatIndexC: 19.8 + 0.1125 * i,
    outdoorTempC: -5,
    heatingOn: true
  })
}

for (let i = 0; i <= 8; i++) {
  samples.push({
    timestampMs: start + 4.5 * 60 * 60 * 1000 + i * quarterHour,
    heatIndexC: 20.7 - 0.075 * i,
    outdoorTempC: -5,
    heatingOn: false
  })
}

export { samples as syntheticPreheatSamples }
