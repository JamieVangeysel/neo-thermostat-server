export default class Thermostat {
  private uuid = '';
  private state: ThermostatState = {
    currentTemperature: 0,
    targetTemperature: 20,
    currentHeatingCoolingState: HeatingCoolingStateEnum.OFF,
    targetHeatingCoolingState: HeatingCoolingStateEnum.OFF,
    temperatureDisplayUnits: TemperatureDisplayUnits.CELSIUS,
    coolingThresholdTemperature: 20,
    heatingThresholdTemperature: 21,
  };

  constructor() {
    console.debug(`Constructed new instance of Thermostat()`);
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