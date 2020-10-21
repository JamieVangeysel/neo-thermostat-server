import { EventEmitter } from 'events';

export class WeatherInfo extends EventEmitter {
  private apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;

    setInterval(async () => {
      try {
        const forecast = await this.GetForecast('Hasselt,be');
        this.emit('forecast', forecast);
      } catch (err) {
        this.emit('error', err);
      }
    });
  }

  // query => Hasselt,be
  private async GetForecast(query: string): Promise<OpenWeatherMapResponse> {
    const resp: any = await fetch(`https://api.openweathermap.org/data/2.5/weather?APPID=${this.apiKey}&units=metric&q=${query}`);
    return resp.data;
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
