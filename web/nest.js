/*
 * Nest cameras and the doorbell, through the person's own Google Device Access project (signed in on their computer
 * with tools/nest_auth.py, which hands the sign-in to the app as launch parameters). The TV's service keeps the token
 * fresh and watches for doorbell rings; this side lists the cameras and plays their live view (WebRTC).
 */
var Nest = (function () {
  'use strict';

  var KEY = 'fmtv.nest', API = 'https://smartdevicemanagement.googleapis.com/v1/';
  var config = null, cameras = [], pc = null, session = null, device = null, extendTimer = 0, signedOut = false;
  try { config = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}

  function setup(c) {
    if (!c || !c.refreshToken || !c.project || !c.subscription) return;
    config = c;
    signedOut = false;
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
  }

  /** Hands the saved sign-in to the service, which then watches for rings while the TV is on. */
  function start(done) {
    if (!config || !TV.nest) { if (done) done(false); return; }
    TV.nest({config: config}, function (res) {
      signedOut = !!(res && res.signedOut);
      if (done) done(!!res);
    });
  }

  function token(done) {
    TV.nest({token: true}, function (res) {
      if (res && res.signedOut) signedOut = true;
      done(res && res.token ? res.token : '');
    });
  }

  function api(method, path, body, done) {
    token(function (t) {
      if (!t) { done(new Error(signedOut ? 'signed out' : 'no connection')); return; }
      var x = new XMLHttpRequest(), over = false;
      function end(err, json) { if (!over) { over = true; done(err, json); } }
      x.open(method, API + path, true);
      x.setRequestHeader('Authorization', 'Bearer ' + t);
      if (body) x.setRequestHeader('Content-Type', 'application/json');
      x.timeout = 15000;
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        var json = null;
        try { json = JSON.parse(x.responseText); } catch (e) {}
        end(x.status >= 200 && x.status < 300 ? null : new Error((json && json.error && json.error.message) || 'HTTP ' + x.status), json);
      };
      x.ontimeout = x.onerror = function () { end(new Error('no connection')); };
      x.send(body ? JSON.stringify(body) : null);
    });
  }

  /** The cameras with a live view (doorbells first): [{id, name, doorbell}]. */
  function refresh(done) {
    if (!config) { done([]); return; }
    api('GET', 'enterprises/' + config.project + '/devices', null, function (err, res) {
      if (err) { done(cameras); return; }
      var list = [], devices = (res && res.devices) || [];
      for (var i = 0; i < devices.length; i++) {
        var d = devices[i], traits = d.traits || {}, live = traits['sdm.devices.traits.CameraLiveStream'];
        if (!live || (live.supportedProtocols || []).indexOf('WEB_RTC') < 0) continue;
        var info = traits['sdm.devices.traits.Info'] || {}, room = d.parentRelations && d.parentRelations[0];
        list.push({id: d.name, name: info.customName || (room && room.displayName) || 'Camera', doorbell: /DOORBELL/.test(d.type || '')});
      }
      list.sort(function (a, b) { return (b.doorbell ? 1 : 0) - (a.doorbell ? 1 : 0); });
      cameras = list;
      done(list);
    });
  }

  function command(id, name, params, done) {
    api('POST', id + ':executeCommand', {command: 'sdm.devices.commands.CameraLiveStream.' + name, params: params}, done || function () {});
  }

  /** Plays a camera's live view in the video element: done(err). */
  function live(id, video, done) {
    stop();
    if (!window.RTCPeerConnection) { done(new Error('no WebRTC')); return; }
    var p = new window.RTCPeerConnection({});
    pc = p;
    device = id;
    // Google asks for audio, then video, then a data channel, in that order.
    p.addTransceiver('audio', {direction: 'recvonly'});
    p.addTransceiver('video', {direction: 'recvonly'});
    p.createDataChannel('dataSendChannel');
    p.ontrack = function (e) {
      if (e.streams && e.streams[0] && video.srcObject !== e.streams[0]) {
        video.srcObject = e.streams[0];
        try { video.play(); } catch (x) {}
      }
    };
    p.createOffer().then(function (offer) {
      return p.setLocalDescription(offer).then(function () { return offer; });
    }).then(function (offer) {
      command(id, 'GenerateWebRtcStream', {offerSdp: offer.sdp}, function (err, res) {
        if (pc !== p) return;
        var r = res && res.results;
        if (err || !r || !r.answerSdp) { done(err || new Error('no answer')); return; }
        session = r.mediaSessionId;
        p.setRemoteDescription({type: 'answer', sdp: r.answerSdp}).then(function () { done(null); }, function (e) { done(e); });
        // A stream lasts 5 minutes unless extended.
        extendTimer = setInterval(function () { if (session) command(id, 'ExtendWebRtcStream', {mediaSessionId: session}); }, 4 * 60000);
      });
    }, function (e) { done(e); });
  }

  function stop() {
    clearInterval(extendTimer);
    if (session && device) command(device, 'StopWebRtcStream', {mediaSessionId: session});
    if (pc) { try { pc.close(); } catch (e) {} }
    pc = null;
    session = null;
    device = null;
  }

  return {
    configured: function () { return !!config; },
    signedOut: function () { return signedOut; },
    setup: setup,
    start: start,
    refresh: refresh,
    cameras: function () { return cameras; },
    nameOf: function (id) { for (var i = 0; i < cameras.length; i++) if (cameras[i].id === id) return cameras[i].name; return ''; },
    live: live,
    stop: stop
  };
})();
