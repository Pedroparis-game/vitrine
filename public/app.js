/* Vitrine — front-end sem framework.
   Fluxo: /api/me → (conectado) /api/catalog + /api/store + /api/owned → renderiza abas.
   Sem servidor (prévia), usa window.VITRINE_DEMO embutido. */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR"));
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento: tudo bem */ } },
  };

  const state = {
    mode: "live",           // "live" | "demo"
    catalog: null,          // { tiers, weapons, skins }
    byLevel: new Map(),     // uuid do nível (ItemID da loja) → skin
    byId: new Map(),        // uuid da skin → skin
    data: null,             // { daily, bundles, night, wallet }
    owned: [],
    me: null,
    deadlines: {},          // nome do relógio → timestamp final
    loadedAt: 0,            // quando os dados chegaram (base dos relógios)
    revealed: new Set(),    // ofertas do Mercado Noturno já reveladas
    bundleIdx: 0,
    weapon: "all",
    query: "",
  };

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    if (window.VITRINE_API) return window.VITRINE_API(path, opts); // app Android
    const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `Erro ${res.status}`), { status: res.status });
    return body;
  }

  function indexCatalog(cat) {
    state.catalog = cat;
    state.byLevel.clear(); state.byId.clear();
    for (const s of cat.skins) {
      state.byId.set(s.id, s);
      for (const l of s.l || []) state.byLevel.set(l, s);
      state.byLevel.set(s.id, s);
    }
  }
  const tierOf = (s) => (s && state.catalog.tiers[s.t]) || { name: "Padrão", color: "#8a94a3", rank: 0 };
  const weaponOf = (s) => state.catalog.weapons[s?.w]?.name || "";

  /* ---------------- arte ---------------- */
  // Na prévia não há imagens reais; desenha uma silhueta da classe da arma com as cores da skin.
  const SHAPES = {
    rifle: "M8 40h52l8-8h84l6 6h74v8h-70l-8 6h-30l-6 22h-14l4-22h-16l-8 18h-16l6-18h-28l-16 12H8z",
    smg: "M20 40h40l8-8h70l6 6h52v8h-48l-6 6h-22l-4 22h-14l4-22h-10l-8 26h-16l8-26H48l-14 10H20z",
    sniper: "M4 42h60l6-6h40l4-10h34l4 10h84v6h-80l-6 6h-28l-6 18h-12l4-18h-24l-14 12H4z",
    pistol: "M70 30h104l6 6v10h-74l-4 6h-6l-12 30H58l10-30h-4l-6-6V36z",
    shotgun: "M10 42h56l6-6h150v10H108l-6 6H86l-6 18H66l4-18H48l-20 12H10z",
    mg: "M6 40h48l8-8h90l6 6h70v10h-66l-8 6h-20v18h-20V54H86l-8 20H62l6-20H40l-16 12H6z",
    melee: "M30 52h60l6-6h10l4 4h100c14 0 22-8 26-14-4 22-26 26-36 26H110l-4 4H96l-6-6H30z",
  };
  function artSVG(art, id) {
    const g = `g${id.replace(/[^a-z0-9]/gi, "").slice(0, 10)}${Math.random().toString(36).slice(2, 6)}`;
    const d = SHAPES[art.k] || SHAPES.rifle;
    return `<svg viewBox="0 0 240 90" role="img" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${esc(art.a)}"/><stop offset=".55" stop-color="${esc(art.b)}"/><stop offset="1" stop-color="${esc(art.a)}"/></linearGradient></defs>
      <path d="${d}" fill="url(#${g})" stroke="rgba(0,0,0,.35)" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  }
  function art(img, alt, id) {
    if (!img) return `<span class="q">?</span>`;
    if (typeof img === "object") return artSVG(img, id);
    return `<img src="${esc(img)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  }

  /* ---------------- etiqueta ---------------- */
  function tagHTML(skin, { price, base, pct, small, hidden, idx } = {}) {
    if (hidden) {
      return `<button class="tag tag--hidden" type="button" data-reveal="${idx}" aria-label="Revelar oferta ${idx + 1}">
        <div class="tag__art"><span class="q">?</span></div>
        <div class="tag__body"><span class="tag__tier">Oferta oculta</span><span class="tag__name">Toque para revelar</span><span class="tag__weapon">&nbsp;</span>
        <span class="tag__price">&nbsp;</span></div></button>`;
    }
    const t = tierOf(skin);
    const name = skin?.n || "Item desconhecido";
    return `<button class="tag" type="button" style="--tier:${esc(t.color)}" data-skin="${esc(skin?.id || "")}">
      ${pct ? `<span class="tag__off">−${pct}%</span>` : ""}
      <div class="tag__art">${art(skin?.i, name, skin?.id || "x")}</div>
      <div class="tag__body">
        <span class="tag__tier">${esc(t.name)}</span>
        <span class="tag__name">${esc(name)}</span>
        <span class="tag__weapon">${esc(weaponOf(skin))}</span>
        ${price != null ? `<span class="tag__price">${fmt(price)} <small>VP</small>${base ? `<s>${fmt(base)}</s>` : ""}</span>` : ""}
      </div></button>`;
  }

  /* ---------------- renderização ---------------- */
  function renderWallet() {
    const w = state.data?.wallet || {};
    $("#wallet").innerHTML = [
      ["vp", "VP", w.vp], ["rad", "Radianita", w.rad], ["kc", "Kingdom", w.kc],
    ].filter(([, , v]) => v != null).map(([k, l, v]) => `<span class="coin coin--${k}">${fmt(v)} <small>${l}</small></span>`).join("");
    const me = state.me;
    $("#whoName").innerHTML = me ? `${esc(me.name)}<i>#${esc(me.tag)}</i>` : "";
    $("#account").hidden = false;
  }

  function renderDaily() {
    const d = state.data.daily;
    state.deadlines.daily = state.loadedAt + (d?.remaining || 0) * 1000;
    $("#dailyGrid").innerHTML = (d?.offers || []).map((o) => tagHTML(state.byLevel.get(o.item), { price: o.cost })).join("")
      || `<p class="empty">A loja do dia não veio na resposta. Tente atualizar a página.</p>`;
  }

  function renderBundle() {
    const list = state.data.bundles || [];
    const box = $("#bundleBox");
    if (!list.length) { box.innerHTML = `<p class="empty">Nenhum pacote em destaque agora.</p>`; return; }
    const i = Math.min(state.bundleIdx, list.length - 1);
    const b = list[i];
    state.deadlines.bundle = state.loadedAt + (b.remaining || 0) * 1000;
    const items = (b.items || []).map((it) => ({ it, skin: state.byLevel.get(it.item) })).filter((x) => x.skin);
    const extra = (b.items || []).length - items.length;
    box.innerHTML = `<div class="bundle">
      ${list.length > 1 ? `<div class="pager">${list.map((x, j) => `<button type="button" data-bundle="${j}" aria-pressed="${j === i}">${esc(x.name || `Pacote ${j + 1}`)}</button>`).join("")}</div>` : ""}
      <div class="bundle__hero">${b.image ? art(b.image, b.name, "bundle" + i) : ""}
        <div class="bundle__cap">
          <div><p class="eyebrow" style="color:#e2bc5c">Pacote em destaque</p><h2>${esc(b.name || "Pacote")}</h2>
          ${b.cost ? `<span class="bundle__price">${fmt(b.cost)} <small>VP</small></span>` : ""}</div>
          <div class="sign"><span>Sai em</span><b class="clock" data-clock="bundle">--:--:--</b></div>
        </div>
      </div>
      <div class="tags tags--4">${items.map(({ it, skin }) => tagHTML(skin, { price: it.cost })).join("")}</div>
      ${extra > 0 ? `<p class="count">+ ${extra} ${extra === 1 ? "item" : "itens"} do pacote que não são skins de arma (chaveiro, card, spray).</p>` : ""}
    </div>`;
  }

  function nightKey() { return `vitrine-night-${state.me?.tag || "x"}-${Math.round((state.deadlines.night || 0) / 3.6e6)}`; }
  function renderNight() {
    const n = state.data.night;
    const tab = $("#tabNight");
    tab.innerHTML = "Mercado Noturno" + (n ? `<span class="dot" aria-label="aberto"></span>` : "");
    $("#nightSign").hidden = !n;
    if (!n) { $("#nightBox").innerHTML = `<p class="empty">O Mercado Noturno está fechado agora. Ele abre algumas vezes por ano e aparece aqui sozinho quando estiver ativo.</p>`; return; }
    state.deadlines.night = state.loadedAt + (n.remaining || 0) * 1000;
    (store.get(nightKey()) || []).forEach((i) => state.revealed.add(i));
    const shown = state.revealed;
    const all = shown.size === n.offers.length;
    $("#nightBox").innerHTML = `${all ? "" : `<div class="night-actions"><button class="btn" type="button" id="revealAll">Revelar todas</button></div>`}
      <div class="tags tags--3">${n.offers.map((o, i) => shown.has(i)
        ? tagHTML(state.byLevel.get(o.item), { price: o.discounted, base: o.cost, pct: o.pct })
        : tagHTML(null, { hidden: true, idx: i })).join("")}</div>`;
  }
  function reveal(idx) {
    const set = state.revealed;
    if (idx === "all") state.data.night.offers.forEach((_, i) => set.add(i)); else set.add(idx);
    store.set(nightKey(), [...set]);
    renderNight();
    const targets = idx === "all" ? $$("#nightBox .tag") : [$$("#nightBox .tag")[idx]];
    targets.forEach((el) => el && el.classList.add("tag--flip"));
  }

  function ownedSkins() {
    const seen = new Set(); const out = [];
    for (const id of state.owned) {
      const s = state.byLevel.get(id);
      if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
    }
    return out.sort((a, b) => tierOf(b).rank - tierOf(a).rank || a.n.localeCompare(b.n, "pt-BR"));
  }
  function renderOwned() {
    const all = ownedSkins();
    const counts = new Map();
    all.forEach((s) => counts.set(s.w, (counts.get(s.w) || 0) + 1));
    const chips = [`<button class="chip" type="button" data-weapon="all" aria-pressed="${state.weapon === "all"}">Todas<b>${all.length}</b></button>`]
      .concat(state.catalog.weapons.map((w, i) => counts.get(i)
        ? `<button class="chip" type="button" data-weapon="${i}" aria-pressed="${String(state.weapon) === String(i)}">${esc(w.name)}<b>${counts.get(i)}</b></button>` : ""));
    $("#weaponChips").innerHTML = chips.join("");
    const q = state.query.trim().toLowerCase();
    const list = all.filter((s) => (state.weapon === "all" || String(s.w) === String(state.weapon)) && (!q || s.n.toLowerCase().includes(q)));
    $("#ownedCount").textContent = `${all.length} skins em ${counts.size} armas`;
    $("#ownedGrid").innerHTML = list.map((s) => tagHTML(s, { small: true })).join("")
      || `<p class="empty">${all.length ? "Nenhuma skin com esse filtro." : "Nenhuma skin comprada ainda."}</p>`;
  }

  function renderAll() {
    state.loadedAt = Date.now(); state.revealed = new Set();
    renderWallet(); renderDaily(); renderBundle(); renderNight(); renderOwned(); tick();
  }

  /* ---------------- detalhe ---------------- */
  function openDetail(id) {
    const s = state.byId.get(id);
    if (!s) return;
    const t = tierOf(s);
    const chromas = (s.c || []).filter((c) => c.i);
    const dlg = $("#detail");
    $("#detailIn").innerHTML = `<button class="detail__close" type="button" aria-label="Fechar" data-close>×</button>
      <div class="detail__art" style="--tier:${esc(t.color)}" id="detailArt">${art(chromas[0]?.i || s.i, s.n, s.id + "d")}</div>
      <div class="detail__body">
        <div><p class="eyebrow" style="color:${esc(t.color)}">${esc(t.name)}</p><h2 id="detailName">${esc(s.n)}</h2></div>
        <div class="detail__meta"><span>${esc(weaponOf(s))}</span><span>${(s.l || []).length} ${(s.l || []).length === 1 ? "nível" : "níveis"}</span><span>${chromas.length || 1} ${chromas.length > 1 ? "variações de cor" : "variação"}</span></div>
        ${chromas.length > 1 ? `<div><p class="eyebrow">Variações</p><div class="swatches">${chromas.map((c, i) => `<button class="swatch" type="button" data-chroma="${i}" aria-pressed="${i === 0}" title="${esc(c.n)}" aria-label="${esc(c.n)}">${typeof c.s === "string" ? `<img src="${esc(c.s)}" alt="" loading="lazy">` : `<span style="display:block;width:100%;height:100%;background:linear-gradient(135deg,${esc(c.i.a)},${esc(c.i.b)})"></span>`}</button>`).join("")}</div></div>` : ""}
      </div>`;
    dlg._chromas = chromas; dlg._skin = s;
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }

  /* ---------------- relógios ---------------- */
  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return (d ? `${d}d ` : "") + `${p(h)}:${p(m)}:${p(x)}`;
  }
  function tick() {
    const now = Date.now();
    $$("[data-clock]").forEach((el) => { const end = state.deadlines[el.dataset.clock]; if (end) el.textContent = hms(end - now); });
  }
  setInterval(tick, 1000);

  /* ---------------- abas ---------------- */
  const TABS = ["loja", "pacote", "noturno", "colecao"];
  function showTab(name) {
    if (!TABS.includes(name)) name = "loja";
    $$(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    TABS.forEach((t) => { $(`#panel-${t}`).hidden = t !== name; });
  }

  /* ---------------- visões ---------------- */
  function view(which) {
    $("#viewConnect").hidden = which !== "connect";
    $("#viewApp").hidden = which !== "app";
    $("#loading").hidden = which !== "loading";
    if (which !== "app") $("#account").hidden = true;
  }

  async function loadLive() {
    view("loading");
    const [cat, data, owned] = await Promise.all([api("/api/catalog"), api("/api/store"), api("/api/owned").catch(() => ({ items: [] }))]);
    indexCatalog(cat);
    state.mode = "live"; state.data = data; state.owned = owned.items || [];
    $("#demoNote").hidden = true;
    view("app"); renderAll(); showTab(location.hash.slice(1));
  }

  // Demonstração: usa os dados embutidos (prévia) ou monta uma loja aleatória a partir do catálogo real.
  async function loadDemo() {
    view("loading");
    let demo = window.VITRINE_DEMO;
    if (!demo) {
      const cat = await api("/api/catalog");
      const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
      const priced = cat.skins.filter((s) => cat.tiers[s.t] && s.i);
      const price = (s) => ({ 1: 875, 2: 1275, 3: 1775, 4: 2175, 5: 2475 }[cat.tiers[s.t].rank] || 1775);
      const daily = pick(priced, 4), night = pick(priced, 6), bundle = pick(priced, 4);
      demo = {
        catalog: cat, me: { name: "Demonstração", tag: "BR1" }, owned: pick(priced, 40).map((s) => s.id),
        store: {
          wallet: { vp: 3250, rad: 40, kc: 12500 },
          daily: { remaining: 9 * 3600 + 1234, offers: daily.map((s) => ({ item: s.id, cost: price(s) })) },
          bundles: [{ name: "Pacote de exemplo", image: bundle[0].i, remaining: 5 * 86400, cost: 7100, items: bundle.map((s) => ({ item: s.id, cost: price(s) })) }],
          night: { remaining: 12 * 86400, offers: night.map((s) => { const pct = 15 + Math.floor(Math.random() * 30); return { item: s.id, cost: price(s), pct, discounted: Math.round(price(s) * (1 - pct / 100)) }; }) },
        },
      };
    }
    indexCatalog(demo.catalog);
    state.mode = "demo"; state.data = demo.store; state.owned = demo.owned; state.me = demo.me;
    $("#demoNote").hidden = false;
    $("#demoNoteText").textContent = window.VITRINE_DEMO
      ? "Aqui as armas são silhuetas desenhadas. Rodando no seu PC, aparecem as imagens reais e a sua loja de verdade."
      : "As skins são sorteadas do catálogo real. Conecte sua conta para ver a sua loja.";
    view("app"); renderAll(); showTab(location.hash.slice(1));
  }

  // Se o servidor não conseguiu a porta 80, o login não volta sozinho: já abre o plano B explicado.
  async function setupLogin() {
    try {
      const st = await api("/api/status");
      $("#riotLink").href = st.loginUrl;
      if (!st.autoLogin) {
        $("#fallback").open = true;
        $("#fallbackTitle").textContent = "Depois do login, cole o endereço aqui";
        $("#fallbackText").textContent = "Neste computador a porta 80 está ocupada, então o login não volta sozinho. Depois de entrar, vai aparecer uma página de erro do localhost. Copie o endereço dela e cole aqui.";
        $("#riotLink").target = "_blank";
      }
    } catch { /* mantém o padrão */ }
  }

  async function boot() {
    if (window.VITRINE_DEMO) return loadDemo();
    setupLogin();
    view("loading");
    try {
      state.me = await api("/api/me");
      await loadLive();
    } catch (e) {
      view("connect");
      if (e.status && e.status !== 401) $("#connectMsg").textContent = e.message;
    }
  }

  /* ---------------- eventos ---------------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-skin],[data-reveal],[data-bundle],[data-weapon],[data-chroma],[data-close],#revealAll");
    if (!t) return;
    if (t.dataset.tab) { history.replaceState(null, "", "#" + t.dataset.tab); showTab(t.dataset.tab); }
    else if (t.dataset.reveal != null) reveal(Number(t.dataset.reveal));
    else if (t.id === "revealAll") reveal("all");
    else if (t.dataset.skin) openDetail(t.dataset.skin);
    else if (t.dataset.bundle != null) { state.bundleIdx = Number(t.dataset.bundle); renderBundle(); tick(); }
    else if (t.dataset.weapon != null) { state.weapon = t.dataset.weapon; renderOwned(); }
    else if (t.dataset.chroma != null) {
      const dlg = $("#detail"); const c = dlg._chromas[Number(t.dataset.chroma)];
      $("#detailArt").innerHTML = art(c.i, c.n, dlg._skin.id + "c");
      $$("[data-chroma]").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
    } else if (t.hasAttribute("data-close")) $("#detail").close?.();
  });
  $("#detail").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close?.(); });
  $("#search").addEventListener("input", (e) => { state.query = e.target.value; renderOwned(); });

  $("#connectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#connectBtn"), msg = $("#connectMsg");
    if (window.VITRINE_DEMO) { msg.textContent = "Esta prévia não tem servidor. Rode o projeto no seu PC (node server.js) para conectar sua conta."; return; }
    msg.textContent = ""; btn.disabled = true; btn.textContent = "Conectando…";
    try {
      state.me = await api("/api/connect", { method: "POST", body: JSON.stringify({ url: $("#tokenUrl").value.trim(), region: $("#region").value }) });
      $("#tokenUrl").value = "";
      await loadLive();
    } catch (err) {
      view("connect"); msg.textContent = err.message;
    } finally { btn.disabled = false; btn.textContent = "Ver minha loja"; }
  });

  $("#riotLink").addEventListener("click", (e) => {
    if (!window.VITRINE_DEMO) return;
    e.preventDefault();
    $("#connectMsg").textContent = "Esta prévia não tem servidor. Abra o Vitrine no seu PC para entrar com a sua conta.";
  });
  $("#logoutBtn").addEventListener("click", async () => {
    if (state.mode === "live") await api("/api/logout", { method: "POST" }).catch(() => {});
    state.me = null; $("#demoNote").hidden = true; view("connect");
  });
  $("#demoBtn").addEventListener("click", () => loadDemo().catch((e) => { view("connect"); $("#connectMsg").textContent = e.message; }));
  $("#demoConnect").addEventListener("click", () => { $("#demoNote").hidden = true; view("connect"); });

  boot();
})();
