import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { IConfig, IConfigV3 } from './config'

export interface ConfigLogger {
  debug?: (...args: any[]) => void
  info?: (...args: any[]) => void
  warn?: (...args: any[]) => void
  error?: (...args: any[]) => void
}

const knownSwitchTypes = new Set<string>([
  'HEAT', 'HEAT_VALVE', 'HEAT_ELEMENT', 'WATER_VALVE',
  'COOL', 'COOL_ELEMENT', 'COOL_VALVE', 'VENT', 'NONE'
])

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateConfig(value: unknown): asserts value is IConfigV3 {
  if (!isRecord(value)) throw new Error('Invalid config: expected an object')
  if (value.version !== 3) throw new Error(`Unsupported config version '${String(value.version)}'`)
  if (typeof value.hostname !== 'string' || value.hostname.trim() === '') throw new Error("Invalid config: 'hostname' is required")
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65534) {
    throw new Error('Invalid config: port must be an integer from 1 to 65534')
  }
  if (typeof value.weatherMapApiKey !== 'string') throw new Error("Invalid config: 'weatherMapApiKey' must be a string")
  if (!isRecord(value.relais) || typeof value.relais.hostname !== 'string' || value.relais.hostname.trim() === '' || typeof value.relais.secure !== 'boolean') {
    throw new Error("Invalid config: 'relais' must contain hostname and secure fields")
  }
  if (!Array.isArray(value.instances)) throw new Error("Invalid config: 'instances' must be an array")

  const names = new Set<string>()
  for (const [index, instance] of value.instances.entries()) {
    const prefix = `instances[${index}]`
    if (!isRecord(instance)) throw new Error(`Invalid config: '${prefix}' must be an object`)
    const name = instance.name ?? 'default'
    if (typeof name !== 'string' || name.trim() === '') throw new Error(`Invalid config: '${prefix}.name' must be a non-empty string`)
    if (names.has(name)) throw new Error(`Invalid config: duplicate instance name '${name}'`)
    names.add(name)
    if (typeof instance.temperatureSensor !== 'string' || instance.temperatureSensor.trim() === '') {
      throw new Error(`Invalid config: '${prefix}.temperatureSensor' is required`)
    }
    if (instance.mqttTopics !== undefined) {
      if (!isRecord(instance.mqttTopics)) throw new Error(`Invalid config: '${prefix}.mqttTopics' must be an object`)
      for (const topicGroup of ['temperature', 'thermostatStatus']) {
        const topics = instance.mqttTopics[topicGroup]
        if (topics === undefined) continue
        if (!Array.isArray(topics)) throw new Error(`Invalid config: '${prefix}.mqttTopics.${topicGroup}' must be an array`)
        for (const [topicIndex, topic] of topics.entries()) {
          if (typeof topic !== 'string' || topic.length === 0 || topic.trim() !== topic || /[\u0000\r\n]/.test(topic)) {
            throw new Error(`Invalid config: '${prefix}.mqttTopics.${topicGroup}[${topicIndex}]' must be a non-empty exact topic`)
          }
          if (/[+#]/.test(topic)) {
            throw new Error(`Invalid config: '${prefix}.mqttTopics.${topicGroup}[${topicIndex}]' must be an exact topic without wildcards`)
          }
        }
      }
    }
    if (!Array.isArray(instance.switches)) throw new Error(`Invalid config: '${prefix}.switches' must be an array`)
    const pins = new Set<number>()
    for (const [switchIndex, relay] of instance.switches.entries()) {
      const switchPath = `${prefix}.switches[${switchIndex}]`
      if (!isRecord(relay) || !Number.isInteger(relay.pinIndex) || relay.pinIndex < 1) {
        throw new Error(`Invalid config: '${switchPath}.pinIndex' must be a positive integer`)
      }
      if (pins.has(relay.pinIndex)) throw new Error(`Invalid config: duplicate pinIndex ${relay.pinIndex} in '${prefix}'`)
      pins.add(relay.pinIndex)
      if (!knownSwitchTypes.has(relay.type)) throw new Error(`Invalid config: unsupported switch type in '${switchPath}'`)
      if (typeof relay.active !== 'boolean') throw new Error(`Invalid config: '${switchPath}.active' must be boolean`)
    }

    const state = instance.thermostatState
    if (!isRecord(state)) throw new Error(`Invalid config: '${prefix}.thermostatState' must be an object`)
    for (const key of ['currentTemperature', 'currentRelativeHumidity', 'targetTemperature']) {
      if (typeof state[key] !== 'number' || !Number.isFinite(state[key])) {
        throw new Error(`Invalid config: '${prefix}.thermostatState.${key}' must be finite`)
      }
    }
    if (state.currentRelativeHumidity < 0 || state.currentRelativeHumidity > 100) {
      throw new Error(`Invalid config: '${prefix}.thermostatState.currentRelativeHumidity' must be 0..100`)
    }
    if (![0, 1, 2, 3].includes(state.currentHeatingCoolingState) ||
        ![0, 1, 2, 3].includes(state.targetHeatingCoolingState)) {
      throw new Error(`Invalid config: '${prefix}.thermostatState' has an invalid heating/cooling state`)
    }
    if (![0, 1].includes(state.temperatureDisplayUnits)) {
      throw new Error(`Invalid config: '${prefix}.thermostatState.temperatureDisplayUnits' is invalid`)
    }
  }

  if (value.mongoDB !== undefined) {
    if (!isRecord(value.mongoDB)) throw new Error("Invalid config: 'mongoDB' must be an object when present")
    for (const key of ['url', 'db', 'username', 'password']) {
      if (typeof value.mongoDB[key] !== 'string') throw new Error(`Invalid config: 'mongoDB.${key}' must be a string`)
    }
    if (value.mongoDB.url.trim() && !value.mongoDB.db.trim()) {
      throw new Error("Invalid config: 'mongoDB.db' is required when mongoDB.url is configured")
    }
  }
}

export class ConfigService {
  private readonly filePath: string
  private readonly logger: ConfigLogger

  constructor(logger: ConfigLogger = console, filePath: string = path.resolve(process.cwd(), 'config.json')) {
    this.logger = logger
    this.filePath = path.resolve(filePath)
  }

  async load(): Promise<IConfigV3> {
    this.logger.debug?.(`ConfigService.load() -- start '${path.basename(this.filePath)}'`)
    let raw: unknown
    try {
      raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        const config = this.defaultConfig()
        validateConfig(config)
        await this.writeAtomically(config)
        this.logger.info?.('Config file was missing; wrote an inert default template')
        return config
      }
      if (error instanceof SyntaxError) {
        const parseError = new Error(`Config file '${this.filePath}' contains invalid JSON`)
        this.logger.error?.('ConfigService.load() -- failed to parse config JSON', parseError)
        throw parseError
      }
      this.logger.error?.('ConfigService.load() -- could not read config file', error)
      throw error
    }

    if (!isRecord(raw)) {
      const shapeError = new Error(`Config file '${this.filePath}' must contain a JSON object`)
      this.logger.error?.('ConfigService.load() -- invalid config shape', shapeError)
      throw shapeError
    }
    if (raw.version === 2) {
      const migrated = this.migrateV2(raw as unknown as IConfig)
      try {
        validateConfig(migrated)
      } catch (error) {
        this.logger.error?.('ConfigService.load() -- migrated config failed validation', error)
        throw error
      }
      const backupPath = `${this.filePath}.v2.${Date.now()}.${randomUUID()}.bak`
      await fs.copyFile(this.filePath, backupPath, fsConstants.COPYFILE_EXCL)
      await this.writeAtomically(migrated)
      this.logger.info?.(`Migrated config v2 to v3; preserved original config as '${path.basename(backupPath)}'`)
      return migrated
    }

    try {
      validateConfig(raw)
    } catch (error) {
      this.logger.error?.('ConfigService.load() -- config failed validation', error)
      throw error
    }
    this.logger.info?.('ConfigService.load() -- validated config v3')
    return raw
  }

  async save(config: IConfigV3): Promise<boolean> {
    this.logger.debug?.('ConfigService.save() -- start')
    try {
      validateConfig(config)
      await this.writeAtomically(config)
      this.logger.debug?.(`ConfigService.save() -- wrote '${path.basename(this.filePath)}' atomically`)
      return true
    } catch (error) {
      this.logger.error?.('ConfigService.save() failed', error)
      return false
    } finally {
      this.logger.debug?.('ConfigService.save() -- end')
    }
  }

  private async writeAtomically(config: IConfigV3): Promise<void> {
    const directory = path.dirname(this.filePath)
    await fs.mkdir(directory, { recursive: true })
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(tempPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
      await fs.rename(tempPath, this.filePath)
    } catch (error) {
      await fs.unlink(tempPath).catch((): void => undefined)
      throw error
    }
  }

  private migrateV2(config: IConfig): IConfigV3 {
    if (!isRecord(config.relais) || !isRecord(config.thermostatState)) {
      throw new Error('Config v2 is missing relais or thermostatState')
    }
    const switches = Array.isArray(config.relais.switches) ? config.relais.switches : []
    return {
      version: 3,
      hostname: config.hostname,
      port: config.port,
      weatherMapApiKey: config.weatherMapApiKey,
      ...(config.mongoDB ? { mongoDB: config.mongoDB } : {}),
      relais: {
        hostname: config.relais.hostname,
        secure: config.relais.secure
      },
      instances: [{
        name: config.instance ?? 'default',
        temperatureSensor: config.temperatureSensor,
        thermostatState: config.thermostatState,
        switches
      }]
    }
  }

  private defaultConfig(): IConfigV3 {
    return {
      version: 3,
      hostname: '0.0.0.0',
      port: 8080,
      weatherMapApiKey: '',
      relais: { hostname: 'localhost', secure: false },
      instances: []
    }
  }
}
