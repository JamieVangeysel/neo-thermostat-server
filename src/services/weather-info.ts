import { EventEmitter } from 'events'
import type { Platform } from '../platform'

export class WeatherInfoService extends EventEmitter {
  private readonly platform: Platform
  private interval?: NodeJS.Timeout

  constructor(platform: Platform) {
    super()

    this.platform = platform
    this.platform.logger.debug(`WeatherInfoService() -- start`)
    this.platform.logger.debug(`WeatherInfoService() -- end`)
  }

  async start(): Promise<void> {
    if (this.interval) return
    const apiKey = this.platform.config.weatherMapApiKey?.trim()
    if (!apiKey) {
      this.platform.logger.warn('WeatherInfoService() -- no weatherMapApiKey configured, skip')
      return
    }
    this.platform.logger.debug('WeatherInfoService() -- has weatherMapApiKey, start interval')
    this.interval = setInterval(() => { void this.update() }, 300000)
    // Weather is optional and must not hold application startup open.
    void this.update()
    this.platform.logger.debug('WeatherInfoService.start() -- end')
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval)
      this.platform.logger.debug('WeatherInfoService.stop() -- cleared update interval')
    }
    this.interval = undefined
  }

  async update() {
    this.platform.logger.debug(`WeatherInfoService.update() -- start`)
    try {
      const forecast = await this.getForecastL(50.89323461766859, 5.31859673594343) // 50.89323461766859, 5.31859673594343
      this.emit('forecast', forecast)
    } catch (err) {
      this.emit('error', err)
    } finally {
      this.platform.logger.debug('WeatherInfoService.update() -- end')
    }
  }

  /**
   * @description query OpenWeatherMapAPi
   * @private
   * @param {number} lat
   * @param {number} lon
   * @return {Promise<OpenWeatherMapResponse>}
   * @memberof WeatherInfoService
   */
  async getForecastL(lat: number, lon: number): Promise<OpenWeatherMapResponse> {
    this.platform.logger.debug(`WeatherInfoService.getForecast() -- start`, lat, lon)
    const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?APPID=${this.platform.config.weatherMapApiKey}&units=metric&lat=${lat}&lon=${lon}`).then(r => r.json())
    this.platform.logger.debug(`WeatherInfoService.getForecast() -- end`)
    return await resp
  }

  /**
   * @description query OpenWeatherMapAPi
   * @private
   * @deprecated
   * @param {string} query example query => Hasselt,be
   * @return {Promise<OpenWeatherMapResponse>}
   * @memberof WeatherInfoService
   */
  async getForecast(query: string): Promise<OpenWeatherMapResponse> {
    this.platform.logger.debug(`WeatherInfoService.getForecast() -- start`, query)
    const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?APPID=${this.platform.config.weatherMapApiKey}&units=metric&q=${query}`).then(r => r.json())
    this.platform.logger.debug(`WeatherInfoService.getForecast() -- end`)
    return await resp
  }
}


export interface OpenWeatherMapResponse {
  coord: {
    lon: number
    lat: number
  }
  weather: {
    id: number
    main: string
    description: string
    icon: string
  }[]
  base: string
  main: {
    temp: number
    pressure: number
    humidity: number
    temp_min: number
    temp_max: number
  }
  visibility: number
  wind: {
    speed: number
    deg: number
  }
  clouds: {
    all: number
  }
  id: string
  name: string
  cod: number
}
