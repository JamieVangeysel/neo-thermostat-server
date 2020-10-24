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
    this.logger.log(`Platform.constructor() -- start`);
    this.init().then(() => {
      this.logger.log(`Platform.constructor() -- end`);
    });
  }

  private async init(): Promise<void> {
    this.logger.log(`Platform.init() -- init`);
    this.configService.on('initialized', (config: IConfig) => {
      this.logger.log(`Platform.init() -- configService emitted initialized`);
      this.config = config;
      this.logger.log(`Platform.init() -- set config`);
      const thermostat = new Thermostat(this);
      this.logger.log(`Platform.init() -- initialized new Thermostat()`);
      this.database = new DatabaseService(this);
      this.logger.log(`Platform.init() -- initialized new DatabaseService()`);
      this.http.configure(config.hostname, config.port, thermostat);
      this.logger.log(`Platform.init() -- configure http instance`);
    });
    await this.configService.initialize();
    this.logger.log(`Platform.init() -- end`);
  }
}
