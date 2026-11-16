import { Platform } from '../platform'
import { EventEmitter } from 'events'
import { IRelaisSwitch, IRelaisV2, SwitchStateEnum, SwitchTypeEnum } from './config'
import { connect, MqttClient } from 'mqtt'
import { executeFaultShutdown, publishWithBrokerAck, relayTransitionPlan } from './sensor-safety'
import { publishRetainedShadowStatus } from './thermal-shadow'

export class Relais extends EventEmitter {
  platform: Platform
  config: IRelaisV2
  switches: IRelaisSwitch[]
  client?: MqttClient
  private readonly reportedRelayStates = new Map<number, { active: boolean; at: string }>()
  private readonly retainedShadowStatuses = new Map<string, string>()

  constructor(platform: Platform, switches: IRelaisSwitch[]) {
    super()

    this.platform = platform
    this.config = platform.config.relais
    this.switches = switches

    this.platform.logger.info('Relais zone switches', this.switches)

  }

  async start(): Promise<void> {
    if (this.client) return
    this.platform.logger.debug('Relais.start() -- connecting to MQTT broker')
    const client = connect('mqtt://localhost:1883', {
      username: 'neo',
      password: 'password'
    })
    this.client = client
    client.on('error', err => {
      this.platform.logger.error('Relais MQTT client error', err)
      this.emit('relayCommandError', { error: err })
    })
    client.on('offline', () => {
      this.emit('relayCommandError', { error: new Error('Relay MQTT client is offline') })
    })
    this.listen()
  }

  async stop(): Promise<void> {
    const client = this.client
    this.client = undefined
    if (!client) return
    this.platform.logger.debug('Relais.stop() -- closing MQTT client')
    await new Promise<void>(resolve => client.end(true, {}, () => resolve()))
    this.platform.logger.info('Relais.stop() -- MQTT client closed')
  }

  private listen(): void {
    const topic = `${this.config.hostname}/relais/#`
    const client = this.client
    if (!client) throw new Error('Relay MQTT client has not been started')

    client.on('connect', () => {
      this.platform.logger.info('Connected to MQTT server')
      this.publishPendingShadowStatuses(client)

      client.subscribe([topic], err => {
        if (err) {
          this.platform.logger.error('Could not subscribe to relay status topic', topic, err)
          this.emit('relayCommandError', { error: err })
          return
        }
        this.platform.logger.debug(`Subscribe to topic '${topic}'`)
      })
    })

    client.on('message', async (topic: string, payload: Buffer) => {
      this.platform.logger.debug('Received Message:', topic, payload.toString())

      const topicPrefix = `${this.config.hostname}/relais/`
      if (!topic.startsWith(topicPrefix)) return
      const pinText = topic.substring(topicPrefix.length)
      if (!/^\d+$/.test(pinText)) return
      const pinIndex: number = Number(pinText)
      const state = payload.toString().trim()
      if (state !== 'ON' && state !== 'OFF') {
        this.platform.logger.error('Invalid MQTT relay status payload', topic, state)
        return
      }

      const sw = this.switches.find(e => e.pinIndex === pinIndex)
      if (sw) {
        sw.active = state === 'ON'
        this.reportedRelayStates.set(pinIndex, { active: sw.active, at: new Date().toISOString() })
      } else {
        this.platform.logger.info('Switch with pinIndex is not defined on this instance', pinIndex)
      }

      this.emit('update', this.switches)
    })
  }

  /** Publish a retained, read-only thermostat decision transcript to configured topics. */
  async publishShadowStatus(topics: string[], status: unknown): Promise<void> {
    if (topics.length === 0) return
    const serialized = typeof status === 'string' ? status : JSON.stringify(status)
    if (typeof serialized !== 'string') throw new Error('Shadow status could not be serialized')
    for (const topic of topics) this.retainedShadowStatuses.set(topic, serialized)
    const client = this.client
    if (!client?.connected) {
      this.platform.logger.debug('Relais.publishShadowStatus() -- cached until MQTT reconnect', topics)
      return
    }
    await Promise.all(topics.map(topic => this.publishRetainedStatus(client, topic, serialized)))
  }

  private publishPendingShadowStatuses(client: MqttClient): void {
    for (const [topic, payload] of this.retainedShadowStatuses) {
      void this.publishRetainedStatus(client, topic, payload).catch((): void => undefined)
    }
  }

  private async publishRetainedStatus(client: MqttClient, topic: string, payload: string): Promise<void> {
    try {
      await publishRetainedShadowStatus(client, topic, payload)
      this.platform.logger.debug('Relais.publishShadowStatus() -- broker accepted retained status', topic)
    } catch (error) {
      this.platform.logger.error('Relais.publishShadowStatus() -- failed to publish retained status', topic, error)
      throw error
    }
  }

  get mqttReportedRelays(): { pinIndex: number; type: string; state: 'ON' | 'OFF' | 'UNKNOWN'; reportedAt?: string }[] {
    return this.switches.map(relay => {
      const reported = this.reportedRelayStates.get(relay.pinIndex)
      return {
        pinIndex: relay.pinIndex,
        type: relay.type,
        state: reported ? (reported.active ? 'ON' : 'OFF') : 'UNKNOWN',
        reportedAt: reported?.at
      }
    })
  }

  /**
   * @description activate relais with given type
   */
  async activate(type: SwitchTypeEnum): Promise<void> {
    this.platform.logger.debug(`Relais.activate() -- start`, type)

    if (type === SwitchTypeEnum.WATER_VALVE) {
      this.platform.logger.warn('WATER_VALVE is deprecated and is not controlled by the thermostat')
      return
    }
    if (type === SwitchTypeEnum.VENT) {
      this.platform.logger.error(`Relais.activate() -- type '${type}' cannot be controlled separately`)
      return
    }
    const { turnOn: onSwitches, turnOff: offSwitches } = relayTransitionPlan(this.switches, type)
    this.platform.logger.log(`Relais.activate() -- filtered on and off lists`, onSwitches, offSwitches)

    // Serialize the interlock: publish OFF commands before any incompatible ON.
    for (const e of offSwitches) {
      this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.OFF)`)
      await this.setState(e, SwitchStateEnum.OFF)
    }

    for (const e of onSwitches) {
      this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.ON)`)
      await this.setState(e, SwitchStateEnum.ON)
    }

    await this.update()
    this.platform.logger.debug(`Relais.activate() -- end`)
  }

  async deactivate(type: SwitchTypeEnum): Promise<void> {
    this.platform.logger.debug(`Relais.deactivate() -- start`, type)

    switch (type) {
      case SwitchTypeEnum.WATER_VALVE:
        this.platform.logger.warn('WATER_VALVE is deprecated and is not controlled by the thermostat')
        return
    }

    await this.update()
    this.platform.logger.debug(`Relais.deactivate() -- end`)
  }

  async deactivateForSensorFault(): Promise<{ requestedPinIndexes: number[]; failures: { pinIndex: number; message: string }[] }> {
    // Send OFF to this zone's HVAC outputs even if the last reported state is OFF;
    // local MQTT status may be missing or stale. Shared HEAT_ELEMENT and legacy
    // WATER_VALVE are deliberately not addressed by this service.
    return executeFaultShutdown(this.switches, relay => this.setState(relay, SwitchStateEnum.OFF, true))
  }

  private async update() {
    this.platform.logger.debug(`Relais.update() -- start`)
    this.platform.logger.debug(`Relais.update() -- this method is currently unused a we are using MQTT now.`)
    // try {
    //   const relaisResult = await fetch(`${this.config.secure ? 'https' : 'http'}://${this.config.hostname}/state`)
    //   this.platform.logger.log(`Relais.update() -- save current relais status in function memory : { status: boolean[] }`)
    //   const relaisStates: boolean[] = (await relaisResult.json()).status
    //   this.platform.logger.log(`Relais.update() -- current relais status`, relaisStates)
    //
    //   for (let i = 0; i < relaisStates.length; i++) {
    //     const sw = this.switches.find(e => e.pinIndex === i + 1)
    //     if (sw) {
    //       sw.active = relaisStates[i]
    //     } else {
    //       this.platform.logger.info('Switch with pinIndex is not defined on this instance', i + 1)
    //     }
    //   }
    //
    //   this.emit('update', this.switches)
    // } catch (err) {
    //   this.platform.logger.error(`Relais.update() -- get state failed!`)
    // }
    this.platform.logger.debug(`Relais.update() -- end`)
  }

  /**
   * @description Change the state of a specific IRelaisSwitch Instance
   */
  private async setState(relais: IRelaisSwitch, state: SwitchStateEnum, force: boolean = false): Promise<void> {
    this.platform.logger.debug(`Relais.setState() -- start`, relais, state)
    // check the current state of pinIndex
    if (!force && relais.active && state === SwitchStateEnum.ON) {
      this.platform.logger.log(`Relais.setState() -- relais is currently ON and needs to be switched ON so skip request.`)
    } else if (!force && !relais.active && state === SwitchStateEnum.OFF) {
      this.platform.logger.log(`Relais.setState() -- relais is currently OFF and needs to be switched OFF so skip request.`)
    } else {
      if (relais.active) {
        this.platform.logger.log(`Relais.setState() -- relais is currently ON and needs to be switched OFF`, relais.pinIndex)
      } else {
        this.platform.logger.log(`Relais.setState() -- relais is currently OFF and needs to be switched ON`, relais.pinIndex)
      }
      try {
        if (!this.client) throw new Error('Relay MQTT client has not been started')
        await publishWithBrokerAck(
          this.client,
          `${this.config.hostname}/relais/${relais.pinIndex}`,
          state === SwitchStateEnum.ON ? 'ON' : 'OFF'
        )
        this.emit('commandPublished', { pinIndex: relais.pinIndex, state })
      } catch (err) {
        this.platform.logger.error(`Relais.setState() -- error`, err)
        this.emit('relayCommandError', { pinIndex: relais.pinIndex, error: err })
        throw err
      }
    }
    this.platform.logger.debug(`Relais.setState() -- end`)
  }

}
