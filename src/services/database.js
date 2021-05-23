const MongoClient = require('mongodb')

class DatabaseService {
  /**
   * @description
   * @private
   * @type {Platform}
   * @memberof DatabaseService
   */
  platform
  /**
   * @description
   * @private
   * @type {IConfig}
   * @memberof DatabaseService
   */
  config
  /**
   * @description
   * @private
   * @type {string}
   * @memberof DatabaseService
   */
  url

  /**
   * @description This boolean will be set to true if config is ok and we can connect to database
   * @private
   * @memberof DatabaseService
   */
  enabled = false

  /**
   * Creates an instance of DatabaseService.
   * @param {Platform} platform
   * @memberof DatabaseService
   */
  constructor(platform) {
    platform.logger.debug(`DatabaseService.constructor() -- start`)
    this.platform = platform
    this.config = platform.config
    this.url = this.dbUrl
    this.platform.logger.debug(`DatabaseService.constructor() -- end`)
  }

  async init() {
    this.platform.logger.debug(`DatabaseService.init() -- start`)
    return new Promise((resolve, reject) => {
      if (this.url.length === 0) {
        return reject(new Error('no Database config was provided'))
      }
      MongoClient.connect(this.url, {
        useUnifiedTopology: true,
        useNewUrlParser: true,
      }, (connectErr, db) => {
        if (connectErr) {
          this.platform.logger.error(`DatabaseService.init() -- MongoClient.connect error: `, connectErr)
          return reject(connectErr)
        }
        this.enabled = true
        this.platform.logger.debug(`DatabaseService.init() -- Client connected, created/openend database ${this.dbName}`)
        db.close()
        this.platform.logger.debug(`DatabaseService.init() -- Client closed db connection`)
        return resolve()
      })
    })
  }

  /**
   * @description
   * @param {string} collection
   * @return {Promise<boolean>}
   * @memberof DatabaseService
   */
  createCollection(collection) {
    return new Promise((resolve, reject) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr, db) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.createCollection() -- MongoClient.connect error: `, connectErr)
            reject(connectErr)
            return
          }
          const dbo = db.db(this.dbName)

          dbo.createCollection(collection, (createErr) => {
            if (createErr) {
              this.platform.logger.error(`DatabaseService.createCollection() -- dbo.createCollection error: `, createErr)
              reject(createErr)
              return
            }
            this.platform.logger.debug(`DatabaseService.createCollection() -- Collection '${collection}' created!`)
            resolve(true)
            db.close()
          })
        })
      } else {
        reject(new Error('DatabaseService is not enabled'))
      }
    })
  }

  /**
   * @description
   * @param {string} collection
   * @param {any} document
   * @return {Promise<boolean>}
   * @memberof DatabaseService
   */
  insertIntoCollection(collection, document) {
    return new Promise((resolve, reject) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr, db) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.insertIntoCollection() -- MongoClient.connect error: `, connectErr)
            reject(connectErr)
            return
          }
          const dbo = db.db(this.dbName)

          dbo.collection(collection).insertOne(document, (insertErr) => {
            if (insertErr) {
              this.platform.logger.error(`DatabaseService.insertIntoCollection() -- dbo.collection.insertOne error: `, insertErr)
              reject(insertErr)
              return
            }
            this.platform.logger.debug(`DatabaseService.insertIntoCollection() -- Inserted 1 document into collection '${collection}'!`)
            resolve(true)
            db.close()
          })
        })
      } else {
        reject(new Error('DatabaseService is not enabled'))
      }
    })
  }

  /**
   * @description
   * @param {string} collection
   * @param {any} query
   * @return {Promise<any>}
   * @memberof DatabaseService
   */
  findInCollection(collection, query) {
    return new Promise((resolve, reject) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr, db) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.findInCollection() -- MongoClient.connect error: `, connectErr)
            reject(connectErr)
            return
          }
          const dbo = db.db(this.dbName)

          dbo.collection(collection).findOne(query, (findErr, result) => {
            if (findErr) {
              this.platform.logger.error(`DatabaseService.findInCollection() -- dbo.collection.findOne error: `, findErr)
              reject(findErr)
            }
            this.platform.logger.debug(`DatabaseService.findInCollection() -- Found 1 document in collection '${collection}'!`)
            resolve(result)
            db.close()
          })
        })
      } else {
        reject(new Error('DatabaseService is not enabled'))
      }
    })
  }
  /**
   *
   *
   * @param {string} collection
   * @param {any} query
   * @return {Promise<any[]>}
   * @memberof DatabaseService
   */
  queryInCollection(collection, query) {
    return new Promise((resolve, reject) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr, db) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.queryInCollection() -- MongoClient.connect error: `, connectErr)
            reject(connectErr)
            return
          }
          const dbo = db.db(this.dbName)

          dbo.collection(collection).find(query).toArray((findErr, result) => {
            if (findErr) {
              this.platform.logger.error(`DatabaseService.queryInCollection() -- dbo.collection.find error: `, findErr)
              reject(findErr)
            }
            this.platform.logger.debug(`DatabaseService.queryInCollection() -- Found ${result.length} documents in collection '${collection}'!`)
            resolve(result)
            db.close()
          })
        })
      } else {
        reject(new Error('DatabaseService is not enabled'))
      }
    })
  }

  /**
   * @description
   * @param {string} collection
   * @param {any} query
   * @return {Promise<boolean>}
   * @memberof DatabaseService
   */
  deleteFromCollection(collection, query) {
    return new Promise((resolve, reject) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr, db) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.deleteFromCollection() -- MongoClient.connect error: `, connectErr)
            reject(connectErr)
            return
          }
          const dbo = db.db(this.dbName)

          dbo.collection(collection).deleteOne(query, (findErr) => {
            if (findErr) {
              this.platform.logger.error(`DatabaseService.deleteFromCollection() -- dbo.collection.find error: `, findErr)
              reject(findErr)
            }
            this.platform.logger.debug(`DatabaseService.deleteFromCollection() -- Deleted 1 document from collection '${collection}'!`)
            resolve(true)
            db.close()
          })
        })
      } else {
        reject(new Error('DatabaseService is not enabled'))
      }
    })
  }

  /**
   * @description 
   * @param {string} collection
   * @param {any} query
   * @param {any} values
   * @return {Promise<boolean>}
   * @memberof DatabaseService
   */
  updateInCollection(collection, query, values) {
    return new Promise((resolve, reject) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr, db) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.updateInCollection() -- MongoClient.connect error: `, connectErr)
            reject(connectErr)
            return
          }
          const dbo = db.db(this.dbName)

          dbo.collection(collection).updateOne(query, {
            $set: values
          }, (updateErr) => {
            if (updateErr) {
              this.platform.logger.error(`DatabaseService.updateInCollection() -- dbo.collection.updateOne error: `, updateErr)
              reject(updateErr)
            }
            this.platform.logger.debug(`DatabaseService.updateInCollection() -- Updated 1 document in collection '${collection}'!`)
            resolve(true)
            db.close()
          })
        })
      } else {
        reject(new Error('DatabaseService is not enabled'))
      }
    })
  }

  /**
   * @param {string} collection
   * @return {Promise<boolean>}
   * @memberof DatabaseService
   */
  dropCollection(collection) {
    return new Promise((resolve, reject) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr, db) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.dropCollection() -- MongoClient.connect error: `, connectErr)
            reject(connectErr)
            return
          }
          const dbo = db.db(this.dbName)

          dbo.collection(collection).drop((dropErr, ok) => {
            if (dropErr) {
              this.platform.logger.error(`DatabaseService.dropCollection() -- dbo.collection.drop error: `, dropErr)
              reject(dropErr)
            }
            this.platform.logger.debug(`DatabaseService.dropCollection() -- Dropped collection '${collection}'!`)
            resolve(ok)
            db.close()
          })
        })
      } else {
        reject(new Error('DatabaseService is not enabled'))
      }
    })
  }

  /**
   *
   * @readonly
   * @private
   * @type {string}
   * @memberof DatabaseService
   */
  get dbName() {
    return this.config.mongoDB.db
  }

  /**
   *
   * @readonly
   * @private
   * @type {string}
   * @memberof DatabaseService
   */
  get dbUrl() {
    return this.config.mongoDB.url
      .replace('{db}', this.config.mongoDB.db)
      .replace('{username}', this.config.mongoDB.username)
      .replace('{password}', this.config.mongoDB.password)
  }
}

module.exports = {
  default: DatabaseService
}