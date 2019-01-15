'use strict'

const rawBody = require('raw-body')
const http = require('http')
const get = require('simple-get')
const EventEmitter = require('events')
const graphql = require('./lib/graphql')
const { resolve, URL } = require('url')
const debug = require('debug')('ncm-proxy')
const { promisify } = require('util')

class Proxy extends EventEmitter {
  constructor ({ port = 14313 } = {}) {
    super()

    this.registry('https://registry.npmjs.org')

    this._check = null
    this._token = null
    this._port = port
    this._api = null
  }

  registry (target) {
    // remove trailing slash
    target = target.replace(/(\/)$/, '')
    this._registry = target
  }

  api (url) {
    this._api = url
  }

  auth (token) {
    this._token = token
  }

  listen (cb) {
    const server = http.createServer((req, res) => {
      this._handle(req, res).catch(err => {
        console.error(err)
        res.statusCode = 500
        res.end(err.message)
      })
    })
    server.listen(this._port, cb)
    return server
  }

  check (fn) {
    this._check = fn
  }

  async _proxy (req, res) {
    const proxyRes = await this._getProxyRes(req, res)
    new Playback(proxyRes, res).all()
  }

  async _getProxyRes (req, res) {
    const targetUrl = /^\//.test(req.url)
      ? `${this._registry}${req.url}`
      : req.url
    const url = new URL(targetUrl)

    // remove cloudfront headers in case ncm-proxy itself has been deployed
    // behind cloudfront
    for (const key of Object.keys(req.headers)) {
      if (/^cf/.test(key)) delete req.headers[key]
    }

    return promisify(get)({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      method: req.method,
      path: url.pathname + url.search,
      headers: Object.assign({}, req.headers, { host: url.host }),
      auth: [url.username, url.password].filter(Boolean).join(':'),
      body: req
    })
  }

  async _handle (req, res) {
    debug('%s %s', req.method, req.url)
    let scope, name, version

    // /favicon.ico
    if (req.url === '/favicon.ico') return res.end()

    // POST /*
    // PUT /*
    if (req.method !== 'GET') return this._proxy(req, res)

    // GET /-/*
    if (/^\/-\//.test(req.url)) return this._proxy(req, res)

    // GET /:name
    let m = /^\/([^/@]+)/.exec(req.url)
    if (m) {
      name = m[1]
    }

    // GET /@:scope%2f:name
    m = /^\/(@[^%]+)%2f(.+)/.exec(req.url)
    if (m) {
      scope = m[1]
      name = m[2]
    }

    // GET /:name/-/:name-:version.tgz
    // GET /@:scope/:name/-/:name-:version.tgz
    m = RegExp(`${name}-(.+).tgz`).exec(req.url)
    if (m) {
      version = m[1]
    }

    debug(
      'scope=%s name=%s version=%s',
      scope,
      name,
      version
    )

    if (name && version) {
      await this._rewriteTarballRequest(
        req,
        res,
        scope,
        name,
        version
      )
    } else if (name) {
      await this._rewritePackageRequest(req, res)
    } else {
      await this._proxy(req, res)
    }
  }

  async _rewriteTarballRequest (
    req,
    res,
    scope,
    pkgName,
    version
  ) {
    const name = [scope, pkgName].filter(Boolean).join('/')
    const certification = await this._getCertification(name, version)
    const pkg = Object.assign({ name, version }, certification)
    pkg.license = (
      pkg.results.find(
        result => result.name === 'license' && result.value !== 'unknown'
      ) || {}
    ).value
    if (await this._check(pkg)) {
      const target = scope
        ? resolve(this._registry, `${scope}/${name}/-/${name}-${version}.tgz`)
        : resolve(this._registry, `${name}/-/${name}-${version}.tgz`)
      res.statusCode = 307
      res.setHeader('Location', target)
      res.end(target)
    } else {
      res.statusCode = 404
      res.setHeader('npm-notice', `${name} has score of ${pkg.score}`)
      res.end()
    }
  }

  async _rewritePackageRequest (req, res) {
    await this._rewriteJSONRequest(req, res, pkg => {
      for (const version of Object.values(pkg.versions)) {
        const tarball = new URL(version.dist.tarball)
        tarball.hostname = 'localhost'
        tarball.port = this._port
        tarball.protocol = 'http'
        version.dist.tarball = tarball.href
      }
      return pkg
    })
  }

  async _rewriteJSONRequest (req, res, rewrite) {
    await this._rewriteRequest(req, res, async str => {
      const json = JSON.parse(str)
      const rewritten = rewrite(json)
      return JSON.stringify(rewritten)
    })
  }

  async _rewriteRequest (req, res, rewrite) {
    debug('proxy %s ...', req.url)

    const proxyRes = await this._getProxyRes(req, res)
    const buf = await rawBody(proxyRes)
    debug('proxy %s %s', req.url, proxyRes.statusCode)

    if (proxyRes.statusCode === 301 || proxyRes.statusCode === 302) {
      const { location } = proxyRes.headers
      req.url = /^\//.test(location)
        ? new URL(req.url).origin + location
        : location
      req.url = fixNodeSourceIORedirect(req.url)
      return this._rewriteRequest(req, res, rewrite)
    }

    if (proxyRes.statusCode >= 400 || proxyRes.statusCode === 304) {
      return new Playback(proxyRes, res).all()
    }

    const rewritten = Buffer.from(await rewrite(buf.toString()))
    new Playback(proxyRes, res).status().headers()
    res.end(rewritten)
  }

  async _getCertification (name, version) {
    const query = `query getScore($name: String!, $version: String!) {
      package(name: $name) {
        versions(version: $version) {
          score
          results {
            severity
            pass
            name
            test
            value
          }
          vulnerabilities {
            id,
            title,
            semver {
              vulnerable
            },
            severity
          }
        }
      }
    }`
    const variables = { name, version }
    const data = await graphql({
      token: this._token,
      url: this._api
    }, query, variables)
    const certification = data.package.versions[0]
    for (const result of certification.results) {
      result.value = JSON.parse(result.value)
    }
    return certification
  }
}

// static-registry.nodesource.io tells us to go to an url without a trailing
// slash, but then will redirect us to one with a trailing slash. This improves
// performance by skipping that one redirect.
const fixNodeSourceIORedirect = url =>
  /^https:\/\/static-registry\.nodesource.io\/packages\/[^/]+$/.test(url)
    ? `${url}/`
    : url

// play back one response onto another
class Playback {
  constructor (resSrc, resDst) {
    this.resSrc = resSrc
    this.resDst = resDst
  }
  status () {
    this.resDst.statusCode = this.resSrc.statusCode
    return this
  }
  headers () {
    for (const [key, value] of Object.entries(this.resSrc.headers)) {
      // those wouldn't be true any more
      if (!['content-length', 'content-encoding'].includes(key)) {
        this.resDst.setHeader(key, value)
      }
    }
    return this
  }
  body () {
    this.resSrc.pipe(this.resDst)
    return this
  }
  all () {
    this.status().headers().body()
  }
}

module.exports = Proxy
