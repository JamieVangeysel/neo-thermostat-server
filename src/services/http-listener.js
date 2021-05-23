const http = require('http')

/** @type {*} */
const okResponse = {
  success: true
}

/**
 * @description
 * @param {any} value
 * @return {any} 
 */
const valueResponse = (value) => {
  return {
    value
  }
}

class HttpListener {
  /**
   * @private
   * @type {Platform}
   * @memberof HttpListener
   */
  platform
  /**
   * @private
   * @type {Thermostat}
   * @memberof HttpListener
   */
  thermostat
  /**
   * Creates an instance of HttpListener.
   * @param {Platform} platform
   * @memberof HttpListener
   */
  constructor(platform) {
    this.platform = platform
  }

/**
 * @description
 * @param {string} hostname
 * @param {number} port
 * @param {Thermostat} thermostat
 * @memberof HttpListener
 */
configure(hostname, port, thermostat) {
    this.platform.logger.debug(`HttpListener.configure() -- start`)
    this.thermostat = thermostat

    const server = http.createServer((req, res) => {
      let body = ''

      switch (`${req.url}|${req.method}`) {
        case '/|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/', returning current status.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.thermostat.State)))
          break

        case '/current-temperature|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/current-temperature', returning current temperature.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.thermostat.CurrentTemperature)))
          break

        case '/target-temperature|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/target-temperature', returning target temperature.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.thermostat.TargetTemperature)))
          break

        case '/target-temperature|POST':
          this.platform.logger.debug(`HttpListener.post() -- received request POST '/target-temperature', setting target temperature.`)

          body = ''
          req.on('data', chunk => {
            body += chunk
          })

          req.on('end', () => {
            try {
              const {
                value
              } = JSON.parse(body)
              this.thermostat.TargetTemperature = value
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
          res.end(JSON.stringify(valueResponse(this.thermostat.CurrentHeatingCoolingState)))
          break

        case '/target-state|GET':
          this.platform.logger.debug(`HttpListener.get() -- received request '/target-state', returning target state.`)
          res.writeHead(200, {
            'Content-Type': 'application/json'
          })
          res.end(JSON.stringify(valueResponse(this.thermostat.TargetHeatingCoolingState)))
          break

        case '/target-state|POST':
          this.platform.logger.debug(`HttpListener.post() -- received request POST '/target-state', setting target state.`)

          body = ''
          req.on('data', chunk => {
            body += chunk
          })

          req.on('end', () => {
            try {
              const {
                value
              } = JSON.parse(body)
              this.thermostat.TargetHeatingCoolingState = value
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
      }
    })

    server.listen(port, hostname, () => {
      console.log(`HttpListener.configure() -- server listening on ${hostname}:${port}`)
    })

    this.platform.logger.debug(`HttpListener.configure() -- end`)
  }
}

module.exports = {
  default: HttpListener
}