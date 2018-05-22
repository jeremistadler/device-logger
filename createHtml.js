/*
https://github.com/luin/ioredis
*/

const fs = require('fs')
const Redis = require('ioredis')
const moment = require('moment')
const express = require('express')
const app = express()
const port = 3000

const redis = new Redis({
  connectionName: 'Vizualizer',
  dropBufferSupport: true,
  password: 'hej123',
  host: '192.168.191.82',
})

app.get('/', (request, response) => {
  generate(request, response)
})

app.listen(port, err => {
  if (err) return console.log('something bad happened', err)
  console.log(`server is listening on ${port}`)
})

function avg(arr) {
  if (arr.length === 0) return null
  if (arr.length === 1) return arr[0]

  let sum = 0
  for (let i = 0; i < arr.length; i++) sum += arr[i]
  return sum / arr.length
}

function generate(req, res) {
  redis
    .smembers('wifi:id:all')
    .then(ids =>
      Promise.all([getAllRssi(ids), getAllNames(ids), getAllAddressTypes(ids)])
    )
    .then(([rssis, names, addressTypes]) => {
      rssis.forEach((item, index) => {
        if (item !== null) {
          item.name = names[index]
          item.addressType = addressTypes[index]
        }
      })
      return rssis.filter(f => f !== null).filter(({ items }) => {
        // if (
        //   items.length === 1 ||
        //   items[items.length - 1].time - items[0].time < HIDE_SHORTER_THEN
        // )
        //   return false

        return true
      })
    })
    .then(itemsToHtml)
    .then(html => {
      res.header('Content-Type', 'text/html')
      res.send(html)
    })
}

function itemsToHtml(allItems) {
  const totalMaxTime = allItems.reduce(
    (a, b) => Math.max(a, b.maxTime),
    allItems[0].maxTime
  )
  const totalMinTime = allItems.reduce(
    (a, b) => Math.min(a, b.minTime),
    allItems[0].minTime
  )
  const diffTime = totalMaxTime - totalMinTime
  const TOTAL_SLOTS = 200

  allItems.sort((a, b) => {
    // if (a.name) return -1
    // if (b.name) return 1
    //
    // if (a.timeDiff > HIDE_SHORTER_THEN) return -1
    // if (b.timeDiff > HIDE_SHORTER_THEN) return 1

    return a.minTime - b.minTime
  })

  return toHtml(
    allItems.map(item => {
      item.buckets = [...new Array(TOTAL_SLOTS)].map(x => [])
      item.items.forEach(point => {
        const pos = Math.floor(
          (point.time - totalMinTime) / diffTime * (TOTAL_SLOTS - 1)
        )
        item.buckets[pos].push(point)
      })
      return item
    }),
    totalMinTime,
    totalMaxTime
  )
}

function normalizeRssi(rssi) {
  if (rssi == null) return 0
  //return 1
  return 1 - rssi * -0.01
}

function toHash(id) {
  var hash = 0,
    i,
    chr
  if (id.length === 0) return hash
  for (i = 0; i < id.length; i++) {
    chr = id.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0 // Convert to 32bit integer
  }
  return hash
}

function idToHue(id) {
  return Math.abs(toHash(id) % 360)
}

function getAllRssi(ids) {
  const pipeline = redis.pipeline()

  const firstTime = moment()
    .subtract(200, 'hour')
    .valueOf()

  ids.forEach(id =>
    pipeline.zrangebyscore(
      'wifi:rssi:byId:' + id,
      firstTime,
      Infinity,
      'WITHSCORES'
    )
  )

  return pipeline.exec().then(pipeResult => {
    return pipeResult.map(f => f[1]).map((r, index) => {
      const id = ids[index]
      const items = []

      for (let i = 0; i < r.length; i += 2) {
        items.push({
          rssi: parseInt(r[i], 10),
          time: parseInt(r[i + 1], 10),
        })
      }

      if (items.length === 0) return null

      const maxTime = items.reduce((a, b) => Math.max(a, b.time), items[0].time)
      const minTime = items.reduce((a, b) => Math.min(a, b.time), items[0].time)
      const timeDiff = maxTime - minTime

      return { items, maxTime, minTime, timeDiff, id }
    })
  })
}

function getAllNames(ids) {
  const pipeline = redis.pipeline()

  ids.forEach(id => pipeline.zrange('wifi:ssid:byId:' + id, 0, -1))

  return pipeline.exec().then(pipeResult => {
    return pipeResult.map(f => f[1]).map((names, index) => {
      const id = ids[index]
      const filtered = names
        .filter(Boolean)
        .filter(f => f !== 'null' && f.trim() !== '')

      if (filtered.length === 0) return ''
      return filtered[0].trim()
    })
  })
}

function getAllAddressTypes(ids) {
  const pipeline = redis.pipeline()

  ids.forEach(id => pipeline.get(`last:byId:${id}:addressType`))

  return pipeline.exec().then(pipeResult => {
    return pipeResult.map(f => f[1])
  })
}

function timeToPercentage(min, max, value) {
  return (value - min) / (max - min) * 100
}

const HIDE_SHORTER_THEN = 1000 * 60 * 30

function toHtml(lines, totalMinTime, totalMaxTime) {
  return `<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <title>Device-logger</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              * {
                box-sizing: border-box;
                font-weight: 300;
                font-size: 12px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
              }
              .items {
                margin: 10px;
              }
              .line {
                height: 15px;
                display: flex;
              }
              .line:nth-child(even) {
                background: #ecf3ff;
              }
              .line:hover {
                background: #b8d9ff;
              }
              .lineInner {
                height: 15px;
                position: relative;
                    flex: 1;
              }
              .name {
                width: 340px;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                font-family: monospace;
              }
              .line .point {
                position: absolute;
                top: 3px;
                width: 10px;
                height: 10px;
                border-width: 0.5px;
                border-style: solid;
                border-radius: 10px;
              }

              .rssiPlotContainer {
                margin: 10px;
                margin-bottom: 50px;
                position: relative;
                height: 500px;
                margin-top: 50px;
                border-bottom: 1px solid black;
                border-top: 1px solid black;
              }
              .rssiPlotContainer > .point {
                position: absolute;
                top: 3px;
                width: 3px;
                height: 3px;
                //border-width: 0.5px;
                //border-style: solid;
                //border-radius: 10px;
              }
              .rssiPlotContainer .axisLabel {
                position: absolute;

              }
            </style>
          </head>
          <body>
            <div class=items>
              ${lines
                .map(
                  ({ buckets, id, name, minTime, maxTime }) => `
                    <div class="line">
                      <span class=name>${id}
                        ${name ? `${name}` : ''}
                      </span>
                      <div class="lineInner">
                      ${buckets
                        .filter(f => f.length > 0)
                        .map(
                          itemsAtPos => `<div class="point" style="
                          left: ${timeToPercentage(
                            totalMinTime,
                            totalMaxTime,
                            avg(itemsAtPos.map(f => f.time))
                          )}%;
                        background-color: hsla(
                          ${idToHue(name)},
                          50%, 50%,
                          ${normalizeRssi(avg(itemsAtPos.map(f => f.rssi)))}
                        );
                        border-color: hsla(${idToHue(name)}, 50%, 50%, 0.6);
                        "></div>`
                        )
                        .join('')}
                    </div></div>`
                )
                .join('')}
            </div>
            <div class=rssiPlotContainer>
              ${lines
                .map(
                  ({ buckets, id, name }) => `
                      ${buckets
                        .filter(f => f.length > 0)
                        .map(
                          itemsAtPos => `<div class="point" style="
                          left: ${timeToPercentage(
                            totalMinTime,
                            totalMaxTime,
                            avg(itemsAtPos.map(f => f.time))
                          )}%;
                          top: ${normalizeRssi(
                            avg(itemsAtPos.map(f => f.rssi))
                          ) * 100}%;
                        background-color: hsla(
                          ${idToHue(name)},
                          50%, 50%,
                          0.5
                        );
                        //border-color: hsla(${idToHue(name)}, 50%, 50%, 0.6);
                        "></div>`
                        )
                        .join('')}
                    `
                )
                .join('')}
              <span class="axisLabel" style="top: 0%">0 dB</span>
              <span class="axisLabel" style="top: 25%">-25 dB</span>
              <span class="axisLabel" style="top: 50%">-50 dB</span>
              <span class="axisLabel" style="top: 75%">-75 dB</span>
              <span class="axisLabel" style="top: 100%">-100 dB</span>
            </div>
          </body>
        </html>`
}
