import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const configModule = await import('../src/services/config-service.ts').catch(() => null)
const databaseModule = await import('../src/services/database.ts').catch(() => null)
const httpListenerModule = await import('../src/services/http-listener.ts').catch(() => null)
const weatherModule = await import('../src/services/weather-info.ts').catch(() => null)
const logger = { debug() {}, info() {}, warn() {}, error() {} }
const scratchRoot = process.env.TMPDIR || path.join(process.env.HOME, '.hermes', 'cache', 'scratch')

function v3Config(overrides = {}) {
  return {
    version: 3,
    hostname: '127.0.0.1',
    port: 8080,
    weatherMapApiKey: '',
    relais: { hostname: 'home', secure: false },
    instances: [],
    ...overrides
  }
}

function makeTempDir(t) {
  return mkdtemp(path.join(scratchRoot, 'neo-config-test-')).then(dir => {
    t.after(() => rm(dir, { recursive: true, force: true }))
    return dir
  })
}

test('MongoDB remains disabled when omitted from config', async () => {
  assert.ok(databaseModule, 'database service should be importable without starting a connection')
  const platform = { logger, config: { mongoDB: undefined } }
  const database = new databaseModule.DatabaseService(platform)
  await database.init()
  assert.equal(database.enabled, false)
  await assert.rejects(database.insertIntoCollection('anything', {}), /not configured|not enabled/i)
  await database.close()
})

test('HTTP listener starts asynchronously and closes idempotently', async () => {
  assert.ok(httpListenerModule, 'HTTP listener should be importable without Platform runtime imports')
  const listener = new httpListenerModule.HttpListener({ logger, thermostats: [] })
  await listener.listen('127.0.0.1', 0)
  await listener.close()
  await listener.close()
})

test('weather startup logs when the optional API key is not configured', async () => {
  assert.ok(weatherModule, 'weather service should be importable without Platform runtime imports')
  const warnings = []
  const weather = new weatherModule.WeatherInfoService({
    logger: { ...logger, warn: (...args) => warnings.push(args.join(' ')) },
    config: { weatherMapApiKey: '' }
  })
  await weather.start()
  await weather.stop()
  assert.ok(warnings.some(message => message.includes('no weatherMapApiKey configured')))
})

test('config service loads without importing or constructing Platform', () => {
  assert.ok(configModule, 'config module should be independently importable')
  assert.equal(typeof configModule.ConfigService, 'function')
  assert.equal(typeof configModule.validateConfig, 'function')
})

test('valid v3 config without MongoDB passes validation', () => {
  assert.ok(configModule, 'config module should be independently importable')
  assert.doesNotThrow(() => configModule.validateConfig(v3Config()))
})

test('validates optional legacy and site MQTT topic arrays per thermostat instance', () => {
  assert.ok(configModule, 'config module should be independently importable')
  const instance = {
    name: 'default',
    temperatureSensor: 'sensor-default',
    thermostatState: {
      currentTemperature: 20,
      currentRelativeHumidity: 45,
      targetTemperature: 20,
      currentHeatingCoolingState: 0,
      targetHeatingCoolingState: 1,
      temperatureDisplayUnits: 0
    },
    switches: [],
    mqttTopics: {
      temperature: ['site/home/master-bedroom/climate/temperature'],
      thermostatStatus: ['site/home/living-space/climate/thermostat']
    }
  }
  assert.doesNotThrow(() => configModule.validateConfig(v3Config({ instances: [instance] })))
  assert.throws(() => configModule.validateConfig(v3Config({
    instances: [{ ...instance, mqttTopics: { temperature: [''], thermostatStatus: ['site/home/living-space/climate/thermostat'] } }]
  })), /mqttTopics|topic/i)
})

test('invalid ports and malformed thermostat records are rejected', () => {
  assert.ok(configModule, 'config module should be independently importable')
  assert.throws(() => configModule.validateConfig(v3Config({ port: 65535 })), /port/i)
  assert.throws(() => configModule.validateConfig(v3Config({ instances: [{ name: 'living' }] })), /temperatureSensor/i)
})

test('a missing config creates an inert v3 template without MongoDB', async t => {
  assert.ok(configModule, 'config module should be independently importable')
  const dir = await makeTempDir(t)
  const filePath = path.join(dir, 'config.json')
  const service = new configModule.ConfigService(logger, filePath)

  const config = await service.load()
  assert.equal(config.version, 3)
  assert.deepEqual(config.instances, [])
  assert.equal(config.mongoDB, undefined)
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), config)
})

test('malformed config fails closed and leaves the original file unchanged', async t => {
  assert.ok(configModule, 'config module should be independently importable')
  const dir = await makeTempDir(t)
  const filePath = path.join(dir, 'config.json')
  const original = '{broken config'
  await writeFile(filePath, original)

  await assert.rejects(new configModule.ConfigService(logger, filePath).load(), /invalid JSON/i)
  assert.equal(await readFile(filePath, 'utf8'), original)
})

test('v2 migration writes a recoverable backup before replacing the config', async t => {
  assert.ok(configModule, 'config module should be independently importable')
  const dir = await makeTempDir(t)
  const filePath = path.join(dir, 'config.json')
  const v2 = {
    version: 2,
    hostname: '127.0.0.1',
    port: 8080,
    instance: 'living',
    weatherMapApiKey: '',
    temperatureSensor: 'sensor-living',
    mongoDB: { url: '', db: '', username: '', password: '' },
    relais: {
      hostname: 'home',
      secure: false,
      switches: [{ pinIndex: 1, type: 'HEAT_VALVE', active: false }]
    },
    thermostatState: {
      currentTemperature: 20,
      currentRelativeHumidity: 45,
      targetTemperature: 20,
      currentHeatingCoolingState: 0,
      targetHeatingCoolingState: 0,
      temperatureDisplayUnits: 0
    }
  }
  const original = JSON.stringify(v2, null, 2)
  await writeFile(filePath, original)

  const migrated = await new configModule.ConfigService(logger, filePath).load()
  assert.equal(migrated.version, 3)
  assert.equal(migrated.instances[0].name, 'living')
  assert.deepEqual(migrated.instances[0].switches, v2.relais.switches)
  assert.equal(JSON.parse(await readFile(filePath, 'utf8')).version, 3)
  const backups = (await readdir(dir)).filter(name => name.startsWith('config.json.v2.') && name.endsWith('.bak'))
  assert.equal(backups.length, 1)
  assert.equal(await readFile(path.join(dir, backups[0]), 'utf8'), original)
})
