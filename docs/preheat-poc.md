# Predictive preheat POC

This is an offline, read-only proof of concept. It estimates when a room will cross the existing low heating threshold and moves the suggested trigger earlier by the estimated heat-system response time. It does not call `Thermostat.evaluateChanges()`, change runtime thresholds, or issue relay commands. For the preferred phase-by-phase January/February analysis of post-switch extrema, use [`thermal-response-poc.md`](thermal-response-poc.md); this threshold calculator is only a simple baseline.

Run the synthetic example:

```sh
npm run preheat:poc
```

Analyze a thermostat CSV without modifying it:

```sh
npm run preheat:poc -- --csv /absolute/path/to/data-log.csv
```

Optional overrides for a CSV run: `--target <C>`, `--current-hi <C>`, and `--outdoor <C>`.

## Model

- Uses `heat-index` as the indoor comfort/control value, not the CSV's raw `temperature` column.
- Treats logged `state=0` as heat OFF and `state=1` as heat ON, and includes only rows with `target-state=1` (HEAT demand); other target modes and COOL state rows are ignored.
- Splits the history into continuous state periods (minimum 30 minutes; gaps over 60 minutes split periods), then estimates heat-index slopes with linear regression.
- Uses median cooling slopes from OFF periods and median recovery slopes from HEAT periods within 5°C of the current outdoor temperature.
- Calculates response lead as `(target HeatIndex - existing lower threshold) / observed heat-up rate`, capped at 120 minutes.
- Raises the trigger by `min(0.6°C, cooling rate × response lead)`, capped at the target. If suitable ON and OFF periods are missing, it falls back to the existing threshold.

The existing thermostat's lower threshold is currently `target - 0.275°C`; the POC mirrors that formula. All limits are prototype defaults, not calibrated settings.

## Synthetic demonstration

The fixture is fabricated: outside `-5°C`, OFF cooling `0.30°C/hour`, HEAT recovery `0.45°C/hour`, target HeatIndex `20°C`, current HeatIndex `19.80°C`. It estimates a 37-minute recovery lead and suggests `19.91°C` instead of the baseline `19.725°C`; the baseline would wait, while the predictor suggests heat now. This only demonstrates the arithmetic, not expected performance in the home.

## Data caveats before trusting a CSV result

The existing app writes `state` from its thermostat heating state after a broker publish; it is not independent proof that the circulation pump physically ran. If the offered log has a separate pump feedback column, the parser should use that instead. The app also writes outside temperature as `0` when no forecast is available, which is indistinguishable from a genuine 0°C reading in the current CSV format. Inspect these fields and data gaps before interpreting rates.

Do not connect this POC to active control yet. First run it against representative real cold-weather logs, check OFF/ON period selection and predicted threshold crossings, then keep it shadow-only for a period before considering control integration. A lower measured heat-up rate should advance the suggested trigger, but this prototype does not establish that changing pump speed or the trigger is safe for the heating system.
