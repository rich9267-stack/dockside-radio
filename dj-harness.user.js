// ==UserScript==
// @name         Dockside Radio DJ (harness test 1)
// @description  Runs inside YouTube Music in Safari. When a new song starts, pauses it, announces it with the iPhone voice, then plays it.
// @version      0.2
// @updateURL    https://rich9267-stack.github.io/dockside-radio/dj-harness.user.js
// @downloadURL  https://rich9267-stack.github.io/dockside-radio/dj-harness.user.js
// @match        https://music.youtube.com/*
// @run-at       document-end
// @noframes
// ==/UserScript==

(function () {
  "use strict";
  if (window.__docksideDJ) return;
  window.__docksideDJ = true;

  var synth = window.speechSynthesis || null;
  var on = false, talking = false, lastKey = "", count = 0, backup = null, held = null;

  // ---- Floating DJ button (tap once to turn on; iPhone only allows speech after a tap) ----
  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "DJ: OFF";
  var st = btn.style;
  st.position = "fixed"; st.left = "12px"; st.bottom = "140px"; st.zIndex = "2147483647";
  st.padding = "10px 14px"; st.borderRadius = "22px"; st.border = "1px solid #f2a541";
  st.background = "#0d1517"; st.color = "#f2a541"; st.font = "700 14px -apple-system, system-ui, sans-serif";
  st.letterSpacing = "0.06em"; st.boxShadow = "0 2px 10px rgba(0,0,0,.5)"; st.opacity = "0.92";
  function mount() { if (document.body && !btn.isConnected) document.body.appendChild(btn); }
  mount(); setInterval(mount, 3000);

  function label(t) { btn.textContent = t; }

  btn.addEventListener("click", function () {
    on = !on;
    if (on) {
      lastKey = currentKey(); // don't interrupt the song already playing
      label("DJ: ON");
      // Speak out loud right inside the tap. iPhone only "unlocks" the voice this way,
      // and it doubles as a test: if you hear this, the voice works on this page.
      if (synth) {
        synth.cancel();
        var u = new SpeechSynthesisUtterance("Dockside Radio DJ is on.");
        held = u;
        synth.speak(u);
        setTimeout(function () { if (on && !synth.speaking && !talking) checkVoice("test"); }, 1500);
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

  // ---- Talk, then play ----
  function stop(resume) {
    clearTimeout(backup);
    if (synth) synth.cancel();
    var was = talking; talking = false;
    if (resume && was && video()) video().play().catch(function () {});
  }

  // If the phone accepted the speech but never started talking, nudge it and show it on the button
  var heardOnce = false;
  function checkVoice(kind) {
    if (synth.speaking) { heardOnce = true; return; }
    try { synth.resume(); } catch (e) {}
    if (!heardOnce) label(kind === "test" ? "DJ: ON (NO VOICE?)" : "DJ: NO VOICE");
  }

  function introduce(n) {
    if (!synth) return;
    var v = video(); if (!v) return;
    talking = true;
    v.pause();
    var by = n.artist ? " by " + n.artist : "";
    var lines = count === 0
      ? ["You're listening to Dockside Radio. Here's " + n.song + by + "."]
      : ["Next up, " + n.song + by + ".", "Here's " + n.song + by + ".", "Coming up on Dockside Radio, " + n.song + by + "."];
    var text = lines[Math.floor(Math.random() * lines.length)];
    count++;
    label("DJ: TALKING");
    var u = new SpeechSynthesisUtterance(text);
    var done = function () {
      if (!talking) return;
      stop(true);
      if (btn.textContent !== "DJ: NO VOICE") label("DJ: ON"); // keep the warning visible
    };
    u.onend = done; u.onerror = done;
    held = u; // keep a reference so iPhone doesn't lose the "finished" signal
    backup = setTimeout(done, 3000 + text.split(" ").length * 450);
    synth.cancel(); // clear anything stuck in the phone's speech queue
    synth.speak(u);
    setTimeout(function () { if (talking) checkVoice("intro"); }, 1200);
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

  // If the user taps play/pause or skips while the DJ talks, get out of the way
  document.addEventListener("click", function (e) {
    if (talking && e.target !== btn && !btn.contains(e.target)) { stop(false); label("DJ: ON"); }
  }, true);
})();
