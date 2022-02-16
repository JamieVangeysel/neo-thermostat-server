const HttpListener = require('./services/http-listener').default
const Logger = require('./services/logging/logger').default
const Thermostat = require('./services/thermostat').default
const ConfigService = require('./services/config').default

const API = require('./services/api')

const {
  IConfig
} = require('./services/config')
const DatabaseService = require('./services/database').default

class Platform {
  /**
   * @type {Logger}
   * @memberof Platform
   */
  logger = new Logger()

  /**
   * @type {IConfig}
   * @memberof Platform
   */
  config

  /**
   * @type {DatabaseService}
   * @memberof Platform
   */
  database

  /**
   * @type {ConfigService}
   * @memberof Platform
   */
  configService = new ConfigService(this)

  /**
   * @type {HttpListener}
   * @memberof Platform
   */
  http = new HttpListener(this)

  /**
   * @type {Thermostat}
   * @memberof Platform
   */
  thermostat

  /**
   * @type {API}
   * @memberof Platform
   */
  api

  constructor() {
    this.logger.debug(`Platform.constructor() -- start`)
    this.init().then(() => {
      this.logger.debug(`Platform.constructor() -- end`)
    })
  }

  /**
   * @description Initialize the platform
   *
   * @private
   * @return {Promise<void>}
   * @memberof Platform
   */
  async init() {
    this.logger.debug(`Platform.init() -- init`)
    this.configService.on('initialized', async (config) => {
      this.logger.debug(`Platform.init() -- configService emitted initialized`)
      this.config = config
      this.logger.log(`Platform.init() -- set config`, config)
      this.database = new DatabaseService(this)
      try {
        await this.database.init()
        this.logger.debug(`Platform.init() -- initialized new DatabaseService()`)
      } catch (err) {
        this.logger.error('Platform.init()', err.message)
      }
      this.api = new API(this)
      this.logger.debug(`Platform.init() -- initialized new API()`)
      await this.api.listen()
      this.logger.debug(`Platform.init() -- API is now listening.`)
      this.thermostat = new Thermostat(this)
      this.logger.debug(`Platform.init() -- initialized new Thermostat()`)
      this.http.configure(config.hostname, config.port, this.thermostat)
      this.logger.log(`Platform.init() -- configure http instance`)
    })
    await this.configService.initialize()
    this.logger.debug(`Platform.init() -- end`)
  }
}

module.exports = {
  Platform
}