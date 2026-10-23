// Vitrine — servidor local, sem dependências (Node 18+).
// 1) serve o site   2) recebe o login da Riot em http://localhost/redirect   3) guarda os tokens só na memória
// 4) faz a ponte com a API da loja.   Rodar:  node server.js  (ou dois cliques no Vitrine.exe)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const { exec } = require("node:child_process");

// A Riot devolve o login do client "riot-client" sempre para http://localhost/redirect (porta 80).
// Por isso o Vitrine tenta a porta 80 primeiro. Se ela estiver ocupada, usa a 5173 e o login vira "copiar e colar".
const PORTS = process.env.PORT ? [Number(process.env.PORT)] : [80, 5173];
const HOST = process.env.HOST || "127.0.0.1"; // só o seu PC acessa
const PUBLIC = path.join(__dirname, "public");
const LANG = "pt-BR";
const LOGIN_URL = "https://auth.riotgames.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%2Fredirect&client_id=riot-client&response_type=token%20id_token&nonce=1&scope=openid%20link%20ban%20lol_region%20account";
let activePort = null;

// Dentro do Vitrine.exe os arquivos do site vêm embutidos; rodando com node, vêm da pasta public/.
let sea = null;
try { sea = require("node:sea"); if (!sea.isSea()) sea = null; } catch { sea = null; }

const CUR = { vp: "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741", rad: "e59aa87c-4cbf-517a-5983-6e81511be9b7", kc: "85ca954a-41f2-ce94-9b45-8ca3dd39a00d" };
const SKIN_LEVEL_TYPE = "e7c63390-eda7-46e0-bb7a-a6abdacd2433";
const SHARD = { na: "na", latam: "na", br: "na", pbe: "pbe", eu: "eu", ap: "ap", kr: "kr" };
const PLATFORM = Buffer.from(JSON.stringify({ platformType: "PC", platformOS: "Windows", platformOSVersion: "10.0.19042.1.256.64bit", platformChipset: "Unknown" })).toString("base64");

const sessions = new Map(); // id do cookie → { access, ent, puuid, region, shard, name, tag, exp }

/* ---------------- utilitários ---------------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) { const e = new HttpError(res.status, body.message || body.error || `HTTP ${res.status}`); e.body = body; throw e; }
  return body;
}

function send(req, res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff", ...extra };
  if (buf.length > 1024 && /gzip/.test(req.headers["accept-encoding"] || "") && /json|text|javascript|css|svg/.test(type)) {
    buf = zlib.gzipSync(buf); headers["Content-Encoding"] = "gzip"; headers["Vary"] = "Accept-Encoding";
  }
  headers["Content-Length"] = buf.length;
  res.writeHead(status, headers); res.end(buf);
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let s = ""; req.on("data", (c) => { s += c; if (s.length > 64e3) { fail(new HttpError(413, "Requisição grande demais.")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new HttpError(400, "JSON inválido.")); } });
  });
}

const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)).filter((p) => p[0]));

function sessionOf(req) {
  const s = sessions.get(cookies(req).vs);
  if (!s) throw new HttpError(401, "Não conectado.");
  if (Date.now() > s.exp) { sessions.delete(cookies(req).vs); throw new HttpError(401, "Sua sessão da Riot expirou. Faça o login de novo."); }
  return s;
}

/* ---------------- catálogo (valorant-api.com), enxuto e em cache ---------------- */
let catalogCache = null, catalogAt = 0, versionCache = null;
const bundleCache = new Map();

async function clientVersion() {
  if (!versionCache || Date.now() - versionCache.at > 3.6e6) {
    const v = await getJSON("https://valorant-api.com/v1/version");
    versionCache = { value: v.data.riotClientVersion, at: Date.now() };
  }
  return versionCache.value;
}

async function catalog() {
  if (catalogCache && Date.now() - catalogAt < 6 * 3.6e6) return catalogCache;
  const [weapons, tiers] = await Promise.all([
    getJSON(`https://valorant-api.com/v1/weapons?language=${LANG}`),
    getJSON(`https://valorant-api.com/v1/contenttiers?language=${LANG}`),
  ]);
  const out = { tiers: {}, weapons: [], skins: [] };
  for (const t of tiers.data) out.tiers[t.uuid] = { name: t.devName, color: "#" + String(t.highlightColor || "8a94a3").slice(0, 6), rank: (t.rank ?? 0) + 1 };
  weapons.data.forEach((w, wi) => {
    out.weapons.push({
      id: w.uuid, name: w.displayName, cat: String(w.category || "").split("::").pop(),
      icon: w.displayIcon, def: w.defaultSkinUuid, cost: w.shopData?.cost ?? 0,
    });
    for (const s of w.skins || []) {
      if (/random|aleat/i.test(s.displayName)) continue;
      out.skins.push({
        id: s.uuid, n: s.displayName, w: wi, t: s.contentTierUuid,
        i: s.levels?.[0]?.displayIcon || s.displayIcon || s.chromas?.[0]?.fullRender || null,
        l: (s.levels || []).map((l) => l.uuid),
        c: (s.chromas || []).map((c) => ({ id: c.uuid, n: c.displayName, i: c.fullRender || c.displayIcon, s: c.swatch })),
      });
    }
  });
  catalogCache = out; catalogAt = Date.now();
  return out;
}

async function bundleInfo(id) {
  if (!id) return {};
  if (!bundleCache.has(id)) {
    try { const b = await getJSON(`https://valorant-api.com/v1/bundles/${id}?language=${LANG}`); bundleCache.set(id, { name: b.data.displayName, image: b.data.displayIcon }); }
    catch { bundleCache.set(id, {}); }
  }
  return bundleCache.get(id);
}

/* ---------------- Riot ---------------- */
function parseTokens(url) {
  const raw = String(url || "").trim();
  const part = raw.includes("#") ? raw.split("#")[1] : raw.split("?")[1] || raw;
  const p = new URLSearchParams(part);
  const access = p.get("access_token");
  if (!access) throw new HttpError(400, "Não achei o access_token nessa URL. Copie o endereço inteiro da página depois do login.");
  return { access, idToken: p.get("id_token"), expiresIn: Number(p.get("expires_in")) || 3600 };
}

async function connect({ url, region }) {
  const { access, idToken, expiresIn } = parseTokens(url);
  const auth = { Authorization: `Bearer ${access}` };
  let ent, info;
  try {
    [ent, info] = await Promise.all([
      getJSON("https://entitlements.auth.riotgames.com/api/token/v1", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}" }),
      getJSON("https://auth.riotgames.com/userinfo", { headers: auth }),
    ]);
  } catch (e) {
    throw new HttpError(401, e.status === 401 || e.status === 403 ? "A Riot recusou o token. Ele pode ter expirado: faça o login de novo e cole a URL nova." : `Falha ao falar com a Riot (${e.message}).`);
  }
  let reg = region && region !== "auto" ? region : null;
  if (!reg && idToken) {
    try {
      const geo = await getJSON("https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant", { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ id_token: idToken }) });
      reg = geo.affinities?.live;
    } catch { /* cai no padrão abaixo */ }
  }
  reg = SHARD[reg] ? reg : "br";
  const s = {
    access, ent: ent.entitlements_token, puuid: info.sub, region: reg, shard: SHARD[reg],
    name: info.acct?.game_name || "Jogador", tag: info.acct?.tag_line || "",
    exp: Date.now() + (expiresIn - 60) * 1000,
  };
  const id = crypto.randomBytes(24).toString("hex");
  sessions.set(id, s);
  return { id, s };
}

async function pd(s, pathname, opts = {}) {
  const headers = {
    Authorization: `Bearer ${s.access}`, "X-Riot-Entitlements-JWT": s.ent,
    "X-Riot-ClientPlatform": PLATFORM, "X-Riot-ClientVersion": await clientVersion(),
    "Content-Type": "application/json", ...opts.headers,
  };
  try { return await getJSON(`https://pd.${s.shard}.a.pvp.net${pathname}`, { ...opts, headers }); }
  catch (e) {
    if (e.status === 400 || e.status === 401) throw new HttpError(401, "Sua sessão da Riot expirou. Faça o login de novo.");
    throw e;
  }
}

const vp = (cost) => (cost ? cost[CUR.vp] ?? null : null);

async function storefront(s) {
  let sf;
  try { sf = await pd(s, `/store/v3/storefront/${s.puuid}`, { method: "POST", body: "{}" }); }
  catch (e) { if (e.status === 401) throw e; sf = await pd(s, `/store/v2/storefront/${s.puuid}`); } // reserva: v2

  const panel = sf.SkinsPanelLayout || {};
  let offers = (panel.SingleItemStoreOffers || []).map((o) => ({ item: o.Rewards?.[0]?.ItemID || o.OfferID, cost: vp(o.Cost) }));
  if (!offers.length && panel.SingleItemOffers) offers = panel.SingleItemOffers.map((id) => ({ item: id, cost: null }));

  const rawBundles = sf.FeaturedBundle?.Bundles || (sf.FeaturedBundle?.Bundle ? [sf.FeaturedBundle.Bundle] : []);
  const bundles = await Promise.all(rawBundles.map(async (b) => {
    const items = b.Items?.length
      ? b.Items.map((i) => ({ item: i.Item?.ItemID, type: i.Item?.ItemTypeID, cost: i.DiscountedPrice ?? i.BasePrice ?? null }))
      : (b.ItemOffers || []).map((i) => ({ item: i.Offer?.Rewards?.[0]?.ItemID, type: i.Offer?.Rewards?.[0]?.ItemTypeID, cost: vp(i.DiscountedCost) ?? vp(i.Offer?.Cost) }));
    return {
      id: b.DataAssetID, ...(await bundleInfo(b.DataAssetID)),
      remaining: b.DurationRemainingInSeconds ?? sf.FeaturedBundle?.BundleRemainingDurationInSeconds ?? 0,
      cost: vp(b.TotalDiscountedCost) ?? items.reduce((a, i) => a + (i.cost || 0), 0),
      items,
    };
  }));

  const bonus = sf.BonusStore;
  const night = bonus?.BonusStoreOffers?.length ? {
    remaining: bonus.BonusStoreRemainingDurationInSeconds,
    offers: bonus.BonusStoreOffers.map((o) => ({ item: o.Offer?.Rewards?.[0]?.ItemID, cost: vp(o.Offer?.Cost), discounted: vp(o.DiscountCosts), pct: o.DiscountPercent })),
  } : null;

  let wallet = {};
  try { const w = await pd(s, `/store/v1/wallet/${s.puuid}`); wallet = { vp: w.Balances?.[CUR.vp], rad: w.Balances?.[CUR.rad], kc: w.Balances?.[CUR.kc] }; } catch { /* carteira é opcional */ }

  return { daily: { remaining: panel.SingleItemOffersRemainingDurationInSeconds || 0, offers }, bundles, night, wallet };
}

async function owned(s) {
  const r = await pd(s, `/store/v1/entitlements/${s.puuid}/${SKIN_LEVEL_TYPE}`);
  return { items: (r.Entitlements || []).map((e) => e.ItemID) };
}

/* ---------------- inventário: o que está equipado ---------------- */
const pubCache = new Map();
async function pubItem(kind, id, pick) {
  if (!id) return null;
  const key = kind + "/" + id;
  if (!pubCache.has(key)) {
    try { pubCache.set(key, pick((await getJSON(`https://valorant-api.com/v1/${kind}/${id}?language=${LANG}`)).data)); }
    catch { return null; }
  }
  return pubCache.get(key);
}

async function loadout(s) {
  const r = await pd(s, `/personalization/v2/players/${s.puuid}/playerloadout`);
  const guns = r.Guns || [];
  const [card, title, sprays, buddies] = await Promise.all([
    pubItem("playercards", r.Identity?.PlayerCardID, (d) => ({ n: d.displayName, wide: d.wideArt, small: d.smallArt })),
    pubItem("playertitles", r.Identity?.PlayerTitleID, (d) => d.titleText || null),
    Promise.all((r.Sprays || []).map((x) => pubItem("sprays", x.SprayID, (d) => ({ n: d.displayName, i: d.fullTransparentIcon || d.displayIcon })))),
    Promise.all(guns.map((g) => pubItem("buddies/levels", g.CharmLevelID, (d) => ({ n: d.displayName, i: d.displayIcon })))),
  ]);
  return {
    level: r.Identity?.HideAccountLevel ? null : r.Identity?.AccountLevel ?? null,
    card, title, sprays: sprays.filter(Boolean),
    guns: guns.map((g, i) => ({ weapon: g.ID, skin: g.SkinID, chroma: g.ChromaID, buddy: buddies[i] })),
  };
}

/* ---------------- rotas ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp" };

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (p.startsWith("/api/")) {
    if (p === "/api/connect" && req.method === "POST") {
      const { id, s } = await connect(await readBody(req));
      return send(req, res, 200, { name: s.name, tag: s.tag, region: s.region },
        undefined, { "Set-Cookie": `vs=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600` });
    }
    if (p === "/api/logout" && req.method === "POST") {
      sessions.delete(cookies(req).vs);
      return send(req, res, 200, { ok: true }, undefined, { "Set-Cookie": "vs=; Path=/; Max-Age=0" });
    }
    if (p === "/api/status") return send(req, res, 200, { loginUrl: LOGIN_URL, autoLogin: activePort === 80 });
    if (p === "/api/catalog") return send(req, res, 200, await catalog(), undefined, { "Cache-Control": "public, max-age=3600" });
    if (p === "/api/me") { const s = sessionOf(req); return send(req, res, 200, { name: s.name, tag: s.tag, region: s.region }); }
    if (p === "/api/store") return send(req, res, 200, await storefront(sessionOf(req)), undefined, { "Cache-Control": "no-store" });
    if (p === "/api/loadout") return send(req, res, 200, await loadout(sessionOf(req)), undefined, { "Cache-Control": "no-store" });
    if (p === "/api/owned") return send(req, res, 200, await owned(sessionOf(req)), undefined, { "Cache-Control": "no-store" });
    throw new HttpError(404, "Rota não encontrada.");
  }

  // volta do login da Riot: http://localhost/redirect#access_token=...
  if (p === "/redirect") return send(req, res, 200, REDIRECT_PAGE, MIME[".html"], { "Cache-Control": "no-store" });

  // arquivos do site
  const rel = p === "/" ? "index.html" : decodeURIComponent(p).replace(/^\/+/, "");
  if (!/^[\w.-]+$/.test(rel)) throw new HttpError(404, "Arquivo não encontrado.");
  let data;
  try { data = sea ? Buffer.from(sea.getAsset(rel)) : await fs.promises.readFile(path.join(PUBLIC, rel)); }
  catch { throw new HttpError(404, "Arquivo não encontrado."); }
  return send(req, res, 200, data, MIME[path.extname(rel)] || "application/octet-stream", { "Cache-Control": "no-cache" });
}

// Página mínima que pega o token do endereço e entrega pro servidor. O token nunca aparece na tela.
const REDIRECT_PAGE = `<!doctype html><meta charset="utf-8"><title>Vitrine</title>
<body style="font:16px system-ui,sans-serif;background:#11151b;color:#e7ebf0;display:grid;place-items:center;min-height:100vh;margin:0">
<p id="m">Conectando sua conta…</p>
<script>
const url = location.href;
history.replaceState(null, "", "/redirect");
fetch("/api/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, region: "auto" }) })
  .then(async (r) => { if (r.ok) location.replace("/#loja"); else throw new Error((await r.json()).error); })
  .catch((e) => { document.getElementById("m").innerHTML = (e.message || "Não deu certo.") + ' <a style="color:#e2bc5c" href="/">Voltar</a>'; });
</script>`;

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function listen(i = 0) {
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = e instanceof HttpError && e.status < 600 ? e.status : 502;
      if (status >= 500) console.error("[erro]", e.message);
      send(req, res, status, { error: e.message || "Erro inesperado." });
    });
  });
  server.once("error", (e) => {
    if ((e.code === "EADDRINUSE" || e.code === "EACCES") && i + 1 < PORTS.length) {
      console.log(`Porta ${PORTS[i]} ocupada, usando ${PORTS[i + 1]}. O login vai precisar de copiar e colar.`);
      return listen(i + 1);
    }
    console.error("Nao consegui iniciar o servidor:", e.message);
    process.exitCode = 1;
  });
  server.listen(PORTS[i], HOST, () => {
    activePort = PORTS[i];
    const url = activePort === 80 ? "http://localhost/" : `http://localhost:${activePort}/`;
    console.log(`\n  Vitrine aberta em ${url}\n  Deixe esta janela aberta enquanto usa. Para desligar, feche a janela.\n`);
    openBrowser(url);
  });
}
listen();

// limpa sessões vencidas a cada 10 min
setInterval(() => { const now = Date.now(); for (const [k, s] of sessions) if (now > s.exp) sessions.delete(k); }, 6e5).unref();
