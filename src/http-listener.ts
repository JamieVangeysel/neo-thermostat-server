import express from 'express';
import Thermostat, { HeatingCoolingStateEnum } from './thermostat';

const okResponse = {
  success: true
};
const valueResponse = (value: any) => {
  return {
    value
  };
};

export default class HttpListener {
  private app: express.Express;
  private thermostat: Thermostat;

  constructor(hostname: string, port: number, thermostat: Thermostat) {
    console.debug(`Constructed new instance of HttpListener('${hostname}', ${port}, Thermostat())`);
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
      return console.log(`server is listening on ${hostname}:${port}`);
    });
  }

  private configureRoutes() {
    //#region gets
    this.app.get('/', (req, res) => {
      console.debug(`received request '/', returning current status.`);
      res.send(valueResponse(this.thermostat.State));
    });

    this.app.get('/current-temperature', (req, res) => {
      console.debug(`received request '/current-temperature', returning current temperature.`);
      res.send(valueResponse(this.thermostat.CurrentTemperature));
    });

    this.app.get('/target-temperature', (req, res) => {
      console.debug(`received request '/target-temperature', returning target temperature.`);
      res.send(valueResponse(this.thermostat.TargetTemperature));
    });

    this.app.get('/current-state', (req, res) => {
      console.debug(`received request '/current-state', returning current state.`);
      res.send(valueResponse(this.thermostat.CurrentHeatingCoolingState));
    });

    this.app.get('/target-state', (req, res) => {
      console.debug(`received request '/target-state', returning target state.`);
      res.send(valueResponse(this.thermostat.TargetHeatingCoolingState));
    });

    this.app.get('/cooling-threshold', (req, res) => {
      console.debug(`received request '/cooling-threshold', returning cooling threshold.`);
      res.send(valueResponse(this.thermostat.CoolingThresholdTemperature));
    });

    this.app.get('/heating-threshold', (req, res) => {
      console.debug(`received request '/heating-threshold', returning heating threshold.`);
      res.send(valueResponse(this.thermostat.HeatingThresholdTemperature));
    });
    //#endregion

    //#region posts
    this.app.post('/target-temperature', (req, res) => {
      console.debug(`received request POST '/target-temperature', setting target temperature.`);
      try {
        const targetTemperature: IPostNumberValue = req.body;
        this.thermostat.TargetTemperature = targetTemperature.value;
        console.debug('Set target temperature to: ' + targetTemperature.value);
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    this.app.post('/target-state', (req, res) => {
      console.debug(`received request POST '/target-state', setting target state.`);
      try {
        const targetHeatingCoolingState: IPostHeatingCoolingStateValue = req.body;
        this.thermostat.TargetHeatingCoolingState = targetHeatingCoolingState.value;
        console.debug('Set target state to: ' + targetHeatingCoolingState.value);
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    this.app.post('/cooling-threshold', (req, res) => {
      console.debug(`received request POST '/cooling-threshold', setting cooling threshold.`);
      try {
        const coolingThresholdTemperature: IPostNumberValue = req.body;
        this.thermostat.CoolingThresholdTemperature = coolingThresholdTemperature.value;
        console.debug('Set cooling threshold to: ' + coolingThresholdTemperature.value);
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    this.app.post('/heating-threshold', (req, res) => {
      console.debug(`received request POST '/heating-threshold', setting heating threshold.`);
      try {
        const heatingThresholdTemperature: IPostNumberValue = req.body;
        this.thermostat.HeatingThresholdTemperature = heatingThresholdTemperature.value;
        console.debug('Set heating threshold to: ' + heatingThresholdTemperature.value);
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    //#endregion
  }
}

interface IPostNumberValue {
  value: number;
}

interface IPostHeatingCoolingStateValue {
  value: HeatingCoolingStateEnum;
}