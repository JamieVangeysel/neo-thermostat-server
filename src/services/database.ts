import type { Platform } from '../platform'
import type { IConfigV3 } from './config'
import * as mongodb from 'mongodb'

const MongoClient: any = (mongodb as any).MongoClient ?? (mongodb as any).default.MongoClient

function errorSummary(error: unknown): { name: string; code?: string | number } {
  const value = error as { name?: string; code?: string | number }
  return { name: value?.name ?? 'UnknownError', ...(value?.code !== undefined ? { code: value.code } : {}) }
}

export class DatabaseService {
  private readonly platform: Platform
  private readonly config: IConfigV3
  private readonly url: string
  private _enabled = false

  constructor(platform: Platform) {
    this.platform = platform
    this.config = platform.config
    this.url = this.config.mongoDB?.url.trim() ? this.dbUrl : ''
  }

  async init(): Promise<void> {
    if (!this.url) {
      this._enabled = false
      this.platform.logger.info('MongoDB not configured; persistence is disabled')
      return
    }

    let client: any
    try {
      client = await this.openClient()
      await client.db(this.dbName).command({ ping: 1 })
      this._enabled = true
      this.platform.logger.info('MongoDB connection verified')
    } catch (error) {
      this._enabled = false
      this.platform.logger.warn('MongoDB unavailable; continuing without optional persistence', errorSummary(error))
    } finally {
      if (client) {
        try {
          await this.closeClient(client)
        } catch {
          this._enabled = false
          this.platform.logger.warn('Could not close the optional MongoDB startup connection')
        }
      }
    }
  }

  async close(): Promise<void> {
    // Operations use short-lived clients and close them in finally blocks.
    this.platform.logger.debug('DatabaseService.close() -- disabling persistence')
    this._enabled = false
  }

  createCollection(collection: string): Promise<boolean> {
    return this.withDatabase(`DatabaseService.createCollection('${collection}')`, async db => {
      await db.createCollection(collection)
      return true
    })
  }

  insertIntoCollection(collection: string, document: any): Promise<boolean> {
    return this.withDatabase(`DatabaseService.insertIntoCollection('${collection}')`, async db => {
      await db.collection(collection).insertOne(document)
      return true
    })
  }

  findInCollection(collection: string, query: any): Promise<any> {
    return this.withDatabase(`DatabaseService.findInCollection('${collection}')`, db => db.collection(collection).findOne(query))
  }

  queryInCollection(collection: string, query: any): Promise<any[]> {
    return this.withDatabase(`DatabaseService.queryInCollection('${collection}')`, db => db.collection(collection).find(query).toArray())
  }

  deleteFromCollection(collection: string, query: any): Promise<boolean> {
    return this.withDatabase(`DatabaseService.deleteFromCollection('${collection}')`, async db => {
      await db.collection(collection).deleteOne(query)
      return true
    })
  }

  updateInCollection(collection: string, query: any, values: any): Promise<boolean> {
    return this.withDatabase(`DatabaseService.updateInCollection('${collection}')`, async db => {
      await db.collection(collection).updateOne(query, { $set: values })
      return true
    })
  }

  dropCollection(collection: string): Promise<boolean> {
    return this.withDatabase(`DatabaseService.dropCollection('${collection}')`, async db => {
      await db.collection(collection).drop()
      return true
    })
  }

  private async withDatabase<T>(operationName: string, operation: (db: any) => Promise<T>): Promise<T> {
    if (!this.enabled || !this.url) {
      this.platform.logger.warn(`${operationName} -- persistence is disabled`)
      throw new Error('DatabaseService is not enabled')
    }
    let client: any
    try {
      this.platform.logger.debug(`${operationName} -- connecting`)
      client = await this.openClient()
      const result = await operation(client.db(this.dbName))
      this.platform.logger.debug(`${operationName} -- complete`)
      return result
    } catch (error) {
      this.platform.logger.error(`${operationName} -- failed`, errorSummary(error))
      throw error
    } finally {
      if (client) {
        try {
          await this.closeClient(client)
        } catch (error) {
          this.platform.logger.error(`${operationName} -- failed to close database connection`, errorSummary(error))
          throw error
        }
      }
    }
  }

  private openClient(): Promise<any> {
    return new Promise((resolve, reject) => {
      MongoClient.connect(this.url, {
        useUnifiedTopology: true,
        useNewUrlParser: true,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000
      }, (error: Error | null, client: any) => {
        if (error) reject(error)
        else resolve(client)
      })
    })
  }

  private closeClient(client: any): Promise<void> {
    return new Promise((resolve, reject) => {
      client.close(false, (error?: Error) => error ? reject(error) : resolve())
    })
  }

  private get dbName(): string {
    return this.config.mongoDB?.db ?? ''
  }

  private get dbUrl(): string {
    const mongo = this.config.mongoDB
    if (!mongo) return ''
    return mongo.url
      .replace('{db}', mongo.db)
      .replace('{username}', mongo.username)
      .replace('{password}', mongo.password)
  }

  get enabled(): boolean {
    return this._enabled
  }
}
