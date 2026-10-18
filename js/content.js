/* Content helpers shared by the site (js/site.js) and the CMS (admin/admin.js).
 *
 * Content lives in the repo as plain files:
 *   content/news.json      { "posts": [ {slug, title, date, tag, image, excerpt, body, draft} ] }
 *   content/settings.json  build badge, project status, community links, footer text
 *   content/pages/*.md     Support / Gallery / About / Download, with a small front matter block
 */
(function (global) {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  var PAGES = ['support', 'gallery', 'about', 'download'];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function slugify(s) {
    return String(s || '').toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'post';
  }

  // "2024-05-24" -> { month: "May", day: "24", year: "2024" } without timezone drift.
  function dateParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return { month: '', day: '', year: '' };
    return { month: MONTHS[+m[2] - 1], day: m[3], year: m[1] };
  }

  function formatDate(iso) {
    var p = dateParts(iso);
    return p.year ? p.month + ' ' + p.day + ', ' + p.year : '';
  }

  // Minimal front matter: "key: value" lines between --- fences.
  function parseFrontMatter(text) {
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text || '');
    var meta = {};
    if (!m) return { meta: meta, body: text || '' };
    m[1].split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
    });
    return { meta: meta, body: text.slice(m[0].length) };
  }

  function stringifyFrontMatter(meta, body) {
    var lines = Object.keys(meta).map(function (k) {
      var v = String(meta[k] == null ? '' : meta[k]).replace(/\r?\n/g, ' ');
      return k + ': ' + (/^[\s"]|[:#]|\s$/.test(v) ? JSON.stringify(v) : v);
    });
    return '---\n' + lines.join('\n') + '\n---\n\n' + String(body || '').replace(/^\s+/, '');
  }

  var purifyReady = false;
  function setupPurify() {
    if (purifyReady || !global.DOMPurify) return;
    purifyReady = true;
    // Allow video embeds from YouTube / Vimeo only.
    DOMPurify.addHook('uponSanitizeElement', function (node, data) {
      if (data.tagName === 'iframe') {
        var src = node.getAttribute('src') || '';
        if (!/^https:\/\/(www\.)?(youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(src)) {
          node.parentNode && node.parentNode.removeChild(node);
        }
      }
    });
    DOMPurify.addHook('afterSanitizeAttributes', function (node) {
      if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') || '')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener');
      }
    });
  }

  // Markdown -> sanitised HTML. `base` is prefixed to relative URLs (the CMS
  // previews from /admin/, so it passes "../").
  function renderMarkdown(md, base) {
    setupPurify();
    var html = global.marked ? marked.parse(md || '', { gfm: true, breaks: false }) : escapeHtml(md);
    html = global.DOMPurify
      ? DOMPurify.sanitize(html, { ADD_TAGS: ['iframe'], ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'target'] })
      : html;
    if (base) {
      html = html.replace(/(<(?:img|a|video|source)\b[^>]*?\s(?:src|href)=")(?![a-z]+:|\/|#)([^"]+)"/gi, '$1' + base + '$2"');
    }
    return html;
  }

  function resolveUrl(path, base) {
    if (!path) return '';
    return /^([a-z]+:|\/|data:)/i.test(path) ? path : (base || '') + path;
  }

  function sortPosts(posts) {
    return posts.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || (a.title || '').localeCompare(b.title || '');
    });
  }

  global.SR = {
    PAGES: PAGES,
    escapeHtml: escapeHtml,
    slugify: slugify,
    dateParts: dateParts,
    formatDate: formatDate,
    parseFrontMatter: parseFrontMatter,
    stringifyFrontMatter: stringifyFrontMatter,
    renderMarkdown: renderMarkdown,
    resolveUrl: resolveUrl,
    sortPosts: sortPosts
  };
})(window);
