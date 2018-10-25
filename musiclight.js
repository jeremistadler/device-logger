const noble = require('noble')
const stringify = require('fast-safe-stringify')
const fs = require('fs')

const whitelistedIds = [
  '00e04cadddd0', // Jeremis Smart Music Light
]
const whitelistedNames = ['Smart Music Light']

const StatusesById = new Map()

noble.on('stateChange', state => {
  console.log('==== Changed state to', state)
  if (state === 'poweredOn') noble.startScanning([], true)
  else noble.stopScanning()
})

noble.on('warning', warning => console.log('Noble Warn:', warning))
noble.on('scanStart', () => console.log('Scan started'))
noble.on('scanStop', () => console.log('Scan stopped'))

noble.on('discover', device => {
  const now = Date.now()

  const { id } = device
  const { localName } = device.advertisement || {}
  let isNew = false

  if (!StatusesById.has(id)) {
    console.log(id, 'Found new device', localName)
    StatusesById.set(id, 'CLOSED')
    isNew = true
  }

  if (!whitelistedIds.includes(id) && !whitelistedNames.includes(localName))
    return

  if (isNew) {
    device.on('rssiUpdate', newRssi => {
      console.log(id, 'new rssi', newRssi)
    })
    device.on('connect', () => {
      console.log(id, 'Connection Opened')
      StatusesById.set(id, 'CONNECTED')
    })
    device.on('disconnect', () => {
      console.log(id, 'Connection closed')
      StatusesById.set(id, 'CLOSED')

      setTimeout(() => {
        console.log('Starting scan')
        noble.startScanning([], true)
      }, 1000)
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
  }

  if (StatusesById.get(id) === 'CLOSED') {
    console.log('Stopping scan to connect to ', id)
    StatusesById.set(id, 'WAIT_TO_CONNECT')
    noble.stopScanning()

    setTimeout(() => {
      openConn(device, id)
    }, 4000)
  }
})

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
      }
    })

    readCharacter(device, id)
  })
}

function readCharacter(device, id) {
  device.discoverAllServicesAndCharacteristics(
    (infoErr, services, characteristics) => {
      fs.writeFile(
        __dirname + '/bt-info-' + id + '-' + Date.now() + '.json',
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

            fs.writeFile(
              __dirname + '/bt-info-data-' + id + '-' + Date.now() + '.json',
              stringify({ ch, data: data.toString('hex') }, null, 2),
              writeFileErr => {
                if (writeFileErr) return console.log(writeFileErr)
              }
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
          ch.write(Buffer.from([1, 1, 8]), true, err => {
            console.log('write', err)
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

          return

          ch.discoverDescriptors((desErr, descriptors) => {
            fs.writeFile(
              __dirname +
                '/bt-info-descriptors-' +
                id +
                '-' +
                Date.now() +
                '.json',
              stringify({ desErr, descriptors }, null, 2),
              writeFileErr => {
                if (writeFileErr) return console.log(writeFileErr)
              }
            )

            if (desErr) console.log(id, 'Read descriptior err', desErr)
            if (descriptors) {
              console.log(id, 'Descriptors', descriptors)
              descriptors.forEach(des => {
                console.log(id, ch.name, 'Descriptor', des)
                des.writeValue(Buffer.from([1, 1]))
                des.readValue((readErr, data) => {
                  fs.writeFile(
                    __dirname +
                      '/bt-info-descriptor-data-' +
                      id +
                      '-' +
                      Date.now() +
                      '.json',
                    stringify({ readErr, data, des }, null, 2),
                    writeFileErr => {
                      if (writeFileErr) return console.log(writeFileErr)
                    }
                  )

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
