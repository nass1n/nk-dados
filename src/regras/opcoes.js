import { eOpcao, eCandidatoAtivoObjeto } from "../fontes/b3.js";
import { diasUteis } from "../util/datas.js";
import { arredondar } from "../util/texto.js";

// erfc de Numerical Recipes (erro < 1,2e-7).
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export const cdfNormal = (x) => 0.5 * erfc(-x / Math.SQRT2);
export const pdfNormal = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
export const taxaContinua = (selic) => Math.log(1 + selic / 100);

function d1d2({ S, K, T, r, sigma }) {
  const raiz = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / raiz;
  return { d1, d2: d1 - raiz };
}

export function precoBlackScholes({ tipo, S, K, T, r, sigma }) {
  if (!(T > 0) || !(sigma > 0)) return tipo === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  const { d1, d2 } = d1d2({ S, K, T, r, sigma });
  const desc = K * Math.exp(-r * T);
  return tipo === "call" ? S * cdfNormal(d1) - desc * cdfNormal(d2) : desc * cdfNormal(-d2) - S * cdfNormal(-d1);
}

export function gregas({ tipo, S, K, T, r, sigma }) {
  const { d1, d2 } = d1d2({ S, K, T, r, sigma });
  const fi = pdfNormal(d1);
  const raizT = Math.sqrt(T);
  const desc = K * Math.exp(-r * T);
  const comum = (-S * fi * sigma) / (2 * raizT);
  return {
    delta: tipo === "call" ? cdfNormal(d1) : cdfNormal(d1) - 1,
    gama: fi / (S * sigma * raizT),
    theta: (tipo === "call" ? comum - r * desc * cdfNormal(d2) : comum + r * desc * cdfNormal(-d2)) / 252,
    vega: (S * fi * raizT) / 100,
  };
}

export function volatilidadeImplicita({ tipo, premio, S, K, T, r }) {
  if (!(premio > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  const desc = K * Math.exp(-r * T);
  const piso = tipo === "call" ? Math.max(0, S - desc) : Math.max(0, desc - S);
  if (premio <= piso) return null;
  let lo = 0.001, hi = 5;
  if (precoBlackScholes({ tipo, S, K, T, r, sigma: hi }) < premio) return null;
  if (precoBlackScholes({ tipo, S, K, T, r, sigma: lo }) > premio) return null;
  let meio = (lo + hi) / 2;
  for (let i = 0; i < 200; i++) {
    meio = (lo + hi) / 2;
    const p = precoBlackScholes({ tipo, S, K, T, r, sigma: meio });
    if (Math.abs(p - premio) < 1e-7) break;
    if (p > premio) hi = meio; else lo = meio;
  }
  return meio;
}

export function montarOpcoes({ pregoes, pregao, selic }) {
  const datas = [...pregoes.keys()].sort();
  const r = taxaContinua(selic);
  const avisos = [];
  let semAtivo = 0;

  // por pregão: ISIN → ticker à vista, e fechamentos
  const ativoPorIsin = new Map();
  const fechamentos = new Map(); // ticker → [{data, fechamento}]
  const nomeAtivo = new Map();
  const melhorPorRaiz = new Map(); // data → raiz → registro de maior volume
  for (const d of datas) {
    const porIsin = new Map();
    const porRaiz = new Map();
    for (const reg of pregoes.get(d)) {
      if (!eCandidatoAtivoObjeto(reg)) continue;
      const atual = porIsin.get(reg.isin);
      if (!atual || reg.volume > atual.volume) porIsin.set(reg.isin, reg);
      const raiz = reg.ticker.slice(0, 4);
      const rr = porRaiz.get(raiz);
      if (!rr || reg.volume > rr.volume) porRaiz.set(raiz, reg);
      if (!fechamentos.has(reg.ticker)) fechamentos.set(reg.ticker, []);
      fechamentos.get(reg.ticker).push({ data: d, fechamento: reg.fechamento });
      nomeAtivo.set(reg.ticker, reg.nome);
    }
    ativoPorIsin.set(d, porIsin);
    melhorPorRaiz.set(d, porRaiz);
  }
  const fechamentoEm = (ticker, data) => {
    const lista = fechamentos.get(ticker) || [];
    let v = null;
    for (const f of lista) if (f.data <= data) v = f.fechamento;
    return v;
  };

  // último registro de cada série
  const series = new Map();
  for (const d of datas) {
    for (const reg of pregoes.get(d)) {
      if (!eOpcao(reg)) continue;
      const porIsin = ativoPorIsin.get(d);
      let ativo = porIsin.get(reg.isin)?.ticker;
      if (!ativo) ativo = melhorPorRaiz.get(d).get(reg.ticker.slice(0, 4))?.ticker;
      if (!ativo) { semAtivo++; continue; }
      series.set(reg.ticker, { reg, data: d, ativo });
    }
  }
  if (semAtivo) avisos.push(`opções sem ativo-objeto identificado: ${semAtivo} registros`);

  const arquivos = {};
  const volumePorAtivo = new Map();
  const raizes = new Map();
  const todas = [];
  let viFora = 0;
  for (const { reg, data, ativo } of series.values()) {
    if (!reg.vencimento || reg.vencimento <= pregao) continue;
    const tipo = reg.tpmerc === "070" ? "call" : "put";
    const doPregao = data === pregao;
    const S = fechamentoEm(ativo, data);
    const T = diasUteis(data, reg.vencimento) / 252;
    let vi = S ? volatilidadeImplicita({ tipo, premio: reg.fechamento, S, K: reg.strike, T, r }) : null;
    let viPct = vi === null ? null : arredondar(vi * 100, 4);
    if (viPct !== null && (viPct < 1 || viPct > 300)) { viPct = null; viFora++; }
    if (viPct !== null) {
      const conf = precoBlackScholes({ tipo, S, K: reg.strike, T, r, sigma: viPct / 100 });
      if (Math.abs(conf - reg.fechamento) >= 0.01) { viPct = null; avisos.push(`VI não reproduz o prêmio: ${reg.ticker}`); }
    }
    const g = viPct !== null ? gregas({ tipo, S, K: reg.strike, T, r, sigma: viPct / 100 }) : null;
    const serie = {
      ticker: reg.ticker,
      tipo,
      strike: reg.strike,
      vencimento: reg.vencimento,
      premio: reg.fechamento,
      dataUltimoNegocio: data,
      negocios: doPregao ? reg.negocios : 0,
      volume: doPregao ? reg.volume : 0,
      vi: viPct,
      delta: g ? arredondar(g.delta, 4) : null,
      gama: g ? arredondar(g.gama, 4) : null,
      theta: g ? arredondar(g.theta, 4) : null,
      vega: g ? arredondar(g.vega, 4) : null,
    };
    if (!arquivos[ativo]) {
      arquivos[ativo] = { ativo, fechamentoAtivo: fechamentoEm(ativo, pregao), pregao, selic, series: [] };
    }
    arquivos[ativo].series.push(serie);
    volumePorAtivo.set(ativo, (volumePorAtivo.get(ativo) || 0) + serie.volume);
    if (!raizes.has(ativo)) raizes.set(ativo, new Map());
    const rz = reg.ticker.slice(0, 4);
    raizes.get(ativo).set(rz, (raizes.get(ativo).get(rz) || 0) + 1);
    todas.push({ ...serie, ativo });
  }
  if (viFora) avisos.push(`VI fora de 1%–300%: ${viFora} séries`);

  for (const a of Object.values(arquivos)) {
    a.series.sort((x, y) => x.vencimento.localeCompare(y.vencimento) || (x.tipo === y.tipo ? 0 : x.tipo === "call" ? -1 : 1) || x.strike - y.strike);
  }
  const ativos = Object.keys(arquivos)
    .sort((a, b) => (volumePorAtivo.get(b) || 0) - (volumePorAtivo.get(a) || 0) || a.localeCompare(b))
    .map((ticker) => ({
      ticker,
      raiz: [...raizes.get(ticker).entries()].sort((x, y) => y[1] - x[1])[0][0],
      nome: nomeAtivo.get(ticker) || ticker,
      series: arquivos[ticker].series.length,
      vencimentos: [...new Set(arquivos[ticker].series.map((s) => s.vencimento))].sort(),
    }));
  const maisNegociadas = todas.filter((s) => s.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, 10)
    .map((s) => ({ ticker: s.ticker, ativo: s.ativo, tipo: s.tipo, strike: s.strike, vencimento: s.vencimento, premio: s.premio, volume: s.volume }));
  return { indice: { pregao, selic, ativos, maisNegociadas }, arquivos, avisos };
}
