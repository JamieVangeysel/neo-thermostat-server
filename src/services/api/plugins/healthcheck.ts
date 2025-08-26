import { FastifyInstance } from 'fastify'

export default async function (fastify: FastifyInstance) {
  fastify.route({ method: 'GET', url: '/', handler: async () => '' })
}