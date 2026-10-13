import { normalizar, nomeEmTitulo, arredondar } from "../util/texto.js";

// Tipo pela composição do ativo: participação de imóveis em imóveis + papéis.
export function tipoFii({ imoveis, papel, segmento }) {
  const total = (imoveis || 0) + (papel || 0);
  if (total > 0) {
    const fracao = (imoveis || 0) / total;
    if (fracao >= 0.75) return "Tijolo";
    if (fracao <= 0.25) return "Papel";
    return "Híbrido";
  }
  const s = normalizar(segmento);
  if (s.includes("hibrido")) return "Híbrido";
  if (s.includes("titulos")) return "Papel";
  return "Tijolo";
}

// Rendimento por cota do mês. O informe não traz o valor por cota: usa Rendimentos a
// distribuir ÷ cotas quando é coerente (até 25%) com DY do mês × VP da cota; senão DY × VP.
export function rendimentoPorCota({ dyMes, vpCota, rendimentosDistribuir, cotas }) {
  if (dyMes === null || dyMes === undefined || !(vpCota > 0)) return null;
  const dy = dyMes > 0.2 ? dyMes / 100 : dyMes;
  const estimado = dy * vpCota;
  if (rendimentosDistribuir > 0 && cotas > 0) {
    const direto = rendimentosDistribuir / cotas;
    if (estimado > 0 && Math.abs(direto / estimado - 1) <= 0.25) return direto;
  }
  return estimado;
}

export function nomeCurtoFii(nome) {
  const limpo = String(nome ?? "")
    .replace(/fundo de investimento imobili[aá]rio/gi, " ")
    .replace(/fundo de investimento/gi, " ")
    .replace(/responsabilidade limitada/gi, " ")
    .replace(/\b(fii|rl|ltda)\b/gi, " ")
    .replace(/\s+-\s*$|^\s*-\s+/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-–]$/, "")
    .trim();
  return nomeEmTitulo(limpo || nome);
}

function mesesAntes(mes, pregao) {
  const [a1, m1] = mes.split("-").map(Number);
  const [a2, m2] = pregao.slice(0, 7).split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

export function montarFiis({ informes, cotacoes, pregao }) {
  const porIsin = new Map();
  for (const i of informes) {
    if (!i.isin) continue;
    if (!porIsin.has(i.isin)) porIsin.set(i.isin, new Map());
    porIsin.get(i.isin).set(i.mes, i); // um informe por mês
  }
  const saida = {};
  for (const c of cotacoes.values()) {
    const mapa = porIsin.get(c.isin);
    if (!mapa) continue;
    const lista = [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
    const ultimo = lista.at(-1);
    if (mesesAntes(ultimo.mes, pregao) > 3) continue;
    const doze = lista.slice(-12);
    const rendimentos = doze.map((i) => ({ mes: i.mes, porCota: rendimentoPorCota(i) }));
    const valores = rendimentos.map((r) => r.porCota);
    const dy12m = doze.length === 12 && valores.every((v) => v !== null) && c.fechamento > 0
      ? arredondar((valores.reduce((s, v) => s + v, 0) / c.fechamento) * 100, 2)
      : null;
    saida[c.ticker] = {
      nome: nomeCurtoFii(ultimo.nome),
      isin: c.isin,
      tipo: tipoFii(ultimo),
      segmento: ultimo.segmento || null,
      fechamento: arredondar(c.fechamento, 2),
      dataFechamento: c.dataFechamento,
      vpCota: arredondar(ultimo.vpCota, 2),
      pvp: ultimo.vpCota > 0 ? arredondar(c.fechamento / ultimo.vpCota, 2) : null,
      dy12m,
      liquidezMedia21d: Math.round(c.volumeMedio21d),
      cotistas: ultimo.cotistas,
      informe: ultimo.mes,
      rendimentos: rendimentos.map((r) => ({ mes: r.mes, porCota: arredondar(r.porCota, 4) })),
    };
  }
  return Object.fromEntries(Object.keys(saida).sort().map((k) => [k, saida[k]]));
}
