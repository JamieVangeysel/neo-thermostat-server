import { Platform } from './platform'

async function main(): Promise<void> {
  let platform: Platform | undefined
  let shutdownRequested = false
  let shutdownPromise: Promise<void> | undefined

  const shutdown = async (signal: string): Promise<void> => {
    shutdownRequested = true
    const runningPlatform = platform
    if (!runningPlatform) return
    if (!shutdownPromise) {
      console.info(`Received ${signal}; shutting down thermostat services`)
      shutdownPromise = runningPlatform.stop()
    }
    await shutdownPromise
    process.exitCode = 0
  }

  process.once('SIGINT', () => {
    void shutdown('SIGINT').catch(error => {
      console.error('Thermostat shutdown failed', error)
      process.exitCode = 1
    })
  })
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').catch(error => {
      console.error('Thermostat shutdown failed', error)
      process.exitCode = 1
    })
  })

  platform = await Platform.create()
  if (shutdownRequested) await shutdown('startup')
}

main().catch(error => {
  console.error('Thermostat startup failed', error)
  process.exitCode = 1
})
