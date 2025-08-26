import { hostname } from 'os'
import fastifyPlugin from 'fastify-plugin'
import { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify'

const maxRequestId = 3656158440062975n
let requestId = 0

export default fastifyPlugin(request_id)

/**
 *
 */
async function request_id(fastify: FastifyInstance) {
  fastify.addHook('onSend', set_header)
  fastify.log.debug('adding plugin request_id')
}

/**
 * set request-id header
 */
async function set_header(request: FastifyRequest, reply: FastifyReply) {
  reply.header('request-id', request.id)
}

export function generate_request_id() {
  if (requestId >= maxRequestId)
    process.exit(13)
  return hostname() + ('0000000000' + (++requestId).toString(36)).slice(-10)
}
