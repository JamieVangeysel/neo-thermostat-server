import { fetch } from 'cross-fetch';
import { FileSystem } from './filesystem';
import { Platform } from '../platform';
import { IRelaisSwitch, Relais, SwitchTypeEnum } from '../relais/relais';
import { OpenWeatherMapResponse, WeatherInfoService } from './weather-info';

export class Thermostat {
  private platform: Platform;
  private uuid = '6d5b00c42c530b3469b04779146c0b97a723cb2524b60b07e5c327596ebd8f6baebca6bb79a2f1ce24e5a88d7426658a';
  private relais: Relais;
  private weatherInfo: WeatherInfoService;
  private retries = 0;
  private currentForecast: OpenWeatherMapResponse;

  constructor(platform: Platform) {
    this.platform = platform;

    this.platform.logger.debug(`Constructed new instance of Thermostat()`);
    // get initial data from azure
    this.getSensorData();

    this.relais = new Relais(this.platform);
    this.relais.on('update', (switches: IRelaisSwitch[]) => {
      this.platform.config.relais.switches = switches;
    });

    this.weatherInfo = new WeatherInfoService(this.platform);
    this.weatherInfo.on('forecast', (forecast: OpenWeatherMapResponse) => {
      this.platform.logger.log(`Thermostat.weatherInfo.on('forecast')`, forecast);
      this.currentForecast = forecast;
    });

    // set update interval fur current temperature to 1 minute
    setInterval(async () => {
      await this.getSensorData();
    }, 60000);
  }

  async getSensorData() {
    try {
      const result = await fetch(this.sensorUrl);
      const data = (await result.json()) as DeviceReponse;

      this.state.currentTemperature = data.temperature;
      this.state.currentRelativeHumidity = data.humidity;
      this.platform.logger.log('HeatIndex', this.HeatIndex);
      await this.evaluateChanges();
    } catch (err) {
      this.platform.logger.error('error while running getSensorData();', err);
    }
  }

  async evaluateChanges() {
    this.platform.logger.debug('start evaluateChanges()');
    try {
      this.platform.logger.info(`Current temperature: ${this.state.currentTemperature}, target Temperature: ${this.state.targetTemperature}`,
        this.state.targetHeatingCoolingState,
        this.state.currentHeatingCoolingState,
        this.thresholds
      );

      switch (this.state.targetHeatingCoolingState) {
        case HeatingCoolingStateEnum.OFF:
          this.platform.logger.debug('targetHeatingCoolingState is OFF, set current state to OFF');
          this.state.currentHeatingCoolingState = this.state.targetHeatingCoolingState;

          // If any relais is still powered on, turn them off
          this.relais.activate(SwitchTypeEnum.NONE);
          return;

        case HeatingCoolingStateEnum.HEAT:
          this.platform.logger.debug('targetHeatingCoolingState is HEAT, check if currently heating');
          if (this.platform.config.relais.switches.some(e => e.type === SwitchTypeEnum.COOL && e.active)) {
            this.platform.logger.debug('system is currently cooling, turn off COOL');
            this.relais.activate(SwitchTypeEnum.NONE);
          }
          if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.HEAT) {
            // The system is currently heating, check if we need to shutdown heater for reaching maximum temperature
            this.platform.logger.debug('Check if target temperature has not been reached');
            if (this.CurrentTemperature >= this.thresholds.heatingMax) {
              this.platform.logger.debug('turn off heating since target has been reached, don\'t change target');
              try {
                this.relais.activate(SwitchTypeEnum.NONE);
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF;
                this.retries = 0;
              } catch {
                this.platform.logger.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            }
          } else if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.OFF) {
            this.platform.logger.debug('Check if temperature has Driftped below acceptable temperature range');
            if (this.state.currentTemperature <= this.thresholds.heatingMin) {
              this.platform.logger.debug('turn on heating since min target has been reached, don\'t change target');
              try {
                this.relais.activate(SwitchTypeEnum.HEAT);
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.HEAT;
                this.retries = 0;
              } catch {
                this.platform.logger.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            } else if (this.CurrentTemperature <= this.TargetTemperature) {
              this.platform.logger.debug('turn on heating since current temperature is below the target temperature');
              try {
                this.relais.activate(SwitchTypeEnum.HEAT);
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.HEAT;
                this.retries = 0;
              } catch {
                this.platform.logger.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            }
          }
          return;

        case HeatingCoolingStateEnum.COOL:
          this.platform.logger.debug('Target is cooling, check if currently cooling');
          this.relais.activate(SwitchTypeEnum.NONE);
          if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.COOL) {
            this.platform.logger.debug('Check if target temperature has been reached');
            if (this.CurrentTemperature <= this.thresholds.coolingMin) {
              this.platform.logger.debug('turn off cooling since target has been reached, don\'t change target');
              try {
                this.relais.activate(SwitchTypeEnum.NONE);
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF;
                this.retries = 0;
              } catch {
                this.platform.logger.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            }
          } else if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.OFF) {
            this.platform.logger.debug('check if maximum temperature has been reached');
            if (this.state.currentTemperature >= this.thresholds.coolingMax) {
              this.platform.logger.debug('turn on heating since min target has been reached, don\'t change target');
              try {
                this.relais.activate(SwitchTypeEnum.COOL);
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.COOL;
                this.retries = 0;
              } catch {
                this.platform.logger.error('Error while turning off the cooling, try again next cycle.');
                this.retries++;
              }
            }
          }
          return;

        case HeatingCoolingStateEnum.AUTO:
          // this code will be added in the future when we take into account outside weather and time of the year
          return;
      }
    } catch (err) {
      this.platform.logger.error('error while updating relais state', err);
    } finally {
      this.platform.logger.debug(`finished running evaluateChanges()`, 'retries:', this.retries);
      if (this.retries > 5) {
        this.platform.logger.error(`Relais communication has been unsuccessfull 5 Times! Send warning To user to power off master switch`);
      }

      // const writeOk = await new FileSystem().writeFile('./config.json', Buffer.from(JSON.stringify(this.platform.config)));
      // if (writeOk) {
      //   this.platform.logger.debug('successfully saved current state in config');
      // } else {
      //   this.platform.logger.error('Error while trying to save current config to disk!');
      // }
    }
  }

  private get sensorUrl() {
    return `https://simplintho-neo-dev.azurewebsites.net/devices/${this.uuid}`;
  }

  private get thresholds(): TemperatureThresholds {
    // 5.2.3.3.2
    if (this.currentForecast) {
      // We have forecast data, we will add this data to out calculation to ensure nicer living conditions
      // temperature sensor heights .1m, .6m, 1.1m, 1.7m

      const minFloorTemp = 19;
      const maxFloorTemp = 29;
      const maxTemperatureDelta = 1.1;
      // Temperature drift(ramp) max
      const maxQuarterTemperatureDrift = 1.1;
      const maxHalfHourTemperatureDrift = 1.7;
      const maxOneHourTemperatureDrift = 2.2;
      const maxTwoHourTemperatureDrift = 2.8;
      const maxFourHourTemperatureDrift = 3.3;

    } else {
      // There is no forecast data, apiKey is not set or there are connection issues.
    }
    // const range = 0.8;
    // const setTemp = this.TargetTemperature + (this.outsideWeather.main.temp * 0.0633);
    // const tempLow = this.CurrentTemperature <= (setTemp - range);
    // const tempHigh = this.CurrentTemperature > (setTemp + range);

    // calculate min and max HEAT and COOL thresholds based on target temperature.
    // Later we will add integrations with outside temperature, humidity and history
    // cool down and warm up periods and future weather forecast
    return {
      heatingMax: this.TargetTemperature + 1.0,
      heatingMin: this.TargetTemperature - 0.5,
      coolingMax: this.TargetTemperature + 0.5,
      coolingMin: this.TargetTemperature - 1.0
    };
  }

  // https://www.wrh.noaa.gov/psr/general/safety/heat/heatindex.png
  // https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
  private get HeatIndex(): number {
    const T = (this.CurrentTemperature * 1.8) + 32;
    const RH = this.CurrentRelativeHumidity;
    let ADJUSTMENT = 0;
    let HI = 0.5 * (T + 61.0 + ((T - 68.0) * 1.2) + (RH * 0.094));

    if ((HI + T) / 2 >= 80) {
      if (T >= 80 && T <= 112 && RH <= 13) {
        // tslint:disable-next-line: max-line-length
        HI = -42.379 + 2.04901523 * T + 10.14333127 * RH - .22475541 * T * RH - .00683783 * T * T - .05481717 * RH * RH + .00122874 * T * T * RH + .00085282 * T * RH * RH - .00000199 * T * T * RH * RH;
        ADJUSTMENT = -1 * (((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95.)) / 17));
      } else if (T >= 80 && T <= 87 && RH >= 85) {
        // tslint:disable-next-line: max-line-length
        HI = -42.379 + 2.04901523 * T + 10.14333127 * RH - .22475541 * T * RH - .00683783 * T * T - .05481717 * RH * RH + .00122874 * T * T * RH + .00085282 * T * RH * RH - .00000199 * T * T * RH * RH;
        ADJUSTMENT = ((RH - 85) / 10) * ((87 - T) / 5);
      }
    }

    return ((HI - 32) / 1.8) + ADJUSTMENT;
  }

  private get state(): ThermostatState {
    return this.platform.config.thermostatState;
  }

  private set state(value: ThermostatState) {
    this.platform.config.thermostatState = value;
  }

  public get State(): ThermostatState {
    return this.state;
  }

  public get CurrentTemperature(): number {
    return this.state.currentTemperature;
  }

  public get CurrentRelativeHumidity(): number {
    return this.state.currentRelativeHumidity;
  }

  public get TargetTemperature(): number {
    return this.state.targetTemperature;
  }

  public set TargetTemperature(value: number) {
    this.state.targetTemperature = value;
    this.evaluateChanges();
  }

  public get CurrentHeatingCoolingState(): HeatingCoolingStateEnum {
    return this.state.currentHeatingCoolingState;
  }

  public get TargetHeatingCoolingState(): HeatingCoolingStateEnum {
    return this.state.targetHeatingCoolingState;
  }

  public set TargetHeatingCoolingState(value: HeatingCoolingStateEnum) {
    this.state.targetHeatingCoolingState = value;
    this.evaluateChanges();
  }
}

export interface ThermostatState {
  currentTemperature: number;
  currentRelativeHumidity: number;
  targetTemperature: number;
  currentHeatingCoolingState: HeatingCoolingStateEnum;
  targetHeatingCoolingState: HeatingCoolingStateEnum;
  temperatureDisplayUnits: TemperatureDisplayUnits;
}

export interface TemperatureThresholds {
  heatingMin: number;
  heatingMax: number;
  coolingMin: number;
  coolingMax: number;
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

interface DeviceReponse {
  uuid: string;
  name: string;
  mac: string;
  firstSeen: string;
  lastSeen: string;
  localIp?: string;
  ipv4?: string;
  ipv6?: string;
  ownerUuid: string;
  temperature: number;
  humidity: number;
  pressure: number;
  icon: string;
  hwVersion: string;
  fwVersion: string;
  checkUpdates: boolean;
  autoUpdate: boolean;
  logLevel: string;
  hwSupported: boolean;
}
