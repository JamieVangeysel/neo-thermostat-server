class Logger {
  /**
   * @description
   * @private
   * @type {LogLevel}
   * @memberof Logger
   */
  level = LogLevel.All

  /**
   * @description
   * @type {boolean}
   * @memberof Logger
   */
  logWithDate = true

  constructor() {}

  /**
   * @description
   * @param {string} message
   * @param {...any[]} optionalParams
   * @memberof Logger
   */
  log(message, ...optionalParams) {
    this.writeToLog(`\x1b[37m${message}`, LogLevel.All, optionalParams)
  }

  /**
   * @description
   * @param {string} message
   * @param {...any[]} optionalParams
   * @memberof Logger
   */
  debug(message, ...optionalParams) {
    this.writeToLog(`\x1b[35m${message}`, LogLevel.Debug, optionalParams)
  }

  /**
   * @description
   * @param {string} message
   * @param {...any[]} optionalParams
   * @memberof Logger
   */
  info(message, ...optionalParams) {
    this.writeToLog(`\x1b[34m${message}`, LogLevel.Info, optionalParams)
  }

  /**
   * @description
   * @param {string} message
   * @param {...any[]} optionalParams
   * @memberof Logger
   */
  warn(message, ...optionalParams) {
    this.writeToLog(`\x1b[33m${message}`, LogLevel.Warn, optionalParams)
  }

  /**
   * @description
   * @param {string} message
   * @param {...any[]} optionalParams
   * @memberof Logger
   */
  error(message, ...optionalParams) {
    this.writeToLog(`\x1b[31m${message}`, LogLevel.Error, optionalParams)
  }

  /**
   * @description
   * @param {string} message
   * @param {...any[]} optionalParams
   * @memberof Logger
   */
  fatal(message, ...optionalParams) {
    this.writeToLog(`\x1b[1m${message}`, LogLevel.Fatal, optionalParams)
  }

  /**
   * @description Write
   * @private
   * @param {string} msg
   * @param {LogLevel} level
   * @param {any[]} params
   * @memberof Logger
   */
  writeToLog(msg, level, params) {
    if (this.shouldLog(level)) {
      const entry = new LogEntry()
      entry.entryDate = new Date()
      entry.message = msg
      entry.level = level
      entry.extraInfo = params
      entry.logWithDate = this.logWithDate

      console.log(entry.buildLogString())
    }
  }

  /**
   * @type {LogLevel}
   * @memberof Logger
   */
  get Level() {
    return this.level
  }

  /**
   *
   * @param {LogLevel} value
   * @memberof Logger
   */
  set Level(value) {
    this.level = value
  }

  /**
   * @description
   * @private
   * @param {LogLevel} level
   * @return {boolean}
   * @memberof Logger
   */
  shouldLog(level) {
    let ret = false
    if ((level >= this.level &&
        level !== LogLevel.Off) ||
      this.level === LogLevel.All) {
      ret = true
    }
    return ret
  }
}

const LogLevel = {
  All: 0,
  Debug: 1,
  Info: 2,
  Warn: 3,
  Error: 4,
  Fatal: 5,
  Off: 6
}

class LogEntry {
  /**
   * @type {Date}
   * @memberof LogEntry
   */
  entryDate = new Date()
  /**
   * @default LogLevel.Debug
   * @type {LogLevel}
   * @memberof LogEntry
   */
  level = LogLevel.Debug
  /**
   * @type {any[]}
   * @memberof LogEntry
   */
  extraInfo = []
  /**
   * @type {boolean}
   * @memberof LogEntry
   */
  logWithDate = true

  /**
   *
   *
   * @return {string} 
   * @memberof LogEntry
   */
  buildLogString() {
    let ret = ''

    if (this.logWithDate) {
      ret = '[' + this.entryDate.toISOString().replace('T', ' ').replace('Z', '') + '] '
    }

    let logLevel = 'None'
    switch (this.level) {
      case LogLevel.All:
        logLevel = 'All'
        break

      case LogLevel.Debug:
        logLevel = 'Debug'
        break

      case LogLevel.Info:
        logLevel = 'Info'
        break

      case LogLevel.Warn:
        logLevel = 'Warn'
        break

      case LogLevel.Error:
        logLevel = 'Error'
        break

      case LogLevel.Fatal:
        logLevel = 'Fatal'
        break
    }

    ret += logLevel.padEnd(5, ' ')
    ret += ': ' + this.message
    if (this.extraInfo.length) {
      ret += ' - Extra Info: ' +
        this.formatParams(this.extraInfo)
    }

    return ret + '\x1b[0m'
  }

  /**
   * @description
   * @private
   * @param {any[]} params
   * @return {string}  {string}
   * @memberof LogEntry
   */
  formatParams(params) {
    let ret = params.join(',')

    // Is there at least one object in the array?
    if (params.some(p => typeof p === 'object')) {
      ret = ''
      // Build comma-delimited string
      for (const item of params) {
        ret += JSON.stringify(item) + ','
      }
    }

    return ret
  }
}

module.exports = {
  default: Logger
}