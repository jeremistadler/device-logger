/*

https://github.com/noble/noble
https://github.com/luin/ioredis

*/

const noble = require('noble')
const Redis = require('ioredis')
const moment = require('moment')

const redis = new Redis(6379, '192.168.1.201')

noble.on('stateChange', state => {
  console.log('==== Changed state to', state)
  if (state === 'poweredOn') {
    noble.startScanning([], true)
  }
})

noble.on('warning', warning => console.log('Warn:', warning))

noble.on('discover', device => {
  const now = moment()

  let { uuid: id, rssi, state, addressType } = device

  let {
    localName,
    txPowerLevel,
    serviceData,
    manufacturerData,
    solicitationServiceUuids,
    serviceSolicitationUuids,
  } =
    device.advertisement || {}

  manufacturerData = manufacturerData
    ? manufacturerData.toString('base64')
    : null

  //serviceData = serviceData ? serviceData.toString('base64') : null

  const data = {
    id,
    rssi,
    state,
    addressType,

    localName,
    manufacturerData,
    txPowerLevel,
    serviceData,
    solicitationServiceUuids,
    serviceSolicitationUuids,
  }

  console.log('Device', data)

  const dateAndHour = now.format('YYYY-MM-DD HH')

  redis.set(`last:byId:${id}:rssi`, rssi)
  redis.set(`last:byId:${id}:state`, state)
  redis.set(`last:byId:${id}:addressType`, addressType)
  redis.set(`last:byId:${id}:localName`, localName)
  redis.set(`last:byId:${id}:txPowerLevel`, txPowerLevel)
  redis.set(`last:byId:${id}:date`, now.format())
  redis.set(`last:byId:${id}:time`, now.valueOf())

  redis.incr(`hits:byId:${id}`)
  redis.incr(`hits:byHour:${dateAndHour}`)
  redis.incr(`hits:byIdHour:${id}:${dateAndHour}`)
  redis.incr(`hits:byHourId:${dateAndHour}:${id}`)

  redis.zadd(`rssi:byId:${id}`, now.valueOf(), rssi)
  redis.zadd(`txPowerLevel:byId:${id}`, now.valueOf(), txPowerLevel)

  redis.zincrby(`state:byId:${id}`, 1, state || 'null')
  redis.zincrby(`manufacturerData:byId:${id}`, 1, manufacturerData || 'null')
  redis.zincrby(`localname:byId:${id}`, 1, localName || 'null')

  redis.rpush(`all`, JSON.stringify(data))
})
