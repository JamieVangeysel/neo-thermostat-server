let fastifyConfig = {
  logger: process.env.NODE_ENV !== 'production'
}

module.exports = class API {
  _port
  _platform

  server

  constructor(platform, port) {
    this._platform = platform || undefined
    this._port = port || 8000

    this.init()
  }

  init() {
    let routePrefix = 'v1'

    if (process.env.NODE_ENV === 'production') {
      if (process.env.APP_VERSION) {
        routePrefix = process.env.APP_VERSION
      }
    } else {
      routePrefix = 'test'
    }

    this.server = require('fastify')(fastifyConfig)
    this.server.register(require('fastify-cors'), {
      credentials: true,
      methods: [
        'GET',
        'HEAD',
        'OPTIONS',
        'POST',
        'PUT',
        'DELETE',
      ],
      origin: [
        'http://localhost',
        'http://localhost:7400',
        'https://thermostat.simplintho.com',
      ],
      strictPreflight: true
    })

    this.server.decorateRequest('locals', null)

    this.server.addHook('onRequest', (req, reply, done) => {
      req.locals = this.platform
      done()
    })

    const { routes } = require('./routes')
    for (const route of routes) {
      route.url = `/${routePrefix}${route.url}`
      this.server.route(route)
    }
  }

  async listen() {
    try {
      this.platform.logger.debug('API.listen() -- Start')
      await this.server.listen(this._port, '0.0.0.0')
      this.platform.logger.info(`API.listen() -- Server listening on ${this.server.server.address().port}.`)
    } catch (err) {
      this.platform.logger.error(err)
    } finally {
      this.platform.logger.debug('API.listen() -- End')
    }
  }

  get platform() {
    return this._platform
  }
}
