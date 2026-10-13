import { diasUteis } from "./util/datas.js";
import { precoBlackScholes, taxaContinua } from "./regras/opcoes.js";

export const LIMITES_PADRAO = {
  minAcoes: 300, acoesObrigatorias: ["PETR4", "VALE3", "ITUB4"],
  minFiis: 150, fiisObrigatorios: ["HGLG11", "KNRI11", "MXRF11"],
  minAtivosOpcoes: 20, ativosObrigatorios: ["PETR4", "VALE3", "BOVA11"],
};

function faixas(registros, regras, avisos) {
  for (const [ticker, r] of Object.entries(registros)) {
    for (const [campo, [min, max]] of Object.entries(regras)) {
      const v = r[campo];
      if (v === null || v === undefined) continue;
      if (!(v >= min && v <= max)) {
        avisos.push(`${ticker}.${campo} = ${v} fora de [${min}, ${max}]`);
        r[campo] = null;
      }
    }
  }
}

function contagem(registros, minimo, obrigatorios, nome, erros) {
  const n = Object.keys(registros || {}).length;
  if (n < minimo) erros.push(`${nome}: ${n} itens, o mínimo é ${minimo}`);
  for (const t of obrigatorios) if (!registros?.[t]) erros.push(`${nome}: falta ${t}`);
}

export function validarAcoes(acoes, limites = LIMITES_PADRAO) {
  const erros = [], avisos = [];
  contagem(acoes, limites.minAcoes, limites.acoesObrigatorias, "ações", erros);
  faixas(acoes, {
    pl: [-1000, 1000], pvp: [-1000, 1000], margemLiquida: [-1000, 1000], roe: [-1000, 1000],
    dy12m: [0, 100], dividaLiqEbitda: [-100, 100], cagrReceita5a: [-100, 1000], cagrLucro5a: [-100, 1000],
  }, avisos);
  return { ok: erros.length === 0, erros, avisos };
}

export function validarFiis(fiis, limites = LIMITES_PADRAO) {
  const erros = [], avisos = [];
  contagem(fiis, limites.minFiis, limites.fiisObrigatorios, "FIIs", erros);
  faixas(fiis, { pvp: [0.05, 10], dy12m: [0, 60] }, avisos);
  return { ok: erros.length === 0, erros, avisos };
}

export function validarOpcoes({ indice, arquivos }, limites = LIMITES_PADRAO) {
  const erros = [], avisos = [];
  const porTicker = Object.fromEntries((indice?.ativos || []).map((a) => [a.ticker, a]));
  contagem(porTicker, limites.minAtivosOpcoes, limites.ativosObrigatorios, "opções", erros);
  const r = taxaContinua(indice.selic);
  const zerar = (s) => { s.vi = null; s.delta = null; s.gama = null; s.theta = null; s.vega = null; };
  for (const arquivo of Object.values(arquivos || {})) {
    for (const s of arquivo.series) {
      if (s.vi === null) continue;
      if (!(s.vi >= 1 && s.vi <= 300)) { avisos.push(`${s.ticker}.vi = ${s.vi} fora de [1, 300]`); zerar(s); continue; }
      if (s.dataUltimoNegocio === indice.pregao && arquivo.fechamentoAtivo > 0) {
        const T = diasUteis(indice.pregao, s.vencimento) / 252;
        const p = precoBlackScholes({ tipo: s.tipo, S: arquivo.fechamentoAtivo, K: s.strike, T, r, sigma: s.vi / 100 });
        if (Math.abs(p - s.premio) >= 0.01) { avisos.push(`${s.ticker}: VI não reproduz o prêmio`); zerar(s); }
      }
    }
  }
  return { ok: erros.length === 0, erros, avisos };
}

export function validarMercado(mercado, pregaoEsperado) {
  const erros = [];
  if (mercado.pregao !== pregaoEsperado) erros.push(`mercado: pregão ${mercado.pregao}, esperado ${pregaoEsperado}`);
  if (!(mercado.selic > 0 && mercado.selic < 100)) erros.push(`mercado: Selic inválida (${mercado.selic})`);
  return { ok: erros.length === 0, erros, avisos: [] };
}
