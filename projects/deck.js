// Shared slide deck: arrow keys / buttons / swipe, slide number kept in the URL hash.
(function () {
  var slides = [].slice.call(document.querySelectorAll('.slide'));
  var n = slides.length, cur = 0;
  var prev = document.getElementById('prev'), next = document.getElementById('next');
  var count = document.getElementById('count'), bar = document.querySelector('.progress span');

  slides.forEach(function (s, i) {
    s.setAttribute('role', 'group');
    s.setAttribute('aria-roledescription', 'slide');
    s.setAttribute('aria-label', (i + 1) + ' of ' + n);
  });

  function show(i, focus) {
    cur = Math.max(0, Math.min(n - 1, i));
    slides.forEach(function (s, k) { s.hidden = k !== cur; });
    count.textContent = String(cur + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0');
    bar.style.width = ((cur + 1) / n * 100) + '%';
    prev.disabled = cur === 0;
    next.disabled = cur === n - 1;
    if (location.hash !== '#' + (cur + 1)) history.replaceState(null, '', '#' + (cur + 1));
    if (focus) { var h = slides[cur].querySelector('h1,h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
    slides[cur].scrollTop = 0;
  }

  prev.addEventListener('click', function () { show(cur - 1, true); });
  next.addEventListener('click', function () { show(cur + 1, true); });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (t.closest && t.closest('input,select,textarea,button,[role=slider]') && e.key === ' ') return;
    if (t.closest && t.closest('input,select,textarea,[role=slider]')) return;
    var k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); show(cur + 1, true); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); show(cur - 1, true); }
    else if (k === 'Home') { e.preventDefault(); show(0, true); }
    else if (k === 'End') { e.preventDefault(); show(n - 1, true); }
  });

  var x0 = null, y0 = null;
  document.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && !e.target.closest('.scroll-x,input')) show(cur + (dx < 0 ? 1 : -1), false);
    x0 = null;
  });

  window.addEventListener('hashchange', function () { show((parseInt(location.hash.slice(1), 10) || 1) - 1, false); });
  show((parseInt(location.hash.slice(1), 10) || 1) - 1, false);
})();
