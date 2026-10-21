// Gera preview.html: o site num arquivo só, com dados de exemplo e sem servidor.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const T = { S: { name: "Select", color: "#5a9fe2", rank: 1 }, D: { name: "Deluxe", color: "#009587", rank: 2 }, P: { name: "Premium", color: "#d1548d", rank: 3 }, E: { name: "Exclusive", color: "#f5955b", rank: 4 }, U: { name: "Ultra", color: "#fad663", rank: 5 } };
const W = [["Vandal","rifle"],["Phantom","rifle"],["Operator","sniper"],["Sheriff","pistol"],["Spectre","smg"],["Judge","shotgun"],["Odin","mg"],["Ghost","pistol"],["Classic","pistol"],["Corpo a Corpo","melee"],["Bulldog","rifle"],["Marshal","sniper"]];
const C = { // coleção: tier, cores das variações
  "Brasa": ["U", [["#ff6a3d","#ffd166"],["#3d7bff","#a8f0ff"],["#9b3dff","#ff8ad8"]]],
  "Aurora": ["E", [["#7cf5d0","#6b5bff"],["#ffe37a","#ff6fa8"]]],
  "Maré": ["P", [["#0d4e7a","#5ad1e6"],["#163a2c","#7be0a6"]]],
  "Neon Sul": ["P", [["#ff3db8","#3dd6ff"],["#c9ff3d","#3d5bff"]]],
  "Granito": ["D", [["#6b6f76","#c9ccd1"]]],
  "Pampa": ["S", [["#7a9a3a","#e8d9a0"]]],
  "Origami": ["D", [["#f2f2ee","#e04b4b"],["#1e1e24","#e8e8e8"]]],
  "Eclipse": ["E", [["#1d1b2e","#f2b84b"],["#2e1b1b","#ff6b6b"]]],
};
const wi = (n) => W.findIndex((w) => w[0] === n);
const skins = []; const id = (col, w) => (col + "-" + w).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-");
for (const [col, [tier, chromas]] of Object.entries(C)) for (const [wn, kind] of W) {
  const sid = id(col, wn);
  const lv = /Brasa|Aurora|Neon|Eclipse/.test(col) ? 4 : 1;
  skins.push({ id: sid, n: wn === "Corpo a Corpo" ? `Lâmina ${col}` : `${wn} ${col}`, w: wi(wn), t: tier,
    i: { k: kind, a: chromas[0][0], b: chromas[0][1] },
    l: Array.from({ length: lv }, (_, i) => `${sid}-l${i + 1}`),
    c: chromas.map(([a, b], i) => ({ n: i ? `Variação ${i + 1}` : "Original", i: { k: kind, a, b }, s: null })) });
}
const price = { S: 875, D: 1275, P: 1775, E: 2175, U: 2475 };
const cost = (sid) => { const s = skins.find((x) => x.id === sid); return s.w === wi("Corpo a Corpo") ? price[s.t] * 2 : price[s.t]; };
const off = (sid, pct) => ({ item: sid, cost: cost(sid), pct, discounted: Math.round(cost(sid) * (1 - pct / 100)) });
const bundleItems = ["aurora-vandal","aurora-ghost","aurora-judge","aurora-corpo-a-corpo"].map((s) => ({ item: s, cost: cost(s) }));
const demo = {
  me: { name: "Pedro", tag: "BR1" },
  catalog: { tiers: T, weapons: W.map(([n]) => ({ id: n, name: n })), skins },
  store: {
    wallet: { vp: 3250, rad: 40, kc: 12500 },
    daily: { remaining: 7 * 3600 + 42 * 60 + 13, offers: ["brasa-operator","mare-phantom","granito-sheriff","neon-sul-spectre"].map((s) => ({ item: s, cost: cost(s) })) },
    bundles: [{ name: "Aurora", image: { k: "rifle", a: "#7cf5d0", b: "#6b5bff" }, remaining: 4 * 86400 + 5 * 3600, cost: Math.round(bundleItems.reduce((a, i) => a + i.cost, 0) * 0.8 / 5) * 5, items: bundleItems }],
    night: { remaining: 9 * 86400 + 3 * 3600, offers: [off("eclipse-vandal", 32), off("pampa-classic", 18), off("origami-odin", 25), off("mare-operator", 41), off("neon-sul-corpo-a-corpo", 22), off("granito-bulldog", 15)] },
  },
  owned: ["brasa-vandal","brasa-sheriff","aurora-phantom","mare-ghost","mare-spectre","neon-sul-vandal","neon-sul-operator","granito-classic","granito-judge","pampa-bulldog","pampa-marshal","origami-sheriff","origami-phantom","eclipse-corpo-a-corpo","eclipse-ghost","aurora-operator","brasa-corpo-a-corpo","mare-vandal","pampa-spectre","origami-classic","granito-odin"].map((s) => s + "-l1"),
};
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
let body = html.split("<!--BODY-START-->")[1].split("<!--BODY-END-->")[0].replace("<!--HEAD-END-->\n</head>\n<body>", "");
body = body.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${fs.readFileSync(path.join(root, "public/style.css"), "utf8")}</style>`);
body = body.replace('<script src="app.js"></script>', () => `<script>window.VITRINE_DEMO=${JSON.stringify(demo)};</script>\n<script>\n${fs.readFileSync(path.join(root, "public/app.js"), "utf8")}</script>`);
fs.writeFileSync(path.join(root, "preview.html"), body.trim() + "\n");
console.log("preview.html", (body.length / 1024).toFixed(1), "KB");
