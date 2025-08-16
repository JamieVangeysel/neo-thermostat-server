import { Platform } from '../platform'
import { EventEmitter } from 'events'
import { IRelaisSwitch, IRelaisV2, SwitchStateEnum, SwitchTypeEnum } from './config'

export class Relais extends EventEmitter {
  platform: Platform
  config: IRelaisV2
  switches: IRelaisSwitch[]
  allSwitches: IRelaisSwitch[]

  constructor(platform: Platform, switches: IRelaisSwitch[]) {
    super()

    this.platform = platform
    this.config = platform.config.relais
    this.switches = switches

    this.allSwitches = platform.config.instances.reduce((prev, curr) => prev.concat(curr), [])
    this.platform.logger.info('Relais all switches', this.allSwitches)
  }

  /**
   * @description activate relais with given type
   */
  activate(type: SwitchTypeEnum) {
    this.platform.logger.debug(`Relais.activate() -- start`, type)

    let onSwitches: IRelaisSwitch[] = []
    let offSwitches: IRelaisSwitch[] = []

    switch (type) {
      case SwitchTypeEnum.HEAT:
        // when HEAT is enabled disable all cooling related switches and enable heating (and ventilation if applicable)
        onSwitches = this.switches.filter(e => ['HEAT', 'HEAT_ELEMENT', 'HEAT_VALVE', 'VENT'].includes(e.type))
        offSwitches = this.switches.filter(e => ['COOL', 'COOL_ELEMENT', 'COOL_VALVE'].includes(e.type))
        break

      case SwitchTypeEnum.NONE:
        onSwitches = []
        offSwitches = this.switches.filter(e => ['HEAT', 'HEAT_ELEMENT', 'HEAT_VALVE', 'COOL', 'COOL_ELEMENT', 'COOL_VALVE', 'VENT'].includes(e.type))
        // if water heater is running leave heating element engaged
        if (this.allSwitches.find(e => e.type === SwitchTypeEnum.WATER_VALVE && e.active)) {
          offSwitches = this.switches.filter(e => e.type !== SwitchTypeEnum.HEAT_ELEMENT)
        }
        break

      case SwitchTypeEnum.WATER_VALVE:
        onSwitches = this.switches.filter(e => ['WATER_VALVE', 'HEAT_ELEMENT'].includes(e.type))
        break

      case SwitchTypeEnum.COOL:
        // when COOL is enabled disable all heating related switches and enable cooling (and ventilation if applicable)
        onSwitches = this.switches.filter(e => ['COOL', 'COOL_ELEMENT', 'COOL_VALVE', 'VENT'].includes(e.type))
        offSwitches = this.switches.filter(e => ['HEAT', 'HEAT_ELEMENT', 'HEAT_VALVE'].includes(e.type))
        // if water heater is running leave heating element engaged
        if (this.allSwitches.find(e => e.type === SwitchTypeEnum.WATER_VALVE && e.active)) {
          offSwitches = this.switches.filter(e => e.type !== SwitchTypeEnum.HEAT_ELEMENT)
        }
        break

      case SwitchTypeEnum.VENT:
        this.platform.logger.error(`Relais.activate() -- type '${type}' cannot be controlled separately`)
        break
    }
    this.platform.logger.log(`Relais.activate() -- filtered on and off lists`, onSwitches, offSwitches)

    offSwitches.forEach(async (e) => {
      this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.OFF)`)
      await this.setState(e, SwitchStateEnum.OFF)
    })

    onSwitches.forEach(async (e) => {
      this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.ON)`)
      await this.setState(e, SwitchStateEnum.ON)
    })

    this.update().then(_ => {
      this.platform.logger.debug(`Relais.activate() -- end`)
    })
  }

  deactivate(type: SwitchTypeEnum) {
    this.platform.logger.debug(`Relais.deactivate() -- start`, type)

    switch (type) {
      case SwitchTypeEnum.WATER_VALVE:
        let offSwitches: IRelaisSwitch[] = this.switches.filter(e => e.type === SwitchTypeEnum.WATER_VALVE)

        // check if there is a heat element active
        if (this.switches.find(e => e.type === SwitchTypeEnum.HEAT_ELEMENT && e.active)) {
          // check if all heat valves are closed
          if (!this.allSwitches.find(e => e.type === SwitchTypeEnum.HEAT_ELEMENT && e.active)) {
            for (let sw of this.switches.filter(e => e.type === SwitchTypeEnum.HEAT_ELEMENT && e.active)) {
              offSwitches.push(sw)
            }
          } else {
            // check if there is a second heating element, if so we can still turn this instance off
            const thisHeatElement = this.switches.find(e => e.type === SwitchTypeEnum.HEAT_ELEMENT)
            if (thisHeatElement && this.allSwitches.find(e => e.type === SwitchTypeEnum.HEAT_ELEMENT && e.pinIndex !== thisHeatElement.pinIndex)) {
              offSwitches.push(thisHeatElement)
            }
          }
        }

        offSwitches.forEach(async (e) => {
          this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.OFF)`)
          await this.setState(e, SwitchStateEnum.OFF)
        })
        break
    }

    this.update().then(_ => {
      this.platform.logger.debug(`Relais.deactivate() -- end`)
    })
  }

  private async update() {
    this.platform.logger.debug(`Relais.update() -- start`)
    this.platform.logger.debug(`Relais.update() -- get current state from relaisController`)
    try {
      const relaisResult = await fetch(`${this.config.secure ? 'https' : 'http'}://${this.config.hostname}/state`)
      this.platform.logger.log(`Relais.update() -- save current relais status in function memory : { status: boolean[] }`)
      const relaisStates: boolean[] = (await relaisResult.json()).status
      this.platform.logger.log(`Relais.update() -- current relais status`, relaisStates)

      for (let i = 0; i < relaisStates.length; i++) {
        const sw = this.switches.find(e => e.pinIndex === i + 1)
        if (sw) {
          sw.active = relaisStates[i]
        } else {
          this.platform.logger.info('Switch with pinIndex is not defined on this instance', i + 1)
        }
      }

      this.emit('update', this.switches)
    } catch (err) {
      this.platform.logger.error(`Relais.update() -- get state failed!`)
    }
    this.platform.logger.debug(`Relais.update() -- end`)
  }

  /**
   * @description Change the state of a specific IRelaisSwitch Instance
   */
  private async setState(relais: IRelaisSwitch, state: SwitchStateEnum) {
    this.platform.logger.debug(`Relais.setState() -- start`, relais, state)
    // check the current state of pinIndex
    if (relais.active && state === SwitchStateEnum.ON) {
      this.platform.logger.log(`Relais.setState() -- relais is currently ON and needs to be switched ON so skip request.`)
    } else if (!relais.active && state === SwitchStateEnum.OFF) {
      this.platform.logger.log(`Relais.setState() -- relais is currently OFF and needs to be switched OFF so skip request.`)
    } else {
      if (relais.active) {
        this.platform.logger.log(`Relais.setState() -- relais is currently ON and needs to be switched OFF`, relais.pinIndex)
      } else {
        this.platform.logger.log(`Relais.setState() -- relais is currently OFF and needs to be switched ON`, relais.pinIndex)
      }
      try {
        await fetch(`${this.config.secure ? 'https' : 'http'}://${this.config.hostname}/${relais.pinIndex}/${state}`)
      } catch (err) {
        this.platform.logger.error(`Relais.setState() -- error`, err)
        this.emit('error', err)
      }
    }
    this.platform.logger.debug(`Relais.setState() -- end`)
  }
}
