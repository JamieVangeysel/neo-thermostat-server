import { HttpListener } from './services/http-listener';
import { Logger } from './services/logging/logger';
import { Thermostat } from './services/thermostat';
import { ConfigService, IConfig } from './services/config';
import { DatabaseService } from './services/database';

export class Platform {
  logger = new Logger();
  config: IConfig;
  configService: ConfigService = new ConfigService(this);
  http: HttpListener = new HttpListener(this);
  database: DatabaseService;

  constructor() {
    this.logger.debug(`Platform.constructor() -- start`);
    this.init().then(() => {
      this.logger.debug(`Platform.constructor() -- end`);
    });
  }

  private async init(): Promise<void> {
    this.logger.debug(`Platform.init() -- init`);
    this.configService.on('initialized', async (config: IConfig) => {
      this.logger.debug(`Platform.init() -- configService emitted initialized`);
      this.config = config;
      this.logger.log(`Platform.init() -- set config`);
      this.database = new DatabaseService(this);
      try {
        await this.database.init();
        this.logger.debug(`Platform.init() -- initialized new DatabaseService()`);
      } catch (err: any) {
        this.logger.error('Platform.init()', err.message);
      }
      const thermostat = new Thermostat(this);
      this.logger.debug(`Platform.init() -- initialized new Thermostat()`);
      this.http.configure(config.hostname, config.port, thermostat);
      this.logger.log(`Platform.init() -- configure http instance`);
    });
    await this.configService.initialize();
    this.logger.debug(`Platform.init() -- end`);
  }
}
