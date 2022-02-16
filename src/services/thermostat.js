const fetch = require('cross-fetch')
const FileSystem = require('./filesystem').default
const { Relais, SwitchTypeEnum } = require('./relais')
const WeatherInfoService = require('./weather-info').default

/**
 * @description Thermostat
 * @export
 * @class Thermostat
 */
class Thermostat {
  /**
   * @description
   * @private
   * @type {Platform}
   * @memberof Thermostat
   */
  platform

  // woonkamer: 6d5b00c42c530b3469b04779146c0b97a723cb2524b60b07e5c327596ebd8f6baebca6bb79a2f1ce24e5a88d7426658a
  /**
   * @description
   * @private
   * @type {Relais}
   * @memberof Thermostat
   */
  relais

  /**
   * @description
   * @private
   * @type {WeatherInfoService}
   * @memberof Thermostat
   */
  weatherInfo

  /**
   * @description
   * @private
   * @type {number}
   * @memberof Thermostat
   */
  retries = 0

  /**
   * @description
   * @private
   * @type {OpenWeatherMapResponse}
   * @memberof Thermostat
   */
  currentForecast

  /**
   * @description
   * @private
   * @type {{ date: Date, temperature: number }[]}
   * @memberof Thermostat
   */
  temperatureHistory = []
  /**
   * @description
   * @private
   * @memberof Thermostat
   */
  fs = new FileSystem()

  /**
   * Creates an instance of Thermostat.
   * @param {Platform} platform
   * @memberof Thermostat
   */
  constructor(platform) {
    this.platform = platform

    this.platform.logger.debug(`Thermostat.constructor() -- Constructed new instance of Thermostat()`)
    // get initial data from azure
    this.getSensorData()

    this.relais = new Relais(this.platform)

    this.relais.on('update', (switches) => {
      this.platform.config.relais.switches = switches
    })

    // check if loggin file exists, if not create csv file
    this.fs.exists('data-log.csv').then(async (logExists) => {
      if (!logExists) {
        // if the file does not exist create file with apropriate csv headers
        await this.fs.writeFile('data-log.csv', Buffer.from('date,state,target-state,temperature,target-temperature,outside-temperature,heat-index\n'))
        await this.fs.writeAppendFile('data-log.csv', Buffer.from(`${new Date().toISOString().replace('T', ' ').substring(0, 19)},${this.state.currentHeatingCoolingState},${this.state.targetHeatingCoolingState},${this.state.currentTemperature},${this.state.targetTemperature},${this.currentForecast ? this.currentForecast.main.temp : 0},${this.HeatIndex}\n`))
      }
    }, rej => {
      this.platform.logger.error(rej)
    }).catch(err => {
      this.platform.logger.error(err.message)
    })

    this.weatherInfo = new WeatherInfoService(this.platform)
    this.weatherInfo.on('forecast', async (forecast) => {
      this.platform.logger.debug(`Thermostat.weatherInfo.on('forecast')`, forecast.main)
      try {
        const ok = await this.platform.database.insertIntoCollection('forecastHistory', {
          date: new Date(),
          forecast
        })

        if (ok) {
          this.platform.logger.log(`Thermostat.weatherInfo.on('forecast') -- Succesfully added forecast to forecastHistory in DB.`)
        }
      } catch (err) {
        this.platform.logger.error(`Thermostat.weatherInfo.on('forecast') -- Error adding forecast to DB!`)
      }
      this.currentForecast = forecast
      this.platform.logger.debug(`Outside heat index: `, this.calculateHeatIndex(forecast.main.temp, forecast.main.humidity))
      this.platform.logger.debug(`Outside wind chill factor: `, this.calculateWindChillFactor(forecast.main.temp, forecast.wind.speed))
    })

    // set update interval fur current temperature to 1 minute
    setInterval(async () => {
      await this.getSensorData()
      await this.fs.writeAppendFile('data-log.csv', Buffer.from(`${new Date().toISOString().replace('T', ' ').substring(0, 19)},${this.state.currentHeatingCoolingState},${this.state.targetHeatingCoolingState},${this.state.currentTemperature},${this.state.targetTemperature},${this.currentForecast ? this.currentForecast.main.temp : 0},${this.HeatIndex}\n`))
    }, 60000)
  }

  async getSensorData() {
    try {
      const result = await fetch(this.sensorUrl)
      /** @type {DeviceReponse} */
      const data = (await result.json())
      /** @type {Date} */
      const lastSeen = data.lastSeen

      // data.temperature -= .2

      this.state.currentTemperature = data.temperature
      this.state.currentRelativeHumidity = data.humidity
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
            temperature: data.temperature
          })
          this.writeTemperatureHistoryAsync()
          this.platform.logger.info('Thermostat.getSensorData() -- saving temperature into temperatureHistory.')
        } else {
          this.platform.logger.warn(`Thermostat.getSensorData() -- returned stale data, skipping insert to history.`)
        }
      } else {
        this.temperatureHistory.push({
          date: new Date(`${lastSeen}Z`),
          temperature: data.temperature
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

  /**
   * @description
   * @private
   * @param {number} currentTemp
   * @memberof Thermostat
   */
  async handleHeatState(currentTemp) {
    this.platform.logger.debug('Thermostat.handleHeatState() -- start')

    this.platform.logger.debug('Thermostat.handleHeatState() -- targetHeatingCoolingState is HEAT, check if currently heating')
    this.platform.logger.debug('Thermostat.handleHeatState() -- config ', this.platform.config.relais.switches)
    if (this.platform.config.relais.switches.some(e => e.type === SwitchTypeEnum.COOL && e.active)) {
      this.platform.logger.debug('system state is heating, turn off COOL')
      this.relais.activate(SwitchTypeEnum.NONE)
    }
    // The system is currently heating
    if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.HEAT) {
      this.platform.logger.debug('Thermostat.handleHeatState() -- The system is currently heating')
      // check if all relais are active
      if (this.platform.config.relais.switches.some(e => e.type === SwitchTypeEnum.HEAT && !e.active)) {
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
      if (this.platform.config.relais.switches.some(e => e.type === SwitchTypeEnum.HEAT && e.active)) {
        this.platform.logger.warn('Thermostat.handleHeatState() -- NONE is active but some relais are activated!')
        this.relais.activate(SwitchTypeEnum.NONE)
      }
      // check if temperature has drifted below an accepteble temperature.
      this.platform.logger.debug('Thermostat.handleHeatState() -- Check if temperature has driftped below an acceptable temperature range')
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

  /**
   * @description
   * @private
   * @param {number} temperature
   * @param {number} relativeHumidity
   * @return {*} 
   * @memberof Thermostat
   */
  calculateHeatIndex(temperature, relativeHumidity) {
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

  /**
   * @description
   * @private
   * @param {number} temperature
   * @param {number} velocity
   * @return {*} 
   * @memberof Thermostat
   */
  calculateWindChillFactor(temperature, velocity) {
    const T = temperature
    const V = velocity * 3.6
    return 13.12 + (0.6215 * T) - 11.37 * Math.pow(V, 0.16) + (0.3965 * T) * Math.pow(V, 0.16)
  }

  /**
   * @description
   * @private
   * @memberof Thermostat
   */
  async writeTemperatureHistoryAsync() {
    await new FileSystem().writeFile('temperature-history.json', Buffer.from(JSON.stringify(this.temperatureHistory, null, 2)))
  }

  /**
   * @description
   * @readonly
   * @private
   * @memberof Thermostat
   */
  get sensorUrl() {
    return `http://napi.jamievangeysel.be/v1/neo/devices/${this.platform.config.temperatureSensor}`
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
  get thresholds() {
    // 5.2.3.3.2

    // We have forecast data, we will add this data to out calculation to ensure nicer living conditions
    // temperature sensor heights .1m, .6m, 1.1m, 1.7m
    // vertical temp difference
    const tempVerticalDeltaStanding = 4.0
    const tempVerticalDeltaSitting = 3.0

    // fan speed calculations for temperature
    const maxFanSpeed = 0.8 // at temperature 25.5
    const minFanSpeed = 0.15 // at temperature 22.5

    const minFloorTemp = 19
    const maxFloorTemp = 29
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
      const Tr = this.CurrentTemperature // mean diant temperature

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

    let heatingMinTH = 0
    let heatingMaxTH = 0
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
        heatingMinTH = lowestDelta
        heatingMaxTH = heatingMinTH + maxTemperatureCycleDelta - correctionTemp
      }
    } else {
      // HEATING cold start set min to current temp is lower than allowed min temp
      if (currentTemp < heatingMin) {
        // curent temp is lower then allowed minimum
        heatingMinTH = currentTemp
        heatingMaxTH = heatingMinTH + maxTemperatureCycleDelta - correctionTemp
      } else {
        heatingMinTH = heatingMin
        heatingMaxTH = heatingMax
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

  /**
   * @description
   * @readonly
   * @private
   * @type {TemperatureDeltaHistory}
   * @memberof Thermostat
   */
  get temperatureDeltas() {
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
   * @description
   * https://www.wrh.noaa.gov/psr/general/safety/heat/heatindex.png
   * https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
   * @readonly
   * @type {number}
   * @memberof Thermostat
   */
  get HeatIndex() {
    return this.calculateHeatIndex(this.CurrentTemperature, this.CurrentRelativeHumidity)
  }

  /**
   * @description
   * @private
   * @type {ThermostatState}
   * @memberof Thermostat
   */
  get state() {
    return this.platform.config.thermostatState
  }

  /**
   * @description
   * @param {ThermostatState} value
   * @private
   * @memberof Thermostat
   */
  set state(value) {
    this.platform.config.thermostatState = value
  }

  /**
   * @description
   * @readonly
   * @type {ThermostatState}
   * @memberof Thermostat
   */
  get State() {
    return this.state
  }

  /**
   * @description
   * @readonly
   * @type {number}
   * @memberof Thermostat
   */
  get CurrentTemperature() {
    return this.state.currentTemperature
  }

  /**
   * @description
   * @readonly
   * @type {number}
   * @memberof Thermostat
   */
  get CurrentRelativeHumidity() {
    return this.state.currentRelativeHumidity
  }

  /**
   * @description
   * @type {number}
   * @memberof Thermostat
   */
  get TargetTemperature() {
    return this.state.targetTemperature
  }

  /**
   * @description
   * @param {number} value
   * @memberof Thermostat
   */
  set TargetTemperature(value) {
    this.state.targetTemperature = value
    this.evaluateChanges()
  }

  /**
   * @description
   * @readonly
   * @type {HeatingCoolingStateEnum}
   * @memberof Thermostat
   */
  get CurrentHeatingCoolingState() {
    return this.state.currentHeatingCoolingState
  }

  /**
   * @description
   * @type {HeatingCoolingStateEnum}
   * @memberof Thermostat
   */
  get TargetHeatingCoolingState() {
    return this.state.targetHeatingCoolingState
  }

  /**
   * @description
   * @param {HeatingCoolingStateEnum} value
   * @memberof Thermostat
   */
  set TargetHeatingCoolingState(value) {
    this.state.targetHeatingCoolingState = value
    this.evaluateChanges()
  }
}

/**
 * @description
 * @class ThermostatState
 */
class ThermostatState {
  /**
   * @description
   * @type {number}
   * @memberof ThermostatState
   */
  currentTemperature
  /**
   * @description
   * @type {number}
   * @memberof ThermostatState
   */
  currentRelativeHumidity
  /**
   * @description
   * @type {number}
   * @memberof ThermostatState
   */
  targetTemperature
  /**
   * @description
   * @type {HeatingCoolingStateEnum}
   * @memberof ThermostatState
   */
  currentHeatingCoolingState
  /**
   * @description
   * @type {HeatingCoolingStateEnum}
   * @memberof ThermostatState
   */
  targetHeatingCoolingState
  /**
   * @description
   * @type {TemperatureDisplayUnits}
   * @memberof ThermostatState
   */
  temperatureDisplayUnits
}
/**
 * @description
 * @class TemperatureThresholds
 */
class TemperatureThresholds {
  /**
   * @description
   * @type {number}
   * @memberof TemperatureThresholds
   */
  heatingMin
  /**
   * @description
   * @type {number}
   * @memberof TemperatureThresholds
   */
  heatingMax
  /**
   * @description
   * @type {number}
   * @memberof TemperatureThresholds
   */
  coolingMin
  /**
   * @description
   * @type {number}
   * @memberof TemperatureThresholds
   */
  coolingMax
  /**
   * @description
   * @type {{
   *     quarter: number
   *     halfHour: number
   *     oneHour: number
   *     twoHours: number
   *     fourHours: number
   *   }}
   * @memberof TemperatureThresholds
   */
  deltaMax
}

const HeatingCoolingStateEnum = {
  OFF: 0,
  HEAT: 1,
  COOL: 2,
  AUTO: 3
}

const TemperatureDisplayUnits = {
  CELSIUS: 0,
  FAHRENHEIT: 1
}

/**
 * @description Device Response from Neo Api
 * @class DeviceReponse
 */
class DeviceReponse {
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  uuid
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  name
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  mac
  /**
   * @type {Date}
   * @memberof DeviceReponse
   */
  firstSeen
  /**
   * @type {Date}
   * @memberof DeviceReponse
   */
  lastSeen
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  localIp
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  ipv4
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  ipv6
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  ownerUuid
  /**
   * @type {number}
   * @memberof DeviceReponse
   */
  temperature
  /**
   * @type {number}
   * @memberof DeviceReponse
   */
  humidity
  /**
   * @type {number}
   * @memberof DeviceReponse
   */
  pressure
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  icon
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  hwVersion
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  fwVersion
  /**
   * @type {boolean}
   * @memberof DeviceReponse
   */
  checkUpdates
  /**
   * @type {number}
   * @memberof DeviceReponse
   */
  autoUpdate
  /**
   * @type {string}
   * @memberof DeviceReponse
   */
  logLevel
  /**
   * @type {boolean}
   * @memberof DeviceReponse
   */
  hwSupported
}

class TemperatureDeltaHistory {
  /**
   * @description
   * @type {TemperatureDeltaHistoryEntry}
   * @memberof TemperatureDeltaHistory
   */
  quarterTemperatureDelta
  /**
   * @description
   * @type {TemperatureDeltaHistoryEntry}
   * @memberof TemperatureDeltaHistory
   */
  halfHourTemperatureDelta
  /**
   * @description
   * @type {TemperatureDeltaHistoryEntry}
   * @memberof TemperatureDeltaHistory
   */
  oneHourTemperatureDelta
  /**
   * @description
   * @type {TemperatureDeltaHistoryEntry}
   * @memberof TemperatureDeltaHistory
   */
  twoHourTemperatureDelta
  /**
   * @description
   * @type {TemperatureDeltaHistoryEntry}
   * @memberof TemperatureDeltaHistory
   */
  fourHourTemperatureDelta
}

class TemperatureDeltaHistoryEntry {
  /**
   * @description
   * @type {number}
   * @memberof TemperatureDeltaHistoryEntry
   */
  min
  /**
   * @description
   * @type {number}
   * @memberof TemperatureDeltaHistoryEntry
   */
  max
  /**
   * @description
   * @type {number}
   * @memberof TemperatureDeltaHistoryEntry
   */
  delta
}

module.exports = {
  default: Thermostat
}