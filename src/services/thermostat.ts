import { Relais } from './relais'
import { Platform } from '../platform'
import { FileSystem } from './filesystem'
import { OpenWeatherMapResponse, WeatherInfoService } from './weather-info'
import { isCoolType, isHeatType, IThermostatInstanceConfig, SwitchTypeEnum } from './config'
import { connect, MqttClient } from 'mqtt'
import { parseThermostatCsv } from './preheat-poc'
import { analyzeThermalTransitions } from './thermal-response-poc'
import type { ThermalTransitionResponse, ThermalTransitionSample } from './thermal-response-poc'
import { buildShadowTranscript } from './thermal-shadow'
import { resolveTemperatureTopics, resolveThermostatStatusTopics } from './mqtt-topic-compat'
import {
  DEFAULT_SENSOR_STALE_AFTER_MS,
  hasFreshSensorSample,
  isSensorStale,
  validateSensorPayload
} from './sensor-safety'

export class Thermostat {
  private readonly platform: Platform
  private readonly fs: FileSystem = new FileSystem()
  private readonly relais: Relais
  private sensorClient?: MqttClient
  private weatherInfo?: WeatherInfoService
  private retries: number = 0
  private currentForecast: OpenWeatherMapResponse
  private temperatureHistory: { date: Date, temperature: number }[] = []
  private sensorStartedAtMs?: number
  private readonly sensorMaxAgeMs: number = DEFAULT_SENSOR_STALE_AFTER_MS
  private lastValidSensorAtMs?: number
  private lastSampledAtMs?: number
  private sensorWatchdog?: NodeJS.Timeout
  private shadowProfileRefreshTimer?: NodeJS.Timeout
  private shadowResponses: ThermalTransitionResponse[] = []
  private shadowHistorySampleCount = 0
  private shadowProfileBuiltAt: string | null = null
  private shadowProfileSource = 'not-loaded'
  private shadowHistoryStartAt: string | null = null
  private shadowHistoryEndAt: string | null = null
  private shadowPhaseSamples: ThermalTransitionSample[] = []
  private shadowPhaseStartAtMs?: number
  private shadowPhaseState?: 'HEAT' | 'OFF'
  private shadowPhaseTransitionKnown = false
  private shadowPhaseInitialHeatIndexC?: number
  private shadowPhaseInitialRawTemperatureC?: number
  private shadowPhaseMinHeatIndexC?: number
  private shadowPhaseMaxHeatIndexC?: number
  private shadowPhaseMinRawTemperatureC?: number
  private shadowPhaseMaxRawTemperatureC?: number
  private lastShadowDecisionSignature = ''
  private lastShadowPublishedAtMs = 0
  private shadowStatusTopicsWarningLogged = false
  private started = false
  private sensorErrorStatus: ThermostatErrorStatus | null = null
  private relayErrorStatus: ThermostatErrorStatus | null = null
  private faultShutdownAttempts: number = 0
  private lastFaultShutdownAttemptAtMs: number = 0
  private lastFaultShutdownFailures: { pinIndex: number; message: string }[] = []

  private readonly instance_name: string

  constructor(platform: Platform, instance_name: string = 'default') {
    this.platform = platform
    this.instance_name = instance_name

    this.platform.logger.debug(`Thermostat.constructor() -- Constructed new instance of Thermostat()`)

    this.relais = new Relais(this.platform, this.instance.switches)

    this.relais.on('update', (switches) => {
      this.instance.switches = switches
    })
    this.relais.on('relayCommandError', (failure: { pinIndex?: number; error: unknown }) => {
      const message = failure.error instanceof Error ? failure.error.message : String(failure.error)
      this.relayErrorStatus = {
        code: 'RELAY_COMMAND_FAILED',
        message: `MQTT relay command could not be published${failure.pinIndex === undefined ? '' : ` for pin ${failure.pinIndex}`}: ${message}`,
        at: new Date().toISOString()
      }
    })
    this.relais.on('commandPublished', () => {
      // This clears only a prior broker-publish error; it is not a physical relay acknowledgement.
      this.relayErrorStatus = null
    })

  }

  async start(): Promise<void> {
    if (this.started) return
    this.platform.logger.info(`Thermostat.start() -- starting instance '${this.instance_name}'`)
    this.sensorStartedAtMs = Date.now()

    const logPath = `data-log-${this.instance_name}.csv`
    if (!(await this.fs.exists(logPath))) {
      await this.fs.writeFile(logPath, Buffer.from('date,state,target-state,temperature,target-temperature,outside-temperature,heat-index\n'))
      await this.fs.writeAppendFile(logPath, Buffer.from(`${new Date().toISOString().replace('T', ' ').substring(0, 19)},${this.state.currentHeatingCoolingState},${this.state.targetHeatingCoolingState},${this.state.currentTemperature},${this.state.targetTemperature},${this.currentForecast ? this.currentForecast.main.temp : 0},${this.HeatIndex}\n`))
    }
    void this.refreshShadowPhaseProfile(logPath).then(() => this.publishShadowTranscript(true))
    this.shadowProfileRefreshTimer = setInterval(() => {
      void this.refreshShadowPhaseProfile(logPath).then(() => this.publishShadowTranscript(true))
    }, 24 * 60 * 60 * 1000)
    this.shadowProfileRefreshTimer.unref()

    this.weatherInfo = new WeatherInfoService(this.platform)
    this.weatherInfo.on('error', err => this.platform.logger.error('Weather update failed', err))
    this.weatherInfo.on('forecast', async (forecast: OpenWeatherMapResponse) => {
      this.platform.logger.debug(`Thermostat.weatherInfo.on('forecast')`, forecast.main)
      try {
        if (this.platform.database.enabled) {
          await this.platform.database.insertIntoCollection('forecastHistory', { date: new Date(), forecast })
          this.platform.logger.debug(`Thermostat.weatherInfo.on('forecast') -- persisted forecast history`)
        }
      } catch (err) {
        this.platform.logger.error('Could not persist forecast', err)
      }
      this.currentForecast = forecast
      this.platform.logger.debug('Outside heat index:', this.calculateHeatIndex(forecast.main.temp, forecast.main.humidity))
      this.platform.logger.debug('Outside wind chill factor:', this.calculateWindChillFactor(forecast.main.temp, forecast.wind.speed))
      void this.publishShadowTranscript(true)
    })

    await this.relais.start()
    await this.weatherInfo.start()

    const topics = resolveTemperatureTopics(this.instance)
    const sensorClient = connect('mqtt://localhost:1883')
    this.sensorClient = sensorClient
    sensorClient.on('connect', () => {
      this.platform.logger.info('Connected to MQTT server')
      sensorClient.subscribe(topics, err => {
        if (err) {
          this.platform.logger.error('Could not subscribe to thermostat sensor topics', topics, err)
          void this.enterSensorFault('SENSOR_MQTT_ERROR', `Could not subscribe to sensor topics: ${err.message}`)
          return
        }
        this.platform.logger.debug(`Subscribed to thermostat sensor topics: ${topics.join(', ')}`)
      })
    })
    sensorClient.on('error', err => {
      this.platform.logger.error('Thermostat sensor MQTT client error', err)
      void this.enterSensorFault('SENSOR_MQTT_ERROR', `Sensor MQTT error: ${err.message}`)
    })
    sensorClient.on('message', (_topic, payload, packet) => {
      this.platform.logger.debug('Received Message:', _topic, payload.toString())
      void this.handleSensorMessage(payload, Boolean(packet?.retain)).catch(err => {
        this.platform.logger.error('Failed to process thermostat sensor message', err)
        void this.enterSensorFault('SENSOR_INVALID', 'Sensor message processing failed')
      })
    })

    this.sensorWatchdog = setInterval(() => {
      const now = Date.now()
      if (this.sensorStartedAtMs !== undefined && isSensorStale(this.lastValidSensorAtMs, this.sensorStartedAtMs, now, this.sensorMaxAgeMs)) {
        void this.enterSensorFault('SENSOR_STALE', 'No fresh valid sensor sample received before the timeout')
      }
    }, 30_000)
    this.sensorWatchdog.unref()
    this.started = true
    this.platform.logger.info(`Thermostat.start() -- instance '${this.instance_name}' started`)
    void this.publishShadowTranscript(true)
  }

  private async refreshShadowPhaseProfile(logPath: string): Promise<void> {
    try {
      if (!(await this.fs.exists(logPath))) return
      const file = await this.fs.readFile(logPath)
      const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000
      const parsed = parseThermostatCsv(file.toString('utf8'))
      const samples: ThermalTransitionSample[] = []
      for (const sample of parsed) {
        if (sample.timestampMs < cutoff || sample.targetTemperatureC === undefined) continue
        samples.push({ ...sample, targetTemperatureC: sample.targetTemperatureC })
      }
      const responses = analyzeThermalTransitions(samples, {
        binMinutes: 5,
        reversalThresholdC: 0.1,
        confirmationBins: 3,
        maxSampleGapMinutes: 5
      })
      this.shadowHistorySampleCount = samples.length
      this.shadowHistoryStartAt = samples.length > 0 ? new Date(samples[0].timestampMs).toISOString() : null
      this.shadowHistoryEndAt = samples.length > 0 ? new Date(samples[samples.length - 1].timestampMs).toISOString() : null
      this.shadowProfileBuiltAt = new Date().toISOString()
      this.shadowProfileSource = `data-log-${this.instance_name}.csv (rolling 365 days)`
      this.seedShadowPhase(samples, responses)
      this.platform.logger.info('Thermostat shadow phase profile refreshed', {
        instance: this.instance_name,
        samples: this.shadowHistorySampleCount,
        completedTransitions: this.shadowResponses.length
      })
    } catch (error) {
      this.platform.logger.warn('Could not refresh thermostat shadow phase profile; using previously loaded profile', error)
    }
  }

  private seedShadowPhase(samples: ThermalTransitionSample[], responses: ThermalTransitionResponse[]): void {
    if (samples.length === 0) {
      this.shadowResponses = []
      this.shadowPhaseSamples = []
      this.shadowPhaseStartAtMs = undefined
      this.shadowPhaseState = undefined
      this.shadowPhaseTransitionKnown = false
      return
    }

    const lastIndex = samples.length - 1
    let phaseStartIndex = lastIndex
    while (phaseStartIndex > 0) {
      const previous = samples[phaseStartIndex - 1]
      const current = samples[phaseStartIndex]
      if (previous.heatingOn !== current.heatingOn || current.timestampMs - previous.timestampMs > 5 * 60_000) break
      phaseStartIndex--
    }

    const currentPhaseStart = samples[phaseStartIndex]
    const precedingSample = phaseStartIndex > 0 ? samples[phaseStartIndex - 1] : undefined
    this.shadowPhaseStartAtMs = currentPhaseStart.timestampMs
    this.shadowPhaseState = currentPhaseStart.heatingOn ? 'HEAT' : 'OFF'
    this.shadowPhaseTransitionKnown = Boolean(precedingSample &&
      precedingSample.heatingOn !== currentPhaseStart.heatingOn &&
      currentPhaseStart.timestampMs - precedingSample.timestampMs <= 5 * 60_000)
    this.shadowPhaseSamples = samples.slice(Math.max(0, phaseStartIndex - 1))
    this.shadowPhaseInitialHeatIndexC = currentPhaseStart.heatIndexC
    this.shadowPhaseInitialRawTemperatureC = currentPhaseStart.rawTemperatureC
    this.shadowPhaseMinHeatIndexC = currentPhaseStart.heatIndexC
    this.shadowPhaseMaxHeatIndexC = currentPhaseStart.heatIndexC
    this.shadowPhaseMinRawTemperatureC = currentPhaseStart.rawTemperatureC
    this.shadowPhaseMaxRawTemperatureC = currentPhaseStart.rawTemperatureC
    for (const sample of samples.slice(phaseStartIndex + 1)) this.updateShadowPhaseExtrema(sample)

    this.shadowResponses = responses.filter(response => response.transitionAtMs < currentPhaseStart.timestampMs)
  }

  private recordShadowSample(timestampMs: number): void {
    if (this.state.targetHeatingCoolingState !== HeatingCoolingStateEnum.HEAT) {
      this.shadowPhaseSamples = []
      this.shadowPhaseStartAtMs = undefined
      this.shadowPhaseState = undefined
      this.shadowPhaseTransitionKnown = false
      return
    }

    const sample: ThermalTransitionSample = {
      timestampMs,
      heatIndexC: this.HeatIndex,
      rawTemperatureC: this.CurrentTemperature,
      outdoorTempC: this.currentForecast?.main?.temp ?? 0,
      targetTemperatureC: this.TargetTemperature,
      heatingOn: this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.HEAT
    }
    if (this.shadowHistoryStartAt === null) this.shadowHistoryStartAt = new Date(sample.timestampMs).toISOString()
    if (this.shadowHistoryEndAt === null || sample.timestampMs > Date.parse(this.shadowHistoryEndAt)) {
      this.shadowHistoryEndAt = new Date(sample.timestampMs).toISOString()
    }
    const previous = this.shadowPhaseSamples[this.shadowPhaseSamples.length - 1]
    if (previous && sample.heatingOn !== previous.heatingOn && sample.timestampMs <= previous.timestampMs) {
      sample.timestampMs = previous.timestampMs + 1
    }
    if (!previous || sample.timestampMs - previous.timestampMs > 5 * 60_000) {
      this.shadowPhaseSamples = [sample]
      this.startShadowPhase(sample, false)
      return
    }

    if (sample.heatingOn !== previous.heatingOn) {
      const completed = this.shadowPhaseStartAtMs === undefined || !this.shadowPhaseTransitionKnown
        ? undefined
        : analyzeThermalTransitions([...this.shadowPhaseSamples, sample], {
            binMinutes: 5,
            reversalThresholdC: 0.1,
            confirmationBins: 3,
            maxSampleGapMinutes: 5
          }).find(response => response.transitionAtMs === this.shadowPhaseStartAtMs)
      if (completed && !this.shadowResponses.some(response => response.transitionAtMs === completed.transitionAtMs)) {
        this.shadowResponses.push(completed)
        this.shadowProfileBuiltAt = new Date().toISOString()
      }
      this.shadowPhaseSamples = [previous, sample]
      this.startShadowPhase(sample, true)
      return
    }

    this.shadowPhaseSamples.push(sample)
    this.updateShadowPhaseExtrema(sample)
    this.shadowHistorySampleCount++
  }

  private startShadowPhase(sample: ThermalTransitionSample, transitionKnown: boolean): void {
    this.shadowPhaseStartAtMs = sample.timestampMs
    this.shadowPhaseState = sample.heatingOn ? 'HEAT' : 'OFF'
    this.shadowPhaseTransitionKnown = transitionKnown
    this.shadowPhaseInitialHeatIndexC = sample.heatIndexC
    this.shadowPhaseInitialRawTemperatureC = sample.rawTemperatureC
    this.shadowPhaseMinHeatIndexC = sample.heatIndexC
    this.shadowPhaseMaxHeatIndexC = sample.heatIndexC
    this.shadowPhaseMinRawTemperatureC = sample.rawTemperatureC
    this.shadowPhaseMaxRawTemperatureC = sample.rawTemperatureC
    this.shadowHistorySampleCount++
  }

  private updateShadowPhaseExtrema(sample: ThermalTransitionSample): void {
    this.shadowPhaseMinHeatIndexC = Math.min(this.shadowPhaseMinHeatIndexC ?? sample.heatIndexC, sample.heatIndexC)
    this.shadowPhaseMaxHeatIndexC = Math.max(this.shadowPhaseMaxHeatIndexC ?? sample.heatIndexC, sample.heatIndexC)
    if (sample.rawTemperatureC !== undefined) {
      this.shadowPhaseMinRawTemperatureC = Math.min(this.shadowPhaseMinRawTemperatureC ?? sample.rawTemperatureC, sample.rawTemperatureC)
      this.shadowPhaseMaxRawTemperatureC = Math.max(this.shadowPhaseMaxRawTemperatureC ?? sample.rawTemperatureC, sample.rawTemperatureC)
    }
  }

  private shadowCurrentPhase(now: number) {
    if (this.shadowPhaseStartAtMs === undefined || this.shadowPhaseState === undefined) return null
    return {
      state: this.shadowPhaseState,
      startedAtMs: this.shadowPhaseStartAtMs,
      elapsedMinutes: Math.max(0, (now - this.shadowPhaseStartAtMs) / 60_000),
      initialHeatIndexC: this.shadowPhaseInitialHeatIndexC ?? null,
      currentHeatIndexC: this.HeatIndex,
      minimumHeatIndexC: this.shadowPhaseMinHeatIndexC ?? null,
      maximumHeatIndexC: this.shadowPhaseMaxHeatIndexC ?? null,
      heatIndexDeltaC: this.HeatIndex - (this.shadowPhaseInitialHeatIndexC ?? this.HeatIndex),
      initialRawTemperatureC: this.shadowPhaseInitialRawTemperatureC ?? null,
      currentRawTemperatureC: this.CurrentTemperature,
      rawTemperatureDeltaC: this.CurrentTemperature - (this.shadowPhaseInitialRawTemperatureC ?? this.CurrentTemperature),
      minimumRawTemperatureC: this.shadowPhaseMinRawTemperatureC ?? null,
      maximumRawTemperatureC: this.shadowPhaseMaxRawTemperatureC ?? null
    }
  }

  private async publishShadowTranscript(force: boolean = false, lifecycle?: 'starting' | 'running' | 'stopping' | 'stopped'): Promise<void> {
    try {
      const statusTopics = resolveThermostatStatusTopics(this.instance)
      if (statusTopics.length === 0) {
        if (!this.shadowStatusTopicsWarningLogged) {
          this.platform.logger.warn(`No MQTT thermostat status topics configured for instance '${this.instance_name}'`)
          this.shadowStatusTopicsWarningLogged = true
        }
        return
      }
      const now = Date.now()
      const currentLifecycle = lifecycle ?? (this.started ? 'running' : 'starting')
      const thresholds = this.thresholds
      const sensorFresh = hasFreshSensorSample(this.lastValidSensorAtMs, now, this.sensorMaxAgeMs)
      const transcript = buildShadowTranscript({
        instanceName: this.instance_name,
        nowMs: now,
        lifecycle: currentLifecycle,
        currentRawTemperatureC: this.CurrentTemperature,
        currentHeatIndexC: this.HeatIndex,
        relativeHumidityPct: this.CurrentRelativeHumidity,
        targetHeatIndexC: this.TargetTemperature,
        outdoorTempC: this.currentForecast?.main?.temp ?? null,
        targetMode: this.heatingCoolingStateName(this.state.targetHeatingCoolingState),
        currentState: this.heatingCoolingStateName(this.state.currentHeatingCoolingState),
        sensorFresh,
        sampleAgeMs: this.lastValidSensorAtMs === undefined ? null : Math.max(0, now - this.lastValidSensorAtMs),
        baselineHeatingMinC: thresholds.heatingMin,
        baselineHeatingMaxC: thresholds.heatingMax,
        phaseResponses: this.shadowResponses,
        profileBuiltAt: this.shadowProfileBuiltAt,
        historySampleCount: this.shadowHistorySampleCount,
        historySource: this.shadowProfileSource,
        historyStartAt: this.shadowHistoryStartAt,
        historyEndAt: this.shadowHistoryEndAt,
        currentPhase: this.shadowCurrentPhase(now),
        mqttReportedRelays: this.relais.mqttReportedRelays,
        errorStatus: this.ErrorStatus
      })
      const signature = JSON.stringify({
        lifecycle: transcript.lifecycle,
        targetMode: transcript.targetMode,
        currentState: transcript.currentState,
        sensorFresh: transcript.sensorFresh,
        baselineAction: transcript.baselineAction,
        shadowAction: transcript.shadowAction,
        thresholds: transcript.thresholds.shadow,
        profileReady: transcript.profile.ready,
        error: this.ErrorStatus?.code ?? null
      })
      if (!force && signature === this.lastShadowDecisionSignature && now - this.lastShadowPublishedAtMs < 5 * 60_000) return
      this.lastShadowDecisionSignature = signature
      this.lastShadowPublishedAtMs = now
      await this.relais.publishShadowStatus(statusTopics, transcript)
    } catch (error) {
      // Shadow telemetry must never affect thermostat control.
      this.platform.logger.warn('Thermostat shadow transcript publish failed; control is unchanged', error)
    }
  }

  private heatingCoolingStateName(state: HeatingCoolingStateEnum): string {
    switch (state) {
      case HeatingCoolingStateEnum.OFF: return 'OFF'
      case HeatingCoolingStateEnum.HEAT: return 'HEAT'
      case HeatingCoolingStateEnum.COOL: return 'COOL'
      case HeatingCoolingStateEnum.AUTO: return 'AUTO'
      default: return 'UNKNOWN'
    }
  }

  private async handleSensorMessage(payload: Buffer, retained: boolean): Promise<void> {
    const now = Date.now()
    const checked = validateSensorPayload(payload, now, this.sensorMaxAgeMs, retained)
    if (checked.ok === false) {
      await this.enterSensorFault(checked.code, checked.message)
      return
    }
    if (this.lastSampledAtMs !== undefined && checked.sample.sampledAtMs <= this.lastSampledAtMs) {
      await this.enterSensorFault('SENSOR_STALE', 'Sensor sample timestamp did not advance')
      return
    }

    this.lastValidSensorAtMs = checked.sample.receivedAtMs
    this.lastSampledAtMs = checked.sample.sampledAtMs
    this.sensorErrorStatus = null
    this.faultShutdownAttempts = 0
    this.lastFaultShutdownFailures = []

    const date = new Date(checked.sample.receivedAtMs)
    this.state.currentTemperature = checked.sample.temperatureC
    this.state.currentRelativeHumidity = checked.sample.relativeHumidityPct

    await this.fs.writeAppendFile(`data-log-${this.instance_name}.csv`, Buffer.from(`${date.toISOString().replace('T', ' ').substring(0, 19)},${this.state.currentHeatingCoolingState},${this.state.targetHeatingCoolingState},${this.state.currentTemperature},${this.state.targetTemperature},${this.currentForecast ? this.currentForecast.main.temp : 0},${this.HeatIndex}\n`))
    this.recordShadowSample(date.getTime())

    try {
      await this.addHistoryEntry(date, checked.sample.temperatureC)
    } catch (err) {
      this.platform.logger.error(`Could not add temperature into History, temp delta's might be faulty!`)
    }

    await this.evaluateChanges()
  }

  private async enterSensorFault(code: 'SENSOR_INVALID' | 'SENSOR_STALE' | 'SENSOR_MQTT_ERROR', message: string): Promise<void> {
    const now = Date.now()
    if (!this.sensorErrorStatus) {
      this.sensorErrorStatus = { code, message, at: new Date(now).toISOString() }
      this.faultShutdownAttempts = 0
      this.lastFaultShutdownFailures = []
    }

    const retryDue = now - this.lastFaultShutdownAttemptAtMs >= 30_000
    if (this.faultShutdownAttempts >= 3 ||
        (this.faultShutdownAttempts > 0 && (!retryDue || this.lastFaultShutdownFailures.length === 0))) {
      return
    }

    this.faultShutdownAttempts++
    this.lastFaultShutdownAttemptAtMs = now
    const result = await this.relais.deactivateForSensorFault()
    this.lastFaultShutdownFailures = result.failures
    this.sensorErrorStatus = {
      ...this.sensorErrorStatus,
      requestedOffPinIndexes: result.requestedPinIndexes,
      relayCommandFailures: result.failures,
      relayCommandConfirmation: result.requestedPinIndexes.length === 0
        ? 'No thermostat-controlled HVAC relays are configured for this zone; no relay command was published'
        : result.failures.length === 0
          ? 'MQTT broker accepted QoS 1 publishes; physical relay acknowledgement is unavailable'
          : 'One or more OFF commands failed at the MQTT broker; physical relay state is unknown'
    }
    void this.publishShadowTranscript(true)
  }

  public async stop(): Promise<void> {
    this.platform.logger.info(`Thermostat.stop() -- stopping instance '${this.instance_name}'`)
    if (this.sensorWatchdog) clearInterval(this.sensorWatchdog)
    if (this.shadowProfileRefreshTimer) clearInterval(this.shadowProfileRefreshTimer)
    this.sensorWatchdog = undefined
    this.shadowProfileRefreshTimer = undefined
    const sensorClient = this.sensorClient
    this.sensorClient = undefined
    if (sensorClient) await new Promise<void>(resolve => sensorClient.end(true, {}, () => resolve()))
    await this.weatherInfo?.stop()
    this.started = false
    await this.publishShadowTranscript(true, 'stopped')
    await this.relais.stop()
    this.platform.logger.info(`Thermostat.stop() -- instance '${this.instance_name}' stopped`)
  }

  async addHistoryEntry(date: Date, temperature: number): Promise<void> {
    this.platform.logger.info(`Thermostat.addHistoryEntry() -- data is from ${date.toISOString().replace('T', ' ').substring(0, 19)}.`)
    let save: boolean = false
    if (this.temperatureHistory.length > 0) {
      const lastHistoryEntry: {
        date: Date,
        temperature: number
      } = this.temperatureHistory[this.temperatureHistory.length - 1]
      if (lastHistoryEntry.date !== date) {
        save = true
      } else {
        this.platform.logger.warn(`Thermostat.addHistoryEntry() -- returned stale data, skipping insert to history.`)
      }
    } else {
      save = true
    }

    if (save) {
      this.temperatureHistory.push({
        date: date,
        temperature: temperature
      })
      this.platform.logger.info('Thermostat.addHistoryEntry() -- saving temperature into temperatureHistory.')
      this.writeTemperatureHistoryAsync().then(() => {
        this.platform.logger.info('Thermostat.addHistoryEntry() -- saved successfully.')
      })
    }
  }

  async getSensorData() {
    try {
      const result = await fetch(this.sensorUrl)
      const response: { data: { temperature: number, humidity: number, date: Date }[] } = (await result.json())

      const data = response.data
      const lastSeen: Date = data[0].date
      // data.temperature -= .2

      this.state.currentTemperature = data[0].temperature
      this.state.currentRelativeHumidity = data[0].humidity
      this.platform.logger.log('Thermostat.getSensorData() -- HeatIndex', this.HeatIndex)

      this.platform.logger.info(`Thermostat.getSensorData() -- data is from ${lastSeen}.`)
      if (this.temperatureHistory.length > 0) {
        /**
         * @type {{
         *    date: Date,
         *    temperature: number
         * }}
         */
        const lastHistoryEntry = this.temperatureHistory[this.temperatureHistory.length - 1]
        if (lastHistoryEntry.date !== lastSeen) {
          this.temperatureHistory.push({
            date: new Date(`${lastSeen}Z`),
            temperature: data[0].temperature
          })
          this.writeTemperatureHistoryAsync()
          this.platform.logger.info('Thermostat.getSensorData() -- saving temperature into temperatureHistory.')
        } else {
          this.platform.logger.warn(`Thermostat.getSensorData() -- returned stale data, skipping insert to history.`)
        }
      } else {
        this.temperatureHistory.push({
          date: new Date(`${lastSeen}Z`),
          temperature: data[0].temperature
        })
        this.writeTemperatureHistoryAsync()
        this.platform.logger.info('Thermostat.getSensorData() -- saving temperature into temperatureHistory.')
      }
      await this.evaluateChanges()
    } catch (err) {
      this.platform.logger.error('Thermostat.getSensorData() -- error while running getSensorData()', err)
    }
  }

  async evaluateChanges() {
    this.platform.logger.debug('Thermostat.evaluateChanges() -- start')
    const now = Date.now()
    const currentStateBeforeEvaluation = this.state.currentHeatingCoolingState
    if (!hasFreshSensorSample(this.lastValidSensorAtMs, now, this.sensorMaxAgeMs)) {
      const startupAgeExpired = this.sensorStartedAtMs !== undefined && now - this.sensorStartedAtMs >= this.sensorMaxAgeMs
      if (this.lastValidSensorAtMs !== undefined || startupAgeExpired) {
        await this.enterSensorFault('SENSOR_STALE', 'Automatic control is inhibited because the sensor sample is stale')
      }
      void this.publishShadowTranscript(true)
      return
    }

    // The thermostat intentionally controls to apparent temperature (heat index), per the comfort policy.
    const currentTemp = this.HeatIndex
    const thresholds = this.thresholds
    const temperatureDeltas = this.temperatureDeltas

    try {
      this.platform.logger.debug(`Thermostat.evaluateChanges() -- Current temperature: ${this.state.currentTemperature}`)
      this.platform.logger.debug(`Thermostat.evaluateChanges() -- Current HEATINDEX temperature: ${this.HeatIndex}`)
      this.platform.logger.debug(`Thermostat.evaluateChanges() -- Target temperature: ${this.state.targetTemperature}`)
      this.platform.logger.debug(`Thermostat.evaluateChanges() -- State info Current: ${this.state.currentHeatingCoolingState}, Target: ${this.state.targetHeatingCoolingState}`)
      this.platform.logger.debug(`Thermostat.evaluateChanges() -- Temp thresholds's: ${JSON.stringify(thresholds)}`)

      this.platform.logger.debug(`Thermostat.evaluateChanges() -- Temp delta's: ${JSON.stringify(temperatureDeltas)}`)

      // report if delta's have been reached, inform user of this behaviour
      if (temperatureDeltas.quarterTemperatureDelta.delta > thresholds.deltaMax.quarter) {
        this.platform.logger.warn('Thermostat.evaluateChanges() -- thresholds.deltaMax.quarter has been exceeded!')
      }
      if (temperatureDeltas.halfHourTemperatureDelta.delta > thresholds.deltaMax.halfHour) {
        this.platform.logger.warn('Thermostat.evaluateChanges() -- thresholds.deltaMax.halfHour has been exceeded!')
      }
      if (temperatureDeltas.oneHourTemperatureDelta.delta > thresholds.deltaMax.oneHour) {
        this.platform.logger.warn('Thermostat.evaluateChanges() -- thresholds.deltaMax.oneHour has been exceeded!')
      }
      if (temperatureDeltas.twoHourTemperatureDelta.delta > thresholds.deltaMax.twoHours) {
        this.platform.logger.warn('Thermostat.evaluateChanges() -- thresholds.deltaMax.twoHours has been exceeded!')
      }
      if (temperatureDeltas.fourHourTemperatureDelta.delta > thresholds.deltaMax.fourHours) {
        this.platform.logger.warn('Thermostat.evaluateChanges() -- thresholds.deltaMax.fourHours has been exceeded!')
      }

      this.platform.logger.debug(`Thermostat.evaluateChanges() -- switch this.state.targetHeatingCoolingState`)
      switch (this.state.targetHeatingCoolingState) {
        case HeatingCoolingStateEnum.OFF:
          this.platform.logger.debug('Thermostat.evaluateChanges() -- targetHeatingCoolingState is OFF, set current state to OFF')

          // If any relais is still powered on, turn them off
          await this.relais.activate(SwitchTypeEnum.NONE)
          this.state.currentHeatingCoolingState = this.state.targetHeatingCoolingState
          return

        case HeatingCoolingStateEnum.HEAT:
          this.platform.logger.debug(`Thermostat.evaluateChanges() -- handleHeatState`)
          await this.handleHeatState(currentTemp)
          return

        case HeatingCoolingStateEnum.COOL:
          this.platform.logger.debug('Thermostat.evaluateChanges() -- Target is cooling, check if currently cooling')
          await this.relais.activate(SwitchTypeEnum.NONE)
          if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.COOL) {
            this.platform.logger.debug('Thermostat.evaluateChanges() -- Check if target temperature has been reached')
            if (currentTemp <= this.thresholds.coolingMin) {
              this.platform.logger.debug('Thermostat.evaluateChanges() -- turn off cooling since target has been reached, don\'t change target')
              try {
                await this.relais.activate(SwitchTypeEnum.NONE)
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF
                this.retries = 0
              } catch {
                this.platform.logger.error('Thermostat.evaluateChanges() -- Error while turning off the heater, try again next cycle.')
                this.retries++
              }
            }
          } else if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.OFF) {
            this.platform.logger.debug('Thermostat.evaluateChanges() -- check if maximum temperature has been reached')
            if (currentTemp >= this.thresholds.coolingMax) {
              this.platform.logger.debug('Thermostat.evaluateChanges() -- turn on heating since min target has been reached, don\'t change target')
              try {
                await this.relais.activate(SwitchTypeEnum.COOL)
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.COOL
                this.retries = 0
              } catch {
                this.platform.logger.error('Thermostat.evaluateChanges() -- Error while turning off the cooling, try again next cycle.')
                this.retries++
              }
            }
          }
          return

        case HeatingCoolingStateEnum.AUTO:
          // this code will be added in the future when we take into account outside weather and time of the year
          return
      }
    } catch (err) {
      this.platform.logger.error('Thermostat.evaluateChanges() -- error while updating relais state', err)
    } finally {
      this.platform.logger.debug(`Thermostat.evaluateChanges() -- finished running evaluateChanges()`, 'retries:', this.retries)
      if (this.retries > 5) {
        this.platform.logger.error(`Thermostat.evaluateChanges() -- Relais communication has been unsuccessfull 5 Times! Send warning To user to power off master switch`)
      }

      const writeOk = await this.platform.configService.save(this.platform.config)
      if (writeOk) {
        this.platform.logger.debug('Thermostat.evaluateChanges() -- successfully saved current state in config')
      } else {
        this.platform.logger.error('Thermostat.evaluateChanges() -- Error while trying to save current config to disk!')
      }
      if (this.state.currentHeatingCoolingState !== currentStateBeforeEvaluation) {
        this.recordShadowSample(Date.now())
      }
      void this.publishShadowTranscript()
    }
  }

  private async handleHeatState(currentTemp: number) {
    this.platform.logger.debug('Thermostat.handleHeatState() -- start')

    this.platform.logger.debug('Thermostat.handleHeatState() -- targetHeatingCoolingState is HEAT, check if currently heating')
    this.platform.logger.debug('Thermostat.handleHeatState() -- config ', this.relais.switches)
    if (this.relais.switches.some(e => isCoolType(e.type) && e.active)) {
      this.platform.logger.debug('system state is heating, turn off COOL')
      await this.relais.activate(SwitchTypeEnum.NONE)
    }
    // The system is currently heating
    if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.HEAT) {
      this.platform.logger.debug('Thermostat.handleHeatState() -- The system is currently heating')
      // check if all relais are active
      if (this.relais.switches.some(e => isHeatType(e.type) && !e.active)) {
        this.platform.logger.warn('Thermostat.handleHeatState() -- HEAT is active but some relais are not activated!')
        await this.relais.activate(SwitchTypeEnum.HEAT)
      }
      // check if we need to shutdown heater for reaching maximum temperature
      this.platform.logger.debug('Thermostat.handleHeatState() -- Check if target temperature has not been reached')
      if (currentTemp >= this.thresholds.heatingMax) {
        this.platform.logger.debug('Thermostat.handleHeatState() -- turn off heating since target has been reached, don\'t change target')
        try {
          await this.relais.activate(SwitchTypeEnum.NONE)
          this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF
          this.retries = 0
        } catch {
          this.platform.logger.error('Thermostat.handleHeatState() -- Error while turning off the heater, try again next cycle.')
          this.retries++
        }
      }
    }
    // The system is currently off
    else if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.OFF) {
      this.platform.logger.debug('Thermostat.handleHeatState() -- The system is currently off')
      // check if all relais are inactive
      if (this.relais.switches.some(e => isHeatType(e.type) && e.active)) {
        this.platform.logger.warn('Thermostat.handleHeatState() -- NONE is active but some relais are activated!')
        await this.relais.activate(SwitchTypeEnum.NONE)
      }
      // check if temperature has drifted below an acceptable temperature.
      this.platform.logger.debug('Thermostat.handleHeatState() -- Check if temperature has drifted below an acceptable temperature range')
      if (currentTemp <= this.thresholds.heatingMin) {
        // tslint:disable-next-line: max-line-length
        this.platform.logger.debug('Thermostat.handleHeatState() -- turn on heating since min target has been reached, don\'t change target')
        try {
          await this.relais.activate(SwitchTypeEnum.HEAT)
          this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.HEAT
          this.retries = 0
        } catch {
          this.platform.logger.error('Thermostat.handleHeatState() -- Error while turning off the heater, try again next cycle.')
          this.retries++
        }
      } // else if (currentTemp <= this.TargetTemperature) {
      // tslint:disable-next-line: max-line-length
      //   this.platform.logger.debug('Thermostat.handleHeatState() -- turn on heating since current temperature is below the target temperature')
      //   try {
      //     this.relais.activate(SwitchTypeEnum.HEAT)
      //     this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.HEAT
      //     this.retries = 0
      //   } catch {
      //     this.platform.logger.error('Thermostat.handleHeatState() -- Error while turning off the heater, try again next cycle.')
      //     this.retries++
      //   }
      // }
    }

    this.platform.logger.debug('Thermostat.handleHeatState() -- end')
  }

  private calculateHeatIndex(temperature: number, relativeHumidity: number): number {
    const T = (temperature * 1.8) + 32
    const RH = relativeHumidity
    let ADJUSTMENT = 0
    let HI = 0.5 * (T + 61.0 + ((T - 68.0) * 1.2) + (RH * 0.094))

    if ((HI + T) / 2 >= 80) {
      // tslint:disable-next-line: max-line-length
      HI = -42.379 + 2.04901523 * T + 10.14333127 * RH - .22475541 * T * RH - .00683783 * T * T - .05481717 * RH * RH + .00122874 * T * T * RH + .00085282 * T * RH * RH - .00000199 * T * T * RH * RH

      if (T >= 80 && T <= 112 && RH <= 13) {
        ADJUSTMENT = -1 * (((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95.)) / 17))
      } else if (T >= 80 && T <= 87 && RH >= 85) {
        ADJUSTMENT = ((RH - 85) / 10) * ((87 - T) / 5)
      }
    }

    return ((HI + ADJUSTMENT - 32) / 1.8)
  }

  private calculateWindChillFactor(temperature: number, velocity: number) {
    const T: number = temperature
    const V: number = velocity * 3.6
    return 13.12 + (0.6215 * T) - 11.37 * Math.pow(V, 0.16) + (0.3965 * T) * Math.pow(V, 0.16)
  }

  private async writeTemperatureHistoryAsync(): Promise<void> {
    await new FileSystem().writeFile('temperature-history.json', Buffer.from(JSON.stringify(this.temperatureHistory, null, 2)))
  }

  private get sensorUrl() {
    return `https://api.jamievangeysel.be/v1/neo/devices/${this.instance.temperatureSensor}/data`
  }

  /**
   * @description
   * https://shop.hellowynd.com/products/halo-home-purifier-bundle
   * https://airthinx.io/iaq/
   * @readonly
   * @private
   * @type {TemperatureThresholds}
   * @memberof Thermostat
   */
  private get thresholds() {
    // 5.2.3.3.2

    // We have forecast data, we will add this data to out calculation to ensure nicer living conditions
    // temperature sensor heights .1m, .6m, 1.1m, 1.7m
    // vertical temp difference
    // const tempVerticalDeltaStanding = 4.0
    // const tempVerticalDeltaSitting = 3.0

    // fan speed calculations for temperature
    // const maxFanSpeed = 0.8 // at temperature 25.5
    // const minFanSpeed = 0.15 // at temperature 22.5

    // const minFloorTemp = 19
    // const maxFloorTemp = 29
    // Maximum temperature delta during cycling temperature when cycle in 15minutes, otherwise use ramp stats
    const maxTemperatureCycleDelta = 1.1
    const correctionTemp = maxTemperatureCycleDelta / 4
    // Temperature drift(ramp) max during warming up or cooling down.
    const maxQuarterTemperatureDelta = 1.1
    const maxHalfHourTemperatureDelta = 1.7
    const maxOneHourTemperatureDelta = 2.2
    const maxTwoHourTemperatureDelta = 2.8
    const maxFourHourTemperatureDelta = 3.3

    const Ta = this.CurrentTemperature // air temperature measured with dry bulb
    const currentTemp = this.CurrentTemperature // air temperature measured with dry bulb
    if (this.currentForecast) {
      const Tr = this.CurrentTemperature // median temperature

      const v = 50.49 - (4.4047 * Ta) + (0.096425 * Math.pow(Ta, 2))
      this.platform.logger.debug(`Thermostat.thresholds -- Desired fan speed: ${v}m/s.`)

      /** @type {number} Operating temperature */
      let To
      if (v < 0.1) {
        To = (Ta + Tr) / 2
      } else {
        To = (Tr + (Ta * Math.sqrt(10 * v))) / (1 + Math.sqrt(10 * v))
      }
      this.platform.logger.debug(`Thermostat.thresholds -- Operating Temperature: ${To}`)

    } else {
      // There is no forecast data, apiKey is not set or there are connection issues.
    }
    // const setTemp = this.TargetTemperature + (this.outsideWeather.main.temp * 0.0633)
    // const tempLow = this.CurrentTemperature <= (setTemp - maxTemperatureCycleDelta / 2)
    // const tempHigh = this.CurrentTemperature > (setTemp + maxTemperatureCycleDelta / 2)

    // calculate min and max HEAT and COOL thresholds based on target temperature.
    // Later we will add integrations with outside temperature, humidity and history
    // cool down and warm up periods and future weather forecast

    // calculate dynamic heating and colling min and max based on delta's
    const heatingMax = this.TargetTemperature + (maxTemperatureCycleDelta / 2) - (correctionTemp / 2)
    const heatingMin = this.TargetTemperature - (maxTemperatureCycleDelta / 2) + correctionTemp
    const coolingMax = this.TargetTemperature + (maxTemperatureCycleDelta / 2) - (correctionTemp / 2)
    const coolingMin = this.TargetTemperature - (maxTemperatureCycleDelta / 2) + correctionTemp

    // let heatingMinTH = 0
    // let heatingMaxTH = 0
    // let coolingMinTH = 0
    // let coolingMaxTH = 0

    const deltas = this.temperatureDeltas

    // check if there is a delta history if not run cold start
    if (this.temperatureHistory.length > 0) {
      // calculate the heating Minimum based on temperature delta's and normal operating temperatures
      // if history min temp is lower than allowed min set history min to current min
      const lowestDelta = Math.min(
        deltas.quarterTemperatureDelta.min,
        deltas.halfHourTemperatureDelta.min,
        deltas.oneHourTemperatureDelta.min,
        deltas.twoHourTemperatureDelta.min,
        deltas.fourHourTemperatureDelta.min
      )
      if (lowestDelta < heatingMin) {
        // heatingMinTH = lowestDelta
        // heatingMaxTH = heatingMinTH + maxTemperatureCycleDelta - correctionTemp
      }
    } else {
      // HEATING cold start set min to current temp is lower than allowed min temp
      if (currentTemp < heatingMin) {
        // curent temp is lower then allowed minimum
        // heatingMinTH = currentTemp
        // heatingMaxTH = heatingMinTH + maxTemperatureCycleDelta - correctionTemp
      } else {
        // heatingMinTH = heatingMin
        // heatingMaxTH = heatingMax
      }

      // COOLING cold start set max to current temp is higher than allowed max temp
      // if (currentTemp > coolingMax) {
      //   coolingMaxTH = currentTemp
      //   coolingMinTH = coolingMaxTH - maxTemperatureCycleDelta + correctionTemp
      // } else {
      //   coolingMinTH = coolingMin
      //   coolingMaxTH = coolingMax
      // }
    }

    return {
      heatingMax, // : heatingMaxTH,
      heatingMin, // : heatingMinTH,
      coolingMax,
      coolingMin,
      deltaMax: {
        quarter: maxQuarterTemperatureDelta,
        halfHour: maxHalfHourTemperatureDelta,
        oneHour: maxOneHourTemperatureDelta,
        twoHours: maxTwoHourTemperatureDelta,
        fourHours: maxFourHourTemperatureDelta
      }
    }
  }

  private get instance(): IThermostatInstanceConfig {
    const thisInstance = (config: IThermostatInstanceConfig) => (config.name ?? 'default') === this.instance_name
    return this.platform.config.instances.find(thisInstance)
  }

  private get temperatureDeltas() {
    /** @type {number} */
    const now = new Date().getTime()
    const hisAll = this.temperatureHistory
    const hisLFH = hisAll.filter(e => e.date >= new Date(now - 14400000))
    const hisLTH = hisLFH.filter(e => e.date >= new Date(now - 7200000))
    const hisLOH = hisLTH.filter(e => e.date >= new Date(now - 3600000))
    const hisLHH = hisLOH.filter(e => e.date >= new Date(now - 1800000))
    const hisLQu = hisLHH.filter(e => e.date >= new Date(now - 900000))

    // tslint:disable-next-line: max-line-length
    const quTDm = Math.min(...hisLQu.map(e => e.temperature))
    const quTDM = Math.max(...hisLQu.map(e => e.temperature))
    const hHTDm = Math.min(...hisLHH.map(e => e.temperature))
    const hHTDM = Math.max(...hisLHH.map(e => e.temperature))
    const oHTDm = Math.min(...hisLOH.map(e => e.temperature))
    const oHTDM = Math.max(...hisLOH.map(e => e.temperature))
    const tHTDm = Math.min(...hisLTH.map(e => e.temperature))
    const tHTDM = Math.max(...hisLTH.map(e => e.temperature))
    const fHTDm = Math.min(...hisLFH.map(e => e.temperature))
    const fHTDM = Math.max(...hisLFH.map(e => e.temperature))

    return {
      quarterTemperatureDelta: {
        min: quTDm,
        max: quTDM,
        delta: quTDM - quTDm
      },
      halfHourTemperatureDelta: {
        min: hHTDm,
        max: hHTDM,
        delta: hHTDM - hHTDm
      },
      oneHourTemperatureDelta: {
        min: oHTDm,
        max: oHTDM,
        delta: oHTDM - oHTDm
      },
      twoHourTemperatureDelta: {
        min: tHTDm,
        max: tHTDM,
        delta: tHTDM - tHTDm
      },
      fourHourTemperatureDelta: {
        min: fHTDm,
        max: fHTDM,
        delta: fHTDM - fHTDm
      }
    }
  }

  /**
   * https://www.wrh.noaa.gov/psr/general/safety/heat/heatindex.png
   * https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
   */
  get HeatIndex() {
    return this.calculateHeatIndex(this.CurrentTemperature, this.CurrentRelativeHumidity)
  }

  private get state(): ThermostatState {
    return this.instance.thermostatState
  }

  // private set state(value: ThermostatState) {
  //   this.instance.thermostatState = value
  // }

  public get Name(): string {
    return this.instance_name
  }

  get State(): ThermostatState {
    return this.state
  }

  get ErrorStatus(): ThermostatErrorStatus | null {
    const error = this.sensorErrorStatus ?? this.relayErrorStatus
    if (!error) return null
    return {
      ...error,
      sensorMaxAgeMs: this.sensorMaxAgeMs,
      lastValidSampleAt: this.lastValidSensorAtMs === undefined
        ? null
        : new Date(this.lastValidSensorAtMs).toISOString(),
      sampleAgeMs: this.lastValidSensorAtMs === undefined
        ? null
        : Math.max(0, Date.now() - this.lastValidSensorAtMs),
      mqttReportedRelays: this.relais.mqttReportedRelays
    }
  }

  get CurrentTemperature(): number {
    return this.state.currentTemperature
  }

  get CurrentRelativeHumidity(): number {
    return this.state.currentRelativeHumidity
  }

  get TargetTemperature(): number {
    return this.state.targetTemperature
  }

  set TargetTemperature(value: number) {
    this.state.targetTemperature = value
    this.evaluateChanges().then()
  }

  get CurrentHeatingCoolingState(): HeatingCoolingStateEnum {
    return this.state.currentHeatingCoolingState
  }

  get TargetHeatingCoolingState(): HeatingCoolingStateEnum {
    return this.state.targetHeatingCoolingState
  }

  set TargetHeatingCoolingState(value: HeatingCoolingStateEnum) {
    const changed = this.state.targetHeatingCoolingState !== value
    this.state.targetHeatingCoolingState = value
    if (changed) this.recordShadowSample(Date.now())
    this.evaluateChanges()
  }

}

export interface ThermostatState {
  currentTemperature: number
  currentRelativeHumidity: number
  targetTemperature: number
  currentHeatingCoolingState: HeatingCoolingStateEnum
  targetHeatingCoolingState: HeatingCoolingStateEnum
  temperatureDisplayUnits: TemperatureDisplayUnits
}

export interface ThermostatErrorStatus {
  code: 'SENSOR_INVALID' | 'SENSOR_STALE' | 'SENSOR_MQTT_ERROR' | 'RELAY_COMMAND_FAILED'
  message: string
  at: string
  requestedOffPinIndexes?: number[]
  relayCommandFailures?: { pinIndex: number; message: string }[]
  relayCommandConfirmation?: string
  sensorMaxAgeMs?: number
  lastValidSampleAt?: string | null
  sampleAgeMs?: number | null
  mqttReportedRelays?: { pinIndex: number; type: string; state: 'ON' | 'OFF' | 'UNKNOWN'; reportedAt?: string }[]
}

export interface TemperatureThresholds {
  heatingMin: number
  heatingMax: number
  coolingMin: number
  coolingMax: number
  deltaMax: {
    quarter: number
    halfHour: number
    oneHour: number
    twoHours: number
    fourHours: number
  }
}

export enum HeatingCoolingStateEnum {
  OFF = 0,
  HEAT = 1,
  COOL = 2,
  AUTO = 3
}

export enum TemperatureDisplayUnits {
  CELSIUS = 0,
  FAHRENHEIT = 1
}

/**
 * @description Device Response from Neo Api
 * @class DeviceReponse
 */
export interface DeviceReponse {
  uuid: string
  name: string
  mac: string
  firstSeen: Date
  lastSeen: Date
  localIp: string
  ipv4: string
  ipv6: string
  ownerUuid: string
  temperature: number
  humidity: number
  pressure: number
  icon: string
  hwVersion: string
  fwVersion: string
  checkUpdates: boolean
  autoUpdate: number
  logLevel: number
  hwSupported: boolean
}

export interface TemperatureDeltaHistory {
  quarterTemperatureDelta: TemperatureDeltaHistoryEntry
  halfHourTemperatureDelta: TemperatureDeltaHistoryEntry
  oneHourTemperatureDelta: TemperatureDeltaHistoryEntry
  twoHourTemperatureDelta: TemperatureDeltaHistoryEntry
  fourHourTemperatureDelta: TemperatureDeltaHistoryEntry
}

export interface TemperatureDeltaHistoryEntry {
  min: number
  max: number
  delta: number
}
