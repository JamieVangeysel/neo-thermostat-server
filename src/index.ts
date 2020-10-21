import { Platform } from './platform';
import { FileSystem } from './services/filesystem';
let platform: Platform;
const filesystem = new FileSystem();

/**
 * @description: this is the entry point of the program, return true if the application started
 */
const main = async (debug?: boolean): Promise<boolean> => {
  return new Promise<boolean>(async (resolve, reject) => {
    try {
      const fileExists: boolean = await filesystem.exists('./config.json');

      platform = new Platform();
      // created platform
      resolve(fileExists);
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
process.on('uncaughtException', err => {
  try {
    console.debug('process.uncaughtException -- Try to kill main if still running.');
    // bot.kill();
  } catch {
    console.error('process.uncaughtException -- There was an error killing main.');
    // bot.kill();
  }
  console.error('process.uncaughtException -- Starting new instance of main.', err);
  // main();
});
