/*

https://github.com/noble/noble
https://github.com/luin/ioredis

*/

const noble = require('noble')
const Redis = require('ioredis')
const moment = require('moment')
const stringify = require('fast-safe-stringify')
const fs = require('fs')
const spawn = require('child_process').spawn

const StatusesById = new Map()

const redis = new Redis({
  connectionName: 'DeviceLogger',
  dropBufferSupport: true,
  password: 'hej123',
})

noble.on('stateChange', state => {
  console.log('==== Changed state to', state)
  if (state === 'poweredOn') noble.startScanning([], true)
  else noble.stopScanning()
})

noble.on('warning', warning => console.log('Warn:', warning))
noble.on('scanStart', () => console.log('Scan started'))
noble.on('scanStop', () => console.log('Scan stopped'))

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

  pipeline.set(`bt:last:byId:${id}:rssi`, rssi)
  pipeline.set(`bt:last:byId:${id}:state`, state)
  pipeline.set(`bt:last:byId:${id}:addressType`, addressType)
  pipeline.set(`bt:last:byId:${id}:localName`, localName)
  pipeline.set(`bt:last:byId:${id}:txPowerLevel`, txPowerLevel)
  pipeline.set(`bt:last:byId:${id}:date`, now.format())
  pipeline.set(`bt:last:byId:${id}:time`, now.valueOf())

  pipeline.incr(`bt:hits:byId:${id}`)
  pipeline.incr(`bt:hits:byHour:${dateAndHour}`)
  pipeline.incr(`bt:hits:byMinute:${dateHourMinute}`)
  pipeline.incr(`bt:hits:byIdHour:${id}:${dateAndHour}`)
  pipeline.incr(`bt:hits:byIdMinute:${id}:${dateHourMinute}`)
  pipeline.incr(`bt:hits:byHourId:${dateAndHour}:${id}`)
  pipeline.incr(`bt:hits:byMinuteId:${dateHourMinute}:${id}`)

  pipeline.zadd(`bt:rssi:byId:${id}`, now.valueOf(), rssi)
  pipeline.zadd(`bt:txPowerLevel:byId:${id}`, now.valueOf(), txPowerLevel)
  pipeline.zadd(`bt:addressType:byId:${id}`, now.valueOf(), addressType)

  pipeline.sadd(`bt:id:seenByPower:${txPowerLevel}`, id)
  pipeline.sadd(`bt:id:seenByName:${localName}`, id)
  pipeline.sadd(`bt:id:seenByState:${state}`, id)
  pipeline.sadd(`bt:id:seenByAddressType:${addressType}`, id)
  pipeline.sadd(`bt:id:seenByData:${manufacturerData || 'null'}`, id)
  pipeline.sadd(`bt:id:all`, id)

  pipeline.zadd(`bt:firstSeen:idByTime`, 'NX', now.valueOf(), id)
  pipeline.zadd(`bt:lastSeen:idByTime`, now.valueOf(), id)
  pipeline.hsetnx(`bt:firstSeen:timeById`, id, now.valueOf())
  pipeline.hset(`bt:lastSeen:timeById`, id, now.valueOf())

  pipeline.zincrby(`bt:seen:byId`, 1, id || 'null')
  pipeline.zincrby(`bt:state:byId:${id}`, 1, state || 'null')
  pipeline.zincrby(
    `bt:manufacturerData:byId:${id}`,
    1,
    manufacturerData || 'null'
  )
  pipeline.zincrby(`bt:localname:byId:${id}`, 1, localName || 'null')

  //pipeline.rpush(`all`, JSON.stringify(data))

  pipeline
    .exec()
    .then(results => {
      const errors = results.map(f => f[0]).filter(Boolean)
      if (errors.length > 0) console.log('errors: ', errors)
    })
    .catch(err => {
      // result === [[null, 'OK'], [null, 'bar']]
      console.log('redis errors: ', err)
    })

  return

  let statusById = StatusesById.get(id)
  if (statusById == null) {
    console.log(id, 'Added new device', localName)
    device.on('rssiUpdate', newRssi => {
      console.log(id, 'new rssi', newRssi)
      redis.zadd(`rssi:byId:${id}`, Date.now(), newRssi)
    })
    device.on('connect', () => {
      console.log(id, 'Connection Opened')
      StatusesById.set(id, 'CONNECTED')
    })
    device.on('disconnect', () => {
      console.log(id, 'Connection closed')
      StatusesById.set(id, 'CLOSED')
    })
    device.on('data', data => {
      console.log(
        id,
        'Got raw data, asHex:',
        data.toString('hex'),
        'asString:',
        data.toString()
      )
    })

    statusById = 'CLOSED'
    StatusesById.set(id, statusById)
  }

  const ids = [
    'ffff3ef238ad', // AB Shutter 1
    'ffffc1114592', // ITAG 1
    '10f1f2ee8d51', // Jeremis Telefon
  ]

  const names = ['Jeremi']

  if (
    statusById === 'CLOSED' &&
    (ids.includes(id) || names.includes(localName.trim()))
  ) {
    console.log('Stopping scan to connect to ', id)
    StatusesById.set(id, 'WAIT_TO_CONNECT')
    noble.stopScanning()

    setTimeout(() => {
      openConn(device, id)
    }, 4000)

    setTimeout(() => {
      console.log('Starting scan')
      noble.startScanning([], true)
    }, 6000)
  }
})

function readCharacter(device, id) {
  device.discoverAllServicesAndCharacteristics(
    (infoErr, services, characteristics) => {
      fs.writeFile(
        '/home/pi/device-logger/' + id + '-' + 'info',
        stringify({ infoErr, services, characteristics }, null, 2),
        writeFileErr => {
          if (writeFileErr) return console.log(writeFileErr)
        }
      )

      if (infoErr) console.log(id, 'Info Error', infoErr)
      if (characteristics)
        characteristics.forEach(ch => {
          ch.on('notify', data => {
            console.log(
              id,
              'Got raw notify, asHex:',
              data.toString('hex'),
              'asString:',
              data.toString()
            )
          })
          ch.on('data', data => {
            console.log(
              id,
              'Got raw data, asHex:',
              data.toString('hex'),
              'asString:',
              data.toString()
            )
          })
          ch.read((readErr, data) => {
            if (readErr) console.log(id, ch.name, 'Char Read err', readErr)
            if (data)
              console.log(
                id,
                `Character data from: "${ch.name}"`,
                'asHex:',
                data.toString('hex'),
                'asString:',
                data.toString()
              )
          })
          ch.subscribe(subError => {
            console.log(id, 'Could not subscribe to character ', ch.name)
          })

          // if (ch.name === 'Alert Level') {
          //   setTimeout(() => {
          //     ch.write(Buffer.from([0xff]), true, writeError => {
          //       if (writeError)
          //         console.log(id, ch.name, 'Write error', writeError)
          //       else console.log(id, ch.name, 'Wrote data')
          //     })
          //   }, 500)
          // }

          ch.discoverDescriptors((desErr, descriptors) => {
            if (desErr) console.log(id, 'Read descriptior err', desErr)
            if (descriptors) {
              console.log(id, 'Descriptors', descriptors)
              descriptors.forEach(des => {
                console.log(id, ch.name, 'Descriptor', des)
                des.readValue((readErr, data) => {
                  if (readErr) console.log(id, ch.name, 'Des Read err', readErr)
                  if (data)
                    console.log(
                      id,
                      `Descriptor data from: "${ch.name}"`,
                      'asHex:',
                      data.toString('hex'),
                      'asString:',
                      data.toString()
                    )
                })
              })
            }
          })
        })
    }
  )
}

function openConn(device, id) {
  console.log(id, 'Connecting...')
  StatusesById.set(id, 'CONNECTING')
  device.connect(connectErr => {
    if (connectErr) {
      console.log(id, '...Connect err', connectErr)
      StatusesById.set(id, 'CLOSED')
      return
    }
    console.log(id, '...Connected!')

    device.updateRssi((err, newRssi) => {
      if (err) {
        console.log(id, 'update rssi error', err)
      } else {
        console.log(id, 'new rssi', newRssi)
        redis.zadd(`rssi:byId:${id}`, Date.now(), newRssi)
      }
    })

    readCharacter(device, id)
  })
}

/*

sudo /home/pi/tshark -i mon0 -f 'not multicast' -l -Y \
'wlan.fc.type_subtype == 0x00 || wlan.fc.type_subtype == 0x01 || wlan.fc.type_subtype == 0x03 || wlan.fc.type_subtype == 0x02 || wlan.fc.type_subtype == 0x04 || wlan.fc.type_subtype == 0x05' \
-T fields \
-e frame.time_epoch \
-e wlan.fc.type_subtype \
-e wlan.ssid \
-e wlan.sa \
-e wlan.da \
-e radiotap.channel.freq \
-e radiotap.dbm_antsignal

*/

const cmd = spawn('/home/pi/tshark', [
  '-i',
  'mon0',
  '-f',
  'not multicast',
  '-l',
  '-Y',
  'wlan.fc.type_subtype == 0x00 || wlan.fc.type_subtype == 0x01 || wlan.fc.type_subtype == 0x02 || wlan.fc.type_subtype == 0x03 || wlan.fc.type_subtype == 0x04 || wlan.fc.type_subtype == 0x05',
  '-T',
  'fields',
  '-e',
  'frame.time_epoch',
  '-e',
  'wlan.fc.type_subtype',
  '-e',
  'wlan.ssid',
  '-e',
  'wlan.sa',
  '-e',
  'wlan.da',
  '-e',
  'wlan.ta',
  '-e',
  'radiotap.channel.freq',
  '-e',
  'wlan_radio.noise_dbm',
  '-e',
  'wlan_radio.signal_dbm',
  '-e',
  'wlan_radio.channel',
])

cmd.stdout.on('data', function(data) {
  if (!data) return
  const lines = data
    .toString()
    .split('\n')
    .map(line => line.split('\t'))
    .filter(parts => parts.length > 5)

  if (lines.length > 0) {
    const pipeline = redis.pipeline()

    lines.forEach(parts => {
      const timeMs = parseFloat(parts[0]) * 1000
      const packetType = parseInt(parts[1])
      const ssid = parts[2]
      const id = parts[3] // Sender Address
      const id2 = parts[4] // Destination Address
      const id3 = parts[5] // Transmitter Address
      const freq = parts[6]
      const rssiNoise = parseFloat(parts[7])
      const rssi = parseFloat(parts[8])
      const channel = parseInt(parts[9])

      const now = moment(timeMs)

      const dateAndHour = now.format('YYYY-MM-DD HH')
      const dateHourMinute = now.format('YYYY-MM-DD HH:mm')

      pipeline.sadd(`wifi:sender:all`, id)
      pipeline.sadd(`wifi:destination:all`, id2)
      pipeline.sadd(`wifi:transmitter:all`, id3)

      pipeline.zadd(`wifi:sender:rssi:${id}`, now.valueOf(), rssi)

      pipeline.zadd(`wifi:sender:ssid:${id}`, now.valueOf(), ssid)
      pipeline.zadd(`wifi:destination:ssid:${id2}`, now.valueOf(), ssid)
      pipeline.zadd(`wifi:transmitter:ssid:${id3}`, now.valueOf(), ssid)

      pipeline.incr(`wifi:hits:byId:${id}`)
      pipeline.incr(`wifi:hits:byHour:${dateAndHour}`)
      pipeline.incr(`wifi:hits:byMinute:${dateHourMinute}`)
      pipeline.incr(`wifi:hits:byIdHour:${id}:${dateAndHour}`)
      pipeline.incr(`wifi:hits:byIdMinute:${id}:${dateHourMinute}`)
      pipeline.incr(`wifi:hits:byHourId:${dateAndHour}:${id}`)
      pipeline.incr(`wifi:hits:byMinuteId:${dateHourMinute}:${id}`)

      pipeline.zadd(`wifi:rssi:byId:${id}`, now.valueOf(), rssi)
      pipeline.zadd(`wifi:bssid:byId:${id}`, now.valueOf(), id2)
      pipeline.zadd(`wifi:freq:byId:${id}`, now.valueOf(), freq)
      pipeline.zadd(`wifi:ssid:byId:${id}`, now.valueOf(), ssid)

      pipeline.sadd(`wifi:id:seenByBssid:${id2}`, id)
      pipeline.sadd(`wifi:id:seenBySsid:${ssid}`, id)
      pipeline.sadd(`wifi:id:seenByFreq:${freq}`, id)
      pipeline.sadd(`wifi:id:all`, id)
      pipeline.sadd(`wifi:ssid:seenById:${id}`, ssid)

      pipeline.zadd(`wifi:firstSeen:idByTime`, 'NX', now.valueOf(), id)
      pipeline.zadd(`wifi:lastSeen:idByTime`, now.valueOf(), id)
      pipeline.hsetnx(`wifi:firstSeen:timeById`, id, now.valueOf())
      pipeline.hset(`wifi:lastSeen:timeById`, id, now.valueOf())

      pipeline.zincrby(`wifi:seenId`, 1, id)
      pipeline.zincrby(`wifi:seenSsid`, 1, ssid)
    })

    pipeline
      .exec()
      .then(results => {
        const errors = results.map(f => f[0]).filter(Boolean)
        if (errors.length > 0) console.log('redis errors: ', errors)
      })
      .catch(err => {
        // result === [[null, 'OK'], [null, 'bar']]
        console.log('redis errors: ', err)
      })
  }
})

cmd.stderr.on('data', function(data) {
  console.log('stderr: ' + data)
})

cmd.on('exit', function(code) {
  console.log('exit code: ' + code)
})
