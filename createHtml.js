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
    .then(ids => {
      return Promise.all(ids.map(getItemsForId))
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
  const TOTAL_SLOTS = 1000

  allItems.sort((a, b) => a.minTime - b.minTime)

  return toHtml(
    allItems.map(({ items, id }) => {
      const line = [...new Array(TOTAL_SLOTS)].map(x => [])
      items.forEach(item => {
        const pos = Math.floor(
          (item.time - minTime) / diffTime * (TOTAL_SLOTS - 1)
        )
        line[pos].push(item)
      })
      return { line, id }
    })
  )
}

function normalizeRssi(rssi) {
  if (rssi == null) return 0
  return 1
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
  console.log(toHash(id))
  return Math.abs(toHash(id) % 360)
}

function getItemsForId(id) {
  return redis.zrange('rssi:byId:' + id, 0, -1, 'WITHSCORES').then(result => {
    const items = []
    for (let i = 0; i < result.length; i += 2) {
      items.push({
        rssi: parseInt(result[i], 10),
        time: parseInt(result[i + 1], 10),
      })
    }

    const maxTime = items.reduce((a, b) => Math.max(a, b.time), items[0].time)
    const minTime = items.reduce((a, b) => Math.min(a, b.time), items[0].time)

    return { items, maxTime, minTime, id }
  })
}

function toHtml(lines) {
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
                display: block;
              }
              .item {
                display: inline-flex;
              }
              .box {
                width: 2px;
                height: 10px;
                background-color: red;
              }
            </style>
          </head>
          <body>
            <div class=items>
              ${lines
                .map(
                  ({ line, id }) => `
                    <div class="item">
                      ${id}
                      ${line
                        .map(
                          itemsAtPos => `<div class="box" style="
                        opacity: ${normalizeRssi(
                          avg(itemsAtPos.map(f => f.rssi))
                        )};
                        background-color: hsl(${idToHue(id)}, 50%, 50%);
                        "></div>`
                        )
                        .join('')}
                    </div>`
                )
                .join('')}
            </div
          </body>
        </html>`
}
