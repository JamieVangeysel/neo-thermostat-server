const {
  Platform
} = require('../../../platform')
const boom = require('boom')

/**
 * Return array of thermostats or return detail if parameter id is supplied
 */
exports.get = async (req, reply) => {
  /** @type {Platform} */
  const platform = req.locals
  try {
    if (req.params.id) {
      // check if parameter id is a valid number
      const id = parseInt(req.params.id, 10) || null
      if (typeof id === 'number' && id !== null) {
        return {
          id,
          isNull: id === null
        }
      } else {
        reply
          .status(400)
          .send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Invalid parameter id'
          })
        return
      }
    }

    return platform.thermostat.temperatureDeltas
  } catch (err) {
    throw boom.boomify(err)
  }
}

exports.getCurrentTemperature = async (req, reply) => {
  /** @type {Platform} */
  const platform = req.locals
  try {
    if (req.params.id) {
      // check if parameter id is a valid number
      const id = parseInt(req.params.id, 10) || null
      if (typeof id === 'number' && id !== null) {
        return {
          currentTemperature: platform.thermostat.CurrentTemperature
        }
      } else {
        reply
          .status(400)
          .send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Invalid parameter id'
          })
        return
      }
    }

    return reply
      .status(204)
      .send()
  } catch (err) {
    throw boom.boomify(err)
  }
}

exports.getTargetTemperature = async (req, reply) => {
  /** @type {Platform} */
  const platform = req.locals
  try {
    if (req.params.id) {
      // check if parameter id is a valid number
      const id = parseInt(req.params.id, 10) || null
      if (typeof id === 'number' && id !== null) {
        return {
          targetTemperature: platform.thermostat.TargetTemperature
        }
      } else {
        reply
          .status(400)
          .send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Invalid parameter id'
          })
        return
      }
    }

    return reply
      .status(204)
      .send()
  } catch (err) {
    throw boom.boomify(err)
  }
}

exports.putTargetTemperature = async (req, reply) => {
  /** @type {Platform} */
  const platform = req.locals
  try {
    if (req.params.id) {
      // check if parameter id is a valid number
      const id = parseInt(req.params.id, 10) || null
      if (typeof id === 'number' && id !== null) {
        const {
          targetTemperature
        } = req.body
        const previousValue = platform.thermostat.TargetTemperature
        if (targetTemperature) {
          if (typeof targetTemperature === 'number') {
            if (targetTemperature >= 5 && targetTemperature <= 21) {
              platform.thermostat.TargetTemperature = targetTemperature
              return {
                previousTargetTemperature: previousValue,
                newTargetTemperature: targetTemperature,
                success: true
              }
            } else {
              return reply
                .status(400)
                .send({
                  statusCode: 400,
                  error: 'Bad Request',
                  message: 'Temperature is not within acceptable range!\nRange: 5-21'
                })
            }
          } else {
            return reply
              .status(400)
              .send({
                statusCode: 400,
                error: 'Bad Request',
                message: 'TargetTemperature is not a number!'
              })
          }
        } else {
          return reply
            .status(400)
            .send({
              statusCode: 400,
              error: 'Bad Request',
              message: 'TargetTemperature was not provided!'
            })
        }
      } else {
        reply
          .status(400)
          .send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Invalid parameter id'
          })
        return
      }
    }

    return reply
      .status(204)
      .send()
  } catch (err) {
    throw boom.boomify(err)
  }
}

exports.post = async (req, reply) => {

}

exports.put = async (req, reply) => {

}

exports.delete = async (req, reply) => {

}