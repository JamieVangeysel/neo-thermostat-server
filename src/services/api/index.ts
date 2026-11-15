import { Platform } from '../../platform'
import { fastify, FastifyInstance } from 'fastify'
import valvesController from './controllers/valvesController'


// local plugins
import { generate_request_id } from './plugins/request-id'
import { Http2SecureServer, Http2ServerRequest, Http2ServerResponse } from 'http2'
import { Thermostat } from '../thermostat'

let fastifyConfig = {
  logger: process.env.NODE_ENV !== 'production'
}

export class API {
  _port: number
  private readonly _platform: Platform
  private listening = false

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

  async listen(host: string = '0.0.0.0'): Promise<void> {
    this.platform.logger.debug('API.listen() -- Start')
    try {
      await this.server.listen({ port: this._port, host })
      this.listening = true
      this.platform.logger.info(`API.listen() -- Server listening on ${host}:${this._port}.`)
    } catch (error) {
      this.platform.logger.error('API.listen() -- failed to start', error)
      throw error
    } finally {
      this.platform.logger.debug('API.listen() -- End')
    }
  }

  async close(): Promise<void> {
    if (!this.listening) return
    this.platform.logger.debug('API.close() -- Start')
    try {
      await this.server.close()
      this.listening = false
      this.platform.logger.info('API.close() -- server closed')
    } catch (error) {
      this.platform.logger.error('API.close() -- failed to close server', error)
      throw error
    } finally {
      this.platform.logger.debug('API.close() -- End')
    }
  }

  get platform() {
    return this._platform
  }
}
