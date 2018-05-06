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
  host: '192.168.1.201',
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
    .smembers('id:all')
    .then(ids => Promise.all([getAllRssi(ids), getAllNames(ids)]))
    .then(([rssis, names]) => {
      rssis.forEach((item, index) => {
        item.name = names[index]
      })
      return rssis
    })
    .then(itemsToHtml)
    .then(html => {
      res.header('Content-Type', 'text/html')
      res.send(html)
    })
}

function itemsToHtml(allItems) {
  const maxTime = allItems.reduce(
    (a, b) => Math.max(a, b.maxTime),
    allItems[0].maxTime
  )
  const minTime = allItems.reduce(
    (a, b) => Math.min(a, b.minTime),
    allItems[0].minTime
  )
  const diffTime = maxTime - minTime
  const TOTAL_SLOTS = 600

  allItems.sort((a, b) => a.minTime - b.minTime)

  return toHtml(
    allItems.map(({ items, id, name }) => {
      const line = [...new Array(TOTAL_SLOTS)].map(x => [])
      items.forEach(item => {
        const pos = Math.floor(
          (item.time - minTime) / diffTime * (TOTAL_SLOTS - 1)
        )
        line[pos].push(item)
      })
      return { line, id, name }
    }),
    minTime,
    maxTime
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

  ids.forEach(id =>
    pipeline.zrangebyscore(
      'rssi:byId:' + id,
      1525219200000,
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

      const maxTime = items.reduce((a, b) => Math.max(a, b.time), items[0].time)
      const minTime = items.reduce((a, b) => Math.min(a, b.time), items[0].time)

      return { items, maxTime, minTime, id }
    })
  })
}

function getAllNames(ids) {
  const pipeline = redis.pipeline()

  ids.forEach(id => pipeline.zrange('localname:byId:' + id, 0, -1))

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

function timeToPercentage(min, max, value) {
  return (value - min) / (max - min) * 100
}

function toHtml(lines, minTime, maxTime) {
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
              .lineInner {
                height: 15px;
                position: relative;
                    flex: 1;
              }
              .name {
                width: 160px;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
              }
              .point {
                position: absolute;
                top: 3px;
                width: 10px;
                height: 10px;
                border-width: 0.5px;
                border-style: solid;
                border-radius: 10px;
              }
            </style>
          </head>
          <body>
            <div class=items>
              ${lines
                .map(
                  ({ line, id, name }) => `
                    <div class="line">
                      <span class=name>${id} (${name})</span>
                      <div class="lineInner">
                      ${line
                        .filter(f => f.length > 0)
                        .map(
                          itemsAtPos => `<div class="point" style="
                          left: ${timeToPercentage(
                            minTime,
                            maxTime,
                            avg(itemsAtPos.map(f => f.time))
                          )}%;
                        background-color: hsla(
                          ${idToHue(id)},
                          50%, 50%,
                          ${normalizeRssi(avg(itemsAtPos.map(f => f.rssi)))}
                        );
                        border-color: hsla(${idToHue(id)}, 50%, 50%, 0.6);
                        "></div>`
                        )
                        .join('')}
                    </div></div>`
                )
                .join('')}
            </div
          </body>
        </html>`
}
