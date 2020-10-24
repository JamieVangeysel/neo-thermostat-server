import { EventEmitter } from 'events';
import express from 'express';
import { Platform } from '../platform';
import { Thermostat, HeatingCoolingStateEnum } from './thermostat';

const okResponse = {
  success: true
};
const valueResponse = (value: any) => {
  return { value };
};

export class HttpListener extends EventEmitter {
  private platform: Platform;
  private app: express.Express;
  private thermostat: Thermostat;

  constructor(platform: Platform) {
    super();
    this.platform = platform;
  }

  configure(hostname: string, port: number, thermostat: Thermostat) {
    this.platform.logger.debug(`HttpListener.configure() -- start`);
    this.thermostat = thermostat;
    this.app = express();
    this.app.use(express.json());

    this.configureRoutes();

    // Add error handling middleware that Express will call
    // in the event of malformed JSON.
    this.app.use((err, req, res, next) => {
      // 'SyntaxError: Unexpected token in JSON at position 0'
      // err.message;
      next(err);
    });

    this.app.listen(port, hostname, () => {
      return this.platform.logger.log(`HttpListener.configure() -- server is listening on ${hostname}:${port}`);
    });
    this.platform.logger.debug(`HttpListener.configure() -- end`);
  }

  private configureRoutes() {
    //#region gets
    this.app.get('/', (req, res) => {
      this.platform.logger.debug(`HttpListener.get() -- received request '/', returning current status.`);
      res.send(valueResponse(this.thermostat.State));
    });

    this.app.get('/current-temperature', (req, res) => {
      this.platform.logger.debug(`HttpListener.get() -- received request '/current-temperature', returning current temperature.`);
      res.send(valueResponse(this.thermostat.CurrentTemperature));
    });

    this.app.get('/target-temperature', (req, res) => {
      this.platform.logger.debug(`HttpListener.get() -- received request '/target-temperature', returning target temperature.`);
      res.send(valueResponse(this.thermostat.TargetTemperature));
    });

    this.app.get('/current-state', (req, res) => {
      this.platform.logger.debug(`HttpListener.get() -- received request '/current-state', returning current state.`);
      res.send(valueResponse(this.thermostat.CurrentHeatingCoolingState));
    });

    this.app.get('/target-state', (req, res) => {
      this.platform.logger.debug(`HttpListener.get() -- received request '/target-state', returning target state.`);
      res.send(valueResponse(this.thermostat.TargetHeatingCoolingState));
    });

    // this.app.get('/cooling-threshold', (req, res) => {
    //   this.platform.logger.debug(`received request '/cooling-threshold', returning cooling threshold.`);
    //   res.send(valueResponse(this.thermostat.CoolingThresholdTemperature));
    // });

    // this.app.get('/heating-threshold', (req, res) => {
    //   this.platform.logger.debug(`received request '/heating-threshold', returning heating threshold.`);
    //   res.send(valueResponse(this.thermostat.HeatingThresholdTemperature));
    // });
    //#endregion

    //#region posts
    this.app.post('/target-temperature', (req, res) => {
      this.platform.logger.debug(`HttpListener.post() -- received request POST '/target-temperature', setting target temperature.`);
      try {
        const targetTemperature: IPostNumberValue = req.body;
        this.thermostat.TargetTemperature = targetTemperature.value;
        this.platform.logger.debug('Set target temperature to: ' + targetTemperature.value);
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    this.app.post('/target-state', (req, res) => {
      this.platform.logger.debug(`HttpListener.post() -- received request POST '/target-state', setting target state.`);
      try {
        const targetHeatingCoolingState: IPostHeatingCoolingStateValue = req.body;
        this.thermostat.TargetHeatingCoolingState = targetHeatingCoolingState.value;
        this.platform.logger.debug('Set target state to: ' + targetHeatingCoolingState.value);
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    // this.app.post('/cooling-threshold', (req, res) => {
    //   this.platform.logger.debug(`received request POST '/cooling-threshold', setting cooling threshold.`);
    //   try {
    //     const coolingThresholdTemperature: IPostNumberValue = req.body;
    //     this.thermostat.CoolingThresholdTemperature = coolingThresholdTemperature.value;
    //     this.platform.logger.debug('Set cooling threshold to: ' + coolingThresholdTemperature.value);
    //     res.send(okResponse);
    //   } catch (err) {
    //     res.status(500);
    //     res.send(err);
    //   }
    // });
    // this.app.post('/heating-threshold', (req, res) => {
    //   this.platform.logger.debug(`received request POST '/heating-threshold', setting heating threshold.`);
    //   try {
    //     const heatingThresholdTemperature: IPostNumberValue = req.body;
    //     this.thermostat.HeatingThresholdTemperature = heatingThresholdTemperature.value;
    //     this.platform.logger.debug('Set heating threshold to: ' + heatingThresholdTemperature.value);
    //     res.send(okResponse);
    //   } catch (err) {
    //     res.status(500);
    //     res.send(err);
    //   }
    // });
    //#endregion
  }
}

interface IPostNumberValue {
  value: number;
}

interface IPostHeatingCoolingStateValue {
  value: HeatingCoolingStateEnum;
}