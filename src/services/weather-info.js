const fetch = require('cross-fetch')
const {
  EventEmitter
} = require('events')

class WeatherInfoService extends EventEmitter {
  /**
   * @description
   * @private
   * @type {Platform}
   * @memberof WeatherInfoService
   */
  platform

  /**
   * Creates an instance of WeatherInfoService.
   * @param {Platform} platform
   * @memberof WeatherInfoService
   */
  constructor(platform) {
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
  /**
   * @description
   * @private
   * @memberof WeatherInfoService
   */
  async startInterval() {
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
  async getForecast(query) {
    this.platform.logger.debug(`WeatherInfoService.getForecast() -- start`, query)
    const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?APPID=${this.platform.config.weatherMapApiKey}&units=metric&q=${query}`).then(r => r.json())
    this.platform.logger.debug(`WeatherInfoService.getForecast() -- end`)
    return await resp
  }
}

/**
 * 
 * @class OpenWeatherMapResponse
 */
class OpenWeatherMapResponse {
  /**
   * @default contains the coordinates of the requested weatherinfo response location
   * @type {{
   *     lon: number
   *     lat: number
   *   }}
   * @memberof OpenWeatherMapResponse
   */
  coord

  /**
   * @description
   * @type {{
   *     id: number
   *     main: string
   *     description: string
   *     icon: string
   *   } []}
   * @memberof OpenWeatherMapResponse
   */
  weather

  /**
   * @description
   * @type {string}
   * @memberof OpenWeatherMapResponse
   */
  base

  /**
   * @description contains main requested data; temperature, pressure, humidity and a min and max temp
   * @type {{
   *     temp: number
   *     pressure: number
   *     humidity: number
   *     temp_min: number
   *     temp_max: number
   *   }}
   * @memberof OpenWeatherMapResponse
   */
  main

  /**
   * @description visibility distance in meters
   * @type {number}
   * @memberof OpenWeatherMapResponse
   */
  visibility

  /**
   * @description Wind speed and rotation info
   * @type {{
   *     speed: number
   *     deg: number
   *   }}
   * @memberof OpenWeatherMapResponse
   */
  wind

  /**
   * @description Clouds type
   * @type {{
   *     all: number
   *   }}
   * @memberof OpenWeatherMapResponse
   */
  clouds

  /**
   * @description
   * @type {string}
   * @memberof OpenWeatherMapResponse
   */
  id

  /**
   * @description
   * @type {string}
   * @memberof OpenWeatherMapResponse
   */
  name

  /**
   * @description
   * @type {number}
   * @memberof OpenWeatherMapResponse
   */
  cod
}

module.exports = {
  default: WeatherInfoService
}