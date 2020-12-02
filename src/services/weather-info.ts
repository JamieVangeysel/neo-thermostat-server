import { fetch } from 'cross-fetch';
import { EventEmitter } from 'events';
import { Platform } from '../platform';

export class WeatherInfoService extends EventEmitter {
  private platform: Platform;

  constructor(platform: Platform) {
    super();

    this.platform = platform;
    this.platform.logger.debug(`WeatherInfoService() -- start`);
    if (platform.config.weatherMapApiKey && platform.config.weatherMapApiKey.trim().length > 0) {
      this.platform.logger.debug(`WeatherInfoService() -- has weatherMapApiKey, start interval`);
      this.startInterval();
    } else {
      this.platform.logger.warn(`WeatherInfoService() -- no weatherMapApiKey configured, skip `);
    }
    this.platform.logger.debug(`WeatherInfoService() -- end`);
  }

  private async startInterval() {
    this.platform.logger.debug(`WeatherInfoService.startInterval() -- start`);
    try {
      const forecast = await this.getForecast('Hasselt,be');
      this.emit('forecast', forecast);
    } catch (err) {
      this.emit('error', err);
    }

    setInterval(async () => {
      try {
        const forecast = await this.getForecast('Hasselt,be');
        this.emit('forecast', forecast);
      } catch (err) {
        this.emit('error', err);
      }
    }, 300000);
    this.platform.logger.debug(`WeatherInfoService.startInterval() -- end`);
  }

  // query => Hasselt,be
  private async getForecast(query: string): Promise<OpenWeatherMapResponse> {
    this.platform.logger.debug(`WeatherInfoService.getForecast() -- start`, query);
    const resp: any = await fetch(`https://api.openweathermap.org/data/2.5/weather?APPID=${this.platform.config.weatherMapApiKey}&units=metric&q=${query}`);
    return await resp.json();
  }
}

export interface OpenWeatherMapResponse {
  coord: {
    lon: number;
    lat: number;
  };
  weather: {
    id: number;
    main: string;
    description: string;
    icon: string;
  }[];
  base: string;
  main: {
    temp: number;
    pressure: number;
    humidity: number;
    temp_min: number;
    temp_max: number;
  };
  visibility: number;
  wind: {
    speed: number;
    deg: number;
  };
  clouds: {
    all: number;
  };
  id: string;
  name: string;
  cod: number;
}
