'use strict';

/**
 * module deps
 */

const co = require('co');
const _ = require('lodash');
const http = require('http');
const fs = Promise.promisifyAll(require('fs'));
const pathFn = require('path');
const util = require('util');
const parse = require('url').parse;
const zlib = require('zlib');
const mime = require('mime');
const bars = require('nodebars');

// patch fs.existAsync
fs.existsAsync = function(path) {
  return new Promise(function(resolve) {
    fs.exists(path, resolve);
  });
};

/**
 * do export
 */
module.exports = Server;

/**
 * class Server
 */
function Server(options) {
  this.port = options.port || 0;
  this.root = pathFn.resolve(options.root || '.');
  this.options = options;

  // createServer
  this.server = http.createServer(this.requestListener.bind(this));
}

/**
 * http.Server on('request') listener
 *
 * for request event
 */
Server.prototype.requestListener = co.wrap(function*(req, res) {
  req.url = decodeURI(req.url);

  // /abc => /abc/
  if (!pathFn.extname(req.url) && req.url.slice(-1) !== '/') {
    res.writeHead(302, {
      Location: req.url + '/'
    });
    res.end();
    return;
  }

  const file = yield this.getFileAsync(req, res);
  if (!file) return; // already handled

  // if file not exists
  if (!(yield fs.existsAsync(file))) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // mime header
  const ext = pathFn.extname(file).slice(1);
  res.setHeader('content-type', mime.lookup(ext));
  res.setHeader('Server', 'http-static-server');

  //do cache
  res.setHeader('Cache-Control', 'max-age=' + 365 * 86400 * 1000); //一年ms
  const now = new Date;
  now.setTime(now.getTime() + 365 * 86400 * 1000);
  res.setHeader('Expires', now.toUTCString());

  try {
    const fd = yield fs.openAsync(file, 'r');
    const s = yield fs.fstatAsync(fd);

    const mtime = s.mtime.toUTCString();
    res.setHeader('Last-Modified', mtime); //最后修改时间

    if (req.headers['if-modified-since'] &&
      req.headers['if-modified-since'] === mtime) {
      //未修改
      res.writeHead(304);
      res.end();
      return;
    }

    res.statusCode = 200;
    this.sendFile(req, res, fd);
  } catch (e) {
    console.error(e);
    console.error(e.stack);
    res.writeHead(500);
    res.end('Server Internal Error');
  }
});

Server.prototype.getFileAsync = co.wrap(function*(req, res) {
  const url = decodeURI(parse(req.url).pathname); //本来已经decode过了,但是parse里面会把空格变成 %20

  // not legal
  if (url.indexOf('../') > -1) {
    console.error('请求已禁止 : %s', req.url);
    res.writeHead(400);
    res.end();
    return;
  }

  // check index files
  if (url.slice(-1) === '/') {
    if (yield fs.existsAsync(this.root + url + 'index.html')) {
      return this.root + url + 'index.html';
    }

    if (yield fs.existsAsync(this.root + url + 'index.htm')) {
      return this.root + url + 'index.htm';
    }

    // list dirs
    yield this.listDirAsync(req, res);
    return;
  }

  // normal file
  return this.root + url;
});

Server.prototype.sendFile = function(req, res, fd) {
  let stream = fs.createReadStream(null, {
    fd: fd
  });

  const acc = (req.headers['accept-encoding']);
  if (acc.indexOf('gzip') > -1) {
    res.setHeader('Content-Encoding', 'gzip');
    stream = stream.pipe(zlib.createGzip());
  } else if (acc.indexOf('deflate') > -1) {
    res.setHeader('Content-Encoding', 'deflate');
    stream = stream.pipe(zlib.createDeflate());
  }
  stream.pipe(res);
};

Server.prototype.listDirAsync = co.wrap(function*(req, res) {
  const self = this;
  const url = req.url;
  const dir = this.root + url;

  try {
    const contents = yield fs.readdirAsync(dir);

    const files = [];
    const dirs = [];

    for (let i = 0; i < contents.length; i++) {
      const c = contents[i];
      const file = self.root + url + c;
      const s = yield fs.statAsync(file);

      if (s.isDirectory()) dirs.push(c);
      else if (s.isFile()) files.push(c);
    }

    dirs.sort();
    files.sort();

    const html = bars.renderFileSync(__dirname + '/tmpl/index.html', {
      url: url,
      parentdir: pathFn.dirname(url),
      dirs: dirs,
      files: files
    });

    res.writeHead(200, {
      'Content-Type': 'text/html'
    });

    res.end(html);
  } catch (e) {
    console.error('列出目录出错 : %s', url);
    console.error(e.stack || e);
    res.writeHead(404);
    res.end(util.format('Can\'t get %s', url));
  }
});

Server.prototype.listen = function() {
  const self = this;

  return new Promise(function(resolve, reject) {
    self.server.listen(self.port, function(err) {
      if (err) {
        return reject(err);
      }

      const url = 'http://localhost:' + this.address().port;
      resolve(url);
    });
  });
};