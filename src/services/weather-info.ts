import { EventEmitter } from 'events'
import { Platform } from '../platform'

export class WeatherInfoService extends EventEmitter {
  private readonly platform: Platform

  constructor(platform: Platform) {
    super()

    this.platform = platform
    this.platform.logger.debug(`WeatherInfoService() -- start`)
    if (platform.config.weatherMapApiKey && platform.config.weatherMapApiKey.trim().length > 0) {
      this.platform.logger.debug(`WeatherInfoService() -- has weatherMapApiKey, start interval`)
      this.startInterval()
    } else {
      this.platform.logger.warn(`WeatherInfoService() -- no weatherMapApiKey configured, skip `)
    }
    this.platform.logger.debug(`WeatherInfoService() -- end`)
  }

  private async startInterval() {
    this.platform.logger.debug(`WeatherInfoService.startInterval() -- start`)

    setInterval(async () => {
      try {
        const forecast = await this.getForecast('Hasselt,be')
        this.emit('forecast', forecast)
      } catch (err) {
        this.emit('error', err)
      }
    }, 300000)

    try {
      const forecast = await this.getForecast('Hasselt,be')
      this.emit('forecast', forecast)
    } catch (err) {
      this.emit('error', err)
    } finally {
      this.platform.logger.debug(`WeatherInfoService.startInterval() -- end`)
    }
  }

  /**
   * @description query OpenWeatherMapAPi
   * @private
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
