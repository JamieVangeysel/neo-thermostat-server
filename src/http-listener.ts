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
      res.send(valueResponse(this.thermostat.State));
    });
    this.app.get('/current-temperature', (req, res) => {
      res.send(valueResponse(this.thermostat.CurrentTemperature));
    });

    this.app.get('/target-temperature', (req, res) => {
      res.send(valueResponse(this.thermostat.TargetTemperature));
    });

    this.app.get('/current-state', (req, res) => {
      res.send(valueResponse(this.thermostat.CurrentHeatingCoolingState));
    });

    this.app.get('/target-state', (req, res) => {
      res.send(valueResponse(this.thermostat.TargetHeatingCoolingState));
    });

    this.app.get('/cooling-threshold', (req, res) => {
      res.send(valueResponse(this.thermostat.CoolingThresholdTemperature));
    });

    this.app.get('/heating-threshold', (req, res) => {
      res.send(valueResponse(this.thermostat.HeatingThresholdTemperature));
    });
    //#endregion

    //#region posts
    this.app.post('/target-temperature', (req, res) => {
      try {
        const targetTemperature: IPostNumberValue = req.body;
        this.thermostat.TargetTemperature = targetTemperature.value;
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    this.app.post('/target-state', (req, res) => {
      try {
        const targetHeatingCoolingState: IPostHeatingCoolingStateValue = req.body;
        this.thermostat.TargetHeatingCoolingState = targetHeatingCoolingState.value;
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    this.app.post('/cooling-threshold', (req, res) => {
      try {
        const coolingThresholdTemperature: IPostNumberValue = req.body;
        this.thermostat.CoolingThresholdTemperature = coolingThresholdTemperature.value;
        res.send(okResponse);
      } catch (err) {
        res.status(500);
        res.send(err);
      }
    });
    this.app.post('/heating-threshold', (req, res) => {
      try {
        const heatingThresholdTemperature: IPostNumberValue = req.body;
        this.thermostat.HeatingThresholdTemperature = heatingThresholdTemperature.value;
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