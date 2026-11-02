/*
 * Free My TV's service on LG webOS: one call to the TV's remote control API (127.0.0.1:3000) for the web app.
 * Newer webOS gives each app's page its own origin (file://io.freemytv-webos), and the API closes any connection
 * that isn't from file:// ("invalid origin"); from here the handshake says file://.
 * Plain ES5 with Node's net only: older webOS ships an old Node.
 */
var net = require('net');
var Service = require('webos-service');

var service = new Service(require('./package.json').name);

/** What the TV's remote control API is asked for: the app list, what's in front, and opening Free My TV again. */
var PERMISSIONS = ['READ_INSTALLED_APPS', 'READ_RUNNING_APPS', 'LAUNCH', 'WRITE_NOTIFICATION_TOAST'];

function buffer(x) {   // Buffer.from is missing before Node 4.5
  return Buffer.from ? Buffer.from(x) : new Buffer(x);
}

/** A client's text frame: masked, as the protocol asks. */
function frame(text) {
  var data = buffer(text), n = data.length;
  var mask = buffer([Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0]);
  for (var i = 0; i < n; i++) data[i] ^= mask[i % 4];
  return Buffer.concat([buffer(n < 126 ? [0x81, 0x80 | n] : [0x81, 0xfe, n >> 8, n & 0xff]), mask, data]);
}

/** done({clientKey, payload}), {refused: true} when the person said no on the TV, or null. */
function call(uri, clientKey, done) {
  var socket = net.connect(3000, '127.0.0.1'), buf = buffer([]), open = false, text = '', finished = false;
  var timer = setTimeout(function () { finish(null); }, 90000);   // time to answer the TV's prompt
  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    socket.destroy();
    done(result);
  }
  function send(obj) {
    socket.write(frame(JSON.stringify(obj)));
  }
  function onMessage(m) {
    if (m.type === 'registered') {
      clientKey = m.payload['client-key'];
      send({type: 'request', id: 'call', uri: 'ssap://' + uri});
    } else if (m.id === 'call') {
      finish(m.type === 'error' ? null : {clientKey: clientKey, payload: m.payload});
    } else if (m.type === 'error') {
      finish(m.id === 'register' ? {refused: true} : null);
    }
  }
  socket.on('connect', function () {
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nOrigin: file://\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ZnJlZW15dHYtd2Vib3MtYXBp\r\n\r\n');
  });
  socket.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      var end = buf.toString('binary').indexOf('\r\n\r\n');
      if (end < 0) return;
      if (!/^HTTP\/1\.1 101/.test(buf.toString('utf8', 0, 12))) { finish(null); return; }
      open = true;
      buf = buf.slice(end + 4);
      var payload = {forcePairing: false, pairingType: 'PROMPT',
        manifest: {manifestVersion: 1, appVersion: '1.0', permissions: PERMISSIONS}};
      if (clientKey) payload['client-key'] = clientKey;
      send({type: 'register', id: 'register', payload: payload});
    }
    // The server's frames: unmasked, a message possibly in several (continuation frames until FIN).
    while (buf.length >= 2) {
      var fin = buf[0] & 0x80, op = buf[0] & 0x0f, n = buf[1] & 0x7f, off = 2;
      if (n === 126) {
        if (buf.length < 4) return;
        n = buf.readUInt16BE(2);
        off = 4;
      } else if (n === 127) {
        if (buf.length < 10) return;
        n = buf.readUInt32BE(6);
        off = 10;
      }
      if (buf.length < off + n) return;
      var data = buf.slice(off, off + n);
      buf = buf.slice(off + n);
      if (op === 8) { finish(null); return; }
      if (op !== 1 && op !== 0) continue;
      text += data.toString('utf8');
      if (!fin) continue;
      var m = null;
      try { m = JSON.parse(text); } catch (e) {}
      text = '';
      if (m) onMessage(m);
    }
  });
  socket.on('error', function () { finish(null); });
  socket.on('close', function () { finish(null); });
}

service.register('ssap', function (message) {
  var p = message.payload || {};
  // Only the app list, the one call the page makes: nothing else goes to the TV's API, nor gets its client key.
  if (p.uri !== 'com.webos.applicationManager/listLaunchPoints') {
    message.respond({returnValue: false, errorText: 'Only listLaunchPoints'});
    return;
  }
  call(p.uri, p.clientKey, function (result) {
    if (!result) message.respond({returnValue: false, errorText: 'No answer from the remote control API'});
    else {
      result.returnValue = true;
      message.respond(result);
    }
  });
});

/*
 * Back to Free My TV: LG's home screen comes up when an app is left (Back at its start, or Home inside it). While the
 * watch runs, that opens Free My TV instead. LG's home stays reachable from Free My TV itself: Home pressed there
 * (Free My TV was in front) is left alone. It also notes when each app came to the front, for the shelf's order.
 */
var LG_HOME = /^com\.webos\.app\.(home|launcher)$/;
var watcher = {socket: null, key: null, app: '', last: '', usage: {}, on: true, retry: null, refused: false};
var keepAlive = null;

function hold() {
  if (keepAlive) return;
  try { service.activityManager.create('keepAlive', function (activity) { keepAlive = activity; }); } catch (e) {}
}

function watch() {
  if (watcher.socket || watcher.refused) return;
  var registered = false;
  var socket = net.connect(3000, '127.0.0.1'), buf = buffer([]), open = false, text = '';
  watcher.socket = socket;
  function send(obj) { socket.write(frame(JSON.stringify(obj))); }
  function again() {
    watcher.socket = null;
    clearTimeout(watcher.retry);
    // Closed before the TV allowed it (its prompt went unanswered): not asking again for 10 minutes.
    if (!watcher.refused) watcher.retry = setTimeout(watch, registered ? 5000 : 600000);
  }
  function onMessage(m) {
    if (m.type === 'error' && m.id === 'register') {
      watcher.refused = true;   // the person said no on the TV: never asked again by the watch
      socket.destroy();
    } else if (m.type === 'registered') {
      registered = true;
      watcher.key = m.payload['client-key'];
      send({type: 'subscribe', id: 'front', uri: 'ssap://com.webos.applicationManager/getForegroundAppInfo'});
    } else if (m.id === 'toast' && m.type === 'error' && nest.ringing) {
      openDoorbell(nest.ringing);
      nest.ringing = '';
    } else if (m.id === 'toast') {
      nest.ringing = '';
    } else if (m.id === 'front' && m.payload) {
      var id = m.payload.appId || '';
      if (!id) return;
      if (LG_HOME.test(id)) {
        // Left an app (not Free My TV): back to Free My TV.
        if (watcher.on && watcher.last && watcher.last !== watcher.app && !LG_HOME.test(watcher.last)) {
          send({type: 'request', id: 'open', uri: 'ssap://system.launcher/launch', payload: {id: watcher.app}});
        }
      } else if (id !== watcher.app) {
        watcher.usage[id] = Date.now();
      }
      watcher.last = id;
    }
  }
  socket.on('connect', function () {
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nOrigin: file://\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ZnJlZW15dHYtd2F0Y2g=\r\n\r\n');
  });
  socket.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      var end = buf.toString('binary').indexOf('\r\n\r\n');
      if (end < 0) return;
      if (!/^HTTP\/1\.1 101/.test(buf.toString('utf8', 0, 12))) { socket.destroy(); return; }
      open = true;
      buf = buf.slice(end + 4);
      var payload = {forcePairing: false, pairingType: 'PROMPT',
        manifest: {manifestVersion: 1, appVersion: '1.0', permissions: PERMISSIONS}};
      if (watcher.key) payload['client-key'] = watcher.key;
      send({type: 'register', id: 'register', payload: payload});
    }
    while (buf.length >= 2) {
      var fin = buf[0] & 0x80, op = buf[0] & 0x0f, n = buf[1] & 0x7f, off = 2;
      if (n === 126) {
        if (buf.length < 4) return;
        n = buf.readUInt16BE(2);
        off = 4;
      } else if (n === 127) {
        if (buf.length < 10) return;
        n = buf.readUInt32BE(6);
        off = 10;
      }
      if (buf.length < off + n) return;
      var data = buf.slice(off, off + n);
      buf = buf.slice(off + n);
      if (op === 8) { socket.destroy(); return; }
      if (op === 9) { socket.write(Buffer.concat([buffer([0x8a, 0x80]), buffer([0, 0, 0, 0])])); continue; }   // ping → pong
      if (op !== 1 && op !== 0) continue;
      text += data.toString('utf8');
      if (!fin) continue;
      var m = null;
      try { m = JSON.parse(text); } catch (e) {}
      text = '';
      if (m) onMessage(m);
    }
  });
  socket.on('error', function () {});
  socket.on('close', again);
}

/** Starts (or updates) the watch; answers with the client key the TV gave and when each app was last in front. */
service.register('watch', function (message) {
  var p = message.payload || {};
  if (p.appId) watcher.app = String(p.appId);
  if (p.clientKey && !watcher.key) watcher.key = String(p.clientKey);
  if (p.enabled !== undefined) watcher.on = p.enabled !== false;
  hold();
  watch();
  message.respond({returnValue: true, clientKey: watcher.key, usage: watcher.usage, on: watcher.on});
});

/*
 * Nest (Google's Smart Device Management): the person's own Device Access project, signed in on their computer with
 * tools/nest_auth.py, which hands the refresh token to the app; the app passes it here. While the TV is on, this
 * pulls the project's Pub/Sub subscription for doorbell rings and brings Free My TV forward with the doorbell's live
 * view. Tokens stay in memory here and in the app's own storage; nothing is logged.
 */
var https = require('https');
var nest = {config: null, token: '', expires: 0, pulling: false, refused: false, retry: null, mode: 'popup', ringing: ''};

function post(host, path, body, headers, done) {
  var data = typeof body === 'string' ? body : JSON.stringify(body);
  headers = headers || {};
  headers['Content-Length'] = Buffer.byteLength(data);
  var req = https.request({host: host, path: path, method: 'POST', headers: headers}, function (res) {
    var text = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { text += c; });
    res.on('end', function () {
      var json = null;
      try { json = JSON.parse(text); } catch (e) {}
      done(res.statusCode >= 200 && res.statusCode < 300 ? null : new Error('HTTP ' + res.statusCode), json);
    });
  });
  req.setTimeout(70000, function () { req.abort(); });
  req.on('error', function (e) { done(e, null); });
  req.write(data);
  req.end();
}

/** A fresh access token (refreshed a minute before it runs out): done(err, token). */
function nestToken(done) {
  var c = nest.config;
  if (!c) { done(new Error('not set up')); return; }
  if (nest.token && Date.now() < nest.expires - 60000) { done(null, nest.token); return; }
  var form = 'grant_type=refresh_token&client_id=' + encodeURIComponent(c.clientId) + '&client_secret=' +
      encodeURIComponent(c.clientSecret) + '&refresh_token=' + encodeURIComponent(c.refreshToken);
  post('oauth2.googleapis.com', '/token', form, {'Content-Type': 'application/x-www-form-urlencoded'}, function (err, res) {
    if (err || !res || !res.access_token) {
      if (res && res.error === 'invalid_grant') nest.refused = true;   // signed out (7 days in Testing): sign in again
      done(err || new Error('no token'));
      return;
    }
    nest.refused = false;
    nest.token = res.access_token;
    nest.expires = Date.now() + (res.expires_in || 3600) * 1000;
    done(null, nest.token);
  });
}

/**
 * A ring: a notification over what's playing ("popup", the default; selecting it opens the live view), or the live
 * view at once ("full"). Where the TV refuses the notification, the live view opens.
 */
function ring(device) {
  if (nest.mode === 'full' || !watcher.socket || watcher.last === watcher.app) { openDoorbell(device); return; }
  nest.ringing = device;
  watcher.socket.write(frame(JSON.stringify({type: 'request', id: 'toast', uri: 'ssap://system.notifications/createToast',
    payload: {message: 'Doorbell: someone is at the door. Select to see the camera.', onClick: {appId: watcher.app,
      params: {doorbell: device, at: Date.now(), prev: watcher.last && !LG_HOME.test(watcher.last) ? watcher.last : ''}}}})));
}

/** Free My TV to the front, on the doorbell's live view; Back there returns to what was playing. */
function openDoorbell(device) {
  var params = {doorbell: device, at: Date.now(), prev: watcher.last && !LG_HOME.test(watcher.last) && watcher.last !== watcher.app ? watcher.last : ''};
  if (watcher.socket) {
    watcher.socket.write(frame(JSON.stringify({type: 'request', id: 'ring', uri: 'ssap://system.launcher/launch',
      payload: {id: watcher.app || 'io.freemytv', params: params}})));
  } else {
    service.call('luna://com.webos.applicationManager/launch', {id: watcher.app || 'io.freemytv', params: params}, function () {});
  }
}

function pullNest() {
  if (!nest.config || nest.pulling || nest.refused) return;
  nest.pulling = true;
  function again(ms) {
    nest.pulling = false;
    clearTimeout(nest.retry);
    nest.retry = setTimeout(pullNest, ms);
  }
  nestToken(function (err, token) {
    if (err) { again(nest.refused ? 3600000 : 30000); return; }
    var c = nest.config, path = '/v1/' + c.subscription + ':pull';
    post('pubsub.googleapis.com', path, {maxMessages: 10}, {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
      function (err2, res) {
        if (err2) { again(15000); return; }
        var msgs = (res && res.receivedMessages) || [], ack = [];
        for (var i = 0; i < msgs.length; i++) {
          ack.push(msgs[i].ackId);
          var ev = null;
          try { ev = JSON.parse((Buffer.from ? Buffer.from(msgs[i].message.data, 'base64') : new Buffer(msgs[i].message.data, 'base64')).toString('utf8')); } catch (e) {}
          var up = ev && ev.resourceUpdate, events = up && up.events;
          // Only a ring from the last minute: events kept while the TV was off aren't shown hours later.
          if (events && events['sdm.devices.events.DoorbellChime.Chime'] && Date.now() - Date.parse(ev.timestamp) < 60000) {
            ring(up.name);
          }
        }
        if (ack.length) {
          post('pubsub.googleapis.com', '/v1/' + c.subscription + ':acknowledge', {ackIds: ack},
            {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, function () {});
        }
        again(msgs.length ? 0 : 1000);
      });
  });
}

/** The app hands its saved Nest settings over at every start; answers with a fresh access token for the live views. */
service.register('nest', function (message) {
  var p = message.payload || {};
  if (p.mode) nest.mode = p.mode === 'full' ? 'full' : 'popup';
  if (p.config && p.config.refreshToken && p.config.subscription) {
    var changed = !nest.config || nest.config.refreshToken !== p.config.refreshToken;
    nest.config = p.config;
    if (changed) { nest.token = ''; nest.refused = false; }
    hold();
    pullNest();
  }
  if (!p.token) { message.respond({returnValue: true, ready: !!nest.config, signedOut: nest.refused}); return; }
  nestToken(function (err, token) {
    message.respond({returnValue: !err, token: token || '', signedOut: nest.refused, errorText: err ? err.message : ''});
  });
});
