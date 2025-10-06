import { Relais } from './relais'
import { Platform } from '../platform'
import { FileSystem } from './filesystem'
import { OpenWeatherMapResponse, WeatherInfoService } from './weather-info'
import { isCoolType, isHeatType, IThermostatInstanceConfig, SwitchTypeEnum } from './config'
import { connect } from 'mqtt'

export class Thermostat {
  private readonly platform: Platform
  private readonly fs: FileSystem = new FileSystem()
  private readonly relais: Relais
  private weatherInfo: WeatherInfoService
  private retries: number = 0
  private currentForecast: OpenWeatherMapResponse
  private temperatureHistory: { date: Date, temperature: number }[] = []

  private readonly instance_name: string

  constructor(platform: Platform, instance_name: string = 'default') {
    this.platform = platform
    this.instance_name = instance_name

    this.platform.logger.debug(`Thermostat.constructor() -- Constructed new instance of Thermostat()`)
    // get initial data from azure
    // this.getSensorData().then()

    this.relais = new Relais(this.platform, this.instance.switches)

    this.relais.on('update', (switches) => {
      this.instance.switches = switches
    })

    // check if logging file exists, if not create csv file
    this.fs.exists('data-log.csv').then(async (logExists) => {
      if (!logExists) {
        // if the file does not exist create file with appropriate csv headers
        await this.fs.writeFile('data-log.csv', Buffer.from('date,state,target-state,temperature,target-temperature,outside-temperature,heat-index\n'))
        await this.fs.writeAppendFile('data-log.csv', Buffer.from(`${new Date().toISOString().replace('T', ' ').substring(0, 19)},${this.state.currentHeatingCoolingState},${this.state.targetHeatingCoolingState},${this.state.currentTemperature},${this.state.targetTemperature},${this.currentForecast ? this.currentForecast.main.temp : 0},${this.HeatIndex}\n`))
      }
    }, rej => {
      this.platform.logger.error(rej)
    }).catch(err => {
      this.platform.logger.error(err.message)
    })

    this.weatherInfo = new WeatherInfoService(this.platform)
    this.weatherInfo.on('forecast', async (forecast: any) => {
      this.platform.logger.debug(`Thermostat.weatherInfo.on('forecast')`, forecast.main)
      try {
        if (this.platform.database.enabled) {
          const ok = await this.platform.database.insertIntoCollection('forecastHistory', {
            date: new Date(),
            forecast
          })

          if (ok) {
            this.platform.logger.log(`Thermostat.weatherInfo.on('forecast') -- Successfully added forecast to forecastHistory in DB.`)
          }
        }
      } catch (err) {
        this.platform.logger.error(`Thermostat.weatherInfo.on('forecast') -- Error adding forecast to DB!`)
      }
      this.currentForecast = forecast
      this.platform.logger.debug(`Outside heat index: `, this.calculateHeatIndex(forecast.main.temp, forecast.main.humidity))
      this.platform.logger.debug(`Outside wind chill factor: `, this.calculateWindChillFactor(forecast.main.temp, forecast.wind.speed))
    })

    // 03D3CE : Mathijs
    // D6C1AD : Kitchen
    // 3B2702 : Living


    const topic = (this.instance.temperatureSensor === '68bc45c0f8dd63bd13a54c511242b2eead672bcbb3358c2e747a95b189bff31e1450908a61ed6ea3f33efb69c2b510f7' ? '3B2702' : '03D3CE') + '/sensor'

    let client = connect('mqtt://localhost:1883')
    client.on('connect', () => {
      this.platform.logger.info('Connected to MQTT server')

      client.subscribe([topic], () => {
        this.platform.logger.debug(`Subscribe to topic '${topic}'`)
      })
    })

    client.on('message', async (topic, payload) => {
      this.platform.logger.debug('Received Message:', topic, payload.toString())

      const data = JSON.parse(payload.toString())

      this.state.currentTemperature = +data.temperature
      this.state.currentRelativeHumidity = +data.humidity
      await this.fs.writeAppendFile('data-log.csv', Buffer.from(`${new Date().toISOString().replace('T', ' ').substring(0, 19)},${this.state.currentHeatingCoolingState},${this.state.targetHeatingCoolingState},${this.state.currentTemperature},${this.state.targetTemperature},${this.currentForecast ? this.currentForecast.main.temp : 0},${this.HeatIndex}\n`))

      await this.evaluateChanges()
    })

    // set update interval fur current temperature to 1 minute
    // setInterval(async () => {
    //   await this.getSensorData()
    //   await this.fs.writeAppendFile('data-log.csv', Buffer.from(`${new Date().toISOString().replace('T', ' ').substring(0, 19)},${this.state.currentHeatingCoolingState},${this.state.targetHeatingCoolingState},${this.state.currentTemperature},${this.state.targetTemperature},${this.currentForecast ? this.currentForecast.main.temp : 0},${this.HeatIndex}\n`))
    // }, 60000)
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
    // Changed back to current temp instead of Heat Index
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
          this.state.currentHeatingCoolingState = this.state.targetHeatingCoolingState

          // If any relais is still powered on, turn them off
          this.relais.activate(SwitchTypeEnum.NONE)
          return

        case HeatingCoolingStateEnum.HEAT:
          this.platform.logger.debug(`Thermostat.evaluateChanges() -- handleHeatState`)
          await this.handleHeatState(currentTemp)
          return

        case HeatingCoolingStateEnum.COOL:
          this.platform.logger.debug('Thermostat.evaluateChanges() -- Target is cooling, check if currently cooling')
          this.relais.activate(SwitchTypeEnum.NONE)
          if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.COOL) {
            this.platform.logger.debug('Thermostat.evaluateChanges() -- Check if target temperature has been reached')
            if (currentTemp <= this.thresholds.coolingMin) {
              this.platform.logger.debug('Thermostat.evaluateChanges() -- turn off cooling since target has been reached, don\'t change target')
              try {
                this.relais.activate(SwitchTypeEnum.NONE)
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
                this.relais.activate(SwitchTypeEnum.COOL)
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
    }
  }

  private async handleHeatState(currentTemp: number) {
    this.platform.logger.debug('Thermostat.handleHeatState() -- start')

    this.platform.logger.debug('Thermostat.handleHeatState() -- targetHeatingCoolingState is HEAT, check if currently heating')
    this.platform.logger.debug('Thermostat.handleHeatState() -- config ', this.relais.switches)
    if (this.relais.switches.some(e => isCoolType(e.type) && e.active)) {
      this.platform.logger.debug('system state is heating, turn off COOL')
      this.relais.activate(SwitchTypeEnum.NONE)
    }
    // The system is currently heating
    if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.HEAT) {
      this.platform.logger.debug('Thermostat.handleHeatState() -- The system is currently heating')
      // check if all relais are active
      if (this.relais.switches.some(e => isHeatType(e.type) && !e.active)) {
        this.platform.logger.warn('Thermostat.handleHeatState() -- HEAT is active but some relais are not activated!')
        this.relais.activate(SwitchTypeEnum.HEAT)
      }
      // check if we need to shutdown heater for reaching maximum temperature
      this.platform.logger.debug('Thermostat.handleHeatState() -- Check if target temperature has not been reached')
      if (currentTemp >= this.thresholds.heatingMax) {
        this.platform.logger.debug('Thermostat.handleHeatState() -- turn off heating since target has been reached, don\'t change target')
        try {
          this.relais.activate(SwitchTypeEnum.NONE)
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
        this.relais.activate(SwitchTypeEnum.NONE)
      }
      // check if temperature has drifted below an acceptable temperature.
      this.platform.logger.debug('Thermostat.handleHeatState() -- Check if temperature has drifted below an acceptable temperature range')
      if (currentTemp <= this.thresholds.heatingMin) {
        // tslint:disable-next-line: max-line-length
        this.platform.logger.debug('Thermostat.handleHeatState() -- turn on heating since min target has been reached, don\'t change target')
        try {
          this.relais.activate(SwitchTypeEnum.HEAT)
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
    this.state.targetHeatingCoolingState = value
    this.evaluateChanges()
  }

  get HeatElementOn(): boolean {
    return this.relais.switches.find(e => e.type === SwitchTypeEnum.HEAT_ELEMENT)?.active ?? null
  }

  get HeatValveOn(): boolean {
    return this.relais.switches.find(e => e.type === SwitchTypeEnum.HEAT_VALVE)?.active ?? null
  }

  get WaterValveOn(): boolean {
    this.platform.logger.debug(`WaterValveOn() -- `, this.relais.switches, this.relais.switches.find(e => e.type === SwitchTypeEnum.WATER_VALVE))
    return this.relais.switches.find(e => e.type === SwitchTypeEnum.WATER_VALVE)?.active ?? null
  }

  set WaterValveOn(value: boolean) {
    this.platform.logger.debug('Set target state WaterValveOn to: ' + value)
    if (value)
      this.relais.activate(SwitchTypeEnum.WATER_VALVE)
    else
      this.relais.deactivate(SwitchTypeEnum.WATER_VALVE)
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
