'use strict'

const { test } = require('tap')
const http = require('http')
const Proxy = require('..')
const fetch = require('node-fetch')

let registry

const { NCM_TOKEN: token } = process.env
if (!token) {
  console.error('Usage: NCM_TOKEN=xxx npm test')
  process.exit(1)
}

const startProxy = ({
  check = async () => true,
  registryAddr = `http://localhost:${registry.address().port}`
} = {}) =>
  new Promise(resolve => {
    const proxy = new Proxy()
    proxy.check(check)
    proxy.registry(registryAddr)
    proxy.auth(token)
    const proxyServer = proxy.listen(() => resolve({ proxyServer, proxy }))
  })

test('Setup', async t => {
  registry = http.createServer()
  registry.listen(() => t.end())
})

test('GET /', async t => {
  const { proxyServer } = await startProxy()
  registry.once('request', (req, res) => {
    t.equal(req.url, '/')
    res.end('OK')
  })
  const res = await fetch('http://localhost:14313/')
  t.equal(res.status, 200)
  const body = await res.text()
  t.equal(body, 'OK')
  proxyServer.close()
})

test('GET /:name', async t => {
  const { proxyServer } = await startProxy()
  registry.once('request', (req, res) => {
    t.equal(req.url, '/name')
    res.end(
      JSON.stringify({
        versions: {
          '1.0.0': {
            dist: {
              tarball: `http://localhost:${
                registry.address().port
              }/name/-/name-1.0.0.tgz`
            }
          }
        }
      })
    )
  })
  const res = await fetch('http://localhost:14313/name')
  t.equal(res.status, 200)
  const body = await res.json()
  t.deepEqual(body, {
    versions: {
      '1.0.0': {
        dist: {
          tarball: 'http://localhost:14313/name/-/name-1.0.0.tgz'
        }
      }
    }
  })
  proxyServer.close()
})

test('trailing slash in registry url', async t => {
  const registryAddr = `http://localhost:${registry.address().port}/`
  const { proxyServer } = await startProxy({ registryAddr })
  registry.once('request', (req, res) => {
    t.equal(req.url, '/name')
    res.end(
      JSON.stringify({
        versions: {
          '1.0.0': {
            dist: {
              tarball: `http://localhost:${
                registry.address().port
              }/name/-/name-1.0.0.tgz`
            }
          }
        }
      })
    )
  })
  const res = await fetch('http://localhost:14313/name')
  t.equal(res.status, 200)
  const body = await res.json()
  t.deepEqual(body, {
    versions: {
      '1.0.0': {
        dist: {
          tarball: 'http://localhost:14313/name/-/name-1.0.0.tgz'
        }
      }
    }
  })
  proxyServer.close()
})

test('rewrite https to http', async t => {
  const registryAddr = `http://localhost:${registry.address().port}/`
  const { proxyServer } = await startProxy({ registryAddr })
  registry.once('request', (req, res) => {
    t.equal(req.url, '/name')
    res.end(
      JSON.stringify({
        versions: {
          '1.0.0': {
            dist: {
              tarball: `https://localhost:${
                registry.address().port
              }/name/-/name-1.0.0.tgz`
            }
          }
        }
      })
    )
  })
  const res = await fetch('http://localhost:14313/name')
  t.equal(res.status, 200)
  const body = await res.json()
  t.deepEqual(body, {
    versions: {
      '1.0.0': {
        dist: {
          tarball: 'http://localhost:14313/name/-/name-1.0.0.tgz'
        }
      }
    }
  })
  proxyServer.close()
})

test('GET /@:scope%2f:name', async t => {
  const { proxyServer } = await startProxy()
  registry.once('request', (req, res) => {
    t.equal(req.url, '/@scope%2fname')
    res.end(
      JSON.stringify({
        versions: {
          '1.0.0': {
            dist: {
              tarball: `http://localhost:${
                registry.address().port
              }/@scope/name/-/name-1.0.0.tgz`
            }
          }
        }
      })
    )
  })
  const res = await fetch('http://localhost:14313/@scope%2fname')
  t.equal(res.status, 200)
  const body = await res.json()
  t.deepEqual(body, {
    versions: {
      '1.0.0': {
        dist: {
          tarball: 'http://localhost:14313/@scope/name/-/name-1.0.0.tgz'
        }
      }
    }
  })
  proxyServer.close()
})

test('GET /:name/-/:name-:version.tgz', async t => {
  await t.test('200', async t => {
    const check = async pkg => {
      t.equal(pkg.name, 'express')
      return true
    }
    const { proxyServer } = await startProxy({ check })
    registry.once('request', (req, res) => {
      t.equal(req.url, '/express/-/express-1.0.0.tgz')
      res.end('OK')
    })
    const res = await fetch(
      'http://localhost:14313/express/-/express-1.0.0.tgz'
    )
    t.equal(res.status, 200)
    const body = await res.text()
    t.equal(body, 'OK')
    proxyServer.close()
  })

  await t.test('404', async t => {
    const check = async () => false
    const { proxyServer } = await startProxy({ check })
    const res = await fetch(
      'http://localhost:14313/express/-/express-1.0.0.tgz'
    )
    t.equal(res.status, 404)
    proxyServer.close()
  })
})

test('GET /@:scope/:name/-/:name-:version.tgz', async t => {
  const check = async pkg => {
    t.equal(pkg.name, '@scope/express')
    return true
  }
  const { proxyServer } = await startProxy({ check })
  registry.once('request', (req, res) => {
    t.equal(req.url, '/@scope/express/-/express-1.0.0.tgz')
    res.end('OK')
  })
  const res = await fetch(
    'http://localhost:14313/@scope/express/-/express-1.0.0.tgz'
  )
  t.equal(res.status, 200)
  const body = await res.text()
  t.equal(body, 'OK')
  proxyServer.close()
})

test('PUT /*', async t => {
  const { proxyServer } = await startProxy()
  registry.once('request', (req, res) => {
    t.equal(req.url, '/express')
    t.equal(req.method, 'PUT')
    res.end('OK')
  })
  const res = await fetch('http://localhost:14313/express', { method: 'PUT' })
  t.equal(res.status, 200)
  const body = await res.text()
  t.equal(body, 'OK')
  proxyServer.close()
})

test('DELETE /*', async t => {
  const { proxyServer } = await startProxy()
  registry.once('request', (req, res) => {
    t.equal(req.url, '/express')
    t.equal(req.method, 'DELETE')
    res.end('OK')
  })
  const res = await fetch('http://localhost:14313/express', {
    method: 'DELETE'
  })
  t.equal(res.status, 200)
  const body = await res.text()
  t.equal(body, 'OK')
  proxyServer.close()
})

test('Cleanup', async t => {
  registry.close()
})

test('Registries', async t => {
  const registries = [
    'http://registry.npmjs.org/',
    'https://registry.npmjs.org/',
    'https://registry.yarnpkg.com/',
    'https://r.cnpmjs.org/'
  ]

  for (const registry of registries) {
    await t.test(registry, async t => {
      const proxy = new Proxy()
      proxy.auth(token)
      proxy.registry(registry)
      proxy.check(() => true)
      const proxyServer = proxy.listen()

      await t.test('GET /express', async t => {
        const res = await fetch('http://localhost:14313/express')
        t.equal(res.status, 200)
      })

      await t.test('GET /express/-/express-1.0.0.tg', async t => {
        const res = await fetch('http://localhost:14313/express/-/express-1.0.0.tg')
        t.notOk(res.ok)
      })

      await t.test('GET /express/-/express-1.0.0.tgz', async t => {
        const res = await fetch('http://localhost:14313/express/-/express-1.0.0.tgz')
        t.equal(res.status, 200)
      })

      proxyServer.close()
    })
  }
})
