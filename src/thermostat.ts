export default class Thermostat {
  private uuid = '6d5b00c42c530b3469b04779146c0b97a723cb2524b60b07e5c327596ebd8f6baebca6bb79a2f1ce24e5a88d7426658a';
  private state: ThermostatState = {
    currentTemperature: 0,
    targetTemperature: 20,
    currentHeatingCoolingState: HeatingCoolingStateEnum.OFF,
    targetHeatingCoolingState: HeatingCoolingStateEnum.OFF,
    temperatureDisplayUnits: TemperatureDisplayUnits.CELSIUS,
    coolingThresholdTemperature: 20,
    heatingThresholdTemperature: 20.5,
  };

  private relaisIp = '192.168.0.164';
  private retries = 0;

  constructor() {
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
    } catch (err) {
      console.error('error while running getSensorData();', err);
    }
  }

  async evaluateChanges() {
    switch (this.state.targetHeatingCoolingState) {
      case HeatingCoolingStateEnum.OFF:
        // Target is off, set current to off and return
        this.state.currentHeatingCoolingState = this.state.targetHeatingCoolingState;
        return;

      case HeatingCoolingStateEnum.HEAT:
        // Target is heating, check if currently heating
        if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.HEAT) {
          // Check if target temperature has not been reached
          if (this.CurrentTemperature >= this.HeatingThresholdTemperature) {
            // turn off heating since target has been reached, don't change target
            try {
              await this.relaisChangeState(2, 'off');
              this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF;
              this.retries = 0;
            } catch {
              console.error('Error while turning off the heater, try again next cycle.');
              this.retries++;
            }
          }
        } else if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.OFF) {
          // check if minimum temperature has been reached
          if (this.state.currentTemperature <= this.HeatingThresholdTemperatureMin) {
            // turn on heating since min target has been reached, don't change target
            try {
              await this.relaisChangeState(2, 'on');
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
        // Target is cooling, check if currently cooling
        if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.COOL) {
          // Check if target temperature has been reached
          if (this.CurrentTemperature <= this.CoolingThresholdTemperature) {
            // turn off cooling since target has been reached, don't change target
            try {
              await this.relaisChangeState(1, 'off');
              this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF;
              this.retries = 0;
            } catch {
              console.error('Error while turning off the heater, try again next cycle.');
              this.retries++;
            }
          }
        } else if (this.state.currentHeatingCoolingState === HeatingCoolingStateEnum.OFF) {
          // check if maximum temperature has been reached
          if (this.state.currentTemperature >= this.CoolingThresholdTemperatureMax) {
            // turn on heating since min target has been reached, don't change target
            try {
              await this.relaisChangeState(2, 'on');
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
        // Target is auto, check is current state is HEAT or COOL
        switch (this.state.currentHeatingCoolingState) {
          case HeatingCoolingStateEnum.HEAT:
            // Check if target temperature has not been reached
            if (this.CurrentTemperature >= this.HeatingThresholdTemperature) {
              // turn off heating since target has been reached, don't change target
              try {
                await this.relaisChangeState(2, 'off');
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF;
                this.retries = 0;
              } catch {
                console.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            }
            break;

          case HeatingCoolingStateEnum.COOL:
            // Check if target temperature has been reached
            if (this.CurrentTemperature <= this.CoolingThresholdTemperature) {
              // turn off cooling since target has been reached, don't change target
              try {
                await this.relaisChangeState(1, 'off');
                this.state.currentHeatingCoolingState = HeatingCoolingStateEnum.OFF;
                this.retries = 0;
              } catch {
                console.error('Error while turning off the heater, try again next cycle.');
                this.retries++;
              }
            }
            break;

          case HeatingCoolingStateEnum.OFF:
            // determine if state should be changed to HEAT or COOL
            break;
        }
    }
  }

  private async relaisChangeState(switchId: number, newState: 'on' | 'off') {
    await fetch(`http://${this.relaisIp}/${switchId}/${newState}`);
  }

  public get State(): ThermostatState {
    return this.state;
  }

  public get CurrentTemperature(): number {
    return this.state.currentTemperature;
  }

  public get TargetTemperature(): number {
    return this.state.targetTemperature
  }

  public set TargetTemperature(value: number) {
    this.state.targetTemperature = value;
  }

  public get CurrentHeatingCoolingState(): HeatingCoolingStateEnum {
    return this.state.currentHeatingCoolingState;
  }

  public get TargetHeatingCoolingState(): HeatingCoolingStateEnum {
    return this.state.targetHeatingCoolingState;
  }

  public set TargetHeatingCoolingState(value: HeatingCoolingStateEnum) {
    this.state.targetHeatingCoolingState = value;
  }

  public get CoolingThresholdTemperature(): number {
    return this.state.coolingThresholdTemperature
  }

  public set CoolingThresholdTemperature(value: number) {
    this.state.coolingThresholdTemperature = value;
  }

  public get HeatingThresholdTemperature(): number {
    return this.state.heatingThresholdTemperature
  }

  public set HeatingThresholdTemperature(value: number) {
    this.state.heatingThresholdTemperature = value;
  }

  private get HeatingThresholdTemperatureMin(): number {
    return this.state.heatingThresholdTemperature - 1.5;
  }

  private get CoolingThresholdTemperatureMax(): number {
    return this.state.coolingThresholdTemperature + 1.5;
  }

  private get sensorUrl() {
    return `https://simplintho-neo-dev.azurewebsites.net/devices/${this.uuid}`;
  }
}

export interface ThermostatState {
  currentTemperature: number;
  targetTemperature: number;
  currentHeatingCoolingState: HeatingCoolingStateEnum;
  targetHeatingCoolingState: HeatingCoolingStateEnum;
  temperatureDisplayUnits: TemperatureDisplayUnits;
  coolingThresholdTemperature: number;
  heatingThresholdTemperature: number;
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