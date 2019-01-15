'use strict'

const Proxy = require('../..')
const fetch = require('node-fetch')
const assert = require('assert')

const iterations = 100
const concurrency = 10

const benchmark = async (title, fn) => {
  const start = new Date()
  console.log(`## ${title}`)

  for (let i = 0; i < iterations / concurrency; i++) {
    const batch = []
    for (let j = 0; j < concurrency; j++) {
      batch.push((async () => {
        await fn(i)
        process.stdout.write('.')
      })())
    }
    await Promise.all(batch)
  }

  console.log()
  console.log(`${new Date() - start}ms`)
  console.log()
}

const suite = async () => {
  console.log('# Benchmark')
  console.log(`iterations=${iterations}, concurrency=${concurrency}`)
  console.log()

  await benchmark('ncm-proxy', async i => {
    const res = await fetch(`http://localhost:14313/express/-/express-4.${i % 10}.0.tgz`)
    assert(res.ok)
  })

  await benchmark('registry.npmjs.org', async i => {
    const res = await fetch(`http://registry.npmjs.org/express/-/express-4.${i % 10}.0.tgz`)
    assert(res.ok)
  })
}

const main = async () => {
  const { NCM_TOKEN: token } = process.env
  if (!token) {
    console.error('Usage: NCM_TOKEN=xxx node benchmark.js')
    process.exit(1)
  }

  const proxy = new Proxy()
  proxy.registry('https://registry.npmjs.org')
  proxy.check(async pkg => true)
  proxy.auth(token)
  const server = proxy.listen(async () => {
    await suite()
    server.close()
  })
}

main().catch(console.error)
