/*

https://github.com/noble/noble
https://github.com/luin/ioredis

*/

const noble = require('noble')
const Redis = require('ioredis')
const moment = require('moment')

const redis = new Redis(6379, '192.168.1.201')

noble.on('stateChange', state => {
  console.log('==== Changed state to ', state)
  if (state === 'poweredOn') {
    noble.startScanning([], true)
  }
})

noble.on('warning', warning => console.log('Warn:', warning))

noble.on('discover', device => {
  const now = moment()
  const manufacturerData = device.advertisement.manufacturerData
    ? device.advertisement.manufacturerData.toString('base64')
    : null

  const data = {
    id: device.uuid,
    rssi: device.rssi,
    state: device.state,
    addressType: device.addressType,

    localName: device.advertisement.localName,
    manufacturerData: manufacturerData,
    txPowerLevel: device.advertisement.txPowerLevel,
    serviceData: device.advertisement.serviceData,
    solicitationServiceUuids: device.advertisement.solicitationServiceUuids,
    serviceSolicitationUuids: device.advertisement.serviceSolicitationUuids,
  }

  console.log('Device', data)

  const dateAndHour = now.format('YYYY-MM-DD HH')

  const id = device.uuid

  redis.set(`last:byId:${id}:rssi`, device.rssi)
  redis.set(`last:byId:${id}:state`, device.state)
  redis.set(`last:byId:${id}:addressType`, device.addressType)
  redis.set(`last:byId:${id}:localName`, device.advertisement.localName)
  redis.set(`last:byId:${id}:txPowerLevel`, device.advertisement.txPowerLevel)
  redis.set(`last:byId:${id}:date`, now.format())
  redis.set(`last:byId:${id}:time`, now.valueOf())

  redis.incr(`hits:byId:${id}`)
  redis.incr(`hits:byHour:${dateAndHour}`)
  redis.incr(`hits:byIdHour:${id}:${dateAndHour}`)
  redis.incr(`hits:byHourId:${dateAndHour}:${id}`)

  redis.zincrby(`rssi:byIdHour:${id}:${hour}`)

  redis.zincrby(`state:byId:${id}`, 1, device.state || 'null')
  redis.zincrby(`manufacturerData:byId:${id}`, 1, manufacturerData || 'null')
  redis.zincrby(
    `localname:byId:${id}`,
    1,
    device.advertisement.localName || 'null'
  )

  redis.rpush(`all`, JSON.stringify(data))
})
