/**
 * module dependencies
 */
global.Promise = require('bluebird');
global.co = require('co');
global._ = require('lodash');
var http = require('http');
var fs = Promise.promisifyAll(require('fs'));
var pathFn = require('path');
var util = require('util');
var parse = require('url').parse;
var zlib = require('zlib');
var razor = require('razor-tmpl');
var mime = require('./mime');

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

  // listen
  this.server.listen(this.port, function() {
    process.title = "localhost@" + this.address().port;
    console.log("http-static-server served at http://localhost:" + this.address().port);
  });
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

  var file =
    yield this.getFileAsync(req, res);
  if (!file) return; // already handled

  // if file not exists
  if (!(
      yield fs.existsAsync(file))) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // mime header
  var ext = pathFn.extname(file).slice(1);
  res.setHeader("Content-Type", mime[ext] || mime["default"]);
  res.setHeader("Server", 'http-static-server');

  //do cache
  res.setHeader("Cache-Control", "max-age=" + 365 * 86400 * 1000); //一年ms
  var now = new Date;
  now.setTime(now.getTime() + 365 * 86400 * 1000);
  res.setHeader("Expires", now.toUTCString());

  try {
    var fd =
      yield fs.openAsync(file, "r");
    var s =
      yield fs.fstatAsync(fd);

    var mtime = s.mtime.toUTCString();
    res.setHeader("Last-Modified", mtime); //最后修改时间

    if (req.headers["if-modified-since"] && req.headers["if-modified-since"] === mtime) {
      //未修改
      res.writeHead(304);
      res.end();
      return;
    }

    res.statusCode = 200;
    this.sendFile(req, res, fd);
  }
  catch (e) {
    console.error(e);
    console.error(e.stack);
    res.writeHead(500);
    res.end('Server Internal Error');
  }
});

Server.prototype.getFileAsync = co.wrap(function*(req, res) {
  var url = decodeURI(parse(req.url).pathname); //本来已经decode过了,但是parse里面会把空格变成 %20

  // not legal
  if (url.indexOf('../') > -1) {
    console.error("请求已禁止 : %s", req.url);
    res.writeHead(400);
    res.end();
    return;
  }

  // check index files
  if (url.slice(-1) === '/') {
    if (
      yield fs.existsAsync(this.root + url + 'index.html')) {
      return this.root + url + 'index.html';
    }

    if (
      yield fs.existsAsync(this.root + url + 'index.htm')) {
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
  var stream = fs.createReadStream(null, {
    fd: fd
  });

  var acc = (req.headers['accept-encoding']);
  if (acc.indexOf('gzip') > -1) {
    res.setHeader("Content-Encoding", 'gzip');
    stream = stream.pipe(zlib.createGzip());
  }
  else if (acc.indexOf('deflate') > -1) {
    res.setHeader("Content-Encoding", 'deflate');
    stream = stream.pipe(zlib.createDeflate());
  }
  stream.pipe(res);
};

Server.prototype.listDirAsync = co.wrap(function*(req, res) {
  var self = this;
  var url = req.url;
  var dir = this.root + url;

  try {
    var contents =
      yield fs.readdirAsync(dir);

    var files = [];
    var dirs = [];

    for (var i = 0; i < contents.length; i++) {
      var c = contents[i];
      var file = self.root + url + c;
      var s =
        yield fs.statAsync(file);

      if (s.isDirectory())
        dirs.push(c)
      else if (s.isFile())
        files.push(c);
    };

    dirs.sort();
    files.sort();

    var html = razor.renderFileSync(__dirname + '/tmpl/index.html', {
      url: url,
      parentdir: pathFn.dirname(url),
      dirs: dirs,
      files: files
    });

    res.writeHead(200, {
      "Content-Type": 'text/html'
    });

    res.end(html);
  }
  catch (e) {
    console.error("列出目录出错 : %s", url);
    console.error(e);
    console.error(e.stack);
    res.writeHead(404);
    res.end(util.format("Can't get %s", url));
  }
});