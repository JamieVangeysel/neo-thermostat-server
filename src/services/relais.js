const fetch = require('cross-fetch')
const EventEmitter = require('events')

class Relais extends EventEmitter {
  /**
   * @description Reference to the platform instance
   * @private
   * @type {Platform}
   * @memberof Relais
   */
  platform

  /**
   * Creates an instance of Relais.
   * @param {Platform} platform
   * @memberof Relais
   */
  constructor(platform) {
    super()

    this.platform = platform
  }

  /**
   * @description activate relais with given type
   * @param {SwitchTypeEnum} type
   * @memberof Relais
   */
  activate(type) {
    this.platform.logger.debug(`Relais.activate() -- start`, type)
    const onSwitches = this.platform.config.relais.switches.filter(e => e.type === type)
    const offSwitches = this.platform.config.relais.switches.filter(e => e.type !== type)
    this.platform.logger.log(`Relais.activate() -- filtered on and off lists`, onSwitches, offSwitches)

    offSwitches.forEach(async (e) => {
      this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.OFF)`)
      await this.setState(e, SwitchStateEnum.OFF)
    })

    onSwitches.forEach(async (e) => {
      this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.ON)`)
      await this.setState(e, SwitchStateEnum.ON)
    })
    this.update()
    this.platform.logger.debug(`Relais.activate() -- end`)
  }

  /**
   * @description
   * @private
   * @memberof Relais
   */
  async update() {
    this.platform.logger.debug(`Relais.update() -- start`)
    this.platform.logger.debug(`Relais.update() -- get current state from relaisController`)
    try {
      const relaisResult = await fetch(`${this.platform.config.relais.secure ? 'https' : 'http'}://${this.platform.config.relais.hostname}/state`)
      this.platform.logger.log(`Relais.update() -- save current relais status in function memory : { status: boolean[] }`)
      /** @type {boolean[]} */
      const relaisStates = (await relaisResult.json()).status
      this.platform.logger.log(`Relais.update() -- current relais status`, relaisStates)

      for (let i = 0; i < relaisStates.length; i++) {
        this.platform.config.relais.switches[i].active = relaisStates[i]
      }

      this.emit('update', this.platform.config.relais.switches)
    } catch (err) {
      this.platform.logger.error(`Relais.update() -- get state failed!`)
    }
    this.platform.logger.debug(`Relais.update() -- end`)
  }

  /**
   * @description Change the state of a specific IRelaisSwitch Instance
   * @private
   * @param {IRelaisSwitch} relais
   * @param {SwitchStateEnum} state
   * @memberof Relais
   */
  async setState(relais, state) {
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
        await fetch(`${this.platform.config.relais.secure ? 'https' : 'http'}://${this.platform.config.relais.hostname}/${relais.pinIndex}/${state}`)
      } catch (err) {
        this.platform.logger.error(`Relais.setState() -- error`, err)
        this.emit('error', err)
      }
    }
    this.platform.logger.debug(`Relais.setState() -- end`)
  }
}

/**
 *
 *
 * @export
 * @interface IRelais
 */
class IRelais {
  /**
   * @description
   * @type {string}
   * @memberof IRelais
   */
  hostname

  /**
   * @description
   * @type {boolean}
   * @memberof IRelais
   */
  secure

  /**
   * @description
   * @type {IRelaisSwitch[]}
   * @memberof IRelais
   */
  switches
}

/**
 *
 *
 * @export
 * @interface IRelaisSwitch
 */
class IRelaisSwitch {
  /**
   * @description
   * @type {number}
   * @memberof IRelaisSwitch
   */
  pinIndex

  /**
   * @description
   * @type {boolean}
   * @memberof IRelaisSwitch
   */
  active

  /**
   * @description
   * @type {SwitchTypeEnum}
   * @memberof IRelaisSwitch
   */
  type
}

/**
 * @description
 * @export
 */
const SwitchTypeEnum = {
  HEAT: 'HEAT',
  COOL: 'COOL',
  VENT: 'VENT', // experimental => ventilation won't be added until v3
  NONE: 'NONE' // dummy entry to be able to deactivate all relais switches
}

/**
 * @description
 * @export
 */
const SwitchStateEnum = {
  ON: 'on',
  OFF: 'off'
}

module.exports = {
  Relais,
  SwitchTypeEnum
}