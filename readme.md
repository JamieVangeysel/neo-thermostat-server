# Neo Thermostat Server:

# New platform (v2)
the platform consists of 5 main services:
- Config: contains the current configuration with various tools
- Thermostat: Array of configured thermostats, if there is only one instance it will always be named default regardless of the configured name
- Relais: Relais host in which different switch power states can be configured
- Filesystem
- HttpServer (api)
- Database (optional: deprecated)
- WeatherInfo (optional)

## Current desired setup
- 2 exposed thermostats (living and app. living)
- 3 exposed valves (heating home, heating app., hot water)
- 1 exposed heater element (heater required by all 3 valve's, heater should be enabled if 1 or more valve's are in the open position)

## Requirements

- NEO Temp sensor (THP10)
- NEO HVAC Controller (HVAC01)
- openweathermap api key (free)

## Optional options

- syslog server
- mongodb server

### Ali todo for new temp proj

- relais: https://www.aliexpress.com/item/1005001504473815.html?spm=a2g0s.9042311.0.0.2ed14c4d71qCZb
- battery: https://www.ebay.co.uk/itm/6pcs-9800mAh-3-7V-Li-ion-Battery-Rechargeable-Low-Drain-USB-Charger-For-Torch/184505323869
- 10 batteries: https://www.ebay.co.uk/itm/10PCS-26650-Batterie-12800mAh-3-7V-Li-ion-Rechargeable-Battery-for-Outil-Jouet/133358469269
- 6 batteries: https://www.benl.ebay.be/itm/6PCS-Battery-26650-12800mAh-3-7V-BRC-Li-ion-Rechargeable-Bateria-for-Flash-New/333307936380

### Refs
- Raspberry: https://www.sossolutions.nl/raspberry-pi-4-model-b-4gb
- Arduino pro mini power: https://www.iot-experiments.com/arduino-pro-mini-power-consumption/
- Arduino pro mini 1MHz: https://www.iot-experiments.com/arduino-pro-mini-1mhz-in-arduino-ide/
- multiple
  rf: https://create.arduino.cc/projecthub/humblehacker/mapping-household-temperature-flow-with-cheap-sensors-6a36c3?ref=tag&ref_id=thermostat&offset=1
- long range rf
  module: https://www.ebay.co.uk/itm/NRF24L01-PA-LNA-SMA-Antenna-Wireless-Transceiver-communication-module-2-4G-1100m/310651702557

### Calculate Heat loss room

Q = ΔT x A x U

- Q = Heatloss in Watt
- ΔT = Temperature difference (inside - outside) in Celsius
- A = Surface area of the structure in square meters
- U = U-value of the structure
- 
  Stel, je hebt een woonkamer van 6 meter lang, 5 meter breed en 2,70 meter hoog.  
- Dit geeft een kamerinhoud van 81 m³.  
- Stel dat de gewenste binnentemperatuur 20°C is en de buitentemperatuur 0°C, dan is het temperatuurverschil 20°C.  
- Je hebt een muur met een oppervlakte van 20 m² en een U-waarde van 0,35 W/m²K.  
- Het warmteverlies door de muur is dan: 20°C * 20 m² * 0,35 W/m²K = 140 Watt.

## Kamers warmtebehoefte draft:

- Keuken: 1824
- Leefruimte & veranda: 8381
- Inkom: 1339
- Voorraadkast: 293
- Technische ruimte: 307
- Wasplaats: 691
- Hal: 1125
- Slaapkamer 1: 1651
- Dressing: 1116
- Badkamer: 2255
- Slaapkamer 2: 2296
- Slaapkamer 3: 2512
- Bureau: 1180
- Opslag 1: 579
- Opslag 2: 670

Totaal: **26.219kW**
