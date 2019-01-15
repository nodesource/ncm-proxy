#!/usr/bin/env node
'use strict'
process.title = 'ncm-proxy'

const Proxy = require('..')

const main = async () => {
  const {
    NCM_TOKEN: token,
    PORT: port = 14313
  } = process.env
  if (!token) {
    console.error('Usage: NCM_TOKEN=xxx ncm-proxy')
    process.exit(1)
  }
  const [, , registry = 'https://registry.npmjs.org'] = process.argv

  const proxy = new Proxy({ port })
  proxy.registry(registry)
  proxy.check(async pkg => {
    console.log(
      `${String(pkg.score || 0).padStart(3)} ` +
        `${pkg.name}@${pkg.version} (license=${pkg.license})`
    )
    for (const result of pkg.results) {
      if (!result.pass) {
        console.log(`    - ${result.name} ("${result.test}"="${result.value}")`)
      }
    }
    return (pkg.score || 0) >= 85
  })
  proxy.auth(token)
  proxy.on('error', err => {
    console.error(err)
  })
  proxy.listen()

  console.log(`http://localhost:${port}/`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
