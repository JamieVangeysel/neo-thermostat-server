const Platform = require('./platform').Platform
let platform

/**
 * @description: this is the entry point of the program, return true if the application started
 *
 * @param {boolean} [debug]
 * @return {Promise<boolean>} Promise resolvs to true if platform has been initialized correctly
 */
function main(debug) {
  return new Promise((resolve, reject) => {
    try {
      platform = new Platform()
      resolve(true)
    } catch (err) {
      reject(err)
    }
  })
}

main()

// catch ctrl+c event and exit normally
process.on('SIGINT', async _ => {
  // await bot.kill()
  console.debug('SIGINT!')
  process.exit()
})

// catch uncaught exceptions, trace, then restart
process.on('uncaughtException', err => {
  try {
    console.debug('process.uncaughtException -- Try to kill main if still running.')
    // bot.kill()
  } catch {
    console.error('process.uncaughtException -- There was an error killing main.')
    // bot.kill()
  }
  console.error('process.uncaughtException -- Starting new instance of main.', err)
  // main()
})

module.exports = {
  main
}