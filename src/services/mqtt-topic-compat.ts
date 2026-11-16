export interface IThermostatMqttTopics {
  /** Additional exact sensor topics to subscribe to; include legacy and/or site-layout topics. */
  temperature?: string[]
  /** Exact retained status topics to publish to; may include multiple compatible layouts. */
  thermostatStatus?: string[]
}

export interface InstanceMqttTopicConfig {
  temperatureSensor?: string
  mqttTopics?: IThermostatMqttTopics
}

const LEGACY_LIVING_SENSOR_ID = '68bc45c0f8dd63bd13a54c511242b2eead672bcbb3358c2e747a95b189bff31e1450908a61ed6ea3f33efb69c2b510f7'

/** Preserve the old sensor topic and add all explicitly configured topics. */
export function resolveTemperatureTopics(instance: InstanceMqttTopicConfig): string[] {
  const legacyTopic = instance.temperatureSensor === LEGACY_LIVING_SENSOR_ID
    ? '3B2702/sensor'
    : '03D3CE/sensor'
  return uniqueTopics([legacyTopic, ...(instance.mqttTopics?.temperature ?? [])])
}

/** Status topics are never guessed; publish exactly the paths configured per instance. */
export function resolveThermostatStatusTopics(instance: InstanceMqttTopicConfig): string[] {
  return uniqueTopics(instance.mqttTopics?.thermostatStatus ?? [])
}

function uniqueTopics(topics: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const topic of topics) {
    if (typeof topic !== 'string' || topic.length === 0 || seen.has(topic)) continue
    seen.add(topic)
    result.push(topic)
  }
  return result
}
