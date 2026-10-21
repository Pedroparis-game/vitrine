/* Vitrine no Android — faz no próprio celular o que o server.js faz no PC.
   As chamadas HTTP passam pela ponte nativa (VitrineNative), que não tem o bloqueio de CORS do navegador.
   O app.js continua igual: ele chama window.VITRINE_API no lugar do fetch("/api/...") */
(() => {
  "use strict";

  const LOGIN_URL = "https://auth.riotgames.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%2Fredirect&client_id=riot-client&response_type=token%20id_token&nonce=1&scope=openid%20link%20ban%20lol_region%20account";
  const LANG = "pt-BR";
  const CUR = { vp: "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741", rad: "e59aa87c-4cbf-517a-5983-6e81511be9b7", kc: "85ca954a-41f2-ce94-9b45-8ca3dd39a00d" };
  const SKIN_LEVEL_TYPE = "e7c63390-eda7-46e0-bb7a-a6abdacd2433";
  const SHARD = { na: "na", latam: "na", br: "na", pbe: "pbe", eu: "eu", ap: "ap", kr: "kr" };
  const PLATFORM = btoa(JSON.stringify({ platformType: "PC", platformOS: "Windows", platformOSVersion: "10.0.19042.1.256.64bit", platformChipset: "Unknown" }));
  const K = { session: "vitrine-session", ever: "vitrine-ever", catalog: "vitrine-catalog" };

  const err = (status, msg) => Object.assign(new Error(msg), { status });
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço: segue sem cache */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
  };

  /* ---------------- ponte nativa ---------------- */
  const bridge = typeof VitrineNative !== "undefined" ? VitrineNative : null;
  let seq = 0;
  const waiting = new Map();
  if (bridge) bridge.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    const done = waiting.get(m.id);
    if (done) { waiting.delete(m.id); done(m); }
  };
  function native(obj) {
    if (!bridge) return Promise.reject(err(500, "Este celular precisa atualizar o Android System WebView (pela Play Store) para o Vitrine funcionar."));
    return new Promise((ok) => { const id = ++seq; waiting.set(id, ok); bridge.postMessage(JSON.stringify({ id, ...obj })); });
  }
  async function http(url, { method = "GET", headers = {}, body = null } = {}) {
    const r = await native({ type: "http", url, method, headers, body });
    if (!r.status) throw err(0, "Sem conexão com a internet. Confira o Wi-Fi ou os dados móveis.");
    let data; try { data = r.body ? JSON.parse(r.body) : {}; } catch { data = { raw: r.body }; }
    if (r.status >= 400) throw err(r.status, data.message || data.error || `HTTP ${r.status}`);
    return data;
  }

  /* ---------------- sessão ---------------- */
  let session = ls.get(K.session);
  let pendingUrl = null;

  // Voltando do login: o MainActivity carrega index.html#access_token=...
  if (/access_token=/.test(location.hash)) {
    pendingUrl = location.href;
    history.replaceState(null, "", location.pathname + "#loja");
  } else if (location.hash === "#erro-login") {
    history.replaceState(null, "", location.pathname);
  }

  // Login de novo. Se os cookies da Riot ainda valem, ela devolve na hora, sem pedir senha.
  function relogin() {
    location.href = LOGIN_URL;
    return new Promise(() => {}); // a página vai trocar
  }

  async function connect(url) {
    const raw = String(url || "").trim();
    const part = raw.includes("#") ? raw.split("#")[1] : raw.split("?")[1] || raw;
    const p = new URLSearchParams(part);
    const access = p.get("access_token");
    if (!access) throw err(400, "O login não trouxe o acesso. Toque em Entrar com a conta Riot de novo.");
    const idToken = p.get("id_token");
    const expiresIn = Number(p.get("expires_in")) || 3600;
    const auth = { Authorization: `Bearer ${access}` };
    let ent, info;
    try {
      [ent, info] = await Promise.all([
        http("https://entitlements.auth.riotgames.com/api/token/v1", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}" }),
        http("https://auth.riotgames.com/userinfo", { headers: auth }),
      ]);
    } catch (e) {
      throw err(401, e.status === 401 || e.status === 403 ? "A Riot recusou o acesso. Toque em Entrar com a conta Riot de novo." : e.status === 0 ? e.message : `Falha ao falar com a Riot (${e.message}).`);
    }
    let reg = null;
    if (idToken) {
      try {
        const geo = await http("https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant", { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ id_token: idToken }) });
        reg = geo.affinities?.live;
      } catch { /* usa o padrão */ }
    }
    reg = SHARD[reg] ? reg : "br";
    session = {
      access, ent: ent.entitlements_token, puuid: info.sub, region: reg, shard: SHARD[reg],
      name: info.acct?.game_name || "Jogador", tag: info.acct?.tag_line || "",
      exp: Date.now() + (expiresIn - 60) * 1000,
    };
    ls.set(K.session, session);
    ls.set(K.ever, true);
    return session;
  }

  async function current() {
    if (pendingUrl) { const u = pendingUrl; pendingUrl = null; return connect(u); }
    if (session && Date.now() < session.exp) return session;
    session = null; ls.del(K.session);
    if (ls.get(K.ever)) return relogin();
    throw err(401, "Não conectado.");
  }

  /* ---------------- catálogo (valorant-api.com) ---------------- */
  let version = null, versionAt = 0;
  async function clientVersion() {
    if (!version || Date.now() - versionAt > 3.6e6) {
      version = (await http("https://valorant-api.com/v1/version")).data.riotClientVersion;
      versionAt = Date.now();
    }
    return version;
  }

  async function catalog() {
    const cached = ls.get(K.catalog);
    if (cached && Date.now() - cached.at < 6 * 3.6e6 && cached.data?.skins?.length) return cached.data;
    const [weapons, tiers] = await Promise.all([
      http(`https://valorant-api.com/v1/weapons?language=${LANG}`),
      http(`https://valorant-api.com/v1/contenttiers?language=${LANG}`),
    ]);
    const out = { tiers: {}, weapons: [], skins: [] };
    for (const t of tiers.data) out.tiers[t.uuid] = { name: t.devName, color: "#" + String(t.highlightColor || "8a94a3").slice(0, 6), rank: (t.rank ?? 0) + 1 };
    weapons.data.forEach((w, wi) => {
      out.weapons.push({ id: w.uuid, name: w.displayName });
      for (const s of w.skins || []) {
        if (/random|aleat/i.test(s.displayName)) continue;
        out.skins.push({
          id: s.uuid, n: s.displayName, w: wi, t: s.contentTierUuid,
          i: s.levels?.[0]?.displayIcon || s.displayIcon || s.chromas?.[0]?.fullRender || null,
          l: (s.levels || []).map((l) => l.uuid),
          c: (s.chromas || []).map((c) => ({ n: c.displayName, i: c.fullRender || c.displayIcon, s: c.swatch })),
        });
      }
    });
    ls.set(K.catalog, { at: Date.now(), data: out });
    return out;
  }

  const bundles = new Map();
  async function bundleInfo(id) {
    if (!id) return {};
    if (!bundles.has(id)) {
      try { const b = await http(`https://valorant-api.com/v1/bundles/${id}?language=${LANG}`); bundles.set(id, { name: b.data.displayName, image: b.data.displayIcon }); }
      catch { bundles.set(id, {}); }
    }
    return bundles.get(id);
  }

  /* ---------------- loja ---------------- */
  async function pd(s, path, opts = {}) {
    const headers = {
      Authorization: `Bearer ${s.access}`, "X-Riot-Entitlements-JWT": s.ent,
      "X-Riot-ClientPlatform": PLATFORM, "X-Riot-ClientVersion": await clientVersion(),
      "Content-Type": "application/json", ...opts.headers,
    };
    try { return await http(`https://pd.${s.shard}.a.pvp.net${path}`, { ...opts, headers }); }
    catch (e) {
      if (e.status === 400 || e.status === 401) {
        session = null; ls.del(K.session);
        return relogin();
      }
      throw e;
    }
  }
  const vp = (cost) => (cost ? cost[CUR.vp] ?? null : null);

  async function storefront(s) {
    let sf;
    try { sf = await pd(s, `/store/v3/storefront/${s.puuid}`, { method: "POST", body: "{}" }); }
    catch (e) { if (e.status === 0) throw e; sf = await pd(s, `/store/v2/storefront/${s.puuid}`); }

    const panel = sf.SkinsPanelLayout || {};
    let offers = (panel.SingleItemStoreOffers || []).map((o) => ({ item: o.Rewards?.[0]?.ItemID || o.OfferID, cost: vp(o.Cost) }));
    if (!offers.length && panel.SingleItemOffers) offers = panel.SingleItemOffers.map((id) => ({ item: id, cost: null }));

    const raw = sf.FeaturedBundle?.Bundles || (sf.FeaturedBundle?.Bundle ? [sf.FeaturedBundle.Bundle] : []);
    const list = await Promise.all(raw.map(async (b) => {
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
    try { const w = await pd(s, `/store/v1/wallet/${s.puuid}`); wallet = { vp: w.Balances?.[CUR.vp], rad: w.Balances?.[CUR.rad], kc: w.Balances?.[CUR.kc] }; } catch { /* opcional */ }

    return { daily: { remaining: panel.SingleItemOffersRemainingDurationInSeconds || 0, offers }, bundles: list, night, wallet };
  }

  async function owned(s) {
    const r = await pd(s, `/store/v1/entitlements/${s.puuid}/${SKIN_LEVEL_TYPE}`);
    return { items: (r.Entitlements || []).map((e) => e.ItemID) };
  }

  /* ---------------- rotas que o app.js usa ---------------- */
  window.VITRINE_API = async (path, opts = {}) => {
    const me = (s) => ({ name: s.name, tag: s.tag, region: s.region });
    switch (path) {
      case "/api/status": return { loginUrl: LOGIN_URL, autoLogin: true };
      case "/api/me": return me(await current());
      case "/api/connect": { let b = {}; try { b = JSON.parse(opts.body || "{}"); } catch { /* vazio */ } return me(await connect(b.url)); }
      case "/api/logout":
        session = null; ls.del(K.session); ls.del(K.ever);
        await native({ type: "logout" }).catch(() => {});
        return { ok: true };
      case "/api/catalog": return catalog();
      case "/api/store": return storefront(await current());
      case "/api/owned": return owned(await current());
      default: throw err(404, "Rota não encontrada.");
    }
  };

  /* ---------------- ajustes de texto para o app ---------------- */
  const fb = document.getElementById("fallback");
  if (fb) fb.hidden = true;
  const fine = document.querySelector("#viewConnect .fine");
  if (fine) fine.textContent = "Depois do primeiro login, o app renova o acesso sozinho. Ative a verificação em duas etapas na sua conta Riot. Projeto pessoal, sem ligação com a Riot Games.";
  const lede = document.querySelector("#viewConnect .lede");
  if (lede) lede.textContent = "Entre uma vez pela página oficial da Riot. Nas próximas, é só abrir o app. Sua senha fica só com a Riot.";
})();
