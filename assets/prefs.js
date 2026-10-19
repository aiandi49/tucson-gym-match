/* Shared text-size selector and theme toggle.
   Stored in localStorage as pref-theme and pref-font-size (wrapped in try/catch).
   The inline script in <head> applies saved values before first paint. */
(function () {
  'use strict';
  var root = document.documentElement;
  var SIZES = ['sm', 'md', 'lg', 'xl'];
  var SIZE_NAMES = { sm: 'small', md: 'medium', lg: 'large', xl: 'extra large' };

  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  function syncSizeButtons() {
    var current = root.getAttribute('data-font-size') || 'sm';
    var buttons = document.querySelectorAll('[data-size-btn]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var size = b.getAttribute('data-size-btn');
      var on = size === current;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', 'Text size ' + SIZE_NAMES[size] + (on ? ' (selected)' : ''));
    }
  }

  function syncThemeButton() {
    var theme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var isDark = theme === 'dark';
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    var label = btn.querySelector('.theme-label');
    if (label) label.textContent = isDark ? 'Dark' : 'Light';
  }

  document.addEventListener('click', function (event) {
    var sizeBtn = event.target.closest('[data-size-btn]');
    if (sizeBtn) {
      var size = sizeBtn.getAttribute('data-size-btn');
      if (SIZES.indexOf(size) !== -1) {
        root.setAttribute('data-font-size', size);
        save('pref-font-size', size);
        syncSizeButtons();
        document.dispatchEvent(new CustomEvent('prefs:change'));
      }
      return;
    }
    var themeBtn = event.target.closest('#theme-toggle');
    if (themeBtn) {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      save('pref-theme', next);
      syncThemeButton();
      document.dispatchEvent(new CustomEvent('prefs:change'));
    }
  });

  syncSizeButtons();
  syncThemeButton();
})();
