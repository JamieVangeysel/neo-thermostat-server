// Copyright 2021-2021 Jamie Vangeysel//
'use strict'

module.exports = (function () {
  // co2 values < 600 amazing, < 800 good, < 1000 fair, < 1500 mediocre, <2000 bad, >= 2000 hazardous
  const getRating = function (coLevel) {
    // normalize level (/100)
    const normalizedLevel = Math.round(coLevel / 100)

    switch (normalizedLevel) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
        return CO2Levels.Amazing

      case 7:
      case 8:
        return CO2Levels.Good

      case 9:
      case 10:
        return CO2Levels.Fair

      case 11:
      case 12:
      case 13:
      case 14:
      case 15:
        return CO2Levels.Mediocre

      case 16:
      case 17:
      case 18:
      case 19:
      case 20:
        return CO2Levels.Bad

      default:
        return CO2Levels.Hazardous
    }
  }

  return {
    getRating: getRating
  }
})()

class CO2Levels {
  static Amazing = new CO2Levels('Amazing')
  static Good = new CO2Levels('Good')
  static Fair = new CO2Levels('Fair')
  static Mediocre = new CO2Levels('Mediocre')
  static Bad = new CO2Levels('Bad')
  static Hazardous = new CO2Levels('Hazardous')

  constructor(name) {
    this.name = name
  }
}