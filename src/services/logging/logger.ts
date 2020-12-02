export class Logger {
  private level: LogLevel = LogLevel.All;
  logWithDate = true;

  constructor() {
  }

  log(message: string, ...optionalParams: any[]) {
    this.writeToLog(`\x1b[37m${message}`, LogLevel.All, optionalParams);
  }

  debug(message: string, ...optionalParams: any[]) {
    this.writeToLog(`\x1b[35m${message}`, LogLevel.Debug, optionalParams);
  }

  info(message: string, ...optionalParams: any[]) {
    this.writeToLog(`\x1b[34m${message}`, LogLevel.Info, optionalParams);
  }

  warn(message: string, ...optionalParams: any[]) {
    this.writeToLog(`\x1b[33m${message}`, LogLevel.Warn, optionalParams);
  }

  error(message: string, ...optionalParams: any[]) {
    this.writeToLog(`\x1b[31m${message}`, LogLevel.Error, optionalParams);
  }

  fatal(message: string, ...optionalParams: any[]) {
    this.writeToLog(`\x1b[1m${message}`, LogLevel.Fatal, optionalParams);
  }

  private writeToLog(msg: string, level: LogLevel, params: any[]) {
    // disable logging
    // return;
    if (this.shouldLog(level)) {
      const entry: LogEntry = new LogEntry();
      entry.entryDate = new Date();
      entry.message = msg;
      entry.level = level;
      entry.extraInfo = params;
      entry.logWithDate = this.logWithDate;

      console.log(entry.buildLogString());
    }
  }

  get Level(): LogLevel {
    return this.level;
  }

  set Level(value: LogLevel) {
    this.level = value;
  }

  private shouldLog(level: LogLevel): boolean {
    let ret = false;
    if ((level >= this.level &&
      level !== LogLevel.Off) ||
      this.level === LogLevel.All) {
      ret = true;
    }
    return ret;
  }
}

export class LogEntry {
  // Public Properties
  entryDate: Date = new Date();
  message = '';
  level: LogLevel = LogLevel.Debug;
  extraInfo: any[] = [];
  logWithDate = true;

  buildLogString(): string {
    let ret = '';

    if (this.logWithDate) {
      ret = '[' + this.entryDate.toISOString().replace('T', ' ').replace('Z', '') + '] ';
    }
    ret += '' + LogLevel[this.level].padEnd(5, ' ');
    ret += ' - ' + this.message;
    if (this.extraInfo.length) {
      ret += ' - Extra Info: '
        + this.formatParams(this.extraInfo);
    }

    return ret + '\x1b[0m';
  }

  private formatParams(params: any[]): string {
    let ret: string = params.join(',');

    // Is there at least one object in the array?
    if (params.some(p => typeof p === 'object')) {
      ret = '';
      // Build comma-delimited string
      for (const item of params) {
        ret += JSON.stringify(item) + ',';
      }
    }

    return ret;
  }
}

export enum LogLevel {
  All = 0,
  Debug = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
  Fatal = 5,
  Off = 6
}
