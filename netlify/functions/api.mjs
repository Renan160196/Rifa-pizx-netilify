import { getStore } from "@netlify/blobs";

const J = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

const DEF = {
  title: "Rifa Solidária", prize: "Prêmio da rifa", price: 10, total: 100, hold: 30,
  drawDate: "", pixKey: "+5519994470605", pixName: "ORGANIZADOR", pixCity: "SAO PAULO",
};

export default async (req) => {
  const store = getStore({ name: "rifa", consistency: "strong" });
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  const st = (await store.get("state", { type: "json" })) || { config: {}, nums: {}, winner: null };
  st.config = { ...DEF, ...st.config };
  const now = Date.now();
  // libera reservas não pagas após o prazo
  for (const n in st.nums) {
    if (st.nums[n].s === "p" && now - st.nums[n].t > st.config.hold * 60000) delete st.nums[n];
  }
  const save = () => store.setJSON("state", st);
  const u = process.env.ADMIN_USER, p = process.env.ADMIN_PASS;
  const isAdmin = !!u && !!p && req.headers.get("x-auth") === btoa(u + ":" + p);
  const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (path === "state") {
    const nums = {};
    for (const n in st.nums) {
      const r = st.nums[n];
      nums[n] = isAdmin ? r : { s: r.s, name: r.name.split(" ")[0] };
    }
    return J({ config: st.config, nums, winner: st.winner, admin: isAdmin });
  }

  if (path === "reserve") {
    const name = String(b.name || "").trim().slice(0, 60);
    const list = [...new Set((b.numbers || []).map(Number))];
    if (name.length < 2) return J({ error: "Informe seu nome." }, 400);
    if (!list.length || list.length > 50) return J({ error: "Escolha de 1 a 50 números." }, 400);
    if (st.winner) return J({ error: "Esta rifa já foi sorteada." }, 400);
    for (const n of list) {
      if (!Number.isInteger(n) || n < 1 || n > st.config.total) return J({ error: "Número inválido." }, 400);
      if (st.nums[n]) return J({ error: `O número ${n} acabou de ser reservado por outra pessoa.` }, 409);
    }
    for (const n of list) st.nums[n] = { s: "p", name, t: now };
    await save();
    return J({ ok: true, hold: st.config.hold });
  }

  if (path === "login") {
    if (!u || !p) return J({ error: "Defina ADMIN_USER e ADMIN_PASS nas variáveis de ambiente da Netlify." }, 500);
    return isAdmin ? J({ ok: true }) : J({ error: "Usuário ou senha incorretos." }, 401);
  }

  if (!isAdmin) return J({ error: "Não autorizado." }, 401);

  if (path === "config") {
    const c = st.config, n = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
    Object.assign(c, {
      title: String(b.title || c.title).slice(0, 80), prize: String(b.prize || c.prize).slice(0, 120),
      price: n(b.price, c.price), total: Math.min(1000, Math.floor(n(b.total, c.total))),
      hold: Math.floor(n(b.hold, c.hold)), drawDate: String(b.drawDate || ""),
      pixKey: String(b.pixKey || c.pixKey).trim(), pixName: String(b.pixName || c.pixName).slice(0, 25),
      pixCity: String(b.pixCity || c.pixCity).slice(0, 15),
    });
    for (const k in st.nums) if (+k > c.total) delete st.nums[k];
    await save();
    return J({ ok: true });
  }

  if (path === "mark") {
    for (const n of b.numbers || []) {
      if (!st.nums[n]) continue;
      if (b.status === "x") st.nums[n].s = "x";
      else delete st.nums[n];
    }
    await save();
    return J({ ok: true });
  }

  if (path === "draw") {
    const paid = Object.keys(st.nums).filter((n) => st.nums[n].s === "x");
    if (!paid.length) return J({ error: "Nenhum número pago para sortear." }, 400);
    const i = crypto.getRandomValues(new Uint32Array(1))[0] % paid.length;
    st.winner = { n: +paid[i], name: st.nums[paid[i]].name, at: now };
    await save();
    return J({ ok: true, winner: st.winner });
  }

  if (path === "reset") {
    st.nums = {}; st.winner = null;
    await save();
    return J({ ok: true });
  }

  return J({ error: "Rota não encontrada." }, 404);
};

export const config = { path: "/api/*" };
