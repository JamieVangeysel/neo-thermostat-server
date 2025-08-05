import * as fs from 'node:fs'
import { Logger } from './logging/logger'
import { IConfig } from './config'

const logger: Logger = new Logger()

export class FileSystem {
  exists(path: string): Promise<boolean> {
    logger.debug(`FileSystem.exists() -- start`)
    return new Promise<boolean>((resolve, reject) => {
      try {
        fs.access(path, (err) => {
          if (!err) {
            logger.debug(`FileSystem.exists() -- resolved to ${true}`)
            resolve(true)
            return
          }
          resolve(false)
        })
      } catch (err) {
        logger.error(`FileSystem.exists() -- err ${err}`)
        reject(err)
      }
    })
  }

  /**
   * Read file contents and returns Buffer
   */
  readFile(path: string): Promise<Buffer> {
    logger.debug(`FileSystem.readFile() -- start`)
    return new Promise<Buffer>((resolve, reject) => {
      try {
        fs.readFile(path, (err, data) => {
          if (err) {
            reject(err)
          }
          logger.debug(`FileSystem.readFile() -- ok`)
          resolve(data)
        })
      } catch (err) {
        logger.error(`FileSystem.readFile() -- err ${err}`)
        reject(err)
      }
    })
  }

  /**
   * Writes text to a file and returns true if the operation is completed.
   */
  writeFile(path: string, bytes: Buffer): Promise<boolean> {
    logger.debug(`FileSystem.writeFile() -- start`)
    return new Promise<boolean>((resolve, reject) => {
      try {
        fs.writeFile(path, bytes, (err) => {
          if (err) {
            resolve(false)
          }
          logger.debug(`FileSystem.writeFile() -- ok`)
          resolve(true)
        })
      } catch (err) {
        logger.error(`FileSystem.writeFile() -- err ${err}`)
        reject(err)
      }
    })
  }

  /**
   * Appends text to a file and returns true if the operation is completed.
   */
  writeAppendFile(path: string, bytes: Buffer): Promise<boolean> {
    logger.debug(`FileSystem.writeAppendFile() -- start`)
    return new Promise<boolean>((resolve, reject) => {
      try {
        fs.appendFile(path, bytes, (err) => {
          if (err) {
            resolve(false)
          }
          logger.debug(`FileSystem.writeAppendFile() -- ok`)
          resolve(true)
        })
      } catch (err) {
        logger.error(`FileSystem.writeAppendFile() -- err ${err}`)
        reject(err)
      }
    })
  }

  /**
   * Deletes the file or folder at a given path
   */
  delete(path: string): Promise<boolean> {
    logger.debug(`FileSystem.delete() -- start`)
    return new Promise((resolve, reject) => {
      try {
        fs.unlink(path, (err) => {
          if (err) {
            resolve(false)
          }
          logger.debug(`FileSystem.delete() -- ok`)
          resolve(true)
        })
      } catch (err) {
        logger.error(`FileSystem.delete() -- err ${err}`)
        reject(err)
      }
    })
  }

  toBuffer(text: string): Buffer {
    return Buffer.from(text)
  }

  toJson(object: any): string {
    return JSON.stringify(object)
  }

  /**
   * @description
   * @param {string} text
   * @return {any}
   * @memberof FileSystem
   */
  fromJson<T>(text: string): T {
    return JSON.parse(text) as T
  }

  checkBuffer(buffer: Buffer): IConfig {
    if (buffer) {
      logger.debug(`checkBuffer() -- buffer is not null.`)
      /** @type {string} */
      const configText: string = buffer.toString()
      try {
        /** @type {IConfig} */
        const configObj = JSON.parse(configText)
        logger.debug(`checkBuffer() -- buffer is JSON.`)
        if (configObj && configObj.version >= 2) {
          logger.debug(`checkBuffer() -- config is instance and version is correct.`)
          return configObj
        }
        logger.debug(`checkBuffer() -- config does not contain required keys.`)
      } catch (e) {
        logger.debug(`checkBuffer() -- buffer not JSON, ${e}.`)
      }
    }

    return null
  }
}
