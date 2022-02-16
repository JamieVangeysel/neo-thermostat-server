const statusController = require('./controllers/status')
const thermostatController = require('./controllers/thermostat')
const airController = require('./controllers/air')

exports.routes = [{
  method: 'GET',
  url: '',
  handler: statusController.get
}, {
  method: 'GET',
  url: '/thermostat',
  handler: thermostatController.get
}, {
  method: 'GET',
  url: '/thermostat/:id',
  handler: thermostatController.get
}, {
  method: 'GET',
  url: '/thermostat/:id/current-temperature',
  handler: thermostatController.getCurrentTemperature
}, {
  method: 'GET',
  url: '/thermostat/:id/target-temperature',
  handler: thermostatController.getTargetTemperature
}, {
  method: 'PUT',
  url: '/thermostat/:id/target-temperature',
  handler: thermostatController.putTargetTemperature
}, {
  method: 'GET',
  url: '/air/:id',
  handler: airController.get
}, {
  method: 'POST',
  url: '/air/:id',
  handler: airController.post
}]