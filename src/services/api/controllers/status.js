exports.get = async (req, reply) => {
  const platform = req.locals

  return platform.thermostat.State
}