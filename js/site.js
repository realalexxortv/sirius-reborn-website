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
      // "#/wiki" and other links into this site open in place
      if (url && url[0] === '#') a.removeAttribute('target'); else a.target = '_blank';
      if (url) { a.href = url; a.removeAttribute('aria-disabled'); a.title = ''; }
      else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.title = 'Coming soon'; }
    });
  }

  // --------------------------------------------------------------- funding
  // The funding worker (funding/, settings funding.api): the goals and the last backers. No API or no answer: nothing shown.
  function loadFunding() {
    var api = get(state.settings, 'funding.api');
    if (!api) return Promise.resolve(null);
    return getJSON(api.replace(/\/+$/, '') + '/funding').catch(function (e) { console.error(e); return null; });
  }

  function money(v, cur) {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: cur, minimumFractionDigits: v % 1 ? 2 : 0 }).format(v);
    } catch (e) { return v + ' ' + cur; }
  }

  function goalHtml(g) {
    var pct = Math.min(100, 100 * g.raised / g.target);
    return '<div class="fund-goal">' +
      '<div class="fund-head"><h3>' + esc(g.label) + '</h3>' +
        '<span class="fund-sum"><b>' + esc(money(g.raised, g.currency)) + '</b> of ' + esc(money(g.target, g.currency)) +
        (g.monthly ? ' this month' : '') + '</span></div>' +
      '<div class="fund-bar" role="progressbar" aria-label="' + esc(g.label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '">' +
        '<i style="width:' + pct + '%"></i></div></div>';
  }

  var SOURCES = { kofi: 'Ko-fi', patreon: 'Patreon', manual: '' };
  function fundingHtml(f) {
    var d = function (iso) { var p = SR.dateParts(iso); return p.month + ' ' + p.day; };
    return '<section class="funding">' + f.goals.map(goalHtml).join('') +
      '<div class="fund-backers"><h3>The Crew</h3>' +
      '<p class="fund-invite">Join the crew and your name goes up here, next to everyone keeping Sirius online.' +
        (f.backers.length ? '' : ' Nobody here yet: be the first.') + '</p>' +
      (f.backers.length ? '<ol>' + f.backers.map(function (b) {
        var via = SOURCES[b.source];
        return '<li><b>' + esc(b.name) + '</b><small>' + (via ? esc(via) + ' \u00b7 ' : '') + esc(d(b.at)) + '</small></li>';
      }).join('') + '</ol>' : '') +
      '</div></section>';
  }

  // Above the timeline: the first goal, one line, to the Donate page.
  function fundingStripHtml(f) {
    var g = f && f.goals[0];
    if (!g) return '';
    var pct = Math.min(100, 100 * g.raised / g.target);
    return '<a class="fund-strip" href="#/donate"><span>' + esc(g.label) + '</span>' +
      '<span class="fund-bar"><i style="width:' + pct + '%"></i></span>' +
      '<b>' + esc(money(g.raised, g.currency)) + ' / ' + esc(money(g.target, g.currency)) + '</b></a>';
  }

  // ------------------------------------------------------------ renderers
  function setHead(title, sub, docTitle) {
    titleEl.textContent = title;
    subEl.textContent = sub || '';
    subEl.parentNode.style.visibility = sub ? '' : 'hidden';
    document.title = (docTitle ? docTitle + ' | ' : '') + 'Sirius Reborn | Reimagining of the 2003 Classic';
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
    return Promise.all([loadPosts(), loadFunding()]).then(function (r) {
      var posts = r[0];
      var end = (state.settings && state.settings.timelineFooter) || '';
      view.innerHTML = fundingStripHtml(r[1]) + (posts.length
        ? '<div class="timeline">' + posts.map(entryHtml).join('') + '</div>' +
          (end ? '<p class="timeline-end">' + esc(end) + '</p>' : '')
        : '<p class="empty">No news yet. Stay tuned.</p>');
    });
  }

  // Discussion happens on the community Discord rather than in on-site comments.
  function discussHtml() {
    var url = get(state.settings, 'links.discord');
    if (!url) return '';
    return '<aside class="discuss">' +
      '<p>Thoughts on this update? Join the conversation with the community.</p>' +
      '<a class="discuss-btn" href="' + esc(url) + '" target="_blank" rel="noopener">' +
        '<img src="assets/ui/hub-discord.png" alt="" width="40" height="40">Discuss on Discord</a>' +
    '</aside>';
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
        discussHtml() +
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
    return Promise.all([load, name === 'donate' ? loadFunding() : null]).then(function (r) {
      var fm = SR.parseFrontMatter(r[0]);
      setHead(fm.meta.title || name, fm.meta.subtitle || '', fm.meta.title || name);
      view.innerHTML = '<div class="page page-' + name + '">' + (r[1] ? fundingHtml(r[1]) : '') +
        '<div class="md">' + SR.renderMarkdown(fm.body) + '</div></div>';
      if (name === 'gallery') return renderGalleryShots(view.querySelector('.page'));
    });
  }

  // The gallery's in-game shots: every image of the wiki's ships and stations, so each wiki update adds its new shots.
  var GALLERY_KINDS = ['ships', 'stations'];
  function renderGalleryShots(page) {
    return Promise.all(GALLERY_KINDS.map(loadWiki)).then(function (lists) {
      page.insertAdjacentHTML('beforeend', GALLERY_KINDS.map(function (key, i) {
        var k = wikiKind(key);
        var shots = lists[i].map(function (e) {
          return (e.images || []).map(function (src) {
            return '<figure class="gallery-shot"><a href="' + esc(src) + '" target="_blank" rel="noopener">' +
              '<img src="' + esc(src) + '" alt="' + esc(e.name) + '" loading="lazy"></a>' +
              '<figcaption><a href="#/wiki/' + key + '/' + encodeURIComponent(e.id) + '">' + esc(e.name) + '</a></figcaption></figure>';
          }).join('');
        }).join('');
        return shots ? '<section class="wiki-section"><h2><a href="#/wiki/' + key + '">' + esc(k.title) + '</a></h2>' +
          '<div class="gallery-grid">' + shots + '</div></section>' : '';
      }).join(''));
    });
  }

  // --------------------------------------------------------------- roadmap
  // content/roadmap.json, written by the game repo's release update: the phase under way, its areas and in each the
  // issues labelled public (open or done). Drawn as a route: one waypoint per area, its ring the area's share done.
  function renderRoadmap() {
    return getJSON('content/roadmap.json').then(function (r) {
      setHead('Roadmap', r.phase + ' \u00b7 ' + r.percent + '% Complete', 'Roadmap');
      var stops = (r.areas || []).map(function (a) {
        var done = a.items.filter(function (i) { return i.done; }).length;
        var pct = Math.round(100 * done / a.items.length);
        return '<section class="rm-stop">' +
          '<div class="rm-ring" role="img" aria-label="' + pct + '% done"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22"/>' +
          '<circle class="rm-ring-fill" cx="26" cy="26" r="22" pathLength="100" stroke-dasharray="' + pct + ' 100"/></svg>' +
          '<span>' + pct + '%</span></div>' +
          '<div class="rm-stop-head"><h2>' + esc(a.name) + '</h2><span class="rm-count">' + done + ' of ' + a.items.length + ' done</span></div>' +
          '<ul class="rm-chips">' + a.items.map(function (i) {
            return '<li class="rm-chip' + (i.done ? ' done' : '') + '">' + esc(i.title) + (i.done ? '<span class="sr"> (done)</span>' : '') + '</li>';
          }).join('') + '</ul></section>';
      }).join('');
      view.innerHTML = '<div class="rm">' +
        '<div class="rm-intro"><p>What is left before ' + esc(r.phase) + ', area by area: the bigger items only, bug fixes are in the ' +
          '<a href="#/">patch notes</a>. It is updated with every release.</p>' +
          '<p class="rm-legend"><span><i class="o"></i>Planned</span><span><i class="d"></i>Done</span></p></div>' +
        (stops ? '<div class="rm-route">' + stops + '</div>' : '<p class="empty">The roadmap is being written. Stay tuned.</p>') +
        '<p class="rm-meta">As of ' + esc(r.release) + ' \u00b7 ' + esc(SR.formatDate(r.date)) + '</p></div>';
    });
  }

  // ------------------------------------------------------------------ wiki
  // content/wiki/<kind>.json, filled by the game repo's wiki update PRs. Values marked og come from the original game's
  // data and get SR.ogIcon(); summary and body are our own text from the CMS.
  var wikiCache = {};
  function loadWiki(kind) {
    return wikiCache[kind] || (wikiCache[kind] = getJSON('content/wiki/' + kind + '.json').then(function (d) {
      return (d.entries || []).filter(function (e) { return !e.hidden; });
    }, function () { return []; }));
  }

  function wikiKind(key) { return SR.WIKI_KINDS.filter(function (k) { return k.key === key; })[0]; }

  function wikiCardHtml(kind, e) {
    var img = e.images && e.images[0];
    return '<a class="wiki-card" href="#/wiki/' + kind + '/' + encodeURIComponent(e.id) + '">' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="wiki-noimg"></span>') +
      '<b>' + esc(e.name) + '</b>' + (e.subtitle ? '<small>' + esc(e.subtitle) + '</small>' : '') + '</a>';
  }

  function ogLegendHtml() {
    return '<p class="og-legend">' + SR.ogIcon() + '<span>' + esc(SR.OG_TITLE) + '</span></p>';
  }

  function renderWiki(kindKey) {
    var kinds = kindKey ? [wikiKind(kindKey)] : SR.WIKI_KINDS;
    if (!kinds[0]) return Promise.resolve(renderNotFound());
    if (kindKey) setHead(kinds[0].title, 'Sirius Wiki', kinds[0].title + ' | Wiki');
    else setHead('Sirius Wiki', 'Reimagined, Piece by Piece', 'Wiki');
    return Promise.all(kinds.map(function (k) { return loadWiki(k.key); })).then(function (lists) {
      var html = kinds.map(function (k, i) {
        if (!lists[i].length) return '';
        var head = kindKey ? '' : '<h2><a href="#/wiki/' + k.key + '">' + esc(k.title) + '</a></h2>';
        return '<section class="wiki-section">' + head +
          '<div class="wiki-grid">' + lists[i].map(function (e) { return wikiCardHtml(k.key, e); }).join('') + '</div></section>';
      }).join('');
      view.innerHTML = '<div class="wiki">' +
        (kindKey ? '<a class="more back" href="#/wiki">Wiki</a>'
          : '<p class="wiki-intro">Every ship, system, station and weapon rebuilt for Sirius Reborn so far. New ones show up here as they make it into the game.</p>') +
        (html || '<p class="empty">Nothing here yet. Stay tuned.</p>') + '</div>';
    });
  }

  function ogValue(row) { return esc(row.value) + (row.og ? ' ' + SR.ogIcon() : ''); }

  function wikiTableHtml(t) {
    return '<div class="wiki-table-wrap"><table class="wiki-table">' +
      '<caption>' + esc(t.title) + (t.og ? ' ' + SR.ogIcon() : '') + '</caption>' +
      '<thead><tr>' + t.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + t.rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderWikiEntry(kindKey, id) {
    var k = wikiKind(kindKey);
    if (!k) return Promise.resolve(renderNotFound());
    return loadWiki(k.key).then(function (list) {
      var e = list.filter(function (x) { return x.id === id; })[0];
      if (!e) return renderNotFound();
      setHead(e.name, e.subtitle || k.one, e.name + ' | Wiki');
      var imgs = e.images || [];
      var stats = e.stats || [];
      var desc = String(e.description || '').split(/\n+/).filter(Boolean);
      view.innerHTML = '<article class="wiki-entry">' +
        '<a class="more back" href="#/wiki/' + k.key + '">' + esc(k.title) + '</a>' +
        (imgs.length ? '<figure class="wiki-hero"><a href="' + esc(imgs[0]) + '" target="_blank" rel="noopener">' +
          '<img src="' + esc(imgs[0]) + '" alt="' + esc(e.name) + '"></a></figure>' : '') +
        (imgs.length > 1 ? '<div class="wiki-thumbs">' + imgs.map(function (src, i) {
          return '<button type="button" data-src="' + esc(src) + '"' + (i ? '' : ' aria-current="true"') + '>' +
            '<img src="' + esc(src) + '" alt=""></button>';
        }).join('') + '</div>' : '') +
        (e.summary ? '<p class="wiki-summary">' + esc(e.summary) + '</p>' : '') +
        (e.body ? '<div class="md">' + SR.renderMarkdown(e.body) + '</div>' : '') +
        (stats.length ? '<table class="wiki-stats"><tbody>' + stats.map(function (r) {
          return '<tr><th>' + esc(r.label) + '</th><td>' + ogValue(r) + '</td></tr>';
        }).join('') + '</tbody></table>' : '') +
        (e.tables || []).map(wikiTableHtml).join('') +
        (desc.length ? '<section class="wiki-og-text"><h3>From the original game ' + SR.ogIcon() + '</h3>' +
          desc.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</section>' : '') +
        ogLegendHtml() +
        '<p class="wiki-meta">Added ' + esc(SR.formatDate(e.added)) +
          (e.updated && e.updated !== e.added ? ' · Updated ' + esc(SR.formatDate(e.updated)) : '') + '</p>' +
      '</article>';
      var hero = view.querySelector('.wiki-hero');
      view.querySelectorAll('.wiki-thumbs button').forEach(function (b) {
        b.addEventListener('click', function () {
          hero.querySelector('img').src = hero.querySelector('a').href = b.getAttribute('data-src');
          view.querySelectorAll('.wiki-thumbs button').forEach(function (x) { x.removeAttribute('aria-current'); });
          b.setAttribute('aria-current', 'true');
        });
      });
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
    if (parts[0] === 'support') parts[0] = 'donate';   // the page's old name, for old links
    var navKey = 'home', job;

    if (!parts.length) job = renderTimeline();
    else if (parts[0] === 'news' && parts[1]) job = renderPost(parts[1]);
    else if (parts[0] === 'roadmap') { navKey = 'roadmap'; job = renderRoadmap(); }
    else if (parts[0] === 'wiki') { navKey = 'wiki'; job = parts[2] ? renderWikiEntry(parts[1], parts[2]) : renderWiki(parts[1]); }
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
