import { FastifyReply } from 'fastify'
import fastifyPlugin from 'fastify-plugin'

export default fastifyPlugin(replyDecorators)

async function replyDecorators(fastify: any) {
  fastify.decorateReply('success')
  fastify.decorateReply('fail')
  fastify.decorateReply('error')

  fastify.addHook('onRequest', async function (request, reply) {
    reply.success = success
    reply.fail = fail
    reply.error = error
  })
}

/**
 * Return a sucessful response
 */
function success(data?: any, code: number = 200, executionTime?: number): FastifyReply {
  if (!data)
    return this
      .code(204)
      .send(undefined)

  return this
    .code(code)
    .send({
      status: 'success',
      code,
      data,
      executionTime
    })
}

/**
 * Return a failed response
 */
function fail(data?: any, code: number = 400, executionTime?: number): FastifyReply {
  return this
    .code(code)
    .send({
      status: 'fail',
      code,
      data,
      executionTime
    })
}

/**
 * Return a error response
 */
function error(message: string, code: number = 500, executionTime?: number): FastifyReply {
  return this
    .code(code)
    .send({
      status: 'error',
      code,
      message,
      executionTime
    })
}