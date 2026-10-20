/* Sirius Reborn CMS.
 *
 * A static page that edits the site's content files through the GitHub REST
 * API with a fine-grained personal access token. Every save re-reads the file
 * first and applies just that change, so two editors don't overwrite each other.
 */
(function () {
  'use strict';

  var API = 'https://api.github.com';
  var STORE = 'sr-cms';
  var NEWS = 'content/news.json';
  var SETTINGS = 'content/settings.json';
  var esc = SR.escapeHtml;

  var app = document.getElementById('app');
  var cfg = null;          // { owner, repo, branch, token }
  var dirty = false;
  var blobs = {};          // repo path -> object URL, for images not yet live on Pages

  // --------------------------------------------------------------- storage
  function loadCfg() {
    var raw = localStorage.getItem(STORE) || sessionStorage.getItem(STORE);
    try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveCfg(c, remember) {
    localStorage.removeItem(STORE); sessionStorage.removeItem(STORE);
    (remember ? localStorage : sessionStorage).setItem(STORE, JSON.stringify(c));
  }

  // ---------------------------------------------------------------- GitHub
  function gh(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.message || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  function repoPath(path) {
    return '/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
  }

  function b64encodeText(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decodeText(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // -> { text, sha } (files over 1 MB come back without content; use the blob API)
  function getFile(path) {
    return gh(repoPath(path) + '?ref=' + encodeURIComponent(cfg.branch)).then(function (f) {
      if (f.content || !f.size) return { text: f.content ? b64decodeText(f.content) : '', sha: f.sha };
      return gh('/repos/' + cfg.owner + '/' + cfg.repo + '/git/blobs/' + f.sha).then(function (b) {
        return { text: b64decodeText(b.content), sha: f.sha };
      });
    });
  }

  function putFile(path, contentB64, message, sha) {
    return gh(repoPath(path), {
      method: 'PUT',
      body: { message: message, content: contentB64, branch: cfg.branch, sha: sha || undefined }
    });
  }

  // Read latest, apply `mutate(text) -> newText`, write; retry once on a race.
  function updateFile(path, mutate, message, attempt) {
    return getFile(path).catch(function (e) {
      if (e.status === 404) return { text: null, sha: null };
      throw e;
    }).then(function (f) {
      var next = mutate(f.text);
      return putFile(path, b64encodeText(next), message, f.sha);
    }).catch(function (e) {
      if ((e.status === 409 || e.status === 422) && !attempt) return updateFile(path, mutate, message, 1);
      throw e;
    });
  }

  function updateJson(path, mutate, message) {
    return updateFile(path, function (text) {
      var data = text ? JSON.parse(text) : {};
      return JSON.stringify(mutate(data) || data, null, 2) + '\n';
    }, message);
  }

  function getJson(path) {
    return getFile(path).then(function (f) { return JSON.parse(f.text || '{}'); });
  }

  // ------------------------------------------------------------------ UI bits
  var toastTimer;
  function toast(msg, kind) {
    var t = document.getElementById('toast');
    t.innerHTML = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, kind === 'error' ? 9000 : 6000);
  }

  function published(what) {
    toast(esc(what) + ' published. The live site updates in about a minute. <a href="' + esc(siteUrl()) + '" target="_blank" rel="noopener">View site ↗</a>');
  }

  function failed(e) {
    console.error(e);
    var msg = e.status === 401 ? 'Your token was rejected. Sign in again.'
      : e.status === 403 || e.status === 404 ? 'GitHub refused the request (' + esc(e.message) + '). Check that the token has Contents: read and write on this repository.'
      : esc(e.message || String(e));
    toast('Couldn’t save: ' + msg, 'error');
  }

  function mount(id) {
    app.innerHTML = '';
    app.appendChild(document.getElementById(id).content.cloneNode(true));
    return app;
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Saving…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  function siteUrl() {
    if (location.hostname.endsWith('github.io') || location.protocol === 'http:') return new URL('../', location.href).href;
    return (window.CMS_CONFIG && CMS_CONFIG.siteUrl) || '../';
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Image src fix-ups for previews: relative paths are relative to the site
  // root (one level up), and fresh uploads aren't on Pages yet.
  function previewSrc(path) {
    return blobs[path] || SR.resolveUrl(path, '../');
  }
  function renderPreview(md, el) {
    el.innerHTML = SR.renderMarkdown(md, '../');
    el.querySelectorAll('img').forEach(function (img) {
      var rel = (img.getAttribute('src') || '').replace(/^\.\.\//, '');
      if (blobs[rel]) img.src = blobs[rel];
    });
  }

  // -------------------------------------------------------- image uploads
  var fileInput = document.getElementById('file-input');
  function pickImage() {
    return new Promise(function (resolve) {
      fileInput.value = '';
      fileInput.onchange = function () { resolve(fileInput.files[0] || null); };
      fileInput.click();
    });
  }

  // Downscale big photos to 1920px JPEG; keep small PNG/GIF/WebP as-is.
  function prepareImage(file) {
    return new Promise(function (resolve, reject) {
      var keep = /gif|svg/.test(file.type) || (file.size < 600 * 1024 && /png|webp|jpeg/.test(file.type));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1920, w = img.naturalWidth, h = img.naturalHeight;
        if (keep && w <= max && h <= max) return resolve({ blob: file, ext: (file.name.split('.').pop() || 'png').toLowerCase(), url: url });
        var s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { resolve({ blob: b, ext: 'jpg', url: URL.createObjectURL(b) }); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { reject(new Error('That file isn’t an image the browser can read.')); };
      img.src = url;
    });
  }

  function blobToB64(blob) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.readAsDataURL(blob);
    });
  }

  function uploadImage() {
    return pickImage().then(function (file) {
      if (!file) return null;
      toast('Uploading ' + esc(file.name) + '…');
      return prepareImage(file).then(function (p) {
        var base = SR.slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 40);
        var path = 'images/uploads/' + today() + '-' + base + '-' + Date.now().toString(36) + '.' + p.ext;
        return blobToB64(p.blob).then(function (b64) {
          return putFile(path, b64, 'Upload image ' + path.split('/').pop());
        }).then(function () {
          blobs[path] = p.url;
          toast('Image uploaded.');
          return path;
        });
      });
    }).catch(function (e) { failed(e); return null; });
  }

  // ------------------------------------------------------ markdown toolbar
  function surround(ta, before, after, placeholder) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var sel = v.slice(s, e) || placeholder || '';
    ta.setRangeText(before + sel + after, s, e, 'end');
    if (!v.slice(s, e) && placeholder) {
      ta.selectionStart = s + before.length;
      ta.selectionEnd = s + before.length + sel.length;
    }
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function linePrefix(ta, prefix) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var ls = v.lastIndexOf('\n', s - 1) + 1;
    var block = v.slice(ls, e).split('\n').map(function (l) { return prefix + l; }).join('\n');
    ta.setRangeText(block, ls, e, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function insertBlock(ta, text) {
    var s = ta.selectionStart, v = ta.value;
    var pre = s > 0 && v[s - 1] !== '\n' ? '\n\n' : (s > 1 && v[s - 2] !== '\n' ? '\n' : '');
    ta.setRangeText(pre + text + '\n', s, ta.selectionEnd, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wireToolbar(root, ta) {
    function act(kind) {
      switch (kind) {
        case 'bold': return surround(ta, '**', '**', 'bold text');
        case 'italic': return surround(ta, '*', '*', 'italic text');
        case 'h2': return linePrefix(ta, '## ');
        case 'h3': return linePrefix(ta, '### ');
        case 'ul': return linePrefix(ta, '- ');
        case 'quote': return linePrefix(ta, '> ');
        case 'link':
          var url = prompt('Link address', 'https://');
          if (url) surround(ta, '[', '](' + url + ')', 'link text');
          return;
        case 'video':
          var v = prompt('YouTube link');
          var m = v && /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(v);
          if (v && !m) return toast('That doesn’t look like a YouTube link.', 'error');
          if (m) insertBlock(ta, '<iframe src="https://www.youtube-nocookie.com/embed/' + m[1] + '" allowfullscreen></iframe>');
          return;
        case 'image':
          var pos = ta.selectionStart;
          return uploadImage().then(function (path) {
            if (!path) return;
            ta.selectionStart = ta.selectionEnd = pos;
            insertBlock(ta, '![](' + path + ')');
          });
      }
    }
    root.querySelectorAll('[data-md]').forEach(function (b) {
      b.addEventListener('click', function () { act(b.getAttribute('data-md')); });
    });
    ta.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); act('bold'); }
      else if (k === 'i') { e.preventDefault(); act('italic'); }
      else if (k === 'k') { e.preventDefault(); act('link'); }
    });
  }

  function trackDirty(form) {
    dirty = false;
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); form.requestSubmit(); }
    });
  }

  addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------------ views
  function viewLogin(error) {
    document.getElementById('tabs').hidden = true;
    document.getElementById('who').hidden = true;
    mount('tpl-login');
    var f = document.getElementById('login-form');
    var d = cfg || window.CMS_CONFIG || {};
    f.owner.value = d.owner || ''; f.repo.value = d.repo || ''; f.branch.value = d.branch || 'main';
    if (error) { var el = document.getElementById('login-error'); el.textContent = error; el.hidden = false; }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button[type=submit]');
      cfg = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim(), token: f.token.value.trim() };
      if (!/^(github_pat_|gh[pousr]_)/.test(cfg.token)) {
        var bad = document.getElementById('login-error');
        bad.textContent = 'That isn’t a GitHub token. Tokens start with github_pat_ (or ghp_ for classic ones). ' +
          'The name you gave the token on GitHub is only a label: paste the long value GitHub showed you once, right after generating it.';
        bad.hidden = false;
        return;
      }
      busy(btn, true, 'Checking…');
      verify().then(function () {
        saveCfg(cfg, f.remember.checked);
        if (location.hash === '#/news') route(); else location.hash = '#/news';
      }).catch(function (err) {
        busy(btn, false);
        var el = document.getElementById('login-error');
        el.textContent = err.message; el.hidden = false;
      });
    });
  }

  function verify() {
    return gh('/repos/' + cfg.owner + '/' + cfg.repo).then(function (r) {
      if (r.permissions && !r.permissions.push) throw new Error('This token can read the repository but not write to it.');
      document.getElementById('repo-label').textContent = cfg.owner + '/' + cfg.repo + ' · ' + cfg.branch;
      document.getElementById('site-link').href = siteUrl();
      document.getElementById('tabs').hidden = false;
      document.getElementById('who').hidden = false;
    }).catch(function (e) {
      if (e.status === 401) throw new Error('GitHub rejected that token. It may be mistyped, expired or revoked: generate a new one and paste its full value.');
      if (e.status === 404) throw new Error('Repository not found, or the token has no access to it.');
      throw e;
    });
  }

  // News list -------------------------------------------------------------
  function viewNews() {
    mount('tpl-news');
    var list = document.getElementById('post-list');
    list.innerHTML = '<li class="muted">Loading…</li>';
    getJson(NEWS).then(function (d) {
      var posts = SR.sortPosts(d.posts || []);
      if (!posts.length) { list.innerHTML = '<li class="muted">No posts yet.</li>'; return; }
      list.innerHTML = posts.map(function (p) {
        return '<li>' +
          '<span class="mini-thumb">' + (p.image ? '<img src="' + esc(previewSrc(p.image)) + '" alt="">' : '') + '</span>' +
          '<a class="post-link" href="#/news/edit/' + encodeURIComponent(p.slug) + '">' +
            '<b>' + esc(p.title) + '</b>' +
            '<small>' + esc(SR.formatDate(p.date)) + (p.tag ? ' · ' + esc(p.tag) : '') + '</small></a>' +
          (p.draft ? '<span class="badge">Draft</span>' : '') +
          '<span class="row-actions">' +
            '<a class="btn small" href="#/news/edit/' + encodeURIComponent(p.slug) + '">Edit</a>' +
            '<button class="btn small danger" data-delete="' + esc(p.slug) + '">Delete</button>' +
          '</span></li>';
      }).join('');
      list.querySelectorAll('[data-delete]').forEach(function (b) {
        b.addEventListener('click', function () {
          var slug = b.getAttribute('data-delete');
          var p = posts.filter(function (x) { return x.slug === slug; })[0];
          deletePost(p, b).then(function (ok) { if (ok) viewNews(); });
        });
      });
    }).catch(function (e) { list.innerHTML = '<li class="error">' + esc(e.message) + '</li>'; });
  }

  function deletePost(p, btn) {
    if (!confirm('Delete “' + p.title + '”? This removes it from the site.')) return Promise.resolve(false);
    busy(btn, true, 'Deleting…');
    return updateJson(NEWS, function (d) {
      d.posts = (d.posts || []).filter(function (x) { return x.slug !== p.slug; });
    }, 'Delete news post: ' + p.title).then(function () {
      dirty = false;
      published('Deletion');
      return true;
    }).catch(function (e) { busy(btn, false); failed(e); return false; });
  }

  // Post editor -----------------------------------------------------------
  function viewPost(slug) {
    mount('tpl-post');
    var f = document.getElementById('post-form');
    var preview = document.getElementById('preview');
    var pic = document.getElementById('thumb-pic');
    var count = document.getElementById('excerpt-count');
    var original = null;
    var slugTouched = !!slug;
    f.querySelectorAll('input, textarea, button').forEach(function (el) { el.disabled = true; });

    getJson(NEWS).then(function (d) {
      var posts = d.posts || [];
      document.getElementById('tag-list').innerHTML = Array.from(new Set(posts.map(function (p) { return p.tag; }).filter(Boolean)))
        .map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');
      if (slug) {
        original = posts.filter(function (p) { return p.slug === slug; })[0];
        if (!original) { toast('That post no longer exists.', 'error'); location.hash = '#/news'; return; }
      }
      var p = original || { date: today(), showImage: true };
      f.title.value = p.title || '';
      f.slug.value = p.slug || '';
      f.date.value = p.date || today();
      f.tag.value = p.tag || '';
      f.image.value = p.image || '';
      f.showImage.checked = p.showImage !== false;
      f.excerpt.value = p.excerpt || '';
      f.body.value = p.body || '';
      f.draft.checked = !!p.draft;
      document.getElementById('editor-title').textContent = original ? 'Edit post' : 'New post';
      document.getElementById('save-post').textContent = original ? 'Save changes' : 'Publish';
      document.getElementById('delete-post').hidden = !original;
      f.querySelectorAll('input, textarea, button').forEach(function (el) { el.disabled = false; });
      refresh();
      trackDirty(f);
      (original ? f.body : f.title).focus();
    }).catch(function (e) { failed(e); });

    function refresh() {
      renderPreview(f.body.value || '*Nothing written yet.*', preview);
      pic.src = f.image.value ? previewSrc(f.image.value.trim()) : '';
      pic.style.visibility = f.image.value ? '' : 'hidden';
      count.textContent = f.excerpt.value.length + ' / 400 (about 200 fits three lines)';
    }

    f.addEventListener('input', function (e) {
      if (e.target === f.slug) slugTouched = true;
      if (e.target === f.title && !slugTouched) f.slug.value = SR.slugify(f.title.value);
      refresh();
    });
    wireToolbar(f, f.body);
    f.querySelector('[data-upload=image]').addEventListener('click', function () {
      uploadImage().then(function (path) { if (path) { f.image.value = path; dirty = true; refresh(); } });
    });
    document.getElementById('delete-post').addEventListener('click', function (e) {
      deletePost(original, e.target).then(function (ok) { if (ok) location.hash = '#/news'; });
    });

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = document.getElementById('save-post');
      var post = {
        slug: SR.slugify(f.slug.value),
        title: f.title.value.trim(),
        date: f.date.value,
        tag: f.tag.value.trim(),
        image: f.image.value.trim(),
        showImage: f.showImage.checked,
        excerpt: f.excerpt.value.trim(),
        body: f.body.value.replace(/\s+$/, '') + '\n',
        draft: f.draft.checked
      };
      var oldSlug = original && original.slug;
      busy(btn, true);
      updateJson(NEWS, function (d) {
        var posts = d.posts || (d.posts = []);
        var taken = posts.some(function (p) { return p.slug === post.slug && p.slug !== oldSlug; });
        if (taken) {
          var n = 2;
          while (posts.some(function (p) { return p.slug === post.slug + '-' + n; })) n++;
          post.slug += '-' + n;
        }
        var i = oldSlug ? posts.findIndex(function (p) { return p.slug === oldSlug; }) : -1;
        if (i >= 0) posts[i] = post; else posts.push(post);
        d.posts = SR.sortPosts(posts);
      }, (original ? 'Update' : 'Publish') + ' news post: ' + post.title).then(function () {
        dirty = false;
        published(post.draft ? 'Draft' : 'Post');
        location.hash = '#/news';
      }).catch(function (err) { busy(btn, false); failed(err); });
    });
  }

  // Pages -----------------------------------------------------------------
  function viewPages() {
    mount('tpl-pages');
    document.getElementById('page-list').innerHTML = SR.PAGES.map(function (name) {
      return '<li><a class="post-link" href="#/pages/' + name + '"><b>' + name[0].toUpperCase() + name.slice(1) + '</b>' +
        '<small>content/pages/' + name + '.md</small></a>' +
        '<span class="row-actions"><a class="btn small" href="#/pages/' + name + '">Edit</a></span></li>';
    }).join('');
  }

  function viewPage(name) {
    if (SR.PAGES.indexOf(name) < 0) { location.hash = '#/pages'; return; }
    mount('tpl-page');
    var f = document.getElementById('page-form');
    var preview = document.getElementById('preview');
    var path = 'content/pages/' + name + '.md';
    document.getElementById('page-heading').textContent = name[0].toUpperCase() + name.slice(1) + ' page';
    getFile(path).then(function (file) {
      var fm = SR.parseFrontMatter(file.text);
      f.title.value = fm.meta.title || '';
      f.subtitle.value = fm.meta.subtitle || '';
      f.body.value = fm.body.replace(/^\s+/, '');
      refresh();
      trackDirty(f);
    }).catch(failed);
    function refresh() { renderPreview(f.body.value, preview); }
    f.addEventListener('input', refresh);
    wireToolbar(f, f.body);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button[type=submit]');
      var text = SR.stringifyFrontMatter({ title: f.title.value.trim(), subtitle: f.subtitle.value.trim() }, f.body.value.replace(/\s+$/, '') + '\n');
      busy(btn, true);
      updateFile(path, function () { return text; }, 'Update ' + name + ' page').then(function () {
        dirty = false;
        busy(btn, false);
        published('Page');
      }).catch(function (err) { busy(btn, false); failed(err); });
    });
  }

  // Wiki ------------------------------------------------------------------
  // content/wiki/<kind>.json comes from the game repo's wiki update PRs; the CMS edits only summary, body and hidden.
  function wikiPath(kind) { return 'content/wiki/' + kind + '.json'; }

  function viewWiki() {
    mount('tpl-wiki');
    var box = document.getElementById('wiki-lists');
    box.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all(SR.WIKI_KINDS.map(function (k) {
      return getJson(wikiPath(k.key)).catch(function (e) { if (e.status === 404) return {}; throw e; });
    })).then(function (all) {
      var html = SR.WIKI_KINDS.map(function (k, i) {
        var entries = all[i].entries || [];
        if (!entries.length) return '';
        return '<h2 class="list-head">' + esc(k.title) + '</h2><ul class="post-list">' + entries.map(function (e) {
          var href = '#/wiki/' + k.key + '/' + encodeURIComponent(e.id);
          return '<li>' +
            '<span class="mini-thumb wide">' + (e.images && e.images[0] ? '<img src="' + esc(previewSrc(e.images[0])) + '" alt="">' : '') + '</span>' +
            '<a class="post-link" href="' + href + '"><b>' + esc(e.name) + '</b>' +
              '<small>' + esc(e.subtitle || k.one) + ' · updated ' + esc(SR.formatDate(e.updated)) + '</small></a>' +
            (e.hidden ? '<span class="badge">Hidden</span>' : '') +
            (!e.summary && !e.body ? '<span class="badge quiet">No text yet</span>' : '') +
            '<span class="row-actions"><a class="btn small" href="' + href + '">Edit</a></span></li>';
        }).join('') + '</ul>';
      }).join('');
      box.innerHTML = html || '<p class="muted">No entries yet. The first wiki update from the game repo fills this in.</p>';
    }).catch(function (e) { box.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; });
  }

  // What the game repo wrote, read-only: images, stats (og = from the original game) and the original description.
  function wikiAutoHtml(e) {
    var og = function (on) { return on ? ' ' + SR.ogIcon() : ''; };
    return (e.images && e.images.length ? '<div class="wiki-images">' + e.images.map(function (src) {
        return '<img src="' + esc(previewSrc(src)) + '" alt="">';
      }).join('') + '</div>' : '') +
      ((e.stats || []).length ? '<table class="wiki-stats"><tbody>' + e.stats.map(function (r) {
        return '<tr><th>' + esc(r.label) + '</th><td>' + esc(r.value) + og(r.og) + '</td></tr>';
      }).join('') + '</tbody></table>' : '') +
      (e.description ? '<p class="wiki-desc">' + esc(e.description).replace(/\n+/g, '<br>') + og(true) + '</p>' : '') +
      '<p class="muted small">' + SR.ogIcon() + ' ' + esc(SR.OG_TITLE) + '. These come from the game repo and change with its updates.</p>';
  }

  function viewWikiEntry(kind, id) {
    if (!SR.WIKI_KINDS.some(function (k) { return k.key === kind; })) { location.hash = '#/wiki'; return; }
    mount('tpl-wiki-entry');
    var f = document.getElementById('wiki-form');
    var preview = document.getElementById('preview');
    var name = id;
    f.querySelectorAll('input, textarea, button').forEach(function (el) { el.disabled = true; });
    document.getElementById('wiki-view').href = siteUrl() + '#/wiki/' + kind + '/' + encodeURIComponent(id);
    getJson(wikiPath(kind)).then(function (d) {
      var e = (d.entries || []).filter(function (x) { return x.id === id; })[0];
      if (!e) { toast('That entry no longer exists.', 'error'); location.hash = '#/wiki'; return; }
      name = e.name;
      document.getElementById('wiki-heading').textContent = e.name;
      document.getElementById('wiki-auto').innerHTML = wikiAutoHtml(e);
      f.summary.value = e.summary || '';
      f.body.value = e.body || '';
      f.elements.hide.checked = !!e.hidden;
      f.querySelectorAll('input, textarea, button').forEach(function (el) { el.disabled = false; });
      refresh();
      trackDirty(f);
    }).catch(failed);
    function refresh() { renderPreview(f.body.value || '*No text yet.*', preview); }
    f.addEventListener('input', refresh);
    wireToolbar(f, f.body);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = f.querySelector('button[type=submit]');
      busy(btn, true);
      updateJson(wikiPath(kind), function (d) {
        var e = (d.entries || []).filter(function (x) { return x.id === id; })[0];
        if (!e) throw new Error('That entry is gone from the wiki (a game update removed or renamed it).');
        e.summary = f.summary.value.trim();
        e.body = f.body.value.trim() ? f.body.value.replace(/\s+$/, '') + '\n' : '';
        e.hidden = f.elements.hide.checked;
      }, 'Wiki: update text of ' + name).then(function () {
        dirty = false;
        busy(btn, false);
        published('Wiki text');
      }).catch(function (err) { busy(btn, false); failed(err); });
    });
  }

  // Settings --------------------------------------------------------------
  function get(o, path) { return path.split('.').reduce(function (x, k) { return x == null ? x : x[k]; }, o); }
  function set(o, path, v) {
    var keys = path.split('.'), last = keys.pop();
    keys.reduce(function (x, k) { return x[k] || (x[k] = {}); }, o)[last] = v;
  }

  function viewSettings() {
    mount('tpl-settings');
    var f = document.getElementById('settings-form');
    var out = document.getElementById('pct-out');
    var fields = Array.from(f.querySelectorAll('[name]'));
    fields.forEach(function (el) { el.disabled = true; });
    getJson(SETTINGS).then(function (s) {
      fields.forEach(function (el) {
        var v = get(s, el.name);
        el.value = v == null ? '' : v;
        el.disabled = false;
      });
      out.textContent = f['status.percent'].value + '%';
      trackDirty(f);
    }).catch(failed);
    f['status.percent'].addEventListener('input', function () { out.textContent = this.value + '%'; });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button[type=submit]');
      busy(btn, true);
      updateJson(SETTINGS, function (s) {
        fields.forEach(function (el) {
          set(s, el.name, el.type === 'range' ? Number(el.value) : el.value.trim());
        });
      }, 'Update site settings').then(function () {
        dirty = false;
        busy(btn, false);
        published('Settings');
      }).catch(function (err) { busy(btn, false); failed(err); });
    });
  }

  // ----------------------------------------------------------------- router
  var lastHash = location.hash;
  function route() {
    if (!cfg || !cfg.token) return viewLogin();
    var parts = (location.hash || '#/').slice(2).split('/').filter(Boolean).map(decodeURIComponent);
    document.querySelectorAll('#tabs a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-tab') === (parts[0] || 'news'));
    });
    if (parts[0] === 'pages') return parts[1] ? viewPage(parts[1]) : viewPages();
    if (parts[0] === 'settings') return viewSettings();
    if (parts[0] === 'wiki') return parts[2] ? viewWikiEntry(parts[1], parts[2]) : viewWiki();
    if (parts[0] === 'news' && parts[1] === 'new') return viewPost(null);
    if (parts[0] === 'news' && parts[1] === 'edit' && parts[2]) return viewPost(parts[2]);
    return viewNews();
  }

  addEventListener('hashchange', function () {
    if (dirty && !confirm('You have unsaved changes. Leave anyway?')) {
      history.replaceState(null, '', lastHash);
      return;
    }
    dirty = false;
    lastHash = location.hash;
    route();
  });

  document.getElementById('signout').addEventListener('click', function () {
    if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    dirty = false;
    localStorage.removeItem(STORE); sessionStorage.removeItem(STORE);
    cfg = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch };
    viewLogin();
  });

  cfg = loadCfg();
  if (cfg && cfg.token) {
    verify().then(route).catch(function (e) { viewLogin(e.message); });
  } else {
    viewLogin();
  }
})();
