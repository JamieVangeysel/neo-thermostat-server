import fastifyPlugin from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import sql, { ConnectionPool } from 'mssql'
import { env } from 'process'

const pools = new Map()
let mssql_connections: { [key: string]: sql.config }

export default fastifyPlugin(mssql)

async function mssql(fastify: FastifyInstance, opts) {
  fastify.log.info({ config: opts }, 'Registering plugin mssql.')
  mssql_connections = opts

  fastify.decorate('getSqlPool')
  fastify.decorate('closeAllSqlPools')

  fastify.getSqlPool = getSqlPool
  fastify.closeAllSqlPools = closeAllSqlPools
}

async function getSqlPool(name?: string) {
  if (!name && env.DB_NAME)
    name = env.DB_NAME
  else if (!name)
    throw new Error(`Missing SQL connection name`)
  if (!pools.has(name)) {
    if (!mssql_connections[name]) {
      throw new Error(`Configuration for pool '${name}' does not exist!`)
    }

    const pool: ConnectionPool = new ConnectionPool(mssql_connections[name])
    const close = pool.close.bind(pool)
    pool.close = (...args) => {
      pools.delete(name)
      return close(...args)
    }
    pools.set(name, await pool.connect())
  }
  return pools.get(name)
}

async function closeAllSqlPools(): Promise<void[]> {
  return Promise.all<void>(Array.from(pools.values()).map((connect) => {
    return connect.then((pool: ConnectionPool): Promise<void> => pool.close())
  }))
}
