import { FileSystem, IConfig } from './filesystem';
import { HttpListener } from './http-listener';
import { SwitchTypeEnum } from './relais/relais';
import { Thermostat, HeatingCoolingStateEnum, TemperatureDisplayUnits } from './thermostat';


const filesystem = new FileSystem();

/**
 * @description: this is the entry point of the program, return true if the application started
 */
const main = async (debug?: boolean): Promise<boolean> => {
  return new Promise<boolean>(async (resolve, reject) => {
    const fileExists: boolean = await filesystem.exists('./config.json');

    try {
      if (fileExists === true) {
        const configBuffer: Buffer = await filesystem.readFile('./config.json');
        const config = filesystem.checkBuffer(configBuffer);
        if (config) {
          const thermostat = new Thermostat(config);
          const http = new HttpListener();
          http.configure(config.hostname, config.port, thermostat);

          resolve(true);
        }
        return;
      } else {
        // create file with default config attached
        const defaultConfig: IConfig = {
          version: 2,
          hostname: 'localhost',
          port: 8080,
          weatherMapApiKey: '',
          relais: {
            hostname: '',
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
            currentHeatingCoolingState: HeatingCoolingStateEnum.OFF,
            targetHeatingCoolingState: HeatingCoolingStateEnum.OFF,
            temperatureDisplayUnits: TemperatureDisplayUnits.CELSIUS
          }
        };
        const writeOk = await filesystem.writeFile('./config.json', Buffer.from(JSON.stringify(defaultConfig)));

        if (writeOk) {
          const thermostat = new Thermostat(defaultConfig);
          const http = new HttpListener();
          http.configure(defaultConfig.hostname, defaultConfig.port, thermostat);
        }

        resolve(writeOk);
        return;
      }
    } catch (err) {
      reject(err);
    }
  });
};

export default main;

main();

// catch ctrl+c event and exit normally
process.on('SIGINT', async _ => {
  // await bot.kill();
  console.debug('SIGINT!');
  process.exit();
});

// catch uncaught exceptions, trace, then restart
process.on('uncaughtException', _ => {
  try {
    console.debug('process.uncaughtException -- Try to kill main if still running.');
    // bot.kill();
  } catch {
    console.error('process.uncaughtException -- There was an error killing main.');
    // bot.kill();
  }
  console.debug('process.uncaughtException -- Starting new instance of main.');
  main();
});
