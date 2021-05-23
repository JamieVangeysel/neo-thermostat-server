const fs = require('fs')
const Logger = require('./logging/logger').default
const logger = new Logger()

class FileSystem {
  /**
   * Creates an instance of FileSystem.
   * @memberof FileSystem
   */
  constructor() {}

  /**
   * Check if path exists and is accessible, promise will be rejected on error.
   * @param {string} path The path to verify.
   * @returns {Promise<boolean>}
   */
  exists(path) {
    logger.debug(`FileSystem.exists() -- start`)
    return new Promise((resolve, reject) => {
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
   * @param {string} path The path to the file.
   * @returns {Promise<Buffer>}
   */
  readFile(path) {
    logger.debug(`FileSystem.readFile() -- start`)
    return new Promise((resolve, reject) => {
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
   * @param {string} path The path to the file.
   * @param {Buffer} text The text to write to file
   * @returns {Promise<boolean>}
   */
  writeFile(path, bytes) {
    logger.debug(`FileSystem.writeFile() -- start`)
    return new Promise((resolve, reject) => {
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
   * @param {string} path The path to the file.
   * @param {Buffer} text The text to append to file
   * @returns {Promise<boolean>}
   */
  writeAppendFile(path, bytes) {
    logger.debug(`FileSystem.writeAppendFile() -- start`)
    return new Promise((resolve, reject) => {
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
   * @param {string} path The path to the file or folder.
   * @returns {Promise<boolean>}
   */
  delete(path) {
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

  /**
   * @description
   * @param {string} text
   * @return {Buffer}
   * @memberof FileSystem
   */
  toBuffer(text) {
    return Buffer.from(text)
  }

  /**
   * @description
   * @param {any} object
   * @return {string}
   * @memberof FileSystem
   */
  toJson(object) {
    const obj = JSON.stringify(object)
    return obj
  }

  /**
   * @description
   * @param {string} text
   * @return {any}
   * @memberof FileSystem
   */
  fromJson(text) {
    const obj = JSON.parse(text)
    return obj
  }

  /**
   * @description
   * @param {Buffer} buffer
   * @return {IConfig}
   * @memberof FileSystem
   */
  checkBuffer(buffer) {
    if (buffer) {
      logger.debug(`checkBuffer() -- buffer is not null.`)
      /** @type {string} */
      const configText = buffer.toString()
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

module.exports = {
  default: FileSystem
}