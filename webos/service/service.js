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
var PERMISSIONS = ['READ_INSTALLED_APPS', 'READ_RUNNING_APPS', 'LAUNCH'];

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
