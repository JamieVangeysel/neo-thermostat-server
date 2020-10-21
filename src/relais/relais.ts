import { EventEmitter } from 'events';
import { Logger } from '../logging/logger';
const logger = new Logger();

export class Relais extends EventEmitter {
  private hostname: string;
  private switches: IRelaisSwitch[];
  private secure: boolean;

  constructor(hostname: string, switches: IRelaisSwitch[], secure: boolean = false) {
    super();

    this.hostname = hostname;
    this.switches = switches;
    this.secure = secure;
  }

  activate(type: SwitchTypeEnum) {
    logger.log(`Relais.activate() -- start`, type);
    const onSwitches = this.switches.filter(e => e.type === type);
    const offSwitches = this.switches.filter(e => e.type !== type);
    logger.log(`Relais.activate() -- filtered on and off lists`, onSwitches, offSwitches);

    offSwitches.forEach(async (e) => {
      logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.OFF)`);
      await this.setState(e, SwitchStateEnum.OFF);
    });

    onSwitches.forEach(async (e) => {
      logger.log(`Relais.activate() -- this.setState(${e.pinIndex}, SwitchStateEnum.ON)`);
      await this.setState(e, SwitchStateEnum.ON);
    });
    logger.log(`Relais.activate() -- end`);
  }

  private async setState(relais: IRelaisSwitch, state: SwitchStateEnum) {
    logger.log(`Relais.setState() -- start`, relais, state);
    // check the current state of pinIndex
    if (relais.active && state === SwitchStateEnum.ON) {
      logger.log(`Relais.setState() -- relais is currently ON and needs to be switched ON so skip request.`);
    } else if (!relais.active && state === SwitchStateEnum.OFF) {
      logger.log(`Relais.setState() -- relais is currently OFF and needs to be switched OFF so skip request.`);
    } else {
      if (relais.active) {
        logger.log(`Relais.setState() -- relais is currently ON and needs to be switched OFF`, relais.pinIndex);
      } else {
        logger.log(`Relais.setState() -- relais is currently OFF and needs to be switched ON`, relais.pinIndex);
      }
      await fetch(`${this.secure ? 'https' : 'http'}://${this.hostname}/${relais.pinIndex}/${state}`);
    }
    logger.log(`Relais.setState() -- end`);
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
  VENT = 'VENT' // experimental => ventilation won't be added until v3
}

export enum SwitchStateEnum {
  ON = 'on',
  OFF = 'off'
}
