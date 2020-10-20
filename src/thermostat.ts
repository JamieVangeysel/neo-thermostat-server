import { fetch } from 'cross-fetch';
import { FileSystem, IConfig } from './filesystem';

export class Thermostat {
  private config: IConfig;
  private uuid = '6d5b00c42c530b3469b04779146c0b97a723cb2524b60b07e5c327596ebd8f6baebca6bb79a2f1ce24e5a88d7426658a';

  private relaisIp = '192.168.0.164';
  private retries = 0;

  constructor(config: IConfig) {
    this.config = config;

    console.debug(`Constructed new instance of Thermostat()`);
    // get initial data from azure
    this.getSensorData();

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
      await this.evaluateChanges();
    } catch (err) {
      console.error('error while running getSensorData();', err);
    }
  }

  async evaluateChanges() {
    console.debug('start evaluateChanges()');
    try {
      // get current state from relaisController
      const relaisResult = await fetch(`http://${this.relaisIp}/state`);
      // save current relais status in function memory : { status: boolean[] }
      const relaisStates = (await relaisResult.json()).status;
      console.debug('relaisResult: ', relaisStates);

      console.info(`Current temperature: ${this.state.currentTemperature}, target Temperature: ${this.state.targetTemperature}`,
        this.state.targetHeatingCoolingState,
        this.state.currentHeatingCoolingState,
        this.thresholds
      );

      switch (this.state.targetHeatingCoolingState) {
        case HeatingCoolingStateEnum.OFF:
          console.debug('targetHeatingCoolingState is OFF, set current state to OFF');
          this.state.currentHeatingCoolingState = this.state.targetHeatingCoolingState;

          // If any relais is still powered on, turn them off
          if (relaisStates[0]) {
            await this.relaisChangeState(0, 'off');
            relaisStates[0] = false;
          }
          if (relaisStates[1]) {
            await this.relaisChangeState(1, 'off');
            relaisStates[1] = false;
          }
          return;

        case HeatingCoolingStateEnum.HEAT:
          console.debug('targetHeatingCoolingState is HEAT, check if currently heating');
          if (relaisStates[0]) {
            console.debug('sytem is currently cooling, turn off COOL');
            await this.relaisChangeState(0, 'off');
            relaisStates[0] = false;
          }
          if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.HEAT) {
            // The system is currently heating, check if we need to shutdown heater for reaching maximum temperature
            console.debug('Check if target temperature has not been reached');
            if (this.CurrentTemperature >= this.thresholds.heatingMax) {
              console.debug('turn off heating since target has been reached, don\'t change target');
              try {
                if (relaisStates[1]) {
                  await this.relaisChangeState(1, 'off');
                  relaisStates[1] = false;
                }
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF;
                this.retries = 0;
              } catch {
                console.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            }
          } else if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.OFF) {
            console.debug('Check if temperature has dropped below acceptable temperature range');
            if (this.state.currentTemperature <= this.thresholds.heatingMin) {
              console.debug('turn on heating since min target has been reached, don\'t change target');
              try {
                if (!relaisStates[1]) {
                  await this.relaisChangeState(1, 'on');
                  relaisStates[1] = true;
                }
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.HEAT;
                this.retries = 0;
              } catch {
                console.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            } else if (this.CurrentTemperature <= this.TargetTemperature) {
              console.debug('turn on heating since current temperature is below the target temperature');
              try {
                if (!relaisStates[1]) {
                  console.log('relaisChangeState');
                  await this.relaisChangeState(1, 'on');
                  relaisStates[1] = true;
                }
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.HEAT;
                this.retries = 0;
              } catch {
                console.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            }
          }
          return;

        case HeatingCoolingStateEnum.COOL:
          console.debug('Target is cooling, check if currently cooling');
          if (relaisStates[1]) {
            console.debug('sytem is currently heating, turn off HEAT');
            await this.relaisChangeState(1, 'off');
            relaisStates[1] = false;
          }
          if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.COOL) {
            console.debug('Check if target temperature has been reached');
            if (this.CurrentTemperature <= this.thresholds.coolingMin) {
              console.debug('turn off cooling since target has been reached, don\'t change target');
              try {
                if (relaisStates[0]) {
                  await this.relaisChangeState(0, 'off');
                  relaisStates[0] = false;
                }
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF;
                this.retries = 0;
              } catch {
                console.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            }
          } else if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.OFF) {
            console.debug('check if maximum temperature has been reached');
            if (this.state.currentTemperature >= this.thresholds.coolingMax) {
              console.debug('turn on heating since min target has been reached, don\'t change target');
              try {
                if (!relaisStates[0]) {
                  await this.relaisChangeState(0, 'on');
                  relaisStates[0] = true;
                }
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.COOL;
                this.retries = 0;
              } catch {
                console.error('Error while turning off the cooling, try again next cycle.');
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
      console.error('error while updating relais state', err);
    } finally {
      console.debug(`finished running evaluateChanges()`, 'retries:', this.retries);
      if (this.retries > 5) {
        console.error(`Relais communication has been unsuccessfull 5 Times! Send warning To user to power off master switch`);
      }

      const writeOk = await new FileSystem().writeFile('./config.json', Buffer.from(JSON.stringify(this.config)));
      if (writeOk) {
        console.debug('successfully saved current state in config');
      } else {
        console.error('Error while trying to save current config to disk!');
      }
    }
  }

  private async relaisChangeState(relaisIndex: number, newState: 'on' | 'off') {
    await fetch(`http://${this.relaisIp}/${relaisIndex + 1}/${newState}`);
  }

  private get sensorUrl() {
    return `https://simplintho-neo-dev.azurewebsites.net/devices/${this.uuid}`;
  }

  private get thresholds(): HeatingThresholds {
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

  private get state(): ThermostatState {
    return this.config.thermostatState;
  }

  private set state(value: ThermostatState) {
    this.config.thermostatState = value;
  }

  public get State(): ThermostatState {
    return this.state;
  }

  public get CurrentTemperature(): number {
    return this.state.currentTemperature;
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
  targetTemperature: number;
  currentHeatingCoolingState: HeatingCoolingStateEnum;
  targetHeatingCoolingState: HeatingCoolingStateEnum;
  temperatureDisplayUnits: TemperatureDisplayUnits;
}

export interface HeatingThresholds {
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
