import { EventEmitter } from 'events';

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
    const onSwitches = this.switches.filter(e => e.type === type);
    const offSwitches = this.switches.filter(e => e.type !== type);

    offSwitches.forEach(async (e) => {
      await this.setState(e, SwitchStateEnum.OFF);
    });

    onSwitches.forEach(async (e) => {
      await this.setState(e, SwitchStateEnum.ON);
    });
  }

  private async setState(relais: IRelaisSwitch, state: SwitchStateEnum) {
    // check the current state of pinIndex
    if (relais.active && state === SwitchStateEnum.ON) {
      // relais is currently ON and wants to be switched to ON so skip request.
    } else if (!relais.active && state === SwitchStateEnum.OFF) {
      // relais is currently OFF and wants to be switched to OFF so skip request.
    } else {
      await fetch(`${this.secure ? 'https' : 'http'}://${this.hostname}/${relais.pinIndex}/${state}`);
    }
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
