/*

https://github.com/noble/noble
https://github.com/luin/ioredis

*/

const noble = require('noble')
const Redis = require('ioredis')
const moment = require('moment')

const redis = new Redis({
  connectionName: 'DeviceLogger',
  dropBufferSupport: true,
  password: 'hej123',
})

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

  serviceData =
    serviceData && serviceData.data
      ? { id: serviceData.uuid, data: serviceData.data.toString('base64') }
      : null

  rssi = rssi == null ? 'null' : rssi
  txPowerLevel = txPowerLevel == null ? 'null' : txPowerLevel
  localName = localName == null ? 'null' : localName
  addressType = addressType == null ? 'null' : addressType
  state = state == null ? 'null' : state

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

  //console.log('Device', data)

  const dateAndHour = now.format('YYYY-MM-DD HH')
  const dateHourMinute = now.format('YYYY-MM-DD HH:mm')
  const pipeline = redis.pipeline()

  pipeline.set(`last:byId:${id}:rssi`, rssi)
  pipeline.set(`last:byId:${id}:state`, state)
  pipeline.set(`last:byId:${id}:addressType`, addressType)
  pipeline.set(`last:byId:${id}:localName`, localName)
  pipeline.set(`last:byId:${id}:txPowerLevel`, txPowerLevel)
  pipeline.set(`last:byId:${id}:date`, now.format())
  pipeline.set(`last:byId:${id}:time`, now.valueOf())

  pipeline.incr(`hits:byId:${id}`)
  pipeline.incr(`hits:byHour:${dateAndHour}`)
  pipeline.incr(`hits:byMinute:${dateHourMinute}`)
  pipeline.incr(`hits:byIdHour:${id}:${dateAndHour}`)
  pipeline.incr(`hits:byIdMinute:${id}:${dateHourMinute}`)
  pipeline.incr(`hits:byHourId:${dateAndHour}:${id}`)
  pipeline.incr(`hits:byMinuteId:${dateHourMinute}:${id}`)

  pipeline.zadd(`rssi:byId:${id}`, now.valueOf(), rssi)
  pipeline.zadd(`txPowerLevel:byId:${id}`, now.valueOf(), txPowerLevel)
  pipeline.zadd(`addressType:byId:${id}`, now.valueOf(), addressType)

  pipeline.sadd(`id:seenByPower:${txPowerLevel}`, id)
  pipeline.sadd(`id:seenByName:${localName}`, id)
  pipeline.sadd(`id:seenByState:${state}`, id)
  pipeline.sadd(`id:seenByAddressType:${addressType}`, id)
  pipeline.sadd(`id:seenByData:${manufacturerData || 'null'}`, id)
  pipeline.sadd(`id:all`, id)

  pipeline.zincrby(`seen:byId`, 1, id || 'null')
  pipeline.zincrby(`state:byId:${id}`, 1, state || 'null')
  pipeline.zincrby(`manufacturerData:byId:${id}`, 1, manufacturerData || 'null')
  pipeline.zincrby(`localname:byId:${id}`, 1, localName || 'null')

  //pipeline.rpush(`all`, JSON.stringify(data))

  pipeline
    .exec()
    .then(results => {
      const errors = results.map(f => f[0]).filter(Boolean)
      if (errors.length > 0) console.log('errors: ', errors)
    })
    .catch(err => {
      // result === [[null, 'OK'], [null, 'bar']]
      console.log('errors: ', err)
    })
})
