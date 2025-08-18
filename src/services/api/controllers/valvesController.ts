import { FastifyReply, FastifyRequest } from 'fastify'
import { Platform } from '../../../platform'
import { IRelaisSwitch } from '../../config'

export default async function valvesController(fastify: any) {
  fastify.get('', handleGetValves)
  fastify.get('/:id/active', handleGetValveActive)
  fastify.get('/:id/in-use', handleGetValveInUse)
}

async function handleGetValves(request: FastifyRequest, reply: FastifyReply) {
  const platform: Platform = request.locals

  const start = performance.now()
  let response: FastifyReply

  try {
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

    let result = valves.map(mapValve)
    platform.logger.log('result from get', result)

    if (valves) {
      response = reply.success(result, undefined, performance.now() - start)
    } else {
      response = reply.error('unknown server error', undefined, performance.now() - start)
    }
  } catch (err) {
    // platform.logger.error({ err }, 'unknown error', undefined, performance.now() - start)
    response = reply.error('unknown server error', undefined, performance.now() - start)
  }

  return response
}

async function handleGetValveActive(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
  const platform: Platform = request.locals
  const id = +request.params.id

  const start = performance.now()
  let response: FastifyReply
  try {
    const allSwitches: IRelaisSwitch[] = platform.config.instances.reduce((prev, curr) => prev.concat(curr.switches), [])
    const valve: IRelaisSwitch = allSwitches.find(e => e.pinIndex === id)
    response = reply.success(valve.active)
  } catch (err) {
    // platform.logger.error({ err }, 'unknown error', undefined, performance.now() - start)
    response = reply.error('unknown server error', undefined, performance.now() - start)
  }

  return response
}

async function handleGetValveInUse(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
  const platform: Platform = request.locals
  const id = +request.params.id

  const start = performance.now()
  let response: FastifyReply
  try {
    const allSwitches: IRelaisSwitch[] = platform.config.instances.reduce((prev, curr) => prev.concat(curr.switches), [])
    const valve: IRelaisSwitch = allSwitches.find(e => e.pinIndex === id)
    response = reply.success(valve.active)
  } catch (err) {
    // platform.logger.error({ err }, 'unknown error', undefined, performance.now() - start)
    response = reply.error('unknown server error', undefined, performance.now() - start)
  }

  return response
}
