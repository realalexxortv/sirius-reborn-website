/* Sirius Reborn site: hash router + renderers for the news panel. */
(function () {
  'use strict';

  var esc = SR.escapeHtml;
  var view = document.getElementById('view');
  var titleEl = document.getElementById('panel-title');
  var subEl = document.getElementById('panel-sub');
  var root = document.documentElement;

  var state = { settings: null, posts: null };

  // ---------------------------------------------------------------- layout
  // The footer panels are the mockup's 1712px strip scaled to the column
  // width; the page reserves the footer's height at the bottom.
  var footerInner = document.querySelector('.footer-inner');
  var footer = document.querySelector('.site-footer');
  function fit() {
    var compact = root.clientWidth < 900;
    root.classList.toggle('compact', compact);
    if (!compact) root.style.setProperty('--fz', footerInner.clientWidth / 1712);
    root.style.setProperty('--footer-h', (compact ? 0 : footer.offsetHeight) + 'px');
    sizeSubtitle();
  }
  addEventListener('resize', fit);

  // Subtitle rules span the width of the heading, as in the mockup.
  function sizeSubtitle() {
    if (root.classList.contains('compact')) return;
    var w = titleEl.offsetWidth;
    titleEl.parentNode.style.setProperty('--title-w', Math.max(w, 380) + 'px');
  }

  // ---------------------------------------------------------------- data
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return r.json();
    });
  }

  function loadSettings() {
    return getJSON('content/settings.json').then(function (s) {
      state.settings = s;
      applySettings(s);
    });
  }

  function loadPosts() {
    if (state.posts) return Promise.resolve(state.posts);
    return getJSON('content/news.json').then(function (d) {
      state.posts = SR.sortPosts((d.posts || []).filter(function (p) { return !p.draft; }));
      return state.posts;
    });
  }

  function get(obj, path) {
    return path.split('.').reduce(function (o, k) { return o && o[k]; }, obj);
  }

  function applySettings(s) {
    document.querySelectorAll('[data-setting]').forEach(function (el) {
      var v = get(s, el.getAttribute('data-setting'));
      if (v != null) el.textContent = String(v).replace('{year}', new Date().getFullYear());
    });
    var pct = Math.max(0, Math.min(100, +get(s, 'status.percent') || 0));
    document.getElementById('status-pct').textContent = Math.round(pct);
    requestAnimationFrame(function () {
      document.querySelector('.ring-fill').style.strokeDasharray = pct + ' 100';
    });
    document.querySelectorAll('[data-link]').forEach(function (a) {
      var url = get(s, 'links.' + a.getAttribute('data-link'));
      if (url) { a.href = url; a.removeAttribute('aria-disabled'); a.title = ''; }
      else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.title = 'Coming soon'; }
    });
  }

  // ------------------------------------------------------------ renderers
  function setHead(title, sub, docTitle) {
    titleEl.textContent = title;
    subEl.textContent = sub || '';
    subEl.parentNode.style.visibility = sub ? '' : 'hidden';
    document.title = (docTitle ? docTitle + ' | ' : '') + 'Sirius Reborn | Remake of the 2003 Classic';
    sizeSubtitle();
  }

  function entryHtml(p) {
    var d = SR.dateParts(p.date);
    var href = '#/news/' + encodeURIComponent(p.slug);
    var img = p.image
      ? '<img class="pic" src="' + esc(p.image) + '" alt="" loading="lazy">'
      : '<span class="pic"></span>';
    return '<article class="entry">' +
      '<img class="dot" src="assets/ui/timeline-dot.png" alt="">' +
      '<time class="date" datetime="' + esc(p.date) + '">' + esc(d.month) + ' ' + esc(d.day) + ', ' + esc(d.year) + '</time>' +
      '<a class="thumb" href="' + href + '" tabindex="-1" aria-hidden="true">' + img +
        '<img class="ring" src="assets/ui/thumb-ring.png" alt=""></a>' +
      '<div class="text">' +
        '<h2><a href="' + href + '">' + esc(p.title) + '</a></h2>' +
        '<p class="excerpt">' + esc(p.excerpt) + '</p>' +
        '<div class="meta">' + (p.tag ? '<span class="tag">' + esc(p.tag) + '</span>' : '<span></span>') +
          '<a class="more" href="' + href + '">Read more</a></div>' +
      '</div></article>';
  }

  function renderTimeline() {
    setHead('Development News Timeline', 'The Journey to Rebirth');
    return loadPosts().then(function (posts) {
      var end = (state.settings && state.settings.timelineFooter) || '';
      view.innerHTML = posts.length
        ? '<div class="timeline">' + posts.map(entryHtml).join('') + '</div>' +
          (end ? '<p class="timeline-end">' + esc(end) + '</p>' : '')
        : '<p class="empty">No news yet. Stay tuned.</p>';
    });
  }

  function renderPost(slug) {
    return loadPosts().then(function (posts) {
      var p = posts.filter(function (x) { return x.slug === slug; })[0];
      if (!p) return renderNotFound();
      setHead('Development News', p.tag || 'The Journey to Rebirth', p.title);
      view.innerHTML = '<article class="post">' +
        '<a class="more back" href="#/">Back to timeline</a>' +
        '<div class="post-meta"><time datetime="' + esc(p.date) + '">' + esc(SR.formatDate(p.date)) + '</time>' +
          (p.tag ? '<span class="tag">' + esc(p.tag) + '</span>' : '') + '</div>' +
        '<h2 class="post-title">' + esc(p.title) + '</h2>' +
        (p.image && p.showImage !== false ? '<figure class="post-hero" hidden><img src="' + esc(p.image) + '" alt=""></figure>' : '') +
        '<div class="md">' + SR.renderMarkdown(p.body || p.excerpt || '') + '</div>' +
      '</article>';
      // Timeline thumbnails are often small; only show a hero image when it's big enough.
      var hero = view.querySelector('.post-hero');
      if (hero) hero.querySelector('img').onload = function () { if (this.naturalWidth >= 480) hero.hidden = false; };
    });
  }

  var pageCache = {};
  function renderPage(name) {
    var load = pageCache[name] || (pageCache[name] = fetch('content/pages/' + name + '.md', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }));
    return load.then(function (text) {
      var fm = SR.parseFrontMatter(text);
      setHead(fm.meta.title || name, fm.meta.subtitle || '', fm.meta.title || name);
      view.innerHTML = '<div class="page page-' + name + '"><div class="md">' + SR.renderMarkdown(fm.body) + '</div></div>';
    });
  }

  function renderNotFound() {
    setHead('Lost in Space', 'Signal not found', 'Not found');
    view.innerHTML = '<p class="empty">Nothing at these coordinates. <a class="more" href="#/">Back to the timeline</a></p>';
  }

  // --------------------------------------------------------------- router
  function route() {
    var path = decodeURIComponent((location.hash || '#/').slice(1)).replace(/\/+$/, '') || '/';
    var parts = path.split('/').filter(Boolean);
    var navKey = 'home', job;

    if (!parts.length) job = renderTimeline();
    else if (parts[0] === 'news' && parts[1]) job = renderPost(parts[1]);
    else if (SR.PAGES.indexOf(parts[0]) >= 0) { navKey = parts[0]; job = renderPage(parts[0]); }
    else job = Promise.resolve(renderNotFound());

    document.querySelectorAll('.nav-btn').forEach(function (a) {
      var on = a.getAttribute('data-route') === navKey;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    job.catch(function (err) {
      console.error(err);
      view.innerHTML = '<p class="error">Transmission failed: ' + esc(err.message) + '</p>';
    });
    scrollTo(0, 0);
  }

  addEventListener('hashchange', route);
  fit();
  if (document.fonts) document.fonts.ready.then(sizeSubtitle);
  loadSettings().catch(function (e) { console.error(e); }).then(route);
})();
