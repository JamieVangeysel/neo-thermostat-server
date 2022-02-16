// #External dependencies
const boom = require('boom')
const Platform = require('../../../platform').Platform
const co2Sensor = require('../models/coSensor')

const fs = require('fs')

exports.get = async (req, reply) => {
  /** @type {Platform} */
  const platform = req.locals

  platform.logger.debug(`airController.get() -- start`)

  try {
    const data = fs.readFileSync('airQualityLog.csv')
    const lines = data.toString().split('\n')
    lines.pop()

    const datapoints = lines.map((line) => {
      const values = line.split(',')
      return {
        date: new Date(values[0]),
        co2: parseInt(values[1]),
        tvoc: parseInt(values[2]),
        rawH2: parseInt(values[3]),
        rawEthanol: parseInt(values[4]),
        rating: co2Sensor.getRating(parseInt(values[1])).name,
      }
    })

    function roundTimeQuarterHour(time) {
      var timeToReturn = new Date(time)
      timeToReturn.setMilliseconds(Math.round(timeToReturn.getMilliseconds() / 1000) * 1000)
      timeToReturn.setSeconds(Math.round(timeToReturn.getSeconds() / 60) * 60)
      timeToReturn.setMinutes(Math.round(timeToReturn.getMinutes() / 15) * 15)
      return timeToReturn
    }

    datapoints.forEach(dp => {
      const time = roundTimeQuarterHour(dp.date)
      dp.timeFrame = time
    })

    function groupBy(arr, criteria) {
      const newObj = arr.reduce(function (acc, currentValue) {
        if (!acc[currentValue[criteria]]) {
          acc[currentValue[criteria]] = []
        }
        acc[currentValue[criteria]].push(currentValue)
        return acc
      }, {})
      return newObj
    }

    const groupedList = groupBy(datapoints, 'timeFrame')

    const result = []
    for (let key of Object.keys(groupedList)) {
      const points = groupedList[key]

      if (points[0].timeFrame.getTime() > new Date().getTime() - (1000 * 60 * 60 * 24 * 7)) {
        // get avg from all datapoints
        const sumCO2 = points.map(e => e.co2).reduce((a, b) => a + b, 0)
        const avgCO2 = (sumCO2 / points.length) || 0
        const sumTvoc = points.map(e => e.tvoc).reduce((a, b) => a + b, 0)
        const avgTvoc = (sumTvoc / points.length) || 0
        const sumRawH2 = points.map(e => e.rawH2).reduce((a, b) => a + b, 0)
        const avgRawH2 = (sumRawH2 / points.length) || 0
        const sumRawEthanol = points.map(e => e.rawEthanol).reduce((a, b) => a + b, 0)
        const avgRawEthanol = (sumRawEthanol / points.length) || 0
  
        result.push({
          date: points[0].timeFrame,
          co2: Math.round(avgCO2),
          tvoc: Math.round(avgTvoc),
          rawH2: Math.round(avgRawH2),
          rawEthanol: Math.round(avgRawEthanol),
          rating: co2Sensor.getRating(avgCO2).name,
        })
      }
    }
    return result
  } catch (err) {
    platform.logger.debug(`airController.get() -- 500:Internal Server Error`)
    platform.logger.error(`airController.get() -- catch`, err)
    throw boom.boomify(err)
  }
}

//
exports.post = async (req, reply) => {
  /** @type {Platform} */
  const platform = req.locals

  platform.logger.debug(`airController.post() -- start`)

  try {
    const body = req.body

    if (body.values) {
      const {
        values
      } = body

      platform.logger.debug(`airController.post() -- body: `, values)

      platform.logger.debug(`airController.post() -- end`)
      return {
        value: co2Sensor.getRating(values.co2).name,
        success: true
      }
    } else if (body.co2) {
      const {
        co2,
        tvoc,
        rawH2,
        rawEthanol
      } = body

      platform.logger.debug(`airController.post() -- body: `, co2, tvoc, rawH2, rawEthanol)

      platform.logger.debug(`airController.post() -- end`)

      fs.appendFileSync('airQualityLog.csv', `${new Date().toISOString()},${co2},${tvoc},${rawH2},${rawEthanol},${req.params.id}\n`)

      return {
        value: co2Sensor.getRating(co2).name,
        success: true
      }
    } else {
      platform.logger.debug(`airController.post() -- 400:Bad Request`)
      platform.logger.debug(`airController.post() -- end`)
      return reply
        .status(400)
        .send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Required values not supplied!'
        })
    }

  } catch (err) {
    platform.logger.debug(`airController.post() -- 500:Internal Server Error`)
    platform.logger.error(`airController.post() -- catch`, err)
    throw boom.boomify(err)
  }
}