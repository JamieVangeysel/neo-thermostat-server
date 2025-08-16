import { Platform } from '../../platform'
import { fastify, FastifyInstance } from 'fastify'
import valvesController from './controllers/valvesController'


// local plugins
import { generate_request_id } from './plugins/request-id'
import { Http2SecureServer, Http2ServerRequest, Http2ServerResponse } from 'http2'

let fastifyConfig = {
  logger: process.env.NODE_ENV !== 'production'
}

export class API {
  _port: number
  private readonly _platform: Platform

  server: FastifyInstance<Http2SecureServer, Http2ServerRequest, Http2ServerResponse>

  constructor(platform: Platform, port?: number) {
    this._platform = platform || undefined
    this._port = port || 8000

    this.init()
  }

  init() {
    let config: any = fastifyConfig
    config.trustProxy = config.trustProxy || true
    config.disableRequestLogging = config.disableRequestLogging || true

    // if (config.logger !== true)
    //   config.logger = setupLogging(appConfig, config.logger)
    config.genReqId = generate_request_id

    config.maxParamLength = 1000
    let routePrefix: string = 'v1'

    if (process.env.NODE_ENV === 'production') {
      if (process.env.APP_VERSION) {
        routePrefix = process.env.APP_VERSION
      }
    } else {
      routePrefix = 'test'
    }

    this.server = fastify(config)
    this.server.register(require('@fastify/cors'), {
      credentials: true,
      methods: [
        'GET',
        'HEAD',
        'OPTIONS',
        'POST',
        'PUT',
        'DELETE'
      ],
      origin: [
        'http://localhost',
        'http://localhost:4200',
        'https://thermostat.jamievangeysel.be'
      ],
      strictPreflight: true
    })

    this.server.decorateRequest('locals', {
      getter: () => {
        return this.platform
      }
    })

    this.server.register(valvesController, { prefix: `/${routePrefix}/valves` })

    // this.server.addHook('onRequest', (req: FastifyRequest, reply: FastifyReply, done: DoneFuncWithErrOrRes) => {
    //   req.locals = this.platform
    //   done()
    // })
  }

  async listen() {
    try {
      this.platform.logger.debug('API.listen() -- Start')
      await this.server.listen({ port: this._port, host: '0.0.0.0' })
      this.platform.logger.info(`API.listen() -- Server listening on ${this._port}.`)
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
