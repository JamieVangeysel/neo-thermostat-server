import * as http from 'node:http'
import type { Platform } from '../platform'
import type { Thermostat } from './thermostat'

const okResponse: any = {
  success: true
}

const valueResponse = (value: any): any => {
  return {
    value
  }
}

export class HttpListener {
  private readonly platform: Platform
  private server?: http.Server

  constructor(platform: Platform) {
    this.platform = platform
  }

  async listen(hostname: string, port: number): Promise<void> {
    if (this.server?.listening) return
    this.platform.logger.debug(`HttpListener.configure() -- start`)

    const server = http.createServer((req: any, res: any): void => {
      let body = ''

      const regex = new RegExp('(?<instance>\/[a-zA-Z0-9-_]+)(?<url>\/.+)?').exec(req.url)
      const instance = regex?.groups?.instance
      const url = regex?.groups?.url ?? '/'
      this.platform.logger.debug(`HttpListener.req() -- `, instance?.substring(1), url)

      switch (`${url}|${req.method}`) {
        case '/|GET': {
          this.platform.logger.debug(`HttpListener.get() -- received request '/', returning current status.`)
          const thermostat = this.getThermostat(instance)
          if (!thermostat) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'thermostat instance not found' }))
            break
          }
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse({ ...thermostat.State, errorStatus: thermostat.ErrorStatus })))
          break
        }

        case '/error-status|GET': {
          const thermostat = this.getThermostat(instance)
          if (!thermostat) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'thermostat instance not found' }))
            break
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(valueResponse(thermostat.ErrorStatus)))
          break
        }

        case '/current-temperature|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/current-temperature', returning current temperature.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).HeatIndex)))
          break

        case '/current-relative-humidity|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/current-relative-humidity', returning current relative-humidity.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).CurrentRelativeHumidity)))
          break

        case '/target-temperature|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/target-temperature', returning target temperature.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).TargetTemperature)))
          break

        case '/target-temperature|POST':
          this.platform.logger.debug(`HttpListener.post() -- received request POST '/target-temperature', setting target temperature.`)

          body = ''
          req.on('data', (chunk: any) => {
            body += chunk.toString()
          })

          req.on('end', () => {
            try {
              const {
                value
              } = JSON.parse(body)
              this.getThermostat(instance).TargetTemperature = value
              this.platform.logger.debug('Set target temperature to: ' + value)
              res.writeHead(200, {
                'Content-Type': 'application/json'
              })
              res.end(JSON.stringify(okResponse))
            } catch (err) {
              res.writeHead(500, {
                'Content-Type': 'application/json'
              })
              res.end(JSON.stringify(err))
            }
          })
          break

        case '/current-state|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/current-state', returning current state.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).CurrentHeatingCoolingState)))
          break

        case '/target-state|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/target-state', returning target state.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).TargetHeatingCoolingState)))
          break

        case '/target-state|POST':
          this.platform.logger.debug(`HttpListener.post() -- received request POST '/target-state', setting target state.`)

          body = ''
          req.on('data', (chunk: any) => {
            body += chunk.toString()
          })

          req.on('end', () => {
            try {
              const {
                value
              } = JSON.parse(body)
              this.getThermostat(instance).TargetHeatingCoolingState = value
              this.platform.logger.debug('Set target state to: ' + value)
              res.writeHead(200, {
                'Content-Type': 'application/json'
              })
              res.end(JSON.stringify(okResponse))
            } catch (err) {
              res.writeHead(500, {
                'Content-Type': 'application/json'
              })
              res.end(JSON.stringify(err))
            }
          })
          break

        // case '/heating-valve/active|GET':
        //   // return on state for outlet (relais with switch type HEAT_VALVE)
        //   this.platform.logger.debug(`HttpListener.get() -- received request '/heating-valve/active', returning target state.`)
        //   res.writeHead(200, {
        //     'Content-Type': 'application/json'
        //   })
        //   res.end(JSON.stringify(valueResponse(this.getThermostat(instance).HeatValveOn ? 1 : 0)))
        //   break

        // case '/water-valve/active|GET':
        //   // return on state for valve (relais with switch type WATER_VALVE)
        //   this.platform.logger.debug(`HttpListener.get() -- received request '/water-valve/active', returning target state.`)
        //   res.writeHead(200, {
        //     'Content-Type': 'application/json'
        //   })
        //   res.end(JSON.stringify(valueResponse(this.getThermostat(instance).WaterValveOn ? 1 : 0)))
        //   break

        // case '/water-valve/active|POST':
        //   // return on state for valve (relais with switch type WATER_VALVE)
        //   this.platform.logger.debug(`HttpListener.post() -- received request '/water-valve/active'.`)
        //   body = ''
        //   req.on('data', (chunk: any) => {
        //     body += chunk.toString()
        //   })
        //
        //   req.on('end', () => {
        //     try {
        //       const {
        //         value
        //       } = JSON.parse(body)
        //       this.getThermostat(instance).WaterValveOn = value
        //       this.platform.logger.debug('Set target state to: ' + value)
        //       res.writeHead(200, {
        //         'Content-Type': 'application/json'
        //       })
        //       res.end(JSON.stringify(okResponse))
        //     } catch (err) {
        //       res.writeHead(500, {
        //         'Content-Type': 'application/json'
        //       })
        //       res.end(JSON.stringify(err))
        //     }
        //   })
        //   break

        // case '/heating-element/on|GET':
        //   // return on state for outlet (relais with switch type HEAT_ELEMENT)
        //   this.platform.logger.debug(`HttpListener.get() -- received request '/heating-element/on', returning target state.`)
        //   res.writeHead(200, {
        //     'Content-Type': 'application/json'
        //   })
        //   res.end(JSON.stringify(valueResponse(this.getThermostat(instance).HeatElementOn)))
        //   break

        default:
          res.writeHead(404, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify({ error: 'Route ' + req.url + 'not found!' }))
          break
      }
    })

    this.server = server
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener('listening', onListening)
        this.server = undefined
        this.platform.logger.error(`HttpListener.listen() -- failed for ${hostname}:${port}`, error)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, hostname)
    })
    server.on('error', error => this.platform.logger.error('HTTP listener error', error))
    this.platform.logger.info(`HttpListener.listen() -- server listening on ${hostname}:${port}`)

    this.platform.logger.debug(`HttpListener.configure() -- end`)
  }

  async close(): Promise<void> {
    const server = this.server
    if (!server) return
    if (!server.listening) {
      this.server = undefined
      return
    }
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
    this.server = undefined
  }

  getThermostat(instance_name?: string): Thermostat | undefined {
    if (!instance_name) return undefined
    return this.platform.thermostats.find(e => e.Name === instance_name.substring(1))
  }
}
