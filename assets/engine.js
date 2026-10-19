/* Tucson Gym Match engine. Talks only to /api/chat. Renders all text with textContent. */
(function () {
  'use strict';

  // ---- Settings ----------------------------------------------------------
  var SILENCE_MS = 10000;           // mic turns off after this much silence
  var WAIT_NOTE_MS = 8000;          // first "still working" note
  var CLOSING_NOTE_MS = 30000;      // second note
  var STORE_KEY = 'tucson-gym-match:v1';
  var MAX_HISTORY = 24;             // messages sent to the server (server caps too)
  var BOT_NAME = 'Gym Planner';
  var PROJECT = 'Tucson Gym Match';
  var HIDDEN_DETAIL_KEYS = ['guide', 'id', 'url_slug', 'internal'];

  // ---- Elements ----------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var board = $('board');
  var chatCard = $('chat-card');
  var log = $('log');
  var emptyState = $('empty-state');
  var form = $('composer');
  var input = $('input');
  var sendBtn = $('send-btn');
  var micBtn = $('mic-btn');
  var micStatus = $('mic-status');
  var micError = $('mic-error');
  var resetBtn = $('reset-btn');
  var fullBtn = $('full-btn');
  var downloadBtn = $('download-btn');
  var countChip = $('msg-count');

  // ---- State (sessionStorage, wrapped) ----------------------------------
  var state = { messages: [], matches: [], selectedId: null, nextStep: '' };
  var busy = false;

  function loadState() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s && Array.isArray(s.messages)) {
        state.messages = s.messages.filter(function (m) {
          return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
        });
        state.matches = Array.isArray(s.matches) ? s.matches : [];
        state.selectedId = typeof s.selectedId === 'string' ? s.selectedId : null;
        state.nextStep = typeof s.nextStep === 'string' ? s.nextStep : '';
      }
    } catch (e) { /* storage unavailable or corrupt */ }
  }
  function saveState() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---- Reply parsing ----------------------------------------------------
  var MATCH_LINE = /^\s*[*_`>-]*\s*MATCH\s*:/i;

  function parseReply(raw) {
    var lines = String(raw || '').split(/\r?\n/);
    var visible = [];
    var matches = [];
    var nextStep = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (MATCH_LINE.test(line)) {
        var jsonPart = line.slice(line.indexOf(':') + 1).trim().replace(/[`*_]+$/, '');
        try {
          var m = JSON.parse(jsonPart);
          var clean = cleanMatch(m);
          if (clean) matches.push(clean);
        } catch (e) { /* malformed MATCH line: dropped from view either way */ }
        continue;
      }
      var ns = line.match(/^\s*\**\s*Next step\s*:\s*\**\s*(.+)$/i);
      if (ns) nextStep = ns[1].replace(/\*+/g, '').trim();
      visible.push(line);
    }
    var text = visible.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text: text, matches: matches, nextStep: nextStep };
  }

  function cleanMatch(m) {
    if (!m || typeof m !== 'object') return null;
    var title = typeof m.title === 'string' ? m.title.trim() : '';
    if (!title) return null;
    var id = typeof m.id === 'string' && m.id.trim() ? m.id.trim() : title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    var score = null;
    if (typeof m.score === 'number' && isFinite(m.score)) score = Math.max(0, Math.min(100, Math.round(m.score)));
    var details = {};
    if (m.details && typeof m.details === 'object') {
      Object.keys(m.details).forEach(function (k) {
        var v = m.details[k];
        if (v === null || v === undefined) return;
        details[String(k).slice(0, 60)] = String(v).slice(0, 400);
      });
    }
    return {
      id: id.slice(0, 80),
      title: title.slice(0, 120),
      score: score,
      why: typeof m.why === 'string' ? m.why.slice(0, 300) : '',
      kind: typeof m.kind === 'string' ? m.kind.slice(0, 40) : '',
      details: details
    };
  }

  function sortMatches(list) {
    return list.slice().sort(function (a, b) {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
  }

  // ---- Safe rich text (no innerHTML) -------------------------------------
  var URL_RE = /(https:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;

  // Plain text for the download file: drop markdown emphasis and heading marks.
  function plainText(text) {
    return String(text)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/^\s*#+\s*/gm, '');
  }

  function appendLinks(parent, text) {
    var last = 0;
    text.replace(URL_RE, function (match, _g, offset) {
      if (offset > last) parent.appendChild(document.createTextNode(text.slice(last, offset)));
      var a = document.createElement('a');
      a.href = match;
      a.textContent = match;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parent.appendChild(a);
      last = offset + match.length;
      return match;
    });
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // **bold** becomes <strong>; everything else stays text. No innerHTML anywhere.
  function appendInline(parent, text) {
    var parts = String(text).replace(/__(.+?)__/g, '**$1**').split(/\*\*(.+?)\*\*/);
    parts.forEach(function (part, i) {
      if (!part) return;
      if (i % 2 === 1) {
        var strong = document.createElement('strong');
        appendLinks(strong, part);
        parent.appendChild(strong);
      } else {
        appendLinks(parent, part.replace(/\*\*/g, ''));
      }
    });
  }

  function renderRich(container, text) {
    var bullet = /^\s*[-*•]\s+/;
    var numbered = /^\s*\d+[.)]\s+/;
    var heading = /^\s*#+\s*/;
    var list = null;
    var listType = '';
    String(text).split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line.trim()) { list = null; return; }
      var type = bullet.test(line) ? 'ul' : numbered.test(line) ? 'ol' : '';
      if (type) {
        if (!list || listType !== type) {
          list = document.createElement(type);
          listType = type;
          container.appendChild(list);
        }
        var li = document.createElement('li');
        appendInline(li, line.replace(type === 'ul' ? bullet : numbered, ''));
        list.appendChild(li);
        return;
      }
      list = null;
      var p = document.createElement('p');
      var isHeading = heading.test(line);
      var body = line.replace(heading, '');
      if (isHeading || /^\*\*[^*]+\*\*:?$/.test(body.trim())) {
        p.className = 'lead';
        body = body.replace(/\*\*/g, '');
      }
      appendInline(p, body);
      container.appendChild(p);
    });
  }

  // ---- Message rendering -------------------------------------------------
  function bubble(role, text) {
    var div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
    var label = document.createElement('span');
    label.className = 'label';
    label.textContent = role === 'user' ? 'You' : BOT_NAME;
    div.appendChild(label);
    if (role === 'user') {
      var p = document.createElement('p');
      p.textContent = text;
      div.appendChild(p);
    } else {
      renderRich(div, text);
    }
    return div;
  }

  function renderLog() {
    while (log.firstChild) log.removeChild(log.firstChild);
    if (!state.messages.length) {
      log.appendChild(emptyState);
    } else {
      state.messages.forEach(function (m) {
        var text = m.role === 'assistant' ? parseReply(m.content).text : m.content;
        log.appendChild(bubble(m.role, text));
      });
    }
    log.scrollTop = state.messages.length ? log.scrollHeight : 0;
    updateCount();
    updateDownload();
  }

  function updateCount() {
    var n = state.messages.length;
    countChip.textContent = n === 0 ? 'No messages yet' : n === 1 ? '1 message' : n + ' messages';
  }

  function hasReply() {
    return state.messages.some(function (m) { return m.role === 'assistant'; });
  }
  function updateDownload() {
    downloadBtn.disabled = !hasReply();
  }

  // ---- Side cards --------------------------------------------------------
  var CIRC = 2 * Math.PI * 18;

  function renderCards() {
    var list = sortMatches(state.matches);
    var top = list[0] || null;
    var selected = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === state.selectedId) selected = list[i];
    if (!selected) selected = top;

    // Top match
    $('top-kind').textContent = top ? (top.kind || 'Gym or plan') : 'Gym or plan';
    $('top-title').textContent = top ? top.title : 'Waiting for your first question';
    $('top-score').textContent = top && top.score !== null ? String(top.score) : '—';
    $('top-why').textContent = top
      ? (top.why || '') + (top.score === null ? ' Share your priorities (budget, perks, schedule) to get a fit score.' : '')
      : 'Ask about a gym, or tell the planner your budget and the perks you care about.';

    // Gauge
    var topScore = top && top.score !== null ? top.score : null;
    $('gauge-fill').setAttribute('stroke-dasharray', (topScore === null ? 0 : (CIRC * topScore) / 100).toFixed(1) + ' ' + CIRC.toFixed(1));
    $('gauge-fill').style.visibility = topScore ? 'visible' : 'hidden';
    $('gauge-num').textContent = topScore === null ? '—' : String(topScore);
    $('gauge').setAttribute('aria-label', topScore === null ? 'Top fit score: not yet scored' : 'Top fit score: ' + topScore + ' out of 100');

    var scored = list.filter(function (m) { return m.score !== null; }).length;
    $('rank-note').textContent = !list.length
      ? 'Ranked by fit once you share your priorities.'
      : scored
        ? 'Ranked by fit score. Unscored options are listed last.'
        : 'Not scored yet. Share your budget and must-have perks to rank these.';

    // Shortlist
    var ol = $('short-list');
    while (ol.firstChild) ol.removeChild(ol.firstChild);
    if (!list.length) {
      var empty = document.createElement('li');
      empty.className = 'short-empty';
      empty.textContent = 'Matches will appear here.';
      ol.appendChild(empty);
    }
    list.forEach(function (m) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'short-item';
      b.setAttribute('aria-pressed', selected && selected.id === m.id ? 'true' : 'false');
      var t = document.createElement('span');
      t.className = 's-title';
      t.textContent = m.title;
      var s = document.createElement('span');
      s.className = 's-score';
      s.textContent = m.score === null ? '—' : m.score + '/100';
      b.appendChild(t);
      b.appendChild(s);
      b.addEventListener('click', function () {
        state.selectedId = m.id;
        saveState();
        renderCards();
      });
      li.appendChild(b);
      ol.appendChild(li);
    });

    // Details
    var name = $('details-name');
    var dl = $('details-list');
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    var guideLink = $('guide-link');
    if (selected) {
      name.textContent = selected.title;
      name.classList.add('has-match');
      Object.keys(selected.details).forEach(function (k) {
        if (HIDDEN_DETAIL_KEYS.indexOf(k.toLowerCase()) !== -1) return;
        var row = document.createElement('div');
        var dt = document.createElement('dt');
        dt.textContent = k;
        var dd = document.createElement('dd');
        appendInline(dd, selected.details[k]);
        row.appendChild(dt);
        row.appendChild(dd);
        dl.appendChild(row);
      });
      var slug = /^[a-z0-9-]+$/.test(selected.id) ? selected.id : '';
      guideLink.href = slug ? '/guide#' + slug : '/guide';
      guideLink.textContent = 'Read about ' + selected.title + ' in the guide';
    } else {
      name.textContent = 'Pick a match to see its prices, fees and perks.';
      name.classList.remove('has-match');
      guideLink.href = '/guide';
      guideLink.textContent = 'Read about it in the guide';
    }
    $('next-text').textContent = state.nextStep || 'Use your free guest visit, then come back and tell the planner what you liked.';
  }

  // ---- Thinking indicator -----------------------------------------------
  var thinkingEl = null;
  var thinkTimers = [];

  function showThinking() {
    hideThinking();
    if (emptyState.parentNode === log) log.removeChild(emptyState);
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'msg bot thinking';
    var label = document.createElement('span');
    label.className = 'label';
    label.textContent = BOT_NAME;
    var dots = document.createElement('span');
    dots.className = 'dots';
    dots.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 3; i++) dots.appendChild(document.createElement('span'));
    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = 'The planner is working on your answer.';
    var note = document.createElement('span');
    note.className = 'wait-note';
    note.hidden = true;
    thinkingEl.appendChild(label);
    thinkingEl.appendChild(dots);
    thinkingEl.appendChild(sr);
    thinkingEl.appendChild(note);
    log.appendChild(thinkingEl);
    log.scrollTop = log.scrollHeight;
    thinkTimers.push(setTimeout(function () {
      note.hidden = false;
      note.textContent = 'Still working. Live price checks can take up to a minute.';
      log.scrollTop = log.scrollHeight;
    }, WAIT_NOTE_MS));
    thinkTimers.push(setTimeout(function () {
      note.textContent = 'Almost there. Comparing fees and perks.';
    }, CLOSING_NOTE_MS));
  }
  function hideThinking() {
    thinkTimers.forEach(clearTimeout);
    thinkTimers = [];
    if (thinkingEl && thinkingEl.parentNode) thinkingEl.parentNode.removeChild(thinkingEl);
    thinkingEl = null;
  }

  function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    sendBtn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // ---- Sending -----------------------------------------------------------
  function showError(text) {
    var div = document.createElement('div');
    div.className = 'msg error';
    div.setAttribute('role', 'alert');
    var p = document.createElement('p');
    p.textContent = text;
    div.appendChild(p);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function send(text) {
    if (busy) return;
    var message = text.trim();
    if (!message) return;
    if (listening) stopListening();
    state.messages.push({ role: 'user', content: message.slice(0, 2000) });
    saveState();
    renderLog();
    input.value = '';
    autoGrow();
    setBusy(true);
    showThinking();

    var history = state.messages.slice(-MAX_HISTORY).map(function (m) {
      return { role: m.role, content: m.content };
    });
    while (history.length && history[0].role !== 'user') history.shift();

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (r) {
        hideThinking();
        if (!r.ok || !r.data || typeof r.data.reply !== 'string') {
          var msg = r.data && typeof r.data.error === 'string' ? r.data.error : 'Something went wrong. Please try again.';
          showError(msg);
          return;
        }
        state.messages.push({ role: 'assistant', content: r.data.reply });
        var parsed = parseReply(r.data.reply);
        if (parsed.matches.length) {
          state.matches = parsed.matches;
          var top = sortMatches(parsed.matches)[0];
          state.selectedId = top ? top.id : null;
        }
        if (parsed.nextStep) state.nextStep = parsed.nextStep;
        saveState();
        renderLog();
        renderCards();
      })
      .catch(function () {
        hideThinking();
        showError('Could not reach the planner. Check your connection and try again.');
      })
      .then(function () {
        setBusy(false);
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    }
  });

  function autoGrow() {
    input.style.height = 'auto';
    var max = parseFloat(getComputedStyle(input).maxHeight) || 136;
    var h = input.scrollHeight + 2;
    input.style.height = Math.min(h, max) + 'px';
    input.style.overflowY = h > max ? 'auto' : 'hidden';
  }
  input.addEventListener('input', autoGrow);
  document.addEventListener('prefs:change', autoGrow);

  // ---- Start over --------------------------------------------------------
  resetBtn.addEventListener('click', function () {
    if (listening) stopListening();
    hideThinking();
    state = { messages: [], matches: [], selectedId: null, nextStep: '' };
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    renderLog();
    renderCards();
    input.focus();
  });

  // ---- Full page ---------------------------------------------------------
  var placeholder = null;
  function setFull(on) {
    var isFull = chatCard.classList.contains('is-full');
    if (on === isFull) return;
    if (on) {
      placeholder = document.createElement('div');
      placeholder.className = 'card chat-card placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.style.height = chatCard.getBoundingClientRect().height + 'px';
      board.insertBefore(placeholder, chatCard);
      chatCard.classList.add('is-full');
      document.body.classList.add('chat-full');
      fullBtn.setAttribute('aria-pressed', 'true');
      fullBtn.setAttribute('aria-label', 'Exit full page');
      fullBtn.textContent = 'Exit full page';
      chatCard.setAttribute('role', 'dialog');
      chatCard.setAttribute('aria-modal', 'true');
      input.focus();
    } else {
      chatCard.classList.remove('is-full');
      document.body.classList.remove('chat-full');
      if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      placeholder = null;
      fullBtn.setAttribute('aria-pressed', 'false');
      fullBtn.setAttribute('aria-label', 'Full page');
      fullBtn.textContent = 'Full page';
      chatCard.removeAttribute('role');
      chatCard.removeAttribute('aria-modal');
      fullBtn.focus();
    }
    log.scrollTop = log.scrollHeight;
  }
  fullBtn.addEventListener('click', function () { setFull(!chatCard.classList.contains('is-full')); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && chatCard.classList.contains('is-full')) setFull(false);
  });

  // ---- Download ----------------------------------------------------------
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function buildPlanText() {
    var now = new Date();
    var L = [];
    L.push(PROJECT + ' - gym plan saved ' + now.toLocaleString());
    L.push('');
    L.push('Note: prices and facts were checked during this conversation and in the guide (October 2026). Gym prices and fees change often; confirm them at the front desk before you sign anything.');
    L.push('');
    L.push('RANKED OPTIONS');
    L.push('==============');
    var list = sortMatches(state.matches);
    if (!list.length) L.push('No options were ranked in this conversation.');
    list.forEach(function (m, i) {
      L.push((i + 1) + '. ' + m.title + ' - Fit score: ' + (m.score === null ? 'not scored yet' : m.score + '/100'));
      if (m.why) L.push('   Why: ' + plainText(m.why));
      Object.keys(m.details).forEach(function (k) {
        if (HIDDEN_DETAIL_KEYS.indexOf(k.toLowerCase()) !== -1) return;
        L.push('   ' + k + ': ' + plainText(m.details[k]));
      });
      L.push('');
    });
    L.push('LATEST PLAN');
    L.push('===========');
    var lastBot = null;
    for (var i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'assistant') { lastBot = state.messages[i]; break; }
    }
    L.push(lastBot ? plainText(parseReply(lastBot.content).text) : 'No reply yet.');
    L.push('');
    L.push('FULL CONVERSATION');
    L.push('=================');
    state.messages.forEach(function (m) {
      var text = m.role === 'assistant' ? plainText(parseReply(m.content).text) : m.content;
      L.push((m.role === 'user' ? 'You: ' : BOT_NAME + ': ') + text);
      L.push('');
    });
    var body = L.join('\n')
      .split('\n')
      .filter(function (line) { return !MATCH_LINE.test(line); })
      .join('\r\n');
    return '﻿' + body;
  }

  downloadBtn.addEventListener('click', function () {
    if (!hasReply()) return;
    var d = new Date();
    var name = 'tucson-gym-match-plan-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.txt';
    var blob = new Blob([buildPlanText()], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // ---- Voice input -------------------------------------------------------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var isAndroid = /Android/i.test(navigator.userAgent || '');
  var rec = null;
  var listening = false;
  var lastSpeechAt = 0;
  var silenceTimer = null;
  var baseText = '';
  var committed = '';
  var sessionFinal = '';
  var interim = '';

  function joinParts(parts) {
    return parts.map(function (p) { return p.trim(); }).filter(Boolean).join(' ');
  }
  function renderSpeech() {
    input.value = joinParts([baseText, committed, sessionFinal, interim]);
    autoGrow();
  }
  function armSilence() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(function () { stopListening(); }, SILENCE_MS);
  }
  function showMicError(text) {
    micError.textContent = text;
    micError.hidden = false;
  }

  function startSession() {
    rec = new SR();
    rec.lang = document.documentElement.lang === 'en' ? (navigator.language || 'en-US') : document.documentElement.lang;
    rec.interimResults = true;
    rec.continuous = !isAndroid;
    rec.maxAlternatives = 1;
    sessionFinal = '';
    interim = '';
    rec.onresult = function (e) {
      var fin = '';
      var tmp = '';
      for (var i = 0; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) fin += ' ' + r[0].transcript;
        else tmp += ' ' + r[0].transcript;
      }
      sessionFinal = fin.trim();
      interim = tmp.trim();
      lastSpeechAt = Date.now();
      armSilence();
      renderSpeech();
    };
    rec.onerror = function (e) {
      var code = e && e.error;
      if (code === 'no-speech' || code === 'aborted') return; // silence is handled by the timer
      var msg;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        msg = 'The microphone is blocked. Allow microphone access for this site in your browser settings, then tap the mic again.';
      } else if (code === 'audio-capture') {
        msg = 'No microphone was found. Connect or enable a microphone, then tap the mic again.';
      } else if (code === 'network') {
        msg = 'Voice input lost its connection. Check your internet connection and tap the mic again, or type instead.';
      } else {
        msg = 'Voice input stopped unexpectedly. Tap the mic to try again, or type your question.';
      }
      stopListening(msg);
    };
    rec.onend = function () {
      committed = joinParts([committed, sessionFinal]);
      sessionFinal = '';
      interim = '';
      renderSpeech();
      if (!listening) return;
      if (Date.now() - lastSpeechAt < SILENCE_MS) {
        try { startSession(); } catch (err) {
          stopListening('Voice input could not restart. Tap the mic to try again, or type your question.');
        }
      } else {
        stopListening();
      }
    };
    rec.start();
  }

  function startListening() {
    micError.hidden = true;
    micError.textContent = '';
    baseText = input.value;
    committed = '';
    sessionFinal = '';
    interim = '';
    listening = true;
    lastSpeechAt = Date.now();
    try {
      startSession();
    } catch (err) {
      listening = false;
      showMicError('Voice input could not start. Tap the mic to try again, or type your question.');
      return;
    }
    armSilence();
    micBtn.setAttribute('aria-pressed', 'true');
    micBtn.setAttribute('aria-label', 'Stop voice input');
    micStatus.hidden = false;
  }

  function stopListening(errorText) {
    listening = false;
    clearTimeout(silenceTimer);
    if (rec) {
      var r = rec;
      rec = null;
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try { r.stop(); } catch (e) { /* already stopped */ }
    }
    committed = joinParts([committed, sessionFinal, interim]);
    sessionFinal = '';
    interim = '';
    if (baseText || committed) input.value = joinParts([baseText, committed]);
    autoGrow();
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.setAttribute('aria-label', 'Start voice input');
    micStatus.hidden = true;
    if (errorText) showMicError(errorText);
  }

  if (SR) {
    micBtn.hidden = false;
    micBtn.addEventListener('click', function () {
      if (listening) stopListening();
      else startListening();
    });
  }

  // ---- Init --------------------------------------------------------------
  loadState();
  renderLog();
  renderCards();
  autoGrow();
})();
