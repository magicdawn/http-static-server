'use strict'

/**
 * module deps
 */

const fs = require('promise.ify').all(require('fs'))
const dirname = require('path').dirname
const basename = require('path').basename
const extname = require('path').extname
const _ = require('lodash')
const swig = require('swig')
const express = require('express')
const modern = require('express-modern')

/**
 * do exports
 */

module.exports = function setup(root, index) {
  const app = express()
  root || process.cwd()

  const opts = {
    dotfiles: 'allow',
    setHeaders: (res, path, stat) => {
      if (/^\./.test(basename(path))) {
        res.type('text')
      }

      const ext = extname(path).slice(1)
      if (~['cson', 'less', 'py', 'rb'].indexOf(ext)) {
        res.type('text')
      }
    }
  }

  if(!index) opts.index = index
  app.use(express.static(root, opts))

  // list dir
  app.use(modern(function*(req, res, next) {
    if (!_.endsWith(req.path, '/')) return next()

    const rel = req.path.slice(0, -1)
    if (~rel.indexOf('../')) return res.status(400).send('../ not allowed')

    const dir = root + rel
    const contents = yield fs.readdirAsync(dir)
    const files = []
    const dirs = []

    for (let c of contents) {
      const file = dir + '/' + c
      const s = yield fs.statAsync(file)
      if (s.isDirectory()) dirs.push(c)
      else if (s.isFile()) files.push(c)
    }

    dirs.sort()
    files.sort()

    const html = swig.renderFile(__dirname + '/tmpl/index.html', {
      url: req.path,
      parentdir: dirname(req.path.slice(0, -1)) || '/',
      dirs: dirs,
      files: files
    })

    res.type('html').send(html)
  }))

  return app
}