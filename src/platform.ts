

export class Platform {
  readonly logger: Logger = new Logger()
  readonly config: IConfig
  public database: DatabaseService
  public configService: ConfigService = new ConfigService(this)
  private http: HttpListener = new HttpListener(this)
  private thermostat: Thermostat
  private api: API

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
