import { Logger } from './services/logging/logger'
import { ConfigService, IConfigV3 } from './services/config'
import { DatabaseService } from './services/database'
import { Thermostat } from './services/thermostat'
import { HttpListener } from './services/http-listener'
import { API } from './services/api'

export class Platform {
  readonly logger: Logger
  readonly configService: ConfigService
  readonly database: DatabaseService
  private readonly http: HttpListener
  private readonly api: API
  public readonly thermostats: Thermostat[]
  private readonly _config: IConfigV3
  private stopPromise?: Promise<void>

  private constructor(config: IConfigV3, configService: ConfigService, logger: Logger) {
    this._config = config
    this.configService = configService
    this.logger = logger
    this.database = new DatabaseService(this)
    this.http = new HttpListener(this)
    this.api = new API(this, config.port + 1)
    this.thermostats = config.instances.map(instance => new Thermostat(this, instance.name ?? 'default'))
  }

  static async create(configPath?: string): Promise<Platform> {
    const logger = new Logger()
    const configService = new ConfigService(logger, configPath)
    logger.debug('Platform.create() -- loading configuration')
    const config = await configService.load()
    logger.info(`Platform.create() -- configuration ready (v${config.version}, ${config.instances.length} thermostat instance(s))`)
    const platform = new Platform(config, configService, logger)

    try {
      await platform.start()
      return platform
    } catch (error) {
      try {
        await platform.stop()
      } catch (stopError) {
        logger.error('Platform startup cleanup failed', stopError)
      }
      throw error
    }
  }

  private async start(): Promise<void> {
    this.logger.info('Platform.start() -- start')
    this.logger.debug('Platform.start() -- initializing optional database persistence')
    await this.database.init()
    this.logger.debug(`Platform.start() -- starting ${this.thermostats.length} thermostat instance(s)`)
    for (const thermostat of this.thermostats) await thermostat.start()
    this.logger.debug('Platform.start() -- starting API listener')
    await this.api.listen('0.0.0.0')
    this.logger.debug('Platform.start() -- starting HTTP listener')
    await this.http.listen(this.config.hostname, this.config.port)
    this.logger.info('Platform.start() -- ready')
  }

  stop(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopServices()
    return this.stopPromise
  }

  private async stopServices(): Promise<void> {
    this.logger.info('Platform.stop() -- start')
    const failures: unknown[] = []
    const stop = async (operation: () => Promise<void>) => {
      try {
        await operation()
      } catch (error) {
        failures.push(error)
      }
    }

    this.logger.debug('Platform.stop() -- closing HTTP listener')
    await stop(() => this.http.close())
    this.logger.debug('Platform.stop() -- closing API listener')
    await stop(() => this.api.close())
    for (const thermostat of [...this.thermostats].reverse()) {
      this.logger.debug('Platform.stop() -- stopping thermostat service')
      await stop(() => thermostat.stop())
    }
    this.logger.debug('Platform.stop() -- closing database service')
    await stop(() => this.database.close())

    if (failures.length > 0) {
      throw new Error(`Platform shutdown had ${failures.length} failure(s): ${failures.map(String).join('; ')}`)
    }
    this.logger.info('Platform.stop() -- complete')
  }

  public get config(): IConfigV3 {
    return this._config
  }

  public set config(config: IConfigV3) {
    this.logger.info('Platform.config updated')
    Object.assign(this._config, config)
  }
}
