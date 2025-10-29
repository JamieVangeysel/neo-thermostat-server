import { EventEmitter } from 'events'
import { Platform } from '../platform'
import { FileSystem } from './filesystem'
import { HeatingCoolingStateEnum, TemperatureDisplayUnits, ThermostatState } from './thermostat'

const filesystem = new FileSystem()

export class ConfigService extends EventEmitter {
  private platform: Platform

  constructor(platform: Platform) {
    super()

    this.platform = platform
  }

  async save(config: IConfigV3): Promise<boolean> {
    this.platform.logger.debug(`ConfigService.save() -- start`)

    const writeOk: boolean = await filesystem.writeFile('./config.json', Buffer.from(JSON.stringify(config, null, 2)))
    if (writeOk) {
      this.platform.logger.log(`ConfigService.save() -- write config to './config.json' ok.`)
      this.emit('saved', config)
    } else {
      this.platform.logger.warn(`ConfigService.save() -- write config to './config.json' failed.`)
    }

    this.platform.logger.debug(`ConfigService.save() -- end`)
    return writeOk
  }

  async initialize() {
    this.platform.logger.debug(`ConfigService.initialize() -- start`)
    const fileExists = await filesystem.exists('./config.json')

    if (fileExists) {
      this.platform.logger.log(`ConfigService.initialize() -- config file exists and is writable.`)
      const configBuffer = await filesystem.readFile('./config.json')
      if (configBuffer) {
        this.platform.logger.log(`ConfigService.initialize() -- read config file content into Buffer.`)
        let config: IConfig | IConfigV3 = filesystem.checkBuffer(configBuffer)
        if (config && config.version > 1) {
          if (config.version === 2) {
            this.platform.logger.info(`ConfigService.initialize() -- config file is version 2, performing in place upgrade to v3`)
            config = this.performInplaceUpgrade(config)
          }
          this.platform.logger.log(`ConfigService.initialize() -- checkBuffer config OK.`)

          this.platform.logger.log(`Platform.init() -- './config.json' Buffer is ok.`)
          this.emit('initialized', config)
          return
        } else {
          this.platform.logger.warn(`ConfigService.initialize() -- checkBuffer config failed!`)
        }
      } else {
        this.platform.logger.warn(`ConfigService.initialize() -- read config failed!`)
      }
      await this.createDefaultConfig()
    } else {
      this.platform.logger.log(`ConfigService.initialize() -- config file does not exist.`)
      await this.createDefaultConfig()
    }

    this.platform.logger.debug(`ConfigService.initialize() -- end`)
  }

  private performInplaceUpgrade(config: IConfig): IConfigV3 {
    let newConfig: IConfigV3 = {
      version: 3,
      hostname: config.hostname,
      port: config.port,
      mongoDB: config.mongoDB,
      weatherMapApiKey: config.weatherMapApiKey,
      relais: {
        hostname: config.relais.hostname,
        secure: config.relais.secure
      },
      instances: []
    }
    if (config.mongoDB) {
      // delete newConfig.mongoDB
      this.platform.logger.warn(`ConfigService.performInplaceUpgrade() -- mongoDB is no longer actively in use, history logging is still active but will be deprecated in future versions.`)
    }
    newConfig.instances.push(
      {
        name: config.instance ?? 'default',
        temperatureSensor: config.temperatureSensor,
        thermostatState: config.thermostatState,
        switches: config.relais.switches
      }
    )

    return newConfig
  }

  private async createDefaultConfig(): Promise<void> {
    this.platform.logger.log(`ConfigService.createDefaultConfig() -- start`)
    // const defaultConfig: IConfig = {
    //   version: 2,
    //   hostname: 'localhost',
    //   port: 8080,
    //   instance: 'default',
    //   weatherMapApiKey: '',
    //   temperatureSensor: '',
    //   mongoDB: {
    //     url: '',
    //     db: '',
    //     username: '',
    //     password: ''
    //   },
    //   relais: {
    //     hostname: 'localhost',
    //     secure: false,
    //     switches: [{
    //       pinIndex: 1,
    //       type: SwitchTypeEnum.COOL,
    //       active: false
    //     }, {
    //       pinIndex: 2,
    //       type: SwitchTypeEnum.HEAT,
    //       active: false
    //     }]
    //   },
    //   thermostatState: {
    //     currentTemperature: 0,
    //     targetTemperature: 20,
    //     currentRelativeHumidity: 50,
    //     currentHeatingCoolingState: HeatingCoolingStateEnum.OFF,
    //     targetHeatingCoolingState: HeatingCoolingStateEnum.OFF,
    //     temperatureDisplayUnits: TemperatureDisplayUnits.CELSIUS
    //   }
    // }

    const defaultConfig: IConfigV3 = {
      version: 3,
      hostname: '0.0.0.0',
      port: 8080,
      weatherMapApiKey: '',
      relais: {
        hostname: 'localhost',
        secure: false
      },
      instances: [{
        temperatureSensor: '',
        switches: [{
          pinIndex: 1,
          type: SwitchTypeEnum.COOL,
          active: false
        }, {
          pinIndex: 2,
          type: SwitchTypeEnum.HEAT,
          active: false
        }],
        thermostatState: {
          currentTemperature: 0,
          targetTemperature: 20,
          currentRelativeHumidity: 50,
          currentHeatingCoolingState: HeatingCoolingStateEnum.OFF,
          targetHeatingCoolingState: HeatingCoolingStateEnum.OFF,
          temperatureDisplayUnits: TemperatureDisplayUnits.CELSIUS
        }
      }]
    }

    this.platform.logger.log(`ConfigService.createDefaultConfig() -- write defaultConfig to './config.json'`)
    const writeOk = await filesystem.writeFile('./config.json', Buffer.from(JSON.stringify(defaultConfig, null, 2)))
    if (writeOk) {
      this.platform.logger.log(`ConfigService.createDefaultConfig() -- write defaultConfig to './config.json' ok.`)
      this.emit('initialized', defaultConfig)
    } else {
      this.platform.logger.warn(`ConfigService.createDefaultConfig() -- write defaultConfig to './config.json' failed.`)
    }

    this.platform.logger.log(`ConfigService.createDefaultConfig() -- end`)
  }
}

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
  HEAT_ELEMENT = 'HEAT_ELEMENT',
  WATER_VALVE = 'WATER_VALVE',
  COOL = 'COOL',
  COOL_ELEMENT = 'COOL_ELEMENT',
  COOL_VALVE = 'COOL_VALVE',
  VENT = 'VENT', // experimental => ventilation won't be added until v3
  NONE = 'NONE' // dummy entry to be able to deactivate all relais switches
}

export function isHeatType (value: SwitchTypeEnum): boolean {
  return [SwitchTypeEnum.HEAT, SwitchTypeEnum.HEAT_ELEMENT, SwitchTypeEnum.HEAT_VALVE].includes(value)
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
