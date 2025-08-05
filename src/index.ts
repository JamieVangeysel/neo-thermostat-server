import { Platform } from './platform'

function main(debug?: boolean) {
  return new Promise((resolve, reject) => {
    try {
      const platform = new Platform()
      resolve(true)
    } catch (err) {
      reject(err)
    }
  })
}

main()

// catch ctrl+c event and exit normally
process.on('SIGINT', async _ => {
  // await platform.kill()
  console.debug('SIGINT!')
  process.exit()
})

// catch uncaught exceptions, trace, then restart
process.on('uncaughtException', err => {
  try {
    console.debug('process.uncaughtException -- Try to kill main if still running.')
    // platform.kill()
  } catch {
    console.error('process.uncaughtException -- There was an error killing main.')
    // platform.kill()
  }
  console.error('process.uncaughtException -- Starting new instance of main.', err)
  // main()
})
