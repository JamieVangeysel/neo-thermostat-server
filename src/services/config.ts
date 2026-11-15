import type { ThermostatState } from './thermostat'
export { ConfigService, validateConfig } from './config-service'
export type { ConfigLogger } from './config-service'


export interface IConfig {
  version: 2
  hostname: string
  instance?: string
  port: number
  relais: IRelais
  weatherMapApiKey: string
  temperatureSensor: string
  mongoDB: IMongoDBConfig
  thermostatState: ThermostatState
}

export interface IConfigV3 {
  version: 3
  hostname: string
  port: number
  weatherMapApiKey: string
  mongoDB?: IMongoDBConfig
  relais: IRelaisV2
  instances: IThermostatInstanceConfig[]
}

export interface IThermostatInstanceConfig {
  name?: string
  temperatureSensor: string
  thermostatState: ThermostatState
  switches: IRelaisSwitch[]
}

export interface IRelaisV2 {
  hostname: string
  secure: boolean
}

export interface IRelais {
  hostname: string
  secure: boolean
  switches: IRelaisSwitch[]
}

export interface IRelaisSwitch {
  pinIndex: number
  active: boolean
  type: SwitchTypeEnum
}

export enum SwitchTypeEnum {
  HEAT = 'HEAT',
  HEAT_VALVE = 'HEAT_VALVE',
  /** @deprecated The Arduino now manages this shared output from heat demand. */
  HEAT_ELEMENT = 'HEAT_ELEMENT',
  /** @deprecated Hot-water relay control has been retired. */
  WATER_VALVE = 'WATER_VALVE',
  COOL = 'COOL',
  COOL_ELEMENT = 'COOL_ELEMENT',
  COOL_VALVE = 'COOL_VALVE',
  VENT = 'VENT', // experimental => ventilation won't be added until v3
  NONE = 'NONE' // dummy entry to be able to deactivate all relais switches
}

export function isHeatType (value: SwitchTypeEnum): boolean {
  return [SwitchTypeEnum.HEAT, SwitchTypeEnum.HEAT_VALVE].includes(value)
}

export function isCoolType (value: SwitchTypeEnum): boolean {
  return [SwitchTypeEnum.COOL, SwitchTypeEnum.COOL_ELEMENT, SwitchTypeEnum.COOL_VALVE].includes(value)
}

export enum SwitchStateEnum {
  ON = 'on',
  OFF = 'off'
}

interface IMongoDBConfig {
  url: string
  db: string
  username: string
  password: string
}
