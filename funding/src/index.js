/* Sirius Reborn funding: takes Ko-fi and Patreon webhooks, serves the goals and the last backers.
 *
 *   GET  /funding                 public: { goals: [{ label, target, raised, currency, monthly }], backers: [{ name, source, at }] }
 *   POST /kofi                    Ko-fi webhook (form field "data", checked against KOFI_TOKEN)
 *   POST /patreon                 Patreon webhook (X-Patreon-Signature, HMAC-MD5 with PATREON_SECRET)
 *   GET  /admin                   goals and the last 100 payments            } Authorization: Bearer ADMIN_TOKEN
 *   PUT  /admin/goals             { goals: [...] }                           }
 *   POST /admin/donations         a payment by hand: { name, amount, currency }   (a stream tip, a transfer)
 *   POST /admin/donations/<id>    { hidden, void }
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const BACKERS = 10;
const NAME_MAX = 32;
// Ko-fi types that are support; shop orders and commissions are sales.
const KOFI_TYPES = new Set(['Donation', 'Subscription']);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (path === '/funding' && req.method === 'GET') return json(await funding(env), 200, { 'Cache-Control': 'public, max-age=30' });
      if (path === '/kofi' && req.method === 'POST') return await kofi(req, env);
      if (path === '/patreon' && req.method === 'POST') return await patreon(req, env);
      if (path.startsWith('/admin')) {
        if (!sameSecret(bearer(req), env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);
        if (path === '/admin' && req.method === 'GET') return json(await admin(env));
        if (path === '/admin/goals' && req.method === 'PUT') return json(await putGoals(env, await req.json()));
        if (path === '/admin/donations' && req.method === 'POST') return json(await addManual(env, await req.json()));
        const m = path.match(/^\/admin\/donations\/(.+)$/);
        if (m && req.method === 'POST') return json(await flag(env, decodeURIComponent(m[1]), await req.json()));
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      if (e instanceof BadRequest) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  },
};

// ------------------------------------------------------------------ public

async function funding(env) {
  const goals = await getGoals(env);
  const raised = await Promise.all(goals.map((g) => env.DB.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) AS c FROM donations WHERE void = 0 AND currency = ? AND at >= ?'
  ).bind(g.currency, goalStart(g)).first('c')));
  // Each person once, at their latest payment.
  const { results } = await env.DB.prepare(
    `SELECT name, source, MAX(at) AS at FROM donations WHERE void = 0 AND hidden = 0
     GROUP BY backer ORDER BY at DESC LIMIT ?`
  ).bind(BACKERS).all();
  return {
    goals: goals.map((g, i) => ({ label: g.label, target: g.target, raised: raised[i] / 100, currency: g.currency, monthly: g.monthly })),
    backers: results,
  };
}

// A monthly goal counts the current calendar month (UTC), the others everything since their date.
function goalStart(g) {
  if (!g.monthly) return g.since;
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// ----------------------------------------------------------------- webhooks

async function kofi(req, env) {
  let d;
  try { d = JSON.parse((await req.formData()).get('data')); } catch { throw new BadRequest('no data'); }
  if (!sameSecret(d.verification_token, env.KOFI_TOKEN)) return json({ error: 'unauthorized' }, 401);
  if (!KOFI_TYPES.has(d.type)) return json({ ok: true, ignored: d.type });
  const cents = Math.round(parseFloat(d.amount) * 100);
  if (!(cents > 0)) throw new BadRequest('bad amount');
  // Ko-fi's "make this private" box: counted, shown as Anonymous.
  const name = d.is_public === false ? '' : cleanName(d.from_name);
  await insert(env, {
    id: 'kofi:' + d.message_id,
    source: 'kofi',
    backer: name ? 'kofi:' + name.toLowerCase() : 'kofi:' + d.message_id,
    name: name || 'Anonymous',
    cents,
    currency: String(d.currency || '').toUpperCase(),
    at: isoOrNow(d.timestamp),
  });
  return json({ ok: true });
}

async function patreon(req, env) {
  const body = await req.text();
  const sig = createHmac('md5', env.PATREON_SECRET || '').update(body).digest('hex');
  if (!sameSecret(req.headers.get('X-Patreon-Signature'), sig)) return json({ error: 'unauthorized' }, 401);
  const doc = JSON.parse(body);
  const m = doc.data;
  if (!m || m.type !== 'member') return json({ ok: true, ignored: 'not a member' });
  const a = m.attributes || {};
  const lifetime = a.campaign_lifetime_support_cents;
  if (!Number.isInteger(lifetime)) return json({ ok: true, ignored: 'no lifetime total' });

  const prev = await env.DB.prepare('SELECT lifetime_cents FROM patreon_members WHERE member_id = ?').bind(m.id).first('lifetime_cents');
  const rise = lifetime - (prev || 0);
  const stmts = [env.DB.prepare(
    'INSERT INTO patreon_members (member_id, lifetime_cents) VALUES (?, ?) ON CONFLICT (member_id) DO UPDATE SET lifetime_cents = excluded.lifetime_cents'
  ).bind(m.id, lifetime)];
  if (rise > 0) {
    // Patreon names are account names, often real ones: the first name only.
    const name = cleanName(String(a.full_name || '').trim().split(/\s+/)[0]);
    stmts.push(insertStmt(env, {
      id: `patreon:${m.id}:${lifetime}`,
      source: 'patreon',
      backer: 'patreon:' + m.id,
      name: name || 'Anonymous',
      cents: rise,
      currency: env.PATREON_CURRENCY,
      at: isoOrNow(a.last_charge_date),
    }));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

// ------------------------------------------------------------------- admin

async function admin(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, source, name, amount_cents, currency, at, hidden, void FROM donations ORDER BY at DESC LIMIT 100'
  ).all();
  return { goals: await getGoals(env), donations: results };
}

async function getGoals(env) {
  const v = await env.DB.prepare("SELECT value FROM config WHERE key = 'goals'").first('value');
  return v ? JSON.parse(v) : [];
}

async function putGoals(env, body) {
  if (!Array.isArray(body.goals)) throw new BadRequest('goals must be a list');
  const goals = body.goals.map((g) => {
    const label = String(g.label || '').trim().slice(0, 120);
    const target = Number(g.target);
    const currency = String(g.currency || '').toUpperCase();
    const monthly = !!g.monthly;
    const since = monthly ? null : new Date(g.since || NaN);
    if (!label) throw new BadRequest('a goal needs a label');
    if (!(target > 0)) throw new BadRequest(`"${label}": the target must be above 0`);
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequest(`"${label}": currency is a 3-letter code like EUR`);
    if (since && isNaN(since)) throw new BadRequest(`"${label}": needs a start date or monthly`);
    return { label, target, currency, monthly, since: since && since.toISOString() };
  });
  await env.DB.prepare("INSERT INTO config (key, value) VALUES ('goals', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(goals)).run();
  return { goals };
}

async function addManual(env, body) {
  const name = cleanName(body.name) || 'Anonymous';
  const cents = Math.round(Number(body.amount) * 100);
  const currency = String(body.currency || '').toUpperCase();
  if (!(cents > 0)) throw new BadRequest('the amount must be above 0');
  if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequest('currency is a 3-letter code like EUR');
  const id = 'manual:' + crypto.randomUUID();
  await insert(env, { id, source: 'manual', backer: 'manual:' + name.toLowerCase(), name, cents, currency, at: isoOrNow(body.at) });
  return { ok: true, id };
}

async function flag(env, id, body) {
  const r = await env.DB.prepare('UPDATE donations SET hidden = COALESCE(?, hidden), void = COALESCE(?, void) WHERE id = ?')
    .bind(bit(body.hidden), bit(body.void), id).run();
  if (!r.meta.changes) throw new BadRequest('no such payment');
  return { ok: true };
}

// ----------------------------------------------------------------- helpers

function insertStmt(env, d) {
  return env.DB.prepare(
    'INSERT OR IGNORE INTO donations (id, source, backer, name, amount_cents, currency, at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(d.id, d.source, d.backer, d.name, d.cents, d.currency, d.at);
}
const insert = (env, d) => insertStmt(env, d).run();

// What a donor typed, as plain text: no control characters, collapsed spaces, short.
function cleanName(s) {
  return String(s || '').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function isoOrNow(t) {
  const d = new Date(t || NaN);
  return (isNaN(d) ? new Date() : d).toISOString();
}

function bit(v) { return v === undefined || v === null ? null : v ? 1 : 0; }

function bearer(req) {
  const h = req.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// Constant-time compare; an unset secret never matches.
function sameSecret(given, secret) {
  if (!secret || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

class BadRequest extends Error {}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...headers } });
}
