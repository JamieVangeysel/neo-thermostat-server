const { EventEmitter } = require('events')
const FileSystem = require('./filesystem').default

const filesystem = new FileSystem()

class ConfigService extends EventEmitter {
  /**
   * @description Platform instance
   * @private
   * @type {Platform}
   * @memberof ConfigService
   */
  platform

  /**
   * Creates an instance of ConfigService.
   * @param {Platform} platform
   * @memberof ConfigService
   */
  constructor(platform) {
    super()

    this.platform = platform
  }

  /**
   * @description
   * @param {IConfig} config
   * @return {*} 
   * @memberof ConfigService
   */
  async save(config) {
    this.platform.logger.debug(`ConfigService.save() -- start`)

    const writeOk = await filesystem.writeFile('./config.json', Buffer.from(JSON.stringify(config, null, 2)))
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
        const config = filesystem.checkBuffer(configBuffer)
        if (config) {
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

  /**
   * @description
   * @private
   * @memberof ConfigService
   */
  async createDefaultConfig() {
    this.platform.logger.log(`ConfigService.createDefaultConfig() -- start`)
    /** @type {IConfig} */
    const defaultConfig = {
      version: 2,
      hostname: 'localhost',
      port: 8080,
      weatherMapApiKey: '',
      temperatureSensor: '',
      mongoDB: {
        url: '',
        db: '',
        username: '',
        password: ''
      },
      relais: {
        hostname: 'localhost',
        secure: false,
        switches: [{
          pinIndex: 1,
          type: SwitchTypeEnum.COOL,
          active: false
        }, {
          pinIndex: 2,
          type: SwitchTypeEnum.HEAT,
          active: false
        }]
      },
      thermostatState: {
        currentTemperature: 0,
        targetTemperature: 20,
        currentRelativeHumidity: 50,
        currentHeatingCoolingState: HeatingCoolingStateEnum.OFF,
        targetHeatingCoolingState: HeatingCoolingStateEnum.OFF,
        temperatureDisplayUnits: TemperatureDisplayUnits.CELSIUS
      }
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

/**
 * @description
 * @class IConfig
 */
class IConfig {
  /**
   * @type {number}
   * @memberof IConfig
   */
  version
  /**
   * @type {string}
   * @memberof IConfig
   */
  hostname
  /**
   * @type {number}
   * @memberof IConfig
   */
  port
  /**
   * @type {IRelais}
   * @memberof IConfig
   */
  relais
  /**
   * @type {string}
   * @memberof IConfig
   */
  weatherMapApiKey
  /**
   * @type {string}
   * @memberof IConfig
   */
  temperatureSensor
  /**
   * @type {ImongoDBConfig}
   * @memberof IConfig
   */
  mongoDB
  /**
   * @type {ThermostatState}
   * @memberof IConfig
   */
  thermostatState
}

/**
 * @class ImongoDBConfig
 */
class ImongoDBConfig {
  /**
   * @type {string}
   * @memberof ImongoDBConfig
   */
  url
  /**
   * @type {string}
   * @memberof ImongoDBConfig
   */
  db
  /**
   * @type {string}
   * @memberof ImongoDBConfig
   */
  username
  /**
   * @type {string}
   * @memberof ImongoDBConfig
   */
  password
}

module.exports = {
  default: ConfigService
}