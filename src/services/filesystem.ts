import * as fs from 'fs'
import { IConfig } from './config'
import { Logger } from './logging/logger'
const logger = new Logger()

export class FileSystem {
  /**
   * Check if path exists and is accessible, promise will be rejected on error.
   * @param path The path to verify.
   */
  public exists(path: string): Promise<boolean> {
    logger.debug(`FileSystem.exists() -- start`)
    return new Promise<boolean>((resolve: (value: boolean) => void, reject: (err: Error) => void) => {
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
   * @param path The path to the file.
   */
  public readFile(path: string): Promise<Buffer> {
    logger.debug(`FileSystem.readFile() -- start`)
    return new Promise<any>((resolve: (value: Buffer) => void, reject: (err: Error) => void) => {
      try {
        fs.readFile(path, (err, data) => {
          if (err) { reject(err) }
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
   * @param path The path to the file.
   * @param text The text to write to file
   */
  public writeFile(path: string, bytes: Buffer): Promise<boolean> {
    logger.debug(`FileSystem.writeFile() -- start`)
    return new Promise<boolean>((resolve: (value: boolean) => void, reject: (err: Error) => void) => {
      try {
        fs.writeFile(path, bytes, (err) => {
          if (err) { resolve(false) }
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
   * @param path The path to the file.
   * @param text The text to append to file
   */
  public writeAppendFile(path: string, bytes: Buffer): Promise<boolean> {
    logger.debug(`FileSystem.writeAppendFile() -- start`)
    return new Promise<any>((resolve: (value: boolean) => void, reject: (err: Error) => void) => {
      try {
        fs.appendFile(path, bytes, (err) => {
          if (err) { resolve(false) }
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
   * @param path The path to the file or folder.
   */
  public delete(path: string): Promise<boolean> {
    logger.debug(`FileSystem.delete() -- start`)
    return new Promise<boolean>((resolve: (value: boolean) => void, reject: (err: Error) => void) => {
      try {
        fs.unlink(path, (err) => {
          if (err) { resolve(false) }
          logger.debug(`FileSystem.delete() -- ok`)
          resolve(true)
        })
      } catch (err) {
        logger.error(`FileSystem.delete() -- err ${err}`)
        reject(err)
      }
    })
  }

  public toBuffer(text: string): Buffer {
    return Buffer.from(text)
  }

  public toJson(object: any): string {
    const obj = JSON.stringify(object)
    return obj
  }

  public fromJson(text: string): any {
    const obj = JSON.parse(text)
    return obj
  }

  public checkBuffer(buffer: Buffer): IConfig {
    if (buffer) {
      logger.debug(`checkBuffer() -- buffer is not null.`)
      const configText: string = buffer.toString()
      try {
        const configObj: IConfig = JSON.parse(configText)
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
