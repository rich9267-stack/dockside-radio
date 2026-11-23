// ==UserScript==
// @name         Dockside Radio DJ
// @description  Runs inside YouTube Music in Safari. When a new song starts, pauses it, has your chosen AI host introduce it, then plays it.
// @version      0.3
// @match        https://music.youtube.com/*
// @run-at       document-end
// @noframes
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      euxcisnyansdrzzjyvsl.supabase.co
// @updateURL    https://rich9267-stack.github.io/dockside-radio/dj-harness.user.js
// @downloadURL  https://rich9267-stack.github.io/dockside-radio/dj-harness.user.js
// ==/UserScript==

(function () {
  "use strict";
  if (window.__docksideDJ) return;
  window.__docksideDJ = true;

  // ---- Hosts (personalities live in the Supabase "dj-intro" function) ----
  var HOSTS = [
    { id: "classic", name: "Big Mike", station: "Classic Rock", voices: ["Aaron", "Evan", "Nathan", "Tom", "Fred"], lang: /^en.US/i, rate: 0.95, pitch: 0.85 },
    { id: "alt",     name: "Jess",     station: "Alternative",  voices: ["Nicky", "Zoe", "Ava", "Allison", "Samantha"], lang: /^en.US/i, rate: 1.0,  pitch: 1.0 },
    { id: "country", name: "Dusty",    station: "Country",      voices: ["Fred", "Tom", "Evan", "Aaron"], lang: /^en.US/i, rate: 0.9,  pitch: 0.95 },
    { id: "rap",     name: "Static",   station: "Rap",          voices: ["Nathan", "Evan", "Aaron", "Tom"], lang: /^en.US/i, rate: 1.12, pitch: 1.0 },
    { id: "dance",   name: "Nova",     station: "Dance",        voices: ["Martha", "Kate", "Serena", "Stephanie"], lang: /^en.GB/i, rate: 1.08, pitch: 1.1 },
    { id: "jazz",    name: "Theo",     station: "Jazz",         voices: ["Arthur", "Daniel", "Oliver", "Malcolm"], lang: /^en.GB/i, rate: 0.88, pitch: 0.9 }
  ];
  var FN_URL = "https://euxcisnyansdrzzjyvsl.supabase.co/functions/v1/dj-intro";
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1eGNpc255YW5zZHJ6emp5dnNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NzMwNTAsImV4cCI6MjEwNzA0OTA1MH0.8WmYz2K_k78lImy_DvH7S041JtByzeOoESqrS64o2i0";

  var synth = window.speechSynthesis || null;
  var on = false, talking = false, lastKey = "", count = 0, backup = null, held = null, token = 0;
  var prev = null, heardOnce = false;

  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var host = HOSTS[0];
  HOSTS.forEach(function (h) { if (h.id === load("dockside-host")) host = h; });

  // ---- On-screen controls (bottom-left, above the player bar) ----
  var box = document.createElement("div");
  var bs = box.style;
  bs.position = "fixed"; bs.left = "12px"; bs.bottom = "140px"; bs.zIndex = "2147483647";
  bs.display = "flex"; bs.flexDirection = "column"; bs.alignItems = "flex-start"; bs.gap = "8px";
  bs.font = "700 14px -apple-system, system-ui, sans-serif"; bs.letterSpacing = "0.04em";

  function pill(text, filled) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = text;
    var s = b.style;
    s.padding = "10px 14px"; s.borderRadius = "22px"; s.border = "1px solid #f2a541";
    s.background = filled ? "#f2a541" : "#0d1517"; s.color = filled ? "#1b1206" : "#f2a541";
    s.font = "inherit"; s.letterSpacing = "inherit"; s.boxShadow = "0 2px 10px rgba(0,0,0,.5)"; s.opacity = "0.94";
    return b;
  }

  var menu = document.createElement("div");
  var ms = menu.style;
  ms.display = "none"; ms.flexDirection = "column"; ms.gap = "6px"; ms.padding = "10px";
  ms.background = "#0d1517"; ms.border = "1px solid #23383d"; ms.borderRadius = "14px";
  ms.boxShadow = "0 4px 18px rgba(0,0,0,.6)";
  function drawMenu() {
    menu.textContent = "";
    HOSTS.forEach(function (h) {
      var b = pill(h.name + " · " + h.station, h === host);
      b.style.boxShadow = "none"; b.style.textAlign = "left";
      b.addEventListener("click", function () {
        host = h; save("dockside-host", h.id); count = 0; prev = null;
        hostBtn.textContent = "HOST: " + h.name.toUpperCase();
        menu.style.display = "none"; drawMenu();
      });
      menu.appendChild(b);
    });
  }

  var hostBtn = pill("HOST: " + host.name.toUpperCase(), false);
  var djBtn = pill("DJ: OFF", false);
  hostBtn.addEventListener("click", function () {
    menu.style.display = menu.style.display === "none" ? "flex" : "none";
  });
  drawMenu();
  box.appendChild(menu); box.appendChild(hostBtn); box.appendChild(djBtn);
  function mount() { if (document.body && !box.isConnected) document.body.appendChild(box); }
  mount(); setInterval(mount, 3000);
  function label(t) { djBtn.textContent = t; }

  djBtn.addEventListener("click", function () {
    on = !on;
    if (on) {
      lastKey = currentKey(); // don't interrupt the song already playing
      label("DJ: ON");
      if (synth) {
        synth.cancel();
        var u = new SpeechSynthesisUtterance(host.name + " is on the air.");
        var v = hostVoice(host); if (v) u.voice = v;
        held = u; synth.speak(u); // speaking inside the tap unlocks the iPhone voice
      } else {
        label("DJ: NO VOICE");
      }
    } else {
      stop(true);
      label("DJ: OFF");
    }
  });

  // ---- What's playing ----
  function nowPlaying() {
    var m = navigator.mediaSession && navigator.mediaSession.metadata;
    if (m && m.title) return { song: String(m.title), artist: String(m.artist || "") };
    var t = document.querySelector(".title.ytmusic-player-bar");
    var b = document.querySelector(".byline.ytmusic-player-bar");
    if (t && t.textContent.trim()) {
      return { song: t.textContent.trim(), artist: b ? b.textContent.split("•")[0].trim() : "" };
    }
    return null;
  }
  function currentKey() { var n = nowPlaying(); return n ? n.song + "|" + n.artist : ""; }
  function video() { return document.querySelector("video"); }

  // Tidy "Artist - Song (Official Video)" style titles
  function cleanNames(n) {
    var t = String(n.song || "");
    t = t.replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|visuali[sz]er|\bhd\b|4k|remaster|explicit|\bmv\b)[^\)\]]*[\)\]]/gi, "");
    t = t.replace(/\s*\|.*$/, "").trim();
    var a = String(n.artist || "").replace(/ - Topic$/, "").replace(/vevo$/i, "").replace(/\s*official$/i, "").trim();
    var parts = t.split(/\s+[-–—]\s+/);
    var squash = function (x) { return x.toLowerCase().replace(/[^a-z0-9]/g, ""); };
    if (parts.length >= 2 && (!a || squash(parts[0]).indexOf(squash(a).slice(0, 4)) === 0)) {
      a = parts[0].trim(); t = parts.slice(1).join(" - ").trim();
    }
    t = t.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
    return { song: t || "this one", artist: a };
  }

  // ---- Voices ----
  function hostVoice(h) {
    if (!synth) return null;
    var all = synth.getVoices();
    var best = function (list) { return list.filter(function (v) { return /premium|enhanced/i.test(v.name); })[0] || list[0] || null; };
    for (var i = 0; i < h.voices.length; i++) {
      var name = h.voices[i];
      var v = best(all.filter(function (x) { return x.name.indexOf(name) === 0; }));
      if (v) return v;
    }
    return best(all.filter(function (x) { return h.lang.test(x.lang); })) || best(all.filter(function (x) { return /^en/i.test(x.lang); }));
  }
  if (synth) synth.getVoices();

  function backupLine(n) {
    var by = n.artist ? " by " + n.artist : "";
    if (count === 0) return "This is " + host.name + " on Dockside Radio " + host.station + ". Here's " + n.song + by + ".";
    var lines = ["Here's " + n.song + by + ".", "Coming up on " + host.station + ", " + n.song + by + ".", "Keeping it rolling with " + n.song + by + "."];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  function whenNow() {
    var d = new Date(), h = d.getHours();
    var part = h < 5 ? "late night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()] + " " + part;
  }

  // ---- Ask the AI for an intro (gives up after 8 seconds) ----
  function fetchIntro(n, first, before) {
    var payload = JSON.stringify({
      station: host.id, song: n.song, artist: n.artist, first: first, when: whenNow(),
      prevSong: before ? before.song : "", prevArtist: before ? before.artist : ""
    });
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + ANON, "apikey": ANON };
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (text) { if (!done) { done = true; clearTimeout(timer); resolve(text || null); } };
      var timer = setTimeout(function () { finish(null); }, 8000);
      var parse = function (txt) { try { var j = JSON.parse(txt); return j && j.text; } catch (e) { return null; } };
      var gm = (typeof GM !== "undefined" && GM.xmlHttpRequest) ? GM.xmlHttpRequest :
               (typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null);
      if (gm) {
        try {
          gm({
            method: "POST", url: FN_URL, headers: headers, data: payload, timeout: 8000,
            onload: function (r) { finish(r.status === 200 ? parse(r.responseText) : null); },
            onerror: function () { finish(null); }, ontimeout: function () { finish(null); }
          });
          return;
        } catch (e) { /* fall through to fetch */ }
      }
      fetch(FN_URL, { method: "POST", headers: headers, body: payload })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (t) { finish(t ? parse(t) : null); })
        .catch(function () { finish(null); });
    });
  }

  // ---- Talk, then play ----
  function stop(resume) {
    clearTimeout(backup);
    token++;
    if (synth) synth.cancel();
    var was = talking; talking = false;
    if (resume && was && video()) video().play().catch(function () {});
  }

  function checkVoice() {
    if (synth.speaking) { heardOnce = true; return; }
    try { synth.resume(); } catch (e) {}
    if (!heardOnce) label("DJ: NO VOICE");
  }

  function introduce(raw) {
    var v = video(); if (!synth || !v) return;
    var n = cleanNames(raw);
    var before = prev; prev = n;
    var my = ++token, first = count === 0;
    talking = true;
    v.pause();
    label("DJ: " + host.name.toUpperCase() + " CUEING…");
    fetchIntro(n, first, before).then(function (text) {
      if (my !== token || !talking) return; // skipped or paused meanwhile
      var ai = !!text;
      if (!text) text = backupLine(n);
      count++;
      label(ai ? "DJ: " + host.name.toUpperCase() + " TALKING" : "DJ: TALKING (BACKUP)");
      var u = new SpeechSynthesisUtterance(text);
      var voice = hostVoice(host); if (voice) u.voice = voice;
      u.rate = host.rate; u.pitch = host.pitch;
      var done = function () {
        if (my !== token || !talking) return;
        stop(true);
        if (djBtn.textContent !== "DJ: NO VOICE") label("DJ: ON");
      };
      u.onend = done; u.onerror = done;
      held = u; // keep a reference so iPhone doesn't lose the "finished" signal
      backup = setTimeout(done, Math.min(25000, 3000 + text.split(" ").length * 480));
      synth.cancel();
      synth.speak(u);
      setTimeout(function () { if (talking && my === token) checkVoice(); }, 1200);
    });
  }

  // ---- Watch for song changes ----
  setInterval(function () {
    if (!on || talking) return;
    var key = currentKey();
    if (!key || key === lastKey) return;
    var v = video();
    if (!v || v.paused) return; // wait until the new song actually starts
    lastKey = key;
    introduce(nowPlaying());
  }, 700);

  // If you tap YouTube Music's own controls while the DJ talks, get out of the way
  document.addEventListener("click", function (e) {
    if (talking && !box.contains(e.target)) { stop(false); label("DJ: ON"); }
  }, true);
})();
