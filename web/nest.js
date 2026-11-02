/*
 * Nest cameras and the doorbell, through the person's own Google Device Access project (signed in on their computer
 * with tools/nest_auth.py, which hands the sign-in to the app as launch parameters). The TV's service keeps the token
 * fresh and watches for doorbell rings; this side lists the cameras and plays their live view (WebRTC).
 */
var Nest = (function () {
  'use strict';

  var KEY = 'fmtv.nest', API = 'https://smartdevicemanagement.googleapis.com/v1/';
  var config = null, cameras = [], thermostats = [], pc = null, session = null, device = null, extendTimer = 0, signedOut = false;
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
    TV.nest({config: config, mode: Prefs.doorbell()}, function (res) {
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
      var list = [], devices = (res && res.devices) || [], temps = [];
      for (var i = 0; i < devices.length; i++) {
        var d = devices[i], traits = d.traits || {}, live = traits['sdm.devices.traits.CameraLiveStream'];
        if (/THERMOSTAT/.test(d.type || '')) temps.push(thermostat(d));
        if (!live || (live.supportedProtocols || []).indexOf('WEB_RTC') < 0) continue;
        var info = traits['sdm.devices.traits.Info'] || {}, room = d.parentRelations && d.parentRelations[0];
        list.push({id: d.name, name: info.customName || (room && room.displayName) || 'Camera', doorbell: /DOORBELL/.test(d.type || '')});
      }
      list.sort(function (a, b) { return (b.doorbell ? 1 : 0) - (a.doorbell ? 1 : 0); });
      cameras = list;
      thermostats = temps;
      // The service names the doorbell in LG's pop-up.
      var names = {};
      for (var j = 0; j < list.length; j++) names[list[j].id] = list[j].name;
      if (TV.nest) TV.nest({names: names}, function () {});
      done(list);
    });
  }

  /** A thermostat as the screen shows it: {id, name, now, mode (HEAT, COOL, HEATCOOL, OFF), eco, heat, cool} in °C. */
  function thermostat(d) {
    var t = d.traits || {}, info = t['sdm.devices.traits.Info'] || {}, room = d.parentRelations && d.parentRelations[0];
    var sp = t['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
    return {id: d.name, name: info.customName || (room && room.displayName) || 'Thermostat',
      now: (t['sdm.devices.traits.Temperature'] || {}).ambientTemperatureCelsius,
      mode: (t['sdm.devices.traits.ThermostatMode'] || {}).mode || 'OFF',
      eco: (t['sdm.devices.traits.ThermostatEco'] || {}).mode === 'MANUAL_ECO',
      heat: sp.heatCelsius, cool: sp.coolCelsius};
  }

  /** Moves a thermostat's target (HEAT or COOL; in HEATCOOL both, keeping their gap) to the given °C: done(err). */
  function setTarget(th, celsius, done) {
    var c = Math.round(celsius * 2) / 2, cmd = 'sdm.devices.commands.ThermostatTemperatureSetpoint.', body;
    if (th.mode === 'HEAT') { body = {command: cmd + 'SetHeat', params: {heatCelsius: c}}; th.heat = c; }
    else if (th.mode === 'COOL') { body = {command: cmd + 'SetCool', params: {coolCelsius: c}}; th.cool = c; }
    else if (th.mode === 'HEATCOOL') {
      var gap = (th.cool || c + 2) - (th.heat || c);
      body = {command: cmd + 'SetRange', params: {heatCelsius: c, coolCelsius: c + gap}};
      th.heat = c;
      th.cool = c + gap;
    } else { done(new Error('off')); return; }
    api('POST', th.id + ':executeCommand', body, function (err) { done(err); });
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
    thermostats: function () { return thermostats; },
    setTarget: setTarget,
    nameOf: function (id) { for (var i = 0; i < cameras.length; i++) if (cameras[i].id === id) return cameras[i].name; return ''; },
    live: live,
    stop: stop
  };
})();
