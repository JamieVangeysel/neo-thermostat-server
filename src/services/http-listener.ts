import * as http from 'node:http'
import { Platform } from '../platform'
import { Thermostat } from './thermostat'

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

  constructor(platform: Platform) {
    this.platform = platform
  }

  configure(hostname: string, port: number) {
    this.platform.logger.debug(`HttpListener.configure() -- start`)

    const server = http.createServer((req: any, res: any): void => {
      let body = ''

      const regex = new RegExp('(?<instance>\/[a-zA-Z0-9]+)(?<url>\/.+)').exec(req.url)
      this.platform.logger.debug(`HttpListener.req() -- `, regex.groups['instance']?.substring(1), regex.groups['url'])
      const instance = regex.groups['instance']
      const url = regex.groups['url']

      switch (`${url}|${req.method}`) {
        case '/|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/', returning current status.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).State)))
          break

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

        case '/heating-valve/active|GET':
          // return on state for outlet (relais with switch type HEAT_VALVE)
          this.platform.logger.debug(`HttpListener.get() -- received request '/heating-valve/active', returning target state.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).HeatValveOn ? 1 : 0)))
          break

        case '/water-valve/active|GET':
          // return on state for valve (relais with switch type WATER_VALVE)
          this.platform.logger.debug(`HttpListener.get() -- received request '/water-valve/active', returning target state.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).WaterValveOn ? 1 : 0)))
          break

        case '/water-valve/active|POST':
          // return on state for valve (relais with switch type WATER_VALVE)
          this.platform.logger.debug(`HttpListener.post() -- received request '/water-valve/active', returning target state.`)
          body = ''
          req.on('data', (chunk: any) => {
            body += chunk.toString()
          })

          req.on('end', () => {
            try {
              const {
                value
              } = JSON.parse(body)
              this.getThermostat(instance).WaterValveOn = value
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

        case '/heating-element/on|GET':
          // return on state for outlet (relais with switch type HEAT_ELEMENT)
          this.platform.logger.debug(`HttpListener.get() -- received request '/heating-element/on', returning target state.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.getThermostat(instance).HeatElementOn)))
          break

        default:
          res.writeHead(404, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify({ error: 'Route ' + req.url + 'not found!' }))
          break
      }
    })

    server.listen(port, hostname, () => {
      console.log(`HttpListener.configure() -- server listening on ${hostname}:${port}`)
    })

    this.platform.logger.debug(`HttpListener.configure() -- end`)
  }

  getThermostat(instance_name: string): Thermostat | undefined {
    if (!instance_name) return undefined
    return this.platform.thermostats.find(e => e.Name === instance_name.substring(1))
  }
}
