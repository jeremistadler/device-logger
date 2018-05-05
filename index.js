/*

https://github.com/noble/noble
https://github.com/luin/ioredis

*/

const noble = require('noble')
const Redis = require('ioredis')
const moment = require('moment')

const StatusesById = new Map()

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

  pipeline.zadd(`firstSeen:idByTime`, 'NX', now.valueOf(), id)
  pipeline.zadd(`lastSeen:idByTime`, now.valueOf(), id)
  pipeline.hsetnx(`firstSeen:timeById`, id, now.valueOf())
  pipeline.hset(`lastSeen:timeById`, id, now.valueOf())

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

  const statusById = StatusesById.get(id)

  if (
    statusById == null ||
    (statusById === 'CLOSED' && ['ffff3ef238ad', 'ffffc1114592'].includes(id))
  ) {
    openConn(id)
  }
})

function openConn(id) {
  console.log(id, 'Connecting...')
  StatusesById.set(id, 'CONNECTING')
  device.connect(connectErr => {
    if (connectErr) {
      console.log(id, '...Connect err', connectErr)
      StatusesById.set(id, 'CLOSED')
      return
    }
    console.log(id, '...Connected!')
    device.once('rssiUpdate', newRssi => {
      console.log(id, 'new rssi', newRssi)
      pipeline.zadd(`rssi:byId:${id}`, Date.now(), newRssi)
    })
    device.once('disconnect', () => {
      console.log(id, 'Connection Opened')
      StatusesById.set(id, 'CONNECTED')
    })
    device.once('disconnect', () => {
      console.log(id, 'Connection closed')
      StatusesById.set(id, 'CLOSED')
    })
    device.discoverAllServicesAndCharacteristics(
      (infoErr, services, characteristics) => {
        if (infoErr) console.log(id, 'Info Error', infoErr)
        console.log(id, { services, characteristics })

        if (characteristics)
          characteristics.forEach(ch => {
            ch.read((readErr, data) => {
              if (readErr) console.log(id, ch.name, 'Char Read err', readErr)
              if (data)
                console.log(
                  id,
                  'Character data from',
                  ch.name,
                  data.toString(),
                  data.toString('hex')
                )
            })
            // ch.subscribe(subError => {
            //   console.log('Could not subscribe to character ', id, ch)
            // })
            ch.discoverDescriptors((desErr, descriptors) => {
              if (desErr) console.log(id, 'Read descriptior err', desErr)
              if (descriptors) {
                console.log(id, 'Descriptors', descriptors)
                descriptors.forEach(des => {
                  des.readValue((readErr, data) => {
                    if (readErr)
                      console.log(id, ch.name, 'Des Read err', readErr)
                    if (data)
                      console.log(
                        id,
                        'Descriptor data from',
                        ch.name,
                        data.toString(),
                        data.toString('hex')
                      )
                  })
                })
              }
            })
          })
      }
    )
  })
}
