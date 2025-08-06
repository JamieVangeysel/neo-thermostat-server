import { Logger } from './services/logging/logger'
import { ConfigService, IConfigV3 } from './services/config'
import { DatabaseService } from './services/database'
import { Thermostat } from './services/thermostat'
import { HttpListener } from './services/http-listener'

export class Platform {
  readonly logger: Logger = new Logger()
  public config: IConfigV3
  public database: DatabaseService
  public configService: ConfigService = new ConfigService(this)
  private http: HttpListener = new HttpListener(this)
  public thermostats: Thermostat[] = []

  // private api: API

  constructor() {
    this.logger.debug(`Platform.constructor() -- start`)
    this.init().then(() => {
      this.logger.debug(`Platform.constructor() -- end`)
    })
  }

  private async init(): Promise<void> {
    this.logger.debug(`Platform.init() -- init`)
    this.configService.on('initialized', async (config: IConfigV3) => {
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
      // this.api = new API(this)
      // this.logger.debug(`Platform.init() -- initialized new API()`)
      // await this.api.listen()
      // this.logger.debug(`Platform.init() -- API is now listening.`)
      for (let thermostat of config.instances) {
        this.thermostats.push(new Thermostat(this, thermostat))
      }
      this.logger.debug(`Platform.init() -- initialized new Thermostat()`)
      this.http.configure(config.hostname, config.port)
      this.logger.log(`Platform.init() -- configure http instance`)
    })
    await this.configService.initialize()
    this.logger.debug(`Platform.init() -- end`)
  }
}
