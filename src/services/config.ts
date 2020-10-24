import { EventEmitter } from 'events';
import { Platform } from '../platform';
import { IRelais, SwitchTypeEnum } from './relais';
import { FileSystem } from './filesystem';
import { HeatingCoolingStateEnum, TemperatureDisplayUnits, ThermostatState } from './thermostat';
const filesystem = new FileSystem();

export class ConfigService extends EventEmitter {
  private platform: Platform;

  constructor(platform: Platform) {
    super();

    this.platform = platform;
  }

  async save(config: IConfig) {
    this.platform.logger.log(`ConfigService.save() -- start`, config);

    const writeOk = await filesystem.writeFile('./config.json', Buffer.from(JSON.stringify(config)));
    if (writeOk) {
      this.platform.logger.log(`ConfigService.save() -- write config to './config.json' ok.`);
      this.emit('saved', config);
    } else {
      this.platform.logger.warn(`ConfigService.save() -- write config to './config.json' failed.`);
    }

    this.platform.logger.log(`ConfigService.save() -- end`);
  }

  async initialize() {
    this.platform.logger.log(`ConfigService.initialize() -- start`);
    const fileExists: boolean = await filesystem.exists('./config.json');

    if (fileExists) {
      this.platform.logger.log(`ConfigService.initialize() -- config file exists and is writable.`);
      const configBuffer: Buffer = await filesystem.readFile('./config.json');
      if (configBuffer) {
        this.platform.logger.log(`ConfigService.initialize() -- read config file content into Buffer.`);
        const config = filesystem.checkBuffer(configBuffer);
        if (config) {
          this.platform.logger.log(`ConfigService.initialize() -- checkBuffer config OK.`);

          this.platform.logger.log(`Platform.init() -- './config.json' Buffer is ok.`);
          this.emit('initialized', config);
          return;
        } else {
          this.platform.logger.warn(`ConfigService.initialize() -- checkBuffer config failed!`);
        }
      } else {
        this.platform.logger.warn(`ConfigService.initialize() -- read config failed!`);
      }
      await this.createDefaultConfig();
    } else {
      this.platform.logger.log(`ConfigService.initialize() -- config file does not exist.`);
      await this.createDefaultConfig();
    }

    this.platform.logger.log(`ConfigService.initialize() -- end`);
  }

  private async createDefaultConfig() {
    this.platform.logger.log(`ConfigService.createDefaultConfig() -- start`);
    const defaultConfig: IConfig = {
      version: 2,
      hostname: 'localhost',
      port: 8080,
      weatherMapApiKey: '',
      mongoDb: {
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
    };

    this.platform.logger.log(`ConfigService.createDefaultConfig() -- write defaultConfig to './config.json'`);
    const writeOk = await filesystem.writeFile('./config.json', Buffer.from(JSON.stringify(defaultConfig)));
    if (writeOk) {
      this.platform.logger.log(`ConfigService.createDefaultConfig() -- write defaultConfig to './config.json' ok.`);
      this.emit('initialized', defaultConfig);
    } else {
      this.platform.logger.warn(`ConfigService.createDefaultConfig() -- write defaultConfig to './config.json' failed.`);
    }

    this.platform.logger.log(`ConfigService.createDefaultConfig() -- end`);
  }
}

export interface IConfig {
  version: number;
  hostname: string;
  port: number;
  relais: IRelais;
  weatherMapApiKey: string;
  mongoDb: ImongoDBConfig;
  thermostatState: ThermostatState;
}

export interface ImongoDBConfig {
  url: string;
  db: string;
  username: string;
  password: string;
}
