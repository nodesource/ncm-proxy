# ncm-proxy
Local Proxy for [NCM 2.0](https://docs.nodesource.com/ncm_v2/docs).

## About

This is a simple proxy server that is run locally on the computer doing the `npm` installations. When an install happens it will use the NCM API to look up score data and then either just log what was done or rewrite the proxied results to prevent installs of non-certified information.

## Usage

Start an ncm proxy server on port `14313` (`14`=N, `3`=C, `13`=M):

```bash
$ NCM_TOKEN=xxx npx @nodesource/ncm-proxy
```

To obtain an ncm token please see [the docs](https://docs.nodesource.com/ncm_v2/docs#ci-createatoken).

Then configure as your npm registry:

```bash
$ npm install express --registry=http://localhost:14313
```

## Custom port

Set the `PORT` environment variable to launch on a different port:

```bash
$ NCM_TOKEN=xxx PORT=8080 npx @nodesource/ncm-proxy
```

## Custom registry

You can also use a different registry than the default `https://registry.npmjs.org/`:

```bash
$ NCM_TOKEN=xxx npx @nodesource/ncm-proxy https://registry.npmjs.org
```

## Routes

All except listed routes are simply proxied through:

### `GET /:package`
### `GET /@scope%2f:package`

Rewrite tarball urls to point at the proxy.

### `GET /:package/-/:package-:version.tgz`
### `GET /@:scope?/:package/-/:package-:version.tgz`

Return `404` if the module has a score lower than 85 or is on the whitelist,
otherwise proxy through.

# License & copyright

Copyright © NodeSource.

Licensed under the MIT open source license, see the LICENSE file for details.
