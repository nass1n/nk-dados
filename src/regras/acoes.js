import { normalizar, nomeEmTitulo, arredondar } from "../util/texto.js";
import { composicaoDaUnit } from "../fontes/cvm.js";

// ---------- filtro de leitura (mantém a memória baixa) ----------
const ehDA = (nome) =>
  /deprecia|exaust|deplec/.test(nome) ||
  (nome.startsWith("amortiza") && !/juros|custo|emprest|debent|financ/.test(nome));
const ehDividendo = (nome) =>
  /dividend|juros sobre (o )?capital|jcp|juros s\/ ?capital/.test(nome) && !/nao controladores|recebid/.test(nome);

export function linhaRelevante(l) {
  const { demonstracao: d, conta, nome } = l;
  if (d === "DRE") return conta.split(".").length <= 3 || conta.startsWith("3.99");
  if (d === "BPA") return ["1", "1.01", "1.01.01", "1.01.02"].includes(conta);
  if (d === "BPP") {
    return conta.startsWith("2.01.04") || conta.startsWith("2.02.01")
      || ((conta.startsWith("2.01") || conta.startsWith("2.02")) && nome.includes("arrendamento"))
      || nome.startsWith("patrimonio liquido") || nome.includes("nao controladores");
  }
  if (d === "DFC") return (conta.startsWith("6.01.01") && ehDA(nome)) || (conta.startsWith("6.03") && ehDividendo(nome));
  return false;
}

// ---------- agrupamento ----------
export function agruparEmpresas(linhas) {
  const empresas = new Map();
  for (const l of linhas) {
    let e = empresas.get(l.cdCvm);
    if (!e) { e = { cdCvm: l.cdCvm, cnpj: l.cnpj, docs: new Map() }; empresas.set(l.cdCvm, e); }
    const chave = `${l.doc}|${l.dtRefer}`;
    let doc = e.docs.get(chave);
    if (!doc) {
      doc = { doc: l.doc, dtRefer: l.dtRefer, linhas: {} };
      for (const dem of ["DRE", "BPA", "BPP", "DFC"]) doc.linhas[dem] = { con: [], ind: [] };
      e.docs.set(chave, doc);
    }
    doc.linhas[l.demonstracao][l.consolidado ? "con" : "ind"].push(l);
  }
  return empresas;
}

// ---------- auxiliares ----------
export function rotuloPeriodo(dtRefer) {
  const tri = Math.ceil(Number(dtRefer.slice(5, 7)) / 3);
  return `${tri}T${dtRefer.slice(2, 4)}`;
}

export function cagr(inicial, final, anos = 5) {
  if (!(inicial > 0) || !(final > 0)) return null;
  return ((final / inicial) ** (1 / anos) - 1) * 100;
}

export function dozeMeses({ fy, ultimo }, extrair) {
  const A = fy.dtRefer.slice(0, 4);
  const anual = extrair(fy, `${A}-01-01`, `${A}-12-31`);
  if (anual === null || anual === undefined) return null;
  if (ultimo === fy || ultimo.doc !== "itr") return anual;
  const B = ultimo.dtRefer.slice(0, 4);
  const atual = extrair(ultimo, `${B}-01-01`, ultimo.dtRefer);
  const anterior = extrair(ultimo, `${A}-01-01`, `${A}${ultimo.dtRefer.slice(4)}`);
  if (atual === null || atual === undefined || anterior === null || anterior === undefined) return null;
  return anual + atual - anterior;
}

const doPeriodo = (l, dtIni, dtFim) => l.dtIni === dtIni && l.dtFim === dtFim;
function escolher(doc, dem) {
  const g = doc.linhas[dem];
  return g.con.length ? g.con : g.ind;
}
function folhas(linhas) {
  const contas = new Set(linhas.map((l) => l.conta));
  return linhas.filter((l) => ![...contas].some((c) => c !== l.conta && c.startsWith(`${l.conta}.`)));
}
function somar(linhas) {
  return linhas.reduce((s, l) => s + l.valor, 0);
}

function tipoDaEmpresa(doc) {
  const receita = escolher(doc, "DRE").find((l) => l.conta === "3.01");
  const nome = receita ? receita.nome : "";
  if (nome.includes("intermediacao financeira")) return "banco";
  if (/seguradora|resseguradora|previdencia|capitalizacao|seguros|premios/.test(nome)) return "seguradora";
  return "empresa";
}

function contaDre(doc, codigo, dtIni, dtFim) {
  const l = escolher(doc, "DRE").find((x) => x.conta === codigo && doPeriodo(x, dtIni, dtFim));
  return l ? l.valor : null;
}

const linhaLucro = (dre) => dre.find((l) => l.conta.split(".").length === 2 && l.nome.startsWith("lucro/prejuizo")
  && /do periodo|do exercicio/.test(l.nome));

// Lucro dos controladores no período. Sem a linha (ou zerada com total ≠ 0): o lucro da
// DRE individual (a controladora) do mesmo período; sem ela, o total consolidado.
function lucroDoPeriodo(doc, dtIni, dtFim) {
  const dre = escolher(doc, "DRE").filter((l) => doPeriodo(l, dtIni, dtFim));
  const total = linhaLucro(dre);
  if (!total) return null;
  const contr = dre.find((l) => l.conta.startsWith(`${total.conta}.`) && l.nome.includes("atribuido a socios da empresa controladora"));
  if (contr && !(contr.valor === 0 && total.valor !== 0)) return contr.valor;
  if (doc.linhas.DRE.con.length) {
    const ind = linhaLucro(doc.linhas.DRE.ind.filter((l) => doPeriodo(l, dtIni, dtFim)));
    if (ind) return ind.valor;
  }
  return total.valor;
}

function daDoPeriodo(doc, dtIni, dtFim) {
  const g = doc.linhas.DFC;
  const daCon = g.con.filter((l) => l.conta.startsWith("6.01.01") && ehDA(l.nome));
  const base = daCon.length ? daCon : g.ind.filter((l) => l.conta.startsWith("6.01.01") && ehDA(l.nome));
  if (!base.length) return null;
  return somar(folhas(base.filter((l) => doPeriodo(l, dtIni, dtFim))));
}

function dividendosDoPeriodo(doc, dtIni, dtFim) {
  const g = doc.linhas.DFC;
  const base = g.ind.length ? g.ind : g.con;
  if (!base.length) return null;
  const linhas = base.filter((l) => l.conta.startsWith("6.03") && ehDividendo(l.nome) && doPeriodo(l, dtIni, dtFim));
  return Math.abs(somar(folhas(linhas)));
}

function balanco(doc) {
  const bpa = escolher(doc, "BPA").filter((l) => l.dtFim === doc.dtRefer);
  const bpp = escolher(doc, "BPP").filter((l) => l.dtFim === doc.dtRefer);
  const v = (linhas, c) => {
    const l = linhas.find((x) => x.conta === c);
    return l ? l.valor : 0;
  };
  const caixa = v(bpa, "1.01.01") + v(bpa, "1.01.02");
  const arrFora = folhas(bpp.filter((l) => (l.conta.startsWith("2.01.") || l.conta.startsWith("2.02."))
    && l.nome.includes("arrendamento") && !/^2\.0[12]\.0[14]/.test(l.conta)));
  const dividaBruta = v(bpp, "2.01.04") + v(bpp, "2.02.01") + somar(arrFora);
  const curta = (a, b) => a.conta.length - b.conta.length;
  const pl = bpp.filter((l) => l.nome.startsWith("patrimonio liquido")).sort(curta)[0];
  const minor = bpp.filter((l) => l.nome.includes("nao controladores") && l.conta.startsWith("2.0")).sort(curta)[0];
  return { caixa, dividaBruta, plControladores: pl ? pl.valor - (minor ? minor.valor : 0) : null };
}

function lpaInformado(doc, dtIni, dtFim) {
  for (const linhas of [doc.linhas.DRE.con, doc.linhas.DRE.ind]) {
    for (const c of ["3.99.01.01", "3.99.01.02"]) {
      const l = linhas.find((x) => x.conta === c && doPeriodo(x, dtIni, dtFim));
      if (l && l.valor) return l.valor;
    }
  }
  return null;
}

// Ações em circulação: escala (unidade ou mil) e tesouraria conferidas pelo LPA informado.
// Sem LPA informado, a escala sai do valor patrimonial por ação (entre R$ 0,05 e R$ 500).
export function acoesEmCirculacao({ capital, lucroAno, lpaInformado: lpa, patrimonio = null }) {
  if (!capital || !(capital.total > 0)) return null;
  const candidatos = [];
  for (const escala of [1, 1000]) {
    for (const modo of ["liquido", "bruto"]) {
      const liq = modo === "liquido";
      const total = (capital.total - (liq ? capital.totalTesouraria : 0)) * escala;
      const on = (capital.on - (liq ? capital.onTesouraria : 0)) * escala;
      const pn = (capital.pn - (liq ? capital.pnTesouraria : 0)) * escala;
      if (total > 0) candidatos.push({ total, on, pn, escala, modo });
    }
  }
  if (!candidatos.length) return null;
  if (lpa && lucroAno !== null && lucroAno !== undefined && lucroAno !== 0) {
    let melhor = null;
    for (const c of candidatos) {
      const calc = lucroAno / c.total;
      const erro = Math.abs(calc / lpa - 1);
      const dif = Math.abs(calc - lpa);
      if (!melhor || erro < melhor.erro) melhor = { c, erro, dif };
    }
    if (melhor.erro <= 0.15 || melhor.dif <= 0.01) return melhor.c;
    return null;
  }
  if (patrimonio > 0) {
    const plausiveis = candidatos.filter((c) => c.modo === "liquido" && patrimonio / c.total >= 0.05 && patrimonio / c.total <= 500);
    if (plausiveis.length === 1) return plausiveis[0];
  }
  return null;
}

// ---------- empresa ----------
export function calcularEmpresa(empresa, { capital }) {
  if (!empresa) return null;
  const docs = [...empresa.docs.values()];
  const dfps = docs.filter((d) => d.doc === "dfp" && d.linhas.DRE.con.length + d.linhas.DRE.ind.length > 0)
    .sort((a, b) => a.dtRefer.localeCompare(b.dtRefer));
  const fy = dfps.filter((d) => d.linhas.BPP.con.length + d.linhas.BPP.ind.length > 0).at(-1) || dfps.at(-1);
  if (!fy || !fy.dtRefer.endsWith("-12-31")) return null;
  const A = Number(fy.dtRefer.slice(0, 4));
  if (contaDre(fy, "3.01", `${A}-01-01`, `${A}-12-31`) === null) return null;
  const itr = docs.filter((d) => d.doc === "itr" && d.dtRefer > fy.dtRefer && d.dtRefer.startsWith(String(A + 1)))
    .sort((a, b) => a.dtRefer.localeCompare(b.dtRefer)).at(-1);
  const ultimo = itr || fy;
  const ref = { fy, ultimo };
  const tipo = tipoDaEmpresa(ultimo);

  const receita = dozeMeses(ref, (d, i, f) => contaDre(d, "3.01", i, f));
  const lucroBruto = dozeMeses(ref, (d, i, f) => contaDre(d, "3.03", i, f));
  const ebit = tipo === "empresa" ? dozeMeses(ref, (d, i, f) => contaDre(d, "3.05", i, f)) : null;
  const lucro = dozeMeses(ref, lucroDoPeriodo);
  const da = tipo === "empresa" ? dozeMeses(ref, daDoPeriodo) : null;
  const ebitda = ebit !== null && da !== null ? ebit + da : null;
  const dividendosPagos = dozeMeses(ref, dividendosDoPeriodo);

  const bal = balanco(ultimo);
  const financeira = tipo !== "empresa";
  const dividaBruta = financeira ? null : bal.dividaBruta;
  const caixa = financeira ? null : bal.caixa;

  const anoUlt = ultimo.dtRefer.slice(0, 4);
  const cap = capital.find((c) => c.cnpj === empresa.cnpj && c.dtRefer === ultimo.dtRefer);
  const acoes = acoesEmCirculacao({
    capital: cap,
    lucroAno: lucroDoPeriodo(ultimo, `${anoUlt}-01-01`, ultimo.dtRefer),
    lpaInformado: lpaInformado(ultimo, `${anoUlt}-01-01`, ultimo.dtRefer),
    patrimonio: bal.plControladores,
  });

  const anual = (ano, extrair) => {
    const candidatos = dfps.filter((d) => Number(d.dtRefer.slice(0, 4)) >= ano)
      .sort((a, b) => (a.dtRefer.startsWith(String(ano)) ? -1 : 0) - (b.dtRefer.startsWith(String(ano)) ? -1 : 0) || a.dtRefer.localeCompare(b.dtRefer));
    for (const d of candidatos) {
      const v = extrair(d, `${ano}-01-01`, `${ano}-12-31`);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };

  return {
    cdCvm: empresa.cdCvm,
    cnpj: empresa.cnpj,
    tipo,
    periodo: rotuloPeriodo(ultimo.dtRefer),
    dataBalanco: ultimo.dtRefer,
    receita,
    lucroBruto,
    ebit,
    lucro,
    da,
    ebitda,
    dividaBruta,
    caixa,
    dividaLiquida: dividaBruta !== null && caixa !== null ? dividaBruta - caixa : null,
    plControladores: bal.plControladores,
    dividendosPagos,
    acoes,
    cagrReceita5a: cagr(anual(A - 5, (d, i, f) => contaDre(d, "3.01", i, f)), anual(A, (d, i, f) => contaDre(d, "3.01", i, f))),
    cagrLucro5a: cagr(anual(A - 5, lucroDoPeriodo), anual(A, lucroDoPeriodo)),
  };
}

// ---------- ticker ----------
const CLASSE_POR_SUFIXO = { 3: "ON", 4: "PN", 5: "PNA", 6: "PNB", 7: "PNC", 8: "PND", 11: "UNIT" };
export const classeDoTicker = (ticker) => CLASSE_POR_SUFIXO[Number(ticker.slice(4))] ?? null;

export function indicadoresDoTicker({ fundamentos, classe, composicao, fechamento }) {
  const vazio = { lpa: null, vpa: null, pl: null, pvp: null };
  if (!fundamentos || !fundamentos.acoes) return vazio;
  const fator = classe === "UNIT" ? (composicao ? composicao.on + composicao.pn : null) : 1;
  if (!fator) return vazio;
  const lpa = fundamentos.lucro !== null ? (fundamentos.lucro / fundamentos.acoes.total) * fator : null;
  const vpa = fundamentos.plControladores !== null ? (fundamentos.plControladores / fundamentos.acoes.total) * fator : null;
  const ok = Number.isFinite(fechamento) && fechamento > 0;
  return {
    lpa, vpa,
    pl: ok && lpa > 0 ? fechamento / lpa : null,
    pvp: ok && vpa > 0 ? fechamento / vpa : null,
  };
}

export function setorExibicao(setor) {
  const s = String(setor ?? "").trim();
  if (!s) return null;
  if (/^Emp\. Adm\. Part(icipações|\.)?\s*(- Sem Setor Principal)?$/i.test(s)) return "Holdings";
  return s.replace(/^Emp\. Adm\. Part\. - /, "");
}

function nomeEmpresa(cad) {
  if (!cad) return null;
  return nomeEmTitulo(cad.nome).replace(/\s+(S\.A\.?|S\/A|SA)$/i, "").trim();
}

const GENERICAS = new Set(["banco", "bco", "cia", "companhia", "sa", "part", "participacoes", "holding", "brasil", "brasileira",
  "do", "de", "da", "dos", "das", "e", "s/a", "ltda", "grupo", "industria", "comercio", "on", "pn", "unt", "ed", "nm", "n1", "n2"]);
const tokens = (t) => normalizar(t).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !GENERICAS.has(p));

// Liga a raiz de 4 letras de um ticker sem linha válida no FCA a uma empresa que só tem
// códigos inválidos no FCA (ex.: o BTG informa "000000"), comparando o nome do pregão
// com o nome empresarial. Só vale com um único candidato.
export function vincularPorNome(nomePregao, candidatos) {
  const tp = tokens(nomePregao);
  const casam = candidatos.filter((c) => tokens(c.nome).some((a) => tp.some((b) => a.startsWith(b) || b.startsWith(a))));
  return casam.length === 1 ? casam[0].cnpj : null;
}

export function montarAcoes({ empresas, capital, cadastro, valoresMobiliarios, cotacoes, dataMinimaBalanco = null }) {
  const porCnpj = new Map([...empresas.values()].map((e) => [e.cnpj, e]));
  const tickerValido = (t) => /^[A-Z]{4}\d{1,2}$/.test(t);
  const cnpjDoTicker = new Map();
  const cnpjDaRaiz = new Map();
  for (const v of valoresMobiliarios) {
    if (!tickerValido(v.ticker)) continue;
    cnpjDoTicker.set(v.ticker, v.cnpj);
    if (!cnpjDaRaiz.has(v.ticker.slice(0, 4))) cnpjDaRaiz.set(v.ticker.slice(0, 4), v.cnpj);
  }
  const unitsPorCnpj = new Map();
  for (const v of valoresMobiliarios) {
    if (v.tipo !== "Units") continue;
    const comp = composicaoDaUnit(v.composicao);
    if (!comp) continue;
    if (!unitsPorCnpj.has(v.cnpj)) unitsPorCnpj.set(v.cnpj, []);
    unitsPorCnpj.get(v.cnpj).push({ ticker: v.ticker, comp });
  }

  // empresas que só informam códigos inválidos no FCA
  const comValido = new Set(cnpjDoTicker.values());
  const semValido = new Map();
  for (const v of valoresMobiliarios) {
    if (!comValido.has(v.cnpj) && porCnpj.has(v.cnpj)) semValido.set(v.cnpj, { cnpj: v.cnpj, nome: v.nome || "" });
  }

  // tickers por empresa
  const grupos = new Map();
  for (const c of cotacoes.values()) {
    const classe = classeDoTicker(c.ticker);
    if (!classe) continue;
    const raiz = c.ticker.slice(0, 4);
    if (!cnpjDoTicker.has(c.ticker) && !cnpjDaRaiz.has(raiz) && semValido.size) {
      const cnpjNome = vincularPorNome(c.nome, [...semValido.values()]);
      if (cnpjNome) cnpjDaRaiz.set(raiz, cnpjNome);
    }
    const cnpj = cnpjDoTicker.get(c.ticker) || cnpjDaRaiz.get(raiz);
    const empresa = cnpj && porCnpj.get(cnpj);
    if (!empresa) continue;
    if (!grupos.has(empresa.cdCvm)) grupos.set(empresa.cdCvm, { empresa, tickers: [] });
    grupos.get(empresa.cdCvm).tickers.push({ ...c, classe });
  }

  const saida = {};
  for (const { empresa, tickers } of grupos.values()) {
    const f = calcularEmpresa(empresa, { capital });
    if (!f) continue;
    if (dataMinimaBalanco && f.dataBalanco < dataMinimaBalanco) continue;
    const units = unitsPorCnpj.get(empresa.cnpj) || [];
    const composicaoDe = (t) => (units.find((u) => u.ticker === t) || (units.length === 1 ? units[0] : null))?.comp ?? null;

    // preço por classe para o valor de mercado
    const porVolume = [...tickers].sort((a, b) => b.volumeMedio21d - a.volumeMedio21d);
    const precoPorAcao = (t) => {
      if (t.classe !== "UNIT") return t.fechamento;
      const comp = composicaoDe(t.ticker);
      return comp ? t.fechamento / (comp.on + comp.pn) : null;
    };
    const referencia = porVolume.map(precoPorAcao).find((p) => Number.isFinite(p) && p > 0) ?? null;
    const precoOn = porVolume.find((t) => t.classe === "ON")?.fechamento ?? referencia;
    const precoPn = porVolume.find((t) => /^PN/.test(t.classe))?.fechamento ?? referencia;
    let valorMercado = null;
    if (f.acoes && precoOn !== null && precoPn !== null) {
      valorMercado = precoOn * f.acoes.on + precoPn * f.acoes.pn;
    }
    const cad = cadastro.get(empresa.cdCvm);
    const nome = nomeEmpresa(cad) || nomeEmTitulo(tickers[0].nome);
    for (const t of tickers) {
      const ind = indicadoresDoTicker({ fundamentos: f, classe: t.classe, composicao: composicaoDe(t.ticker), fechamento: t.fechamento });
      saida[t.ticker] = {
        cvm: f.cdCvm,
        empresa: nome,
        setor: setorExibicao(cad?.setor),
        classe: t.classe,
        periodo: f.periodo,
        dataBalanco: f.dataBalanco,
        fechamento: arredondar(t.fechamento, 2),
        dataFechamento: t.dataFechamento,
        volumeMedio21d: Math.round(t.volumeMedio21d),
        lpa: arredondar(ind.lpa, 4),
        vpa: arredondar(ind.vpa, 4),
        pl: arredondar(ind.pl, 2),
        pvp: arredondar(ind.pvp, 2),
        dy12m: valorMercado > 0 && f.dividendosPagos !== null ? arredondar((f.dividendosPagos / valorMercado) * 100, 2) : null,
        roe: f.plControladores > 0 && f.lucro !== null ? arredondar((f.lucro / f.plControladores) * 100, 2) : null,
        margemLiquida: f.receita > 0 && f.lucro !== null ? arredondar((f.lucro / f.receita) * 100, 2) : null,
        dividaLiqEbitda: f.tipo === "empresa" && f.ebitda > 0 && f.dividaLiquida !== null ? arredondar(f.dividaLiquida / f.ebitda, 2) : null,
        cagrReceita5a: arredondar(f.cagrReceita5a, 2),
        cagrLucro5a: arredondar(f.cagrLucro5a, 2),
        valorMercado: valorMercado !== null ? Math.round(valorMercado) : null,
        tipo: f.tipo,
      };
    }
  }
  return Object.fromEntries(Object.keys(saida).sort().map((k) => [k, saida[k]]));
}
