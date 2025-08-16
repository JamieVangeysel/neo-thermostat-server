import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Platform } from '../../../platform'
import { IRelaisSwitch } from '../../config'

export default async function valvesController(fastify: any) {
  fastify.get('', handleGetValves.bind(fastify))
}

async function handleGetValves(request: FastifyRequest, reply: FastifyReply) {
  const platform: Platform = (this.locals)

  const start = performance.now()
  let response: FastifyReply

  try {
    // const pool: ConnectionPool = await fastify.getSqlPool(DB_NAME)
    // const repo = new Neo(request.log, pool)

    // const result = await repo.get(request.params.uuid)
    const allSwitches: IRelaisSwitch[] = platform.config.instances.reduce((prev, curr) => prev.concat(curr.switches), [])
    const valves: IRelaisSwitch[] = allSwitches.filter(e => e.type.indexOf('VALVE') > -1)

    function mapValve(valve: IRelaisSwitch) {
      return {
        id: valve.pinIndex,
        name: `${valve.type} ${valve.pinIndex}`,
        type: valve.type,
        active: valve.active
      }
    }

    if (valves) {
      response = reply.success(valves.map(mapValve), undefined, performance.now() - start)
    }
    response = reply.error('unknown server error', undefined, performance.now() - start)
  } catch (err) {
    request.log.error({ err }, 'unknown error', undefined, performance.now() - start)
  }

  return response
}
