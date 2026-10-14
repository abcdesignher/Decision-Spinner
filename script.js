(function () {
  'use strict';

  /* ================================================================
     Constants
     ================================================================ */

  var PASTELS = ['#CDE4FF', '#DED5FF', '#FFD8E5', '#FFE2CC', '#FFF0B8', '#CFF2E3', '#C9F0F1', '#EAD8FA'];
  var STORAGE_KEY = 'decisionSpinner.sessions.v1';
  var BACKUP_KEY = 'decisionSpinner.sessions.v1.corrupt';
  var MAX_OPTIONS = 12;
  var SPIN_DURATION = 4200;
  var SPIN_TURNS = 4;
  var TAU = Math.PI * 2;

  /* ================================================================
     State — single source of truth
     ================================================================ */

  var state = {
    options: [],
    suggestions: [],
    topic: '',
    history: [],
    latestWinner: null,
    activeSessionId: null,
    savedSnapshot: null,
    spinning: false,
    saveInFlight: false,
    sessions: [],
    rotation: 0
  };

  /* ================================================================
     DOM helpers
     ================================================================ */

  function $(sel) { return document.querySelector(sel); }

  var el = {
    optionForm: $('#optionForm'),
    optionInput: $('#optionInput'),
    optionList: $('#optionList'),
    optionFeedback: $('#optionFeedback'),
    optionCount: $('#optionCount'),
    clearOptionsBtn: $('#clearOptionsBtn'),
    topicForm: $('#topicForm'),
    topicInput: $('#topicInput'),
    suggestionsArea: $('#suggestionsArea'),
    suggestionList: $('#suggestionList'),
    suggestionNote: $('#suggestionNote'),
    addSelectedBtn: $('#addSelectedBtn'),
    regenerateBtn: $('#regenerateBtn'),
    wheelCanvas: $('#wheelCanvas'),
    spinBtn: $('#spinBtn'),
    spinHint: $('#spinHint'),
    resultCard: $('#resultCard'),
    winnerText: $('#winnerText'),
    spinAgainBtn: $('#spinAgainBtn'),
    editOptionsBtn: $('#editOptionsBtn'),
    saveSessionBtn: $('#saveSessionBtn'),
    historyBlock: $('#historyBlock'),
    historyList: $('#historyList'),
    confettiLayer: $('#confettiLayer'),
    openSessionsBtn: $('#openSessionsBtn'),
    newDecisionBtn: $('#newDecisionBtn'),
    sessionCount: $('#sessionCount'),
    overlay: $('#overlay'),
    modalTitle: $('#modalTitle'),
    modalBody: $('#modalBody'),
    modalFooter: $('#modalFooter'),
    modalCloseBtn: $('#modalCloseBtn'),
    toastWrap: $('#toastWrap'),
    announcer: $('#announcer')
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function mod(n, m) { return ((n % m) + m) % m; }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) {
      return d.toISOString();
    }
  }

  /* ================================================================
     Feedback: toasts, inline feedback, announcer
     ================================================================ */

  function toast(message, kind) {
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' is-' + kind : '');
    node.textContent = message;
    el.toastWrap.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 3600);
  }

  function announce(message) {
    el.announcer.textContent = '';
    setTimeout(function () { el.announcer.textContent = message; }, 40);
  }

  function setFeedback(node, message, kind) {
    node.textContent = message || '';
    node.className = 'feedback' + (kind ? ' is-' + kind : '');
  }

  /* ================================================================
     Modal system
     ================================================================ */

  var modal = { lastFocus: null, onClose: null };

  function isModalOpen() { return !el.overlay.hidden; }

  function focusableIn(container) {
    return Array.prototype.filter.call(
      container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (node) { return node.offsetParent !== null || node === document.activeElement; }
    );
  }

  function openModal(config) {
    var wasOpen = isModalOpen();
    if (!wasOpen) modal.lastFocus = document.activeElement;

    el.modalTitle.textContent = config.title || '';
    el.modalBody.innerHTML = config.body || '';
    el.modalFooter.innerHTML = '';

    (config.actions || []).forEach(function (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (action.className || 'btn-secondary');
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        var keepOpen = action.onClick ? action.onClick() === false : false;
        if (!keepOpen) closeModal();
      });
      el.modalFooter.appendChild(btn);
    });

    el.overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.onClose = config.onClose || null;

    if (config.onOpen) config.onOpen();

    var focusTarget = config.initialFocus
      ? el.modalBody.querySelector(config.initialFocus)
      : (focusableIn(el.modalBody)[0] || el.modalCloseBtn);
    (focusTarget || el.modalCloseBtn).focus();
  }

  function closeModal() {
    if (!isModalOpen()) return;
    el.overlay.hidden = true;
    document.body.style.overflow = '';
    var onClose = modal.onClose;
    modal.onClose = null;
    if (onClose) onClose();
    if (modal.lastFocus && document.contains(modal.lastFocus)) {
      modal.lastFocus.focus();
    }
    modal.lastFocus = null;
  }

  el.modalCloseBtn.addEventListener('click', closeModal);

  el.overlay.addEventListener('mousedown', function (event) {
    if (event.target === el.overlay) closeModal();
  });

  document.addEventListener('keydown', function (event) {
    if (!isModalOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === 'Tab') {
      var items = focusableIn(el.overlay);
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  /* ================================================================
     Storage
     ================================================================ */

  function storageWorks() {
    try {
      var probe = '__ds_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  var canPersist = storageWorks();

  function validIso(value) {
    return typeof value === 'string' && !isNaN(new Date(value).getTime());
  }

  function sanitizeSession(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (!Array.isArray(raw.options)) return null;

    var options = raw.options
      .filter(function (o) { return typeof o === 'string' && o.trim(); })
      .map(function (o) { return o.trim().slice(0, 80); })
      .slice(0, MAX_OPTIONS);

    var history = [];
    if (Array.isArray(raw.history)) {
      history = raw.history
        .filter(function (h) { return h && typeof h === 'object' && typeof h.text === 'string' && h.text.trim(); })
        .map(function (h) {
          return {
            text: h.text.trim().slice(0, 80),
            timestamp: validIso(h.timestamp) ? h.timestamp : new Date().toISOString()
          };
        });
    }

    if (!options.length && !history.length) return null;

    var now = new Date().toISOString();
    return {
      id: raw.id,
      title: (typeof raw.title === 'string' && raw.title.trim()) ? raw.title.trim().slice(0, 100) : 'Untitled decision',
      topic: (typeof raw.topic === 'string') ? raw.topic.trim().slice(0, 140) : '',
      options: options,
      latestWinner: (typeof raw.latestWinner === 'string' && raw.latestWinner.trim()) ? raw.latestWinner.trim() : null,
      history: history,
      createdAt: validIso(raw.createdAt) ? raw.createdAt : now,
      updatedAt: validIso(raw.updatedAt) ? raw.updatedAt : now
    };
  }

  function loadSessionsFromStorage() {
    if (!canPersist) return [];
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      toast("Couldn't read saved sessions in this browser.", 'error');
      return [];
    }
    if (raw === null || raw === '') return [];

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      backupCorruptData(raw);
      toast('Saved data was unreadable, so we started with an empty list.', 'error');
      return [];
    }

    if (!Array.isArray(parsed)) {
      backupCorruptData(raw);
      toast('Saved data was in an unexpected format, so we started fresh.', 'error');
      return [];
    }

    var clean = [];
    var skipped = 0;
    parsed.forEach(function (item) {
      var session = sanitizeSession(item);
      if (session) clean.push(session); else skipped++;
    });
    if (skipped > 0) toast(skipped + ' saved session' + (skipped === 1 ? '' : 's') + " couldn't be read and " + (skipped === 1 ? 'was' : 'were') + ' skipped.', 'error');
    return clean;
  }

  function backupCorruptData(raw) {
    if (!canPersist) return;
    try {
      window.localStorage.setItem(BACKUP_KEY, raw);
    } catch (e) { /* ignore */ }
  }

  function persistSessions(nextSessions) {
    if (!canPersist) {
      toast("This browser is blocking storage, so nothing was saved.", 'error');
      return false;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSessions));
      return true;
    } catch (err) {
      var quota = err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22);
      if (quota) {
        toast("Couldn't save — browser storage is full. Try deleting an old session.", 'error');
      } else {
        toast("Couldn't save — storage failed unexpectedly.", 'error');
      }
      return false;
    }
  }

  /* ================================================================
     Workspace / session helpers
     ================================================================ */

  function collectWorkspace() {
    return {
      topic: state.topic,
      options: state.options.slice(),
      history: state.history.map(function (h) { return { text: h.text, timestamp: h.timestamp }; }),
      latestWinner: state.latestWinner
    };
  }

  function serializeWorkspace() {
    return JSON.stringify(collectWorkspace());
  }

  function isDirty() {
    if (!state.activeSessionId) {
      return !!(state.topic || state.options.length || state.history.length);
    }
    return serializeWorkspace() !== state.savedSnapshot;
  }

  function findSession(id) {
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === id) return state.sessions[i];
    }
    return null;
  }

  function defaultTitle(ws) {
    if (ws.topic) return ws.topic.slice(0, 100);
    if (ws.options.length) return ws.options.slice(0, 2).join(' vs ').slice(0, 100);
    return 'Untitled decision';
  }

  function updateSessionCount() {
    el.sessionCount.textContent = String(state.sessions.length);
    el.openSessionsBtn.setAttribute('aria-label',
      'Saved sessions, ' + state.sessions.length + ' saved');
  }

  function setSaveBusy(busy) {
    state.saveInFlight = busy;
    el.saveSessionBtn.disabled = busy || state.spinning;
  }

  /* ================================================================
     Option management
     ================================================================ */

  function colorFor(index) { return PASTELS[index % PASTELS.length]; }

  function optionExists(text) {
    var lower = text.toLowerCase();
    return state.options.some(function (o) { return o.toLowerCase() === lower; });
  }

  function addOption(raw, feedbackNode) {
    var node = feedbackNode || el.optionFeedback;
    var text = String(raw == null ? '' : raw).trim();

    if (state.spinning) {
      setFeedback(node, 'Hang on — the wheel is still spinning.', 'error');
      return false;
    }
    if (!text) {
      setFeedback(node, 'Type an option first.', 'error');
      return false;
    }
    if (state.options.length >= MAX_OPTIONS) {
      setFeedback(node, 'That is the limit — you can keep up to ' + MAX_OPTIONS + ' options.', 'error');
      return false;
    }
    if (optionExists(text)) {
      setFeedback(node, '“' + text + '” is already on the list.', 'error');
      return false;
    }

    state.options.push(text);
    setFeedback(node, 'Added “' + text + '”.', 'ok');
    afterOptionsChange();
    return true;
  }

  function removeOption(index, feedbackNode) {
    if (state.spinning) {
      setFeedback(feedbackNode || el.optionFeedback, 'Hang on — the wheel is still spinning.', 'error');
      return;
    }
    if (index < 0 || index >= state.options.length) return;
    var removed = state.options.splice(index, 1)[0];
    state.rotation = mod(state.rotation, TAU);
    setFeedback(feedbackNode || el.optionFeedback, 'Removed “' + removed + '”. Past spins stay in your history.');
    afterOptionsChange();
  }

  function clearOptions() {
    if (state.spinning) {
      setFeedback(el.optionFeedback, 'Hang on — the wheel is still spinning.', 'error');
      return;
    }
    if (!state.options.length) return;
    state.options = [];
    state.rotation = 0;
    setFeedback(el.optionFeedback, 'All options cleared. Your spin history is untouched.');
    afterOptionsChange();
  }

  function afterOptionsChange() {
    renderOptionChips();
    renderSuggestions();
    renderWheel();
    updateSpinControls();
    markSessionDirtyHint();
  }

  function renderOptionChips() {
    el.optionList.innerHTML = '';
    if (!state.options.length) {
      var empty = document.createElement('li');
      empty.className = 'chips-empty';
      empty.textContent = 'No options yet — add a few above or ask for suggestions.';
      el.optionList.appendChild(empty);
    } else {
      state.options.forEach(function (option, index) {
        var li = document.createElement('li');
        li.className = 'chip';
        li.style.background = colorFor(index);
        li.innerHTML = '<span class="chip-label"></span>';
        li.querySelector('.chip-label').textContent = option;

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'chip-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove ' + option);
        remove.addEventListener('click', function () { removeOption(index); });
        li.appendChild(remove);
        el.optionList.appendChild(li);
      });
    }

    el.optionCount.textContent = state.options.length + ' / ' + MAX_OPTIONS + ' options';
    el.clearOptionsBtn.disabled = !state.options.length || state.spinning;
  }

  /* ================================================================
     Recommendations (local, rule-based)
     ================================================================ */

  var RECOMMENDATION_RULES = [
    {
      key: 'food',
      words: ['eat', 'lunch', 'dinner', 'breakfast', 'brunch', 'food', 'meal', 'hungry', 'cook', 'restaurant', 'snack', 'cuisine', 'recipe', 'supper', 'bite'],
      items: ['Jollof rice', 'Noodles and eggs', 'Chicken sandwich', 'Rice and stew', 'Yam and egg sauce', 'Beans and plantain',
        'Fried rice and chicken', 'Spaghetti and meat sauce', 'Grilled fish and salad', 'Meat pies', 'Pancakes and fruit', 'Shawarma']
    },
    {
      key: 'js',
      words: ['javascript', 'js', 'project', 'app', 'build', 'code', 'coding', 'program', 'website', 'frontend', 'front-end', 'web'],
      items: ['Quiz app', 'Expense tracker', 'Countdown timer', 'Notes app', 'Memory matching game', 'Color palette generator',
        'Weather dashboard', 'To-do list', 'Random quote generator', 'Calculator', 'Drum machine', 'URL bookmarklet page']
    },
    {
      key: 'productivity',
      words: ['productive', 'productivity', 'focus', 'procrastinate', 'procrastination', 'time', 'work', 'busy', 'task', 'tasks', 'schedule', 'organize'],
      items: ['Run a Pomodoro sprint', 'Tackle the hardest task first', 'Time-block the day', 'Clear the inbox', 'Take a short walk', 'Tidy the desk',
        'Plan tomorrow tonight', 'Batch similar tasks together', 'Turn off notifications for an hour', 'Write a three-item must-do list']
    },
    {
      key: 'writing',
      words: ['write', 'writing', 'writer', 'blog', 'post', 'article', 'content', 'story', 'newsletter', 'essay', 'copy'],
      items: ['Lessons from a recent project', 'A design problem', 'Something learned this week', 'A useful tool', 'A product improvement',
        'A mistake that taught a lesson', 'A myth worth debunking', 'A before-and-after story', 'An opinion you changed your mind about', 'A short how-to guide']
    },
    {
      key: 'entertainment',
      words: ['movie', 'film', 'watch', 'show', 'tv', 'series', 'music', 'game', 'games', 'entertain', 'bored', 'fun', 'podcast'],
      items: ['Watch a movie', 'Binge a new series', 'Listen to a playlist', 'Start a podcast', 'Play a video game', 'Read for fun',
        'Host a game night', 'Try a karaoke session', 'Revisit an old favorite', 'Watch a documentary']
    },
    {
      key: 'weekend',
      words: ['weekend', 'saturday', 'sunday', 'day off', 'free time', 'holiday', 'vacation', 'plan for'],
      items: ['Go for a hike', 'Have a picnic', 'Visit a museum', 'Try a new brunch spot', 'Movie marathon', 'Explore a new neighbourhood',
        'Volunteer somewhere local', 'Beach day', 'Farmers market run', 'Day trip to a nearby town']
    },
    {
      key: 'learning',
      words: ['learn', 'learning', 'study', 'course', 'skill', 'skills', 'language', 'education', 'practice', 'improve at'],
      items: ['Take an online course', 'Follow a tutorial', 'Build a practice project', 'Read a book on it', 'Watch a YouTube series',
        'Make flashcards', 'Find a mentor', 'Practice daily with a challenge', 'Join a study group', 'Teach someone else']
    }
  ];

  var FALLBACK_RULE = {
    key: 'general',
    items: ['Make a pros-and-cons list', 'Sleep on it', 'Ask a friend', 'Pick the fastest option',
      'Choose the cheapest option', 'Go with your first instinct', 'Try it once and review', 'Flip a coin and notice how you feel']
  };

  function shuffle(items) {
    var copy = items.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy;
  }

  function recommend(topic) {
    var words = String(topic).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    var best = null;
    var bestScore = 0;

    RECOMMENDATION_RULES.forEach(function (rule) {
      var score = 0;
      rule.words.forEach(function (word) {
        if (words.indexOf(word) !== -1) score++;
        else if (word.length > 3 && String(topic).toLowerCase().indexOf(word) !== -1) score += 0.5;
      });
      if (score > bestScore) { bestScore = score; best = rule; }
    });

    if (!best || bestScore === 0) {
      return { items: shuffle(FALLBACK_RULE.items).slice(0, 6), note: "We don't have a category for that yet, so here are some general options." };
    }
    return { items: shuffle(best.items).slice(0, 6), note: '' };
  }

  function generateSuggestions() {
    if (state.spinning) {
      setFeedback(el.suggestionNote, 'Hang on — the wheel is still spinning.', 'error');
      return;
    }
    var topic = el.topicInput.value.trim();
    if (!topic) {
      setFeedback(el.suggestionNote, 'Tell us what you want to decide first.', 'error');
      el.topicInput.focus();
      return;
    }

    state.topic = topic;
    var result = recommend(topic);
    state.suggestions = result.items.map(function (text) {
      return { text: text, selected: false };
    });

    el.suggestionsArea.hidden = false;
    setFeedback(el.suggestionNote, result.note || 'Tap the ones that sound good, then add them to your wheel.', result.note ? '' : 'ok');
    renderSuggestions();
    markSessionDirtyHint();
  }

  function renderSuggestions() {
    el.suggestionList.innerHTML = '';

    if (!state.suggestions.length) return;

    state.suggestions.forEach(function (suggestion, index) {
      var alreadyAdded = optionExists(suggestion.text);
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.style.background = colorFor(index);
      btn.textContent = suggestion.text;
      btn.setAttribute('aria-pressed', suggestion.selected ? 'true' : 'false');

      if (alreadyAdded) {
        btn.disabled = true;
        btn.title = 'Already in your options';
        btn.setAttribute('aria-label', suggestion.text + ' (already in your options)');
      } else {
        btn.addEventListener('click', function () {
          suggestion.selected = !suggestion.selected;
          btn.setAttribute('aria-pressed', suggestion.selected ? 'true' : 'false');
          setFeedback(el.suggestionNote, '');
        });
      }

      li.appendChild(btn);
      el.suggestionList.appendChild(li);
    });
  }

  function addSelectedSuggestions() {
    if (state.spinning) {
      setFeedback(el.suggestionNote, 'Hang on — the wheel is still spinning.', 'error');
      return;
    }

    var selected = state.suggestions.filter(function (s) { return s.selected; });
    if (!selected.length) {
      setFeedback(el.suggestionNote, 'Tap a suggestion first, then choose Add selected.', 'error');
      return;
    }

    var slots = MAX_OPTIONS - state.options.length;
    if (slots <= 0) {
      setFeedback(el.suggestionNote, 'You already have all ' + MAX_OPTIONS + ' slots full. Remove an option to add more.', 'error');
      return;
    }

    var added = 0, duplicates = 0, overflow = 0;
    selected.forEach(function (suggestion) {
      if (state.options.length >= MAX_OPTIONS) { overflow++; return; }
      if (optionExists(suggestion.text)) { duplicates++; suggestion.selected = false; return; }
      state.options.push(suggestion.text);
      suggestion.selected = false;
      added++;
    });

    afterOptionsChange();

    var parts = [];
    if (added) parts.push('Added ' + added + ' option' + (added === 1 ? '' : 's') + ' to your wheel.');
    if (duplicates) parts.push(duplicates + ' already on your list.');
    if (overflow) parts.push('Only ' + slots + ' slot' + (slots === 1 ? ' was' : 's were') + ' free, so ' + overflow + ' selection' + (overflow === 1 ? '' : 's') + ' could not be added.');
    setFeedback(el.suggestionNote, parts.join(' '), added ? 'ok' : 'error');
    markSessionDirtyHint();
  }

  /* ================================================================
     Wheel rendering
     ================================================================ */

  function fitLabel(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var shortened = text;
    while (shortened.length > 1 && ctx.measureText(shortened + '…').width > maxWidth) {
      shortened = shortened.slice(0, -1);
    }
    return shortened + '…';
  }

  function drawWheelEmpty(ctx, cx, cy, radius) {
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#E8E4F5';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#77738F';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Add options to build your wheel', cx, cy - 10);
    ctx.font = '500 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('You need at least two.', cx, cy + 14);
  }

  function drawPointer(ctx, cx, cy, radius) {
    var tipY = cy - radius + 26;
    var baseY = cy - radius - 6;
    var half = 13;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - half, baseY);
    ctx.lineTo(cx + half, baseY);
    ctx.closePath();
    ctx.fillStyle = '#4532C0';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  function drawHub(ctx, cx, cy, radius) {
    var hub = Math.max(22, radius * 0.16);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, hub, 0, TAU);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4532C0';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, hub * 0.42, 0, TAU);
    ctx.fillStyle = '#4532C0';
    ctx.fill();
    ctx.restore();
  }

  function renderWheel() {
    var canvas = el.wheelCanvas;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var cssSize = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    var cx = cssSize / 2;
    var cy = cssSize / 2;
    var radius = cssSize / 2 - 8;
    var n = state.options.length;

    if (n === 0) {
      drawWheelEmpty(ctx, cx, cy, radius);
      canvas.setAttribute('aria-label', 'Decision wheel, no options yet');
      return;
    }

    var seg = TAU / n;

    for (var i = 0; i < n; i++) {
      var start = state.rotation + i * seg - Math.PI / 2;
      var end = start + seg;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colorFor(i);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      var mid = start + seg / 2;
      var fontSize = Math.max(12, Math.min(18, Math.floor(seg * radius * 0.30)));
      ctx.font = '600 ' + fontSize + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#24213A';
      ctx.textBaseline = 'middle';

      ctx.save();
      ctx.translate(cx, cy);
      var maxTextWidth = radius - Math.max(22, radius * 0.16) - 22;
      var label = fitLabel(ctx, state.options[i], maxTextWidth);

      if (Math.cos(mid) < 0) {
        ctx.rotate(mid + Math.PI);
        ctx.textAlign = 'left';
        ctx.fillText(label, -(radius - 14), 0);
      } else {
        ctx.rotate(mid);
        ctx.textAlign = 'right';
        ctx.fillText(label, radius - 14, 0);
      }
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#E8E4F5';
    ctx.stroke();

    drawHub(ctx, cx, cy, radius);
    drawPointer(ctx, cx, cy, radius);

    canvas.setAttribute('aria-label', 'Decision wheel with ' + n + ' options: ' + state.options.join(', '));
  }

  /* ================================================================
     Spin behaviour
     ================================================================ */

  function indexUnderPointer(rotation, count) {
    var seg = TAU / count;
    var position = mod(-rotation, TAU);
    var index = Math.floor(position / seg);
    if (index < 0) index = 0;
    if (index > count - 1) index = count - 1;
    return index;
  }

  function updateSpinControls() {
    var count = state.options.length;
    var canSpin = count >= 2 && !state.spinning;

    el.spinBtn.disabled = !canSpin;
    el.spinAgainBtn.disabled = !canSpin;
    el.saveSessionBtn.disabled = state.saveInFlight || state.spinning;
    el.editOptionsBtn.disabled = state.spinning;
    el.clearOptionsBtn.disabled = !count || state.spinning;

    if (state.spinning) {
      el.spinBtn.textContent = 'Spinning…';
      el.spinHint.textContent = 'Almost there…';
    } else {
      el.spinBtn.textContent = 'Spin the wheel';
      el.spinHint.textContent = count < 2
        ? 'Add at least two options to spin.'
        : count + ' option' + (count === 1 ? '' : 's') + ' ready — good luck!';
    }
  }

  function spin() {
    if (state.spinning) return;
    if (state.options.length < 2) {
      setFeedback(el.optionFeedback, 'Add at least two options before spinning.', 'error');
      return;
    }

    var count = state.options.length;
    var seg = TAU / count;
    var targetIndex = Math.floor(Math.random() * count);
    var targetMod = mod(-(targetIndex + 0.5) * seg, TAU);
    var currentMod = mod(state.rotation, TAU);
    var delta = mod(targetMod - currentMod, TAU);
    var startRotation = state.rotation;
    var finalRotation = startRotation + TAU * SPIN_TURNS + delta;

    state.spinning = true;
    updateSpinControls();
    renderOptionChips();

    if (prefersReducedMotion()) {
      finishSpin(finalRotation);
      return;
    }

    var startedAt = null;
    function frame(now) {
      if (startedAt === null) startedAt = now;
      var progress = Math.min(1, (now - startedAt) / SPIN_DURATION);
      var eased = 1 - Math.pow(1 - progress, 4);
      state.rotation = startRotation + (finalRotation - startRotation) * eased;
      renderWheel();
      if (progress < 1) {
        window.requestAnimationFrame(frame);
      } else {
        finishSpin(finalRotation);
      }
    }
    window.requestAnimationFrame(frame);
  }

  function finishSpin(finalRotation) {
    state.rotation = finalRotation;
    var count = state.options.length;
    var winnerIndex = indexUnderPointer(state.rotation, count);
    var winner = state.options[winnerIndex];

    var timestamp = new Date().toISOString();
    state.history.push({ text: winner, timestamp: timestamp });
    state.latestWinner = winner;
    state.spinning = false;

    renderWheel();
    renderResult();
    renderOptionChips();
    updateSpinControls();

    announce('Your pick is ' + winner + '.');
    celebrate();
    markSessionDirtyHint();
  }

  /* ================================================================
     Result and history
     ================================================================ */

  function renderResult() {
    if (!state.latestWinner) {
      el.resultCard.hidden = true;
      return;
    }
    el.resultCard.hidden = false;
    el.winnerText.textContent = state.latestWinner;

    el.historyList.innerHTML = '';
    if (state.history.length) {
      el.historyBlock.hidden = false;
      state.history.slice().reverse().forEach(function (entry) {
        var li = document.createElement('li');
        var text = document.createElement('span');
        text.textContent = entry.text;
        var time = document.createElement('span');
        time.className = 'history-time';
        try {
          time.textContent = new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        } catch (e) {
          time.textContent = '';
        }
        li.appendChild(text);
        li.appendChild(time);
        el.historyList.appendChild(li);
      });
    } else {
      el.historyBlock.hidden = true;
    }
  }

  function celebrate() {
    if (prefersReducedMotion()) return;

    el.resultCard.classList.remove('pulse');
    void el.resultCard.offsetWidth;
    el.resultCard.classList.add('pulse');

    el.confettiLayer.innerHTML = '';
    for (var i = 0; i < 26; i++) {
      var piece = document.createElement('span');
      piece.className = 'confetti';
      piece.style.left = (6 + Math.random() * 88) + '%';
      piece.style.background = colorFor(i);
      piece.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 220) + 'px');
      piece.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
      piece.style.animationDelay = Math.round(Math.random() * 250) + 'ms';
      el.confettiLayer.appendChild(piece);
    }
    setTimeout(function () { el.confettiLayer.innerHTML = ''; }, 2000);
  }

  function markSessionDirtyHint() {
    if (state.activeSessionId) {
      el.saveSessionBtn.textContent = isDirty() ? 'Save session *' : 'Save session';
    } else {
      el.saveSessionBtn.textContent = 'Save session';
    }
  }

  /* ================================================================
     Edit options (elimination) modal
     ================================================================ */

  function openEditOptionsModal() {
    if (state.spinning) return;

    var feedbackNode = null;

    function render() {
      var list = document.getElementById('editOptionList');
      var count = document.getElementById('editCount');
      if (!list) return;
      list.innerHTML = '';

      if (!state.options.length) {
        var empty = document.createElement('li');
        empty.className = 'chips-empty';
        empty.textContent = 'No options left. Add at least two to spin again.';
        list.appendChild(empty);
      } else {
        state.options.forEach(function (option, index) {
          var li = document.createElement('li');
          li.className = 'chip';
          li.style.background = colorFor(index);
          li.innerHTML = '<span class="chip-label"></span>';
          li.querySelector('.chip-label').textContent = option;

          var remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'chip-remove';
          remove.textContent = '×';
          remove.setAttribute('aria-label', 'Remove ' + option);
          remove.addEventListener('click', function () { removeOption(index, feedbackNode); render(); });
          li.appendChild(remove);
          list.appendChild(li);
        });
      }
      if (count) count.textContent = state.options.length + ' / ' + MAX_OPTIONS + ' options';
    }

    openModal({
      title: 'Edit options',
      body:
        '<p class="muted">Remove anything you don&rsquo;t want on the wheel. Winners stay in your spin history even if you remove them.</p>' +
        '<ul class="chips chips-editable" id="editOptionList"></ul>' +
        '<div class="row-form" style="margin-top:16px">' +
        '  <label class="sr-only" for="editOptionInput">Type an option</label>' +
        '  <input type="text" id="editOptionInput" maxlength="80" autocomplete="off" placeholder="Type an option...">' +
        '  <button type="button" class="btn btn-primary" id="editAddBtn">Add option</button>' +
        '</div>' +
        '<p class="feedback" id="editFeedback" role="status" aria-live="polite"></p>' +
        '<span class="muted" id="editCount"></span>',
      actions: [
        { label: 'Done — back to the wheel', className: 'btn-primary', onClick: function () { render(); return true; } }
      ],
      onOpen: function () {
        feedbackNode = document.getElementById('editFeedback');
        var input = document.getElementById('editOptionInput');
        document.getElementById('editAddBtn').addEventListener('click', function () {
          if (addOption(input.value, feedbackNode)) {
            input.value = '';
            render();
          }
          input.focus();
        });
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            document.getElementById('editAddBtn').click();
          }
        });
        render();
      },
      onClose: function () {
        updateSpinControls();
        el.spinBtn.focus();
      }
    });
  }

  /* ================================================================
     Session management
     ================================================================ */

  function saveSession() {
    if (state.spinning) {
      toast('Hang on — the wheel is still spinning.', 'error');
      return false;
    }
    if (state.saveInFlight) return false;

    var ws = collectWorkspace();
    if (!ws.options.length && !ws.history.length) {
      toast('Add some options or spin at least once before saving.', 'error');
      return false;
    }

    var existing = state.activeSessionId ? findSession(state.activeSessionId) : null;
    if (existing && serializeWorkspace() === state.savedSnapshot) {
      toast('Already saved — no new changes.', 'success');
      return true;
    }

    var now = new Date().toISOString();
    var record;
    var next;

    if (existing) {
      record = {
        id: existing.id,
        title: existing.title,
        topic: ws.topic,
        options: ws.options,
        history: ws.history,
        latestWinner: ws.latestWinner,
        createdAt: existing.createdAt,
        updatedAt: now
      };
      next = state.sessions.map(function (s) { return s.id === record.id ? record : s; });
    } else {
      record = {
        id: uid(),
        title: defaultTitle(ws),
        topic: ws.topic,
        options: ws.options,
        history: ws.history,
        latestWinner: ws.latestWinner,
        createdAt: now,
        updatedAt: now
      };
      next = state.sessions.concat([record]);
    }

    setSaveBusy(true);
    var ok = persistSessions(next);
    setSaveBusy(false);

    if (!ok) {
      toast('Nothing was saved, and your session is still right here.', 'error');
      return false;
    }

    state.sessions = next;
    state.activeSessionId = record.id;
    state.savedSnapshot = JSON.stringify(ws);
    updateSessionCount();
    markSessionDirtyHint();

    toast(existing
      ? 'Session updated in this browser.'
      : 'Session saved in this browser. Rename it any time in Saved sessions.', 'success');
    return true;
  }

  function resumeSession(id) {
    var session = findSession(id);
    if (!session) {
      toast("That session couldn't be found.", 'error');
      if (isModalOpen()) openSessionsModal();
      return;
    }
    state.options = session.options.slice();
    state.history = session.history.map(function (h) { return { text: h.text, timestamp: h.timestamp }; });
    state.topic = session.topic;
    state.latestWinner = session.latestWinner;
    state.activeSessionId = session.id;
    state.rotation = 0;
    state.savedSnapshot = JSON.stringify(collectWorkspace());

    el.topicInput.value = state.topic || '';
    state.suggestions = [];
    el.suggestionsArea.hidden = true;
    setFeedback(el.suggestionNote, '');

    afterOptionsChange();
    renderResult();
    markSessionDirtyHint();
    setFeedback(el.optionFeedback, 'Resumed “' + session.title + '” as a working copy. Save to update it.');
    toast('Resumed “' + session.title + '”. Your changes stay unsaved until you hit Save session.', 'success');
  }

  function duplicateSession(id) {
    var source = findSession(id);
    if (!source) return;

    var now = new Date().toISOString();
    var copy = {
      id: uid(),
      title: (source.title + ' (copy)').slice(0, 100),
      topic: source.topic,
      options: source.options.slice(),
      history: source.history.map(function (h) { return { text: h.text, timestamp: h.timestamp }; }),
      latestWinner: source.latestWinner,
      createdAt: now,
      updatedAt: now
    };

    var next = state.sessions.concat([copy]);
    if (!persistSessions(next)) return;
    state.sessions = next;
    updateSessionCount();
    openSessionsModal();
    toast('Duplicated as “' + copy.title + '”. The copy is independent.', 'success');
  }

  function performDelete(id) {
    var session = findSession(id);
    if (!session) return;
    var next = state.sessions.filter(function (s) { return s.id !== id; });
    if (!persistSessions(next)) return;

    state.sessions = next;
    if (state.activeSessionId === id) {
      state.activeSessionId = null;
      state.savedSnapshot = null;
      markSessionDirtyHint();
    }
    updateSessionCount();
    openSessionsModal();
    toast('Deleted “' + session.title + '”.');
  }

  function confirmDelete(id) {
    var session = findSession(id);
    if (!session) return;
    openModal({
      title: 'Delete this session?',
      body: '<p><strong>' + escapeHtml(session.title) + '</strong> will be removed from this browser. This cannot be undone.</p>' +
        '<p class="muted">Your current workspace is not affected.</p>',
      actions: [
        {
          label: 'Cancel', className: 'btn-secondary',
          onClick: function () { openSessionsModal(); return false; }
        },
        {
          label: 'Delete session', className: 'btn-danger',
          onClick: function () { performDelete(id); return false; }
        }
      ]
    });
  }

  /* ---------- sessions view ---------- */

  function sessionsListHtml() {
    if (!state.sessions.length) {
      return '<div class="empty-state">' +
        '<h3>No saved sessions yet</h3>' +
        '<p>Spin the wheel, then choose <strong>Save session</strong> to keep it here. Sessions stay in this browser only.</p>' +
        '</div>';
    }

    var cards = state.sessions.map(function (session) {
      var meta = [];
      if (session.latestWinner) {
        meta.push('<span class="pill pill-result">Latest: ' + escapeHtml(session.latestWinner) + '</span>');
      } else {
        meta.push('<span class="pill">No spins yet</span>');
      }
      meta.push('<span class="pill">' + session.options.length + ' option' + (session.options.length === 1 ? '' : 's') + '</span>');
      meta.push('<span class="pill">' + session.history.length + ' spin' + (session.history.length === 1 ? '' : 's') + '</span>');

      return '<li class="session-card" data-id="' + escapeHtml(session.id) + '">' +
        '<div class="session-card-top">' +
        '  <h3>' + escapeHtml(session.title) + '</h3>' +
        '  <span class="muted">Updated ' + escapeHtml(formatDate(session.updatedAt)) + '</span>' +
        '</div>' +
        (session.topic ? '<p class="session-topic">' + escapeHtml(session.topic) + '</p>' : '') +
        '<p class="session-meta">' + meta.join('') + '</p>' +
        '<div class="session-actions">' +
        '  <button type="button" class="btn btn-primary btn-sm" data-action="resume">Resume</button>' +
        '  <button type="button" class="btn btn-secondary btn-sm" data-action="details">View details</button>' +
        '  <button type="button" class="btn btn-secondary btn-sm" data-action="edit">Edit</button>' +
        '  <button type="button" class="btn btn-secondary btn-sm" data-action="duplicate">Duplicate</button>' +
        '  <button type="button" class="btn btn-danger btn-sm" data-action="delete">Delete</button>' +
        '</div>' +
        '</li>';
    }).join('');

    return '<ul class="session-list">' + cards + '</ul>';
  }

  function openSessionsModal() {
    openModal({
      title: 'Saved sessions',
      body: sessionsListHtml(),
      actions: [{ label: 'Close', className: 'btn-secondary' }]
    });
  }

  function onSessionsClick(event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var cardEl = button.closest('.session-card');
    if (!cardEl) return;
    var id = cardEl.getAttribute('data-id');
    var action = button.getAttribute('data-action');

    if (action === 'resume') {
      closeModal();
      guardUnsaved(function () { resumeSession(id); });
    } else if (action === 'details') {
      openDetailsModal(id);
    } else if (action === 'edit') {
      openEditSessionModal(id);
    } else if (action === 'duplicate') {
      duplicateSession(id);
    } else if (action === 'delete') {
      confirmDelete(id);
    }
  }

  function openDetailsModal(id) {
    var session = findSession(id);
    if (!session) return;

    var historyHtml = session.history.length
      ? '<ol>' + session.history.map(function (h) {
          return '<li>' + escapeHtml(h.text) + ' <span class="muted">— ' + escapeHtml(formatDate(h.timestamp)) + '</span></li>';
        }).join('') + '</ol>'
      : '<p class="muted">No spins recorded yet.</p>';

    var optionsHtml = '<ol>' + session.options.map(function (o) {
      return '<li>' + escapeHtml(o) + '</li>';
    }).join('') + '</ol>';

    openModal({
      title: session.title,
      body:
        '<dl class="detail-list">' +
        '<dt>Topic</dt><dd>' + (session.topic ? escapeHtml(session.topic) : '<span class="muted">Not set</span>') + '</dd>' +
        '<dt>Latest result</dt><dd>' + (session.latestWinner ? escapeHtml(session.latestWinner) : '<span class="muted">None yet</span>') + '</dd>' +
        '<dt>Created</dt><dd>' + escapeHtml(formatDate(session.createdAt)) + '</dd>' +
        '<dt>Last updated</dt><dd>' + escapeHtml(formatDate(session.updatedAt)) + '</dd>' +
        '</dl>' +
        '<div class="detail-section"><h3>Options (' + session.options.length + ')</h3>' + optionsHtml + '</div>' +
        '<div class="detail-section"><h3>Spin history (' + session.history.length + ')</h3>' + historyHtml + '</div>' +
        '<p class="muted" style="margin-top:16px">Read-only — nothing here changes the saved session.</p>',
      actions: [
        {
          label: 'Edit this session', className: 'btn-secondary',
          onClick: function () { openEditSessionModal(id); return false; }
        },
        { label: 'Close', className: 'btn-primary' }
      ]
    });
  }

  function openEditSessionModal(id) {
    var session = findSession(id);
    if (!session) return;

    var draft = {
      title: session.title,
      options: session.options.slice()
    };

    function feedback(node, message, kind) { setFeedback(node, message, kind); }

    function renderDraft() {
      var list = document.getElementById('draftOptionList');
      var count = document.getElementById('draftCount');
      if (!list) return;
      list.innerHTML = '';

      if (!draft.options.length) {
        var empty = document.createElement('li');
        empty.className = 'chips-empty';
        empty.textContent = 'No options — add at least two.';
        list.appendChild(empty);
      }

      draft.options.forEach(function (option, index) {
        var li = document.createElement('li');
        li.className = 'chip';
        li.style.background = colorFor(index);
        li.innerHTML = '<span class="chip-label"></span>';
        li.querySelector('.chip-label').textContent = option;

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'chip-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove ' + option);
        remove.addEventListener('click', function () {
          draft.options.splice(index, 1);
          renderDraft();
        });
        li.appendChild(remove);
        list.appendChild(li);
      });

      if (count) count.textContent = draft.options.length + ' / ' + MAX_OPTIONS + ' options';
    }

    openModal({
      title: 'Edit session',
      body:
        '<div class="field">' +
        '  <label for="draftTitle">Title</label>' +
        '  <input type="text" id="draftTitle" maxlength="100" autocomplete="off">' +
        '</div>' +
        '<div class="field">' +
        '  <span class="label-text">Options</span>' +
        '  <ul class="chips chips-editable" id="draftOptionList"></ul>' +
        '  <div class="row-form" style="margin-top:12px">' +
        '    <label class="sr-only" for="draftOptionInput">Type an option</label>' +
        '    <input type="text" id="draftOptionInput" maxlength="80" autocomplete="off" placeholder="Type an option...">' +
        '    <button type="button" class="btn btn-secondary" id="draftAddBtn">Add option</button>' +
        '  </div>' +
        '  <p class="feedback" id="draftFeedback" role="status" aria-live="polite"></p>' +
        '  <span class="muted" id="draftCount"></span>' +
        '</div>',
      actions: [
        { label: 'Cancel', className: 'btn-secondary' },
        {
          label: 'Save changes', className: 'btn-primary', onClick: function () { return commit(); }
        }
      ],
      onOpen: function () {
        var fb = document.getElementById('draftFeedback');
        var titleInput = document.getElementById('draftTitle');
        var optionInput = document.getElementById('draftOptionInput');
        titleInput.value = draft.title;

        function tryAdd() {
          var text = optionInput.value.trim();
          if (!text) { feedback(fb, 'Type an option first.', 'error'); return; }
          if (draft.options.length >= MAX_OPTIONS) {
            feedback(fb, 'That is the limit — up to ' + MAX_OPTIONS + ' options.', 'error');
            return;
          }
          if (draft.options.some(function (o) { return o.toLowerCase() === text.toLowerCase(); })) {
            feedback(fb, '“' + text + '” is already on the list.', 'error');
            return;
          }
          draft.options.push(text);
          optionInput.value = '';
          feedback(fb, 'Added “' + text + '”.', 'ok');
          renderDraft();
        }

        document.getElementById('draftAddBtn').addEventListener('click', tryAdd);
        optionInput.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); tryAdd(); }
        });
        renderDraft();
      }
    });

    function commit() {
      var fb = document.getElementById('draftFeedback');
      var titleInput = document.getElementById('draftTitle');
      var title = titleInput ? titleInput.value.trim() : '';

      if (!title) {
        feedback(fb, 'Give the session a title.', 'error');
        if (titleInput) titleInput.focus();
        return false;
      }

      var current = findSession(id);
      if (!current) { closeModal(); return false; }

      var updated = {
        id: current.id,
        title: title.slice(0, 100),
        topic: current.topic,
        options: draft.options.slice(),
        history: current.history,
        latestWinner: current.latestWinner,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString()
      };
      var next = state.sessions.map(function (s) { return s.id === id ? updated : s; });
      if (!persistSessions(next)) return false;

      state.sessions = next;
      if (state.activeSessionId === id) {
        state.savedSnapshot = JSON.stringify({
          topic: updated.topic,
          options: updated.options,
          history: updated.history,
          latestWinner: updated.latestWinner
        });
        markSessionDirtyHint();
      }
      openSessionsModal();
      toast('Session updated.', 'success');
      return false;
    }
  }

  /* ================================================================
     Unsaved-changes guard
     ================================================================ */

  function guardUnsaved(next) {
    if (state.spinning) {
      toast('Hang on — the wheel is still spinning.', 'error');
      return;
    }
    if (!isDirty()) {
      next();
      return;
    }

    openModal({
      title: 'Unsaved changes',
      body: '<p>You have unsaved changes in this decision session.</p>' +
        '<p class="muted">Save them to this browser, discard them, or keep working.</p>',
      actions: [
        {
          label: 'Save changes', className: 'btn-primary',
          onClick: function () {
            if (saveSession()) { next(); return true; }
            return false;
          }
        },
        {
          label: 'Discard changes', className: 'btn-danger',
          onClick: function () { next(); return true; }
        },
        { label: 'Keep working', className: 'btn-secondary' }
      ]
    });
  }

  function resetWorkspace() {
    state.options = [];
    state.suggestions = [];
    state.topic = '';
    state.history = [];
    state.latestWinner = null;
    state.activeSessionId = null;
    state.savedSnapshot = null;
    state.rotation = 0;

    el.topicInput.value = '';
    el.optionInput.value = '';
    el.suggestionsArea.hidden = true;
    setFeedback(el.optionFeedback, 'Fresh start — add your options below.');
    setFeedback(el.suggestionNote, '');

    afterOptionsChange();
    renderResult();
    markSessionDirtyHint();
  }

  /* ================================================================
     Wiring
     ================================================================ */

  el.optionForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (addOption(el.optionInput.value)) {
      el.optionInput.value = '';
    }
    el.optionInput.focus();
  });

  el.clearOptionsBtn.addEventListener('click', clearOptions);

  el.topicForm.addEventListener('submit', function (event) {
    event.preventDefault();
    generateSuggestions();
  });

  el.addSelectedBtn.addEventListener('click', addSelectedSuggestions);

  el.regenerateBtn.addEventListener('click', function () {
    generateSuggestions();
  });

  el.spinBtn.addEventListener('click', spin);
  el.spinAgainBtn.addEventListener('click', spin);
  el.editOptionsBtn.addEventListener('click', openEditOptionsModal);
  el.saveSessionBtn.addEventListener('click', function () { saveSession(); });

  el.openSessionsBtn.addEventListener('click', function () {
    openSessionsModal();
  });

  el.newDecisionBtn.addEventListener('click', function () {
    guardUnsaved(resetWorkspace);
  });

  el.modalBody.addEventListener('click', onSessionsClick);

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderWheel, 100);
  });

  /* ================================================================
     Init
     ================================================================ */

  function init() {
    state.sessions = loadSessionsFromStorage();
    updateSessionCount();
    afterOptionsChange();
    renderResult();
    updateSpinControls();
    markSessionDirtyHint();

    if (!canPersist) {
      toast("This browser is blocking local storage — sessions won't survive a refresh.", 'error');
    }
  }

  init();
})();
