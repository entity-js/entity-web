/**
 *  ____            __        __
 * /\  _`\         /\ \__  __/\ \__
 * \ \ \L\_\    ___\ \ ,_\/\_\ \ ,_\  __  __
 *  \ \  _\L  /' _ `\ \ \/\/\ \ \ \/ /\ \/\ \
 *   \ \ \L\ \/\ \/\ \ \ \_\ \ \ \ \_\ \ \_\ \
 *    \ \____/\ \_\ \_\ \__\\ \_\ \__\\/`____ \
 *     \/___/  \/_/\/_/\/__/ \/_/\/__/ `/___/> \
 *                                        /\___/
 *                                        \/__/
 *
 * Entity Web
 */

/**
 * The EntityWeb component.
 *
 * @author Orgun109uk <orgun109uk@gmail.com>
 */

var fs = require('fs'),
    async = require('async'),
    express = require('express');

/**
 * The EntityWeb class.
 *
 * @param {EntityCore} core The entity core object.
 * @param {Object} config The configuration for the servers.
 */
function EntityWeb(core, config) {
  'use strict';

  var _config = config,
      _express = express();

  Object.defineProperties(this, {
    core: {
      get: function () {
        return core;
      }
    },
    config: {
      get: function () {
        return _config;
      }
    },
    express: {
      get: function () {
        return _express;
      }
    }
  });
}

/**
 * Start the HTTP server.
 *
 * @param {Function} done The done callback.
 *   @param {Error} done.err Any raised errors.
 * @async
 * @private
 */
EntityWeb.prototype._startHttp = function (done) {
  'use strict';

  if (this._http) {
    return done();
  }

  var http = require('http');
  http
    .createServer(this.express)
    .listen(this.config.http.port || process.env.PORT);

  /**
   * Get the HTTP server.
   *
   * @var {Http} _http
   * @memberof EntityCore
   * @private
   * @instance
   */
  Object.defineProperty(this, '_http', {
    value: http
  });

  done();
};

/**
 * Start the HTTPS server.
 *
 * @param {Function} done The done callback.
 *   @param {Error} done.err Any raised errors.
 * @async
 * @private
 */
EntityWeb.prototype._startHttps = function (done) {
  'use strict';

  if (this._https) {
    return done();
  }

  var https = require('https');
  https
    .createServer({
      key: fs.readFileSync(this.config.https.sslKey || './certs/client.key'),
      cert: fs.readFileSync(this.config.https.sslCert || './certs/client.crt'),
      requestCert: true
    }, this.express)
    .listen(this.config.https.port || 443);

  /**
   * Get the HTTPS server.
   *
   * @var {Https} _https
   * @memberof EntityCore
   * @private
   * @instance
   */
  Object.defineProperty(this, '_https', {
    value: https
  });

  done();
};

/**
 * Setup the Request and Response objects for use with the WebSocket.
 *
 * @param {Object} req The Request object.
 * @param {Object} res The Response object.
 * @private
 */
EntityWeb.prototype._socketReqRes = function (req, res) {
  'use strict';

  req.method = 'socket';
  req.app = this.express;

  req.isAuthenticated = function () {
    /* jshint ignore:start */
    return (req.user && req.user.logged_in !== false);
    /* jshint ignore:end */
  };

  res.status = function (status) {
    res.status = status;
    return res;
  };

  res.send = function (data) {
    if (typeof data === 'object' && !data.status) {
      data.status = res.status;
    }

    res.emit('data', data);
    return res;
  };

  res.json = res.send;
};

/**
 * Start the web socket server.
 *
 * @param {Function} done The done callback.
 *   @param {Error} done.err Any raised errors.
 * @async
 * @private
 */
EntityWeb.prototype._startSocket = function (done) {
  'use strict';

  if (this._socket) {
    return done();
  }

  var me = this,
      queue = [],
      socket = require('socket.io'),
      socketRouter = require('socket.io-events')();

  socket.listen(
    this._https ? this._https : this._http
  );

  Object.defineProperties(this, {
    /**
     * The Socket.io socket.
     *
     * @var {Socket} _socket
     * @memberof EntityWeb
     * @private
     * @instance
     */
    _socket: {
      value: socket
    },
    /**
     * The Socket router.
     *
     * @var {Router} _socketRouter
     * @memberof EntityWeb
     * @private
     * @instance
     */
    _socketRouter: {
      value: socketRouter
    }
  });

  queue.push(function (next) {
    me.core.fire(next, 'web.socket.pre-init', {
      web: me,
      socket: socket
    });
  });

  queue.push(function (next) {
    socketRouter.on('*', function (sock, args, next) {
      var name = args.shift(),
          msg = args.shift(),
          req = sock.sock.client.request;

      me._socketReqRes(req, sock.sock);
      req.url = name;
      req.body = msg;

      this.express.handle(req, sock.sock);
      next();
    });

    socket.use(me._socketRouter);
    socket.sockets.on('connection', function (socket) {
      var req = socket.client.request;

      me._socketReqRes(req, req.res);
      req.url = 'connect';
      me.express.handle(req, req.res);

      socket.on('disconnect', function () {
        var req = socket.client.request;
        me._socketReqRes(req, req.res);

        req.url = 'disconnect';
        me.express.handle(req, req.res);
      });
    });
  });

  async.series(queue, done);
};

EntityWeb.prototype._setupRoutes = function (done) {
  'use strict';

  var me = this;

  this.express.use(bodyParser());
  this.express.use(methodOverride());

  this.express.use(function (req, res, next) {
    //console.log('Time:', Date.now());
    // @todo - setup context

    me.core.fire(function (err) {
      next(err);
    }, 'web.routing.init', {
      web: me,
      req: req, // ?
      res: res  // ?
      // @todo - context
    });
  });

  this.core.fire('web.routing', function (err) {
    if (err) {
      return done(err);
    }

    me.express.use(function(err, req, res, next) {
      // @todo - error catching/reporting/logging.

      console.error(err.stack);
      res.status(500).send('Something broke!');
    });

    // @todo - templating?

    done(null);
  }, {
    express: this.express
  });
};

/**
 * Initialize the HTTP, HTTPS and SocketIO servers.
 *
 * @param {Function} done The done callback.
 * @param {Error} done.err Any raised errors.
 */
EntityWeb.prototype.initialize = function (done) {
  'use strict';

  var me = this,
      queue = [],
      httpEnabled = this.config.http && this.config.http.enabled,
      httpsEnabled = this.config.https && this.config.https.enabled,
      sioEnabled = this.config.sockets && this.config.sockets.enabled;

  queue.push(function (next) {
    me.core.fire(next, 'web.pre-init', {
      web: me
    });
  });

  queue.push(function (next) {
    me._setupRoutes(next);
  });

  queue.push(function (next) {
    me.core.fire(next, 'web.routing', {
      web: me,
      express: me.express
    });
  });

  if (httpEnabled) {
    queue.push(function (next) {
      me._startHttp(next);
    });
  }

  if (httpsEnabled) {
    queue.push(function (next) {
      me._startHttps(next);
    });
  }

  if (sioEnabled) {
    queue.push(function (next) {
      me._startSocket(next);
    });
  }

  queue.push(function (next) {
    me.core.fire(next, 'web.post-init', {
      web: me
    });
  });

  async.series(queue, done);
};

/**
 * Exports the EntityWeb class.
 */
module.exports = EntityWeb;
