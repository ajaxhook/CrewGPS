const express = require('express');
const router = express.Router();
const RADIUS_METERS = 120;
const HARD_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS     = 10 * 60 * 1000;
const CACHE_SNAP_DECIMALS = 5;
const PER_TRY_TIMEOUT_MS = 8_000;
const HEDGE_DELAY_MS      = 400;
const MIRROR_COOLDOWN_MS  = 45_000;

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];

function metersBetween(a, b) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371000;
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lng - a.lng);
  const s = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parseMaxspeed(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return /mph/i.test(raw) ? Math.round(val * 1.60934) : Math.round(val);
}

function inferDefaultFromTags(tags = {}) {
  const hw = tags.highway || '';
  const zone = (tags['zone:maxspeed'] || '').toUpperCase();
  const mtype = (tags['maxspeed:type'] || '').toUpperCase();
  const motorroad = String(tags.motorroad || '').toLowerCase() === 'yes';

  if (zone.includes('PT:30')) return 30;
  if (zone.includes('PT:URBAN')) return 50;

  if (mtype.includes('PT:URBAN')) return 50;
  if (mtype.includes('PT:RURAL')) return motorroad || hw === 'trunk' ? 100 : 90;
  if (mtype.includes('PT:MOTORWAY')) return 120;

  if (hw === 'motorway' || hw === 'motorway_link') return 120;
  if (motorroad || hw === 'trunk' || hw === 'trunk_link') return 100;
  if (hw === 'residential' || hw === 'living_street') return 50;

  if (['primary','secondary','tertiary','unclassified','service'].includes(hw)) {
    if (hw === 'service') return 50;
    return 90;
  }
  return null;
}

function snapKey(lat, lng) {
  return `${lat.toFixed(CACHE_SNAP_DECIMALS)},${lng.toFixed(CACHE_SNAP_DECIMALS)}`;
}

const CACHE = new Map();
const INFLIGHT = new Map();

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { CACHE.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value, ttl = CACHE_TTL_MS) {
  CACHE.set(key, { value, exp: Date.now() + ttl });
}

const MIRROR_STATE = new Map(
  OVERPASS_MIRRORS.map(url => [url, { cooldownUntil: 0 }])
);

function mirrorAvailable(url) {
  const st = MIRROR_STATE.get(url);
  return !st || Date.now() > st.cooldownUntil;
}
function putOnCooldown(url, ms = MIRROR_COOLDOWN_MS) {
  const st = MIRROR_STATE.get(url) || {};
  st.cooldownUntil = Date.now() + ms;
  MIRROR_STATE.set(url, st);
}
async function fetchWithTimeout(url, opts = {}, timeoutMs = PER_TRY_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function overpassOnce(url, body) {
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ data: body })
    },
    PER_TRY_TIMEOUT_MS
  );

  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) putOnCooldown(url);
    throw new Error(`Overpass ${url} HTTP ${res.status}`);
  }

  try {
    return await res.json();
  } catch {
    const txt = await res.text();
    return JSON.parse(txt);
  }
}

async function hedgedOverpass(body) {
  const candidates = OVERPASS_MIRRORS.filter(mirrorAvailable);
  if (candidates.length === 0) {
    candidates.push(...OVERPASS_MIRRORS);
  }

  const attempts = candidates.map((url, i) =>
    new Promise((resolve, reject) => {
      const delay = i === 0 ? 0 : HEDGE_DELAY_MS * i;
      setTimeout(async () => {
        try {
          const startedAt = Date.now();
          const json = await overpassOnce(url, body);
          resolve({ url, json, ms: Date.now() - startedAt });
        } catch (e) {
          putOnCooldown(url);
          reject(e);
        }
      }, delay);
    })
  );

  const first = await Promise.any(attempts);
  return first.json;
}
async function getOSMSpeedLimit(lat, lng, radiusMeters = RADIUS_METERS) {
  const qWithMax = `
    [out:json][timeout:7];
    way(around:${radiusMeters},${lat},${lng})[highway][~"^maxspeed$"~".*"];
    out tags center 30;
  `.trim();

  try {
    const j1 = await hedgedOverpass(qWithMax);
    if (Array.isArray(j1?.elements) && j1.elements.length) {
      let best = null, bestDist = Infinity;
      for (const el of j1.elements) {
        const s = parseMaxspeed(el.tags?.maxspeed);
        if (s == null) continue;
        const c = el.center || { lat: el.lat, lon: el.lon };
        const dist = metersBetween({ lat, lng }, { lat: c.lat, lng: c.lon });
        if (dist < bestDist) { bestDist = dist; best = s; }
      }
      if (best != null) return best;
    }
  } catch {

  }

  const qNearest = `
    [out:json][timeout:7];
    way(around:${radiusMeters},${lat},${lng})[highway];
    out tags center 50;
  `.trim();

  try {
    const j2 = await hedgedOverpass(qNearest);
    if (Array.isArray(j2?.elements) && j2.elements.length) {
      let bestEl = null, bestDist = Infinity;
      for (const el of j2.elements) {
        const c = el.center || { lat: el.lat, lon: el.lon };
        const dist = metersBetween({ lat, lng }, { lat: c.lat, lng: c.lon });
        if (dist < bestDist) { bestDist = dist; bestEl = el; }
      }
      if (bestEl) {
        const parsed = parseMaxspeed(bestEl.tags?.maxspeed);
        if (parsed != null) return parsed;
        const inferred = inferDefaultFromTags(bestEl.tags || {});
        if (inferred != null) return inferred;
      }
    }
  } catch {
  }

  return null;
}

router.get('/_ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

router.get('/speed-limit', async (req, res) => {
  let finished = false;
  const safeEnd = (status, body) => {
    if (finished) return;
    finished = true;
    try { res.status(status).json(body); }
    catch { try { res.end(); } catch {} }
  };

  const hardTimer = setTimeout(() => {
    safeEnd(200, { speedLimitKmH: null, timeout: true });
  }, HARD_TIMEOUT_MS);

  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      clearTimeout(hardTimer);
      return safeEnd(400, { msg: 'lat/lng inválidos', speedLimitKmH: null });
    }

    if (String(process.env.ROADSLIMIT_MODE).toLowerCase() === 'stub') {
      clearTimeout(hardTimer);
      return safeEnd(200, { speedLimitKmH: 50, stub: true });
    }

    const key = snapKey(lat, lng);
    const cached = cacheGet(key);
    if (cached !== null && cached !== undefined) {
      clearTimeout(hardTimer);
      return safeEnd(200, { speedLimitKmH: cached, cache: true });
    }

    if (INFLIGHT.has(key)) {
      const value = await INFLIGHT.get(key).catch(() => null);
      clearTimeout(hardTimer);
      return safeEnd(200, { speedLimitKmH: value });
    }

    const p = (async () => {
      const limit = await getOSMSpeedLimit(lat, lng, RADIUS_METERS).catch(() => null);
      cacheSet(key, limit, CACHE_TTL_MS);
      return limit;
    })();

    INFLIGHT.set(key, p);
    const value = await p.finally(() => INFLIGHT.delete(key));

    clearTimeout(hardTimer);
    return safeEnd(200, { speedLimitKmH: value });
  } catch (e) {
    clearTimeout(hardTimer);
    return safeEnd(200, { speedLimitKmH: null, error: true });
  }
});

module.exports = router;
