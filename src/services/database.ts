import { MongoClient } from 'mongodb';
import { Platform } from '../platform';
import { IConfig } from './config';

export class DatabaseService {
  private platform: Platform;
  private config: IConfig;
  private url: string;

  // this boolean will be set to true if config is ok and we can connect to database
  private enabled = false;

  constructor(platform: Platform) {
    platform.logger.debug(`DatabaseService.constructor() -- start`);
    this.platform = platform;
    this.config = platform.config;
    this.url = this.dbUrl;

    MongoClient.connect(this.url, {
      useUnifiedTopology: true,
      useNewUrlParser: true,
    }, (connectErr, db) => {
      if (connectErr) {
        this.platform.logger.error(`DatabaseService.constructor() -- MongoClient.connect error: `, connectErr);
        throw connectErr;
      }
      this.enabled = true;
      this.platform.logger.debug(`DatabaseService.constructor() -- Client connected, created/openend database ${this.dbName}`);
      db.close();
      this.platform.logger.debug(`DatabaseService.constructor() -- Client closed db connection`);
    });
    this.platform.logger.debug(`DatabaseService.constructor() -- end`);
  }

  createCollection(collection: string): Promise<boolean> {
    return new Promise<boolean>((resolve: (result: boolean) => void, reject: (err: Error) => void) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr: Error, db: MongoClient) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.createCollection() -- MongoClient.connect error: `, connectErr);
            reject(connectErr);
            return;
          }
          const dbo = db.db(this.dbName);

          dbo.createCollection(collection, (createErr: Error) => {
            if (createErr) {
              this.platform.logger.error(`DatabaseService.createCollection() -- dbo.createCollection error: `, createErr);
              reject(createErr);
              return;
            }
            this.platform.logger.debug(`DatabaseService.createCollection() -- Collection '${collection}' created!`);
            resolve(true);
            db.close();
          });
        });
      } else {
        reject(new Error('DatabaseService is not enabled'));
      }
    });
  }

  insertIntoCollection(collection: string, document: any): Promise<boolean> {
    return new Promise<boolean>((resolve: (value: boolean) => void, reject: (err: Error) => void) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr: Error, db: MongoClient) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.insertIntoCollection() -- MongoClient.connect error: `, connectErr);
            reject(connectErr);
            return;
          }
          const dbo = db.db(this.dbName);

          dbo.collection(collection).insertOne(document, (insertErr: Error) => {
            if (insertErr) {
              this.platform.logger.error(`DatabaseService.insertIntoCollection() -- dbo.collection.insertOne error: `, insertErr);
              reject(insertErr);
              return;
            }
            this.platform.logger.debug(`DatabaseService.insertIntoCollection() -- Inserted 1 document into collection '${collection}'!`);
            resolve(true);
            db.close();
          });
        });
      } else {
        reject(new Error('DatabaseService is not enabled'));
      }
    });
  }

  findInCollection(collection: string, query: any): Promise<any> {
    return new Promise<any>((resolve: (value: any) => void, reject: (err: Error) => void) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr: Error, db: MongoClient) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.findInCollection() -- MongoClient.connect error: `, connectErr);
            reject(connectErr);
            return;
          }
          const dbo = db.db(this.dbName);

          dbo.collection(collection).findOne(query, (findErr, result) => {
            if (findErr) {
              this.platform.logger.error(`DatabaseService.findInCollection() -- dbo.collection.findOne error: `, findErr);
              reject(findErr);
            }
            this.platform.logger.debug(`DatabaseService.findInCollection() -- Found 1 document in collection '${collection}'!`);
            resolve(result);
            db.close();
          });
        });
      } else {
        reject(new Error('DatabaseService is not enabled'));
      }
    });
  }

  queryInCollection(collection: string, query: any): Promise<any[]> {
    return new Promise<any[]>((resolve: (value: any[]) => void, reject: (err: Error) => void) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr: Error, db: MongoClient) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.queryInCollection() -- MongoClient.connect error: `, connectErr);
            reject(connectErr);
            return;
          }
          const dbo = db.db(this.dbName);

          dbo.collection(collection).find(query).toArray((findErr, result) => {
            if (findErr) {
              this.platform.logger.error(`DatabaseService.queryInCollection() -- dbo.collection.find error: `, findErr);
              reject(findErr);
            }
            this.platform.logger.debug(`DatabaseService.queryInCollection() -- Found ${result.length} documents in collection '${collection}'!`);
            resolve(result);
            db.close();
          });
        });
      } else {
        reject(new Error('DatabaseService is not enabled'));
      }
    });
  }

  deleteFromCollection(collection: string, query: any): Promise<boolean> {
    return new Promise<boolean>((resolve: (value: boolean) => void, reject: (err: Error) => void) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr: Error, db: MongoClient) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.deleteFromCollection() -- MongoClient.connect error: `, connectErr);
            reject(connectErr);
            return;
          }
          const dbo = db.db(this.dbName);

          dbo.collection(collection).deleteOne(query, (findErr) => {
            if (findErr) {
              this.platform.logger.error(`DatabaseService.deleteFromCollection() -- dbo.collection.find error: `, findErr);
              reject(findErr);
            }
            this.platform.logger.debug(`DatabaseService.deleteFromCollection() -- Deleted 1 document from collection '${collection}'!`);
            resolve(true);
            db.close();
          });
        });
      } else {
        reject(new Error('DatabaseService is not enabled'));
      }
    });
  }

  updateInCollection(collection: string, query: any, values: any): Promise<boolean> {
    return new Promise<boolean>((resolve: (value: boolean) => void, reject: (err: Error) => void) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr: Error, db: MongoClient) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.updateInCollection() -- MongoClient.connect error: `, connectErr);
            reject(connectErr);
            return;
          }
          const dbo = db.db(this.dbName);

          dbo.collection(collection).updateOne(query, { $set: values }, (updateErr) => {
            if (updateErr) {
              this.platform.logger.error(`DatabaseService.updateInCollection() -- dbo.collection.updateOne error: `, updateErr);
              reject(updateErr);
            }
            this.platform.logger.debug(`DatabaseService.updateInCollection() -- Updated 1 document in collection '${collection}'!`);
            resolve(true);
            db.close();
          });
        });
      } else {
        reject(new Error('DatabaseService is not enabled'));
      }
    });
  }

  dropCollection(collection: string): Promise<boolean> {
    return new Promise<boolean>((resolve: (value: boolean) => void, reject: (err: Error) => void) => {
      if (this.enabled) {
        MongoClient.connect(this.url, {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }, (connectErr: Error, db: MongoClient) => {
          if (connectErr) {
            this.platform.logger.error(`DatabaseService.dropCollection() -- MongoClient.connect error: `, connectErr);
            reject(connectErr);
            return;
          }
          const dbo = db.db(this.dbName);

          dbo.collection(collection).drop((dropErr: Error, ok: boolean) => {
            if (dropErr) {
              this.platform.logger.error(`DatabaseService.dropCollection() -- dbo.collection.drop error: `, dropErr);
              reject(dropErr);
            }
            this.platform.logger.debug(`DatabaseService.dropCollection() -- Dropped collection '${collection}'!`);
            resolve(ok);
            db.close();
          });
        });
      } else {
        reject(new Error('DatabaseService is not enabled'));
      }
    });
  }

  private get dbName(): string {
    return this.config.mongoDB.db;
  }

  private get dbUrl(): string {
    return this.config.mongoDB.url
      .replace('{db}', this.config.mongoDB.db)
      .replace('{username}', this.config.mongoDB.username)
      .replace('{password}', this.config.mongoDB.password);
  }
}
