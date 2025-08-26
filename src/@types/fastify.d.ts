import { FastifyInstance as FI, FastifyRequest as FRQ, FastifyReply as FRP } from 'fastify'
import { Platform } from '../platform'
// import { ConnectionPool } from 'mssql'

declare module 'fastify' {
  export interface FastifyInstance extends FI {
    // getSqlPool: (name?: string) => Promise<ConnectionPool>
    // closeAllSqlPools: () => Promise<void[]>
  }

  export interface FastifyRequest extends FRQ {
    locals: Platform
  }

  export interface FastifyReply extends FRP {
    success: (data?: any, code?: number, executionTime?: number) => FRP
    fail: (data?: any, code?: number, executionTime?: number) => FRP
    error: (message?: string, code?: number, executionTime?: number) => FRP
  }
}
