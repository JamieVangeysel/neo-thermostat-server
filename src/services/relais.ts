import { fetch } from 'cross-fetch';
import { EventEmitter } from 'events';
import { Platform } from '../platform';

export class Relais extends EventEmitter {
  private platform: Platform;

  constructor(platform: Platform) {
    super();

    this.platform = platform;
  }

  activate(type: SwitchTypeEnum) {
    this.platform.logger.log(`Relais.activate() -- start`, type);
    const onSwitches = this.platform.config.relais.switches.filter(e => e.type === type);
    const offSwitches = this.platform.config.relais.switches.filter(e => e.type !== type);
    this.platform.logger.log(`Relais.activate() -- filtered on and off lists`, onSwitches, offSwitches);

    offSwitches.forEach(async (e) => {
      this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.OFF)`);
      await this.setState(e, SwitchStateEnum.OFF);
    });

    onSwitches.forEach(async (e) => {
      this.platform.logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.ON)`);
      await this.setState(e, SwitchStateEnum.ON);
    });
    this.update();
    this.platform.logger.log(`Relais.activate() -- end`);
  }

  private async update() {
    this.platform.logger.log(`Relais.update() -- start`);
    this.platform.logger.log(`Relais.update() -- get current state from relaisController`);
    try {
      const relaisResult = await fetch(`${this.platform.config.relais.secure ? 'https' : 'http'}://${this.platform.config.relais.hostname}/state`);
      this.platform.logger.log(`Relais.update() -- save current relais status in function memory : { status: boolean[] }`);
      const relaisStates: boolean[] = (await relaisResult.json()).status;
      this.platform.logger.log(`Relais.update() -- current relais status`, relaisStates);

      for (let i = 0; i < relaisStates.length; i++) {
        this.platform.config.relais.switches[i].active = relaisStates[i];
      }

      this.emit('update', this.platform.config.relais.switches);
    } catch (err) {
      this.platform.logger.error(`Relais.update() -- get state failed!`);
    }
    this.platform.logger.log(`Relais.update() -- end`);
  }

  private async setState(relais: IRelaisSwitch, state: SwitchStateEnum) {
    this.platform.logger.log(`Relais.setState() -- start`, relais, state);
    // check the current state of pinIndex
    if (relais.active && state === SwitchStateEnum.ON) {
      this.platform.logger.log(`Relais.setState() -- relais is currently ON and needs to be switched ON so skip request.`);
    } else if (!relais.active && state === SwitchStateEnum.OFF) {
      this.platform.logger.log(`Relais.setState() -- relais is currently OFF and needs to be switched OFF so skip request.`);
    } else {
      if (relais.active) {
        this.platform.logger.log(`Relais.setState() -- relais is currently ON and needs to be switched OFF`, relais.pinIndex);
      } else {
        this.platform.logger.log(`Relais.setState() -- relais is currently OFF and needs to be switched ON`, relais.pinIndex);
      }
      try {
        await fetch(`${this.platform.config.relais.secure ? 'https' : 'http'}://${this.platform.config.relais.hostname}/${relais.pinIndex}/${state}`);
      } catch (err) {
        this.emit('error', err);
      }
    }
    this.platform.logger.log(`Relais.setState() -- end`);
  }
}

export interface IRelais {
  hostname: string;
  secure: boolean;
  switches: IRelaisSwitch[];
}

export interface IRelaisSwitch {
  pinIndex: number;
  active: boolean;
  type: SwitchTypeEnum;
}

export enum SwitchTypeEnum {
  HEAT = 'HEAT',
  COOL = 'COOL',
  VENT = 'VENT', // experimental => ventilation won't be added until v3
  NONE = 'NONE' // dummy entry to be able to deactivate all relais switches
}

export enum SwitchStateEnum {
  ON = 'on',
  OFF = 'off'
}
