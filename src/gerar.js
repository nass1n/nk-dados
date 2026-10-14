import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { baixar as baixarHttp } from "./util/http.js";
import { decodificar } from "./util/csv.js";
import { ultimoPregaoEncerrado, ultimosPregoes, somarDias } from "./util/datas.js";
import { baixarPregao, baixarPregoes, resumirCotacoes, eAcao, eFii } from "./fontes/b3.js";
import {
  URLS_CVM, lerDemonstracoes, lerIndiceDocumentos, lerComposicaoCapital, lerCadastro, lerValoresMobiliarios,
} from "./fontes/cvm.js";
import { urlInformeFii, lerInformes } from "./fontes/fii.js";
import { buscarSelic } from "./fontes/bcb.js";
import { buscarJurosEua } from "./fontes/fed.js";
import { linhaRelevante, agruparEmpresas, montarAcoes } from "./regras/acoes.js";
import { montarFiis } from "./regras/fiis.js";
import { montarOpcoes } from "./regras/opcoes.js";
import { LIMITES_PADRAO, validarAcoes, validarFiis, validarOpcoes, validarMercado } from "./validar.js";

function isoBrasilia(date) {
  const b = new Date(date.getTime() - 3 * 3600000);
  return `${b.toISOString().slice(0, 19)}-03:00`;
}

function resumirAvisos(avisos, log) {
  if (!avisos.length) return;
  const tipos = new Map();
  for (const a of avisos) {
    const tipo = a.replace(/^[A-Z0-9]+(\.\w+)?/, "*").replace(/[-\d.,]+/g, "#");
    tipos.set(tipo, (tipos.get(tipo) || 0) + 1);
  }
  log(`avisos: ${avisos.length}`);
  for (const [t, n] of [...tipos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) log(`  ${n} × ${t}`);
  for (const a of avisos.slice(0, 10)) log(`  ex.: ${a}`);
}

export async function gerar({
  agora = new Date(), baixar = baixarHttp, diretorioSaida = "dados", modo = "manual", log = console.log,
  diagnostico = false, limites = LIMITES_PADRAO,
} = {}) {
  const inicio = Date.now();
  const pregao = ultimoPregaoEncerrado(agora);
  log(`pregão de referência: ${pregao} (modo ${modo})`);

  // 1. COTAHIST do pregão
  const doDia = await baixarPregao(pregao, { baixar });
  if (!doDia) {
    const motivo = `COTAHIST de ${pregao} ainda não publicado`;
    if (modo === "noturno") {
      log(`${motivo}; a execução das 7h30 tenta de novo`);
      return { publicado: false, motivo, resumo: {} };
    }
    throw new Error(motivo);
  }

  // 2. pregões anteriores
  const datas = ultimosPregoes(pregao, 21).filter((d) => d !== pregao);
  const pregoes = await baixarPregoes(datas, { baixar, log });
  pregoes.set(pregao, doDia);
  const ordenadas = [...pregoes.keys()].sort();
  const pregoes10 = new Map(ordenadas.slice(-10).map((d) => [d, pregoes.get(d)]));
  log(`COTAHIST: ${pregoes.size} pregões`);

  // 3. Selic
  const selic = await buscarSelic({ baixar });
  log(`Selic: ${selic.valor}% (${selic.data})`);
  let jurosEua = null;
  try {
    jurosEua = await buscarJurosEua({ baixar });
    log(`Juros EUA: meta ${jurosEua.metaMin}–${jurosEua.metaMax}%, efetiva ${jurosEua.efetiva}% (${jurosEua.data})`);
  } catch (e) {
    log(`aviso: juros dos EUA indisponíveis (${e.message})`);
  }

  // 4. CVM
  const ano = Number(pregao.slice(0, 4));
  const pegar = async (url, rotulo) => {
    const buf = await baixar(url);
    if (!buf) log(`aviso: ${rotulo} não encontrado (${url})`);
    return buf;
  };
  const cadBuf = await pegar(URLS_CVM.cadastro, "cadastro");
  const cadastro = cadBuf ? lerCadastro(decodificar(cadBuf)) : new Map();

  const vmPorAno = [];
  for (const a of [ano, ano - 1]) {
    const buf = await pegar(URLS_CVM.fca(a), `FCA ${a}`);
    if (buf) vmPorAno.push(lerValoresMobiliarios(buf, a));
  }
  const vistos = new Set();
  const valoresMobiliarios = [];
  for (const lista of vmPorAno) {
    const novos = lista.filter((v) => !vistos.has(v.cnpj));
    for (const v of novos) valoresMobiliarios.push(v);
    for (const v of novos) vistos.add(v.cnpj);
  }

  const linhas = [];
  const capital = [];
  let recebimento = "";
  for (let a = ano - 1; a >= ano - 6; a--) {
    const buf = await pegar(URLS_CVM.dfp(a), `DFP ${a}`);
    if (!buf) continue;
    const apenasDre = a <= ano - 3;
    for (const l of lerDemonstracoes(buf, { doc: "dfp", ano: a, apenasDre, filtro: linhaRelevante })) linhas.push(l);
    if (!apenasDre) {
      capital.push(...lerComposicaoCapital(buf, { doc: "dfp", ano: a }));
      for (const d of lerIndiceDocumentos(buf, { doc: "dfp", ano: a })) if (d.dtReceb > recebimento) recebimento = d.dtReceb;
    }
  }
  for (const a of [ano, ano - 1]) {
    const buf = await pegar(URLS_CVM.itr(a), `ITR ${a}`);
    if (!buf) continue;
    for (const l of lerDemonstracoes(buf, { doc: "itr", ano: a, filtro: linhaRelevante })) linhas.push(l);
    capital.push(...lerComposicaoCapital(buf, { doc: "itr", ano: a }));
    for (const d of lerIndiceDocumentos(buf, { doc: "itr", ano: a })) if (d.dtReceb > recebimento) recebimento = d.dtReceb;
  }
  log(`CVM: ${linhas.length} linhas de demonstrações, ${capital.length} composições de capital, ${valoresMobiliarios.length} valores mobiliários`);

  const informes = [];
  for (const a of [ano, ano - 1]) {
    const buf = await pegar(urlInformeFii(a), `informe FII ${a}`);
    if (buf) informes.push(...lerInformes(buf, a));
  }
  log(`FII: ${informes.length} informes`);

  // 5. cálculo
  const empresas = agruparEmpresas(linhas);
  const acoes = montarAcoes({
    empresas, capital, cadastro, valoresMobiliarios, cotacoes: resumirCotacoes(pregoes, eAcao),
    dataMinimaBalanco: somarDias(pregao, -550),
  });
  const fiis = montarFiis({ informes, cotacoes: resumirCotacoes(pregoes, eFii), pregao });
  const opcoes = montarOpcoes({ pregoes: pregoes10, pregao, selic: selic.valor });
  log(`calculado: ${Object.keys(acoes).length} ações, ${Object.keys(fiis).length} FIIs, ${opcoes.indice.ativos.length} ativos com opções`);

  const mercado = {
    geradoEm: isoBrasilia(new Date()),
    pregao,
    selic: selic.valor,
    jurosEua,
    fontes: { cvm: recebimento || null, b3: pregao, bcb: selic.data, fed: jurosEua?.data ?? null },
  };

  // 6. validação
  const validacoes = [
    validarMercado(mercado, pregao),
    validarAcoes(acoes, limites),
    validarFiis(fiis, limites),
    validarOpcoes(opcoes, limites),
  ];
  const erros = validacoes.flatMap((v) => v.erros);
  resumirAvisos([...opcoes.avisos, ...validacoes.flatMap((v) => v.avisos)], log);
  for (const t of ["PETR4", "VALE3", "ITUB4", "TAEE11", "KLBN11", "BPAC11"]) log(`${t}: ${JSON.stringify(acoes[t] ?? null)}`);
  for (const t of ["HGLG11", "MXRF11", "KNRI11"]) log(`${t}: ${JSON.stringify(fiis[t] ?? null)}`);
  log(`opções mais negociadas: ${JSON.stringify(opcoes.indice.maisNegociadas.slice(0, 3))}`);

  if (erros.length) {
    for (const e of erros) log(`ERRO: ${e}`);
    if (!diagnostico) throw new Error(`validação falhou: ${erros.join("; ")}`);
  }

  // 7. gravação
  const dir = diretorioSaida;
  mkdirSync(path.join(dir, "opcoes"), { recursive: true });
  writeFileSync(path.join(dir, "mercado.json"), `${JSON.stringify(mercado, null, 2)}\n`);
  writeFileSync(path.join(dir, "acoes.json"), JSON.stringify(acoes));
  writeFileSync(path.join(dir, "fiis.json"), JSON.stringify(fiis));
  writeFileSync(path.join(dir, "opcoes", "indice.json"), JSON.stringify(opcoes.indice));
  const atuais = new Set(Object.keys(opcoes.arquivos).map((a) => `${a}.json`));
  for (const [ativo, arquivo] of Object.entries(opcoes.arquivos)) {
    writeFileSync(path.join(dir, "opcoes", `${ativo}.json`), JSON.stringify(arquivo));
  }
  if (existsSync(path.join(dir, "opcoes"))) {
    for (const f of readdirSync(path.join(dir, "opcoes"))) {
      if (f !== "indice.json" && !atuais.has(f)) rmSync(path.join(dir, "opcoes", f));
    }
  }
  const resumo = {
    pregao, acoes: Object.keys(acoes).length, fiis: Object.keys(fiis).length, ativosOpcoes: opcoes.indice.ativos.length,
    segundos: Math.round((Date.now() - inicio) / 1000),
  };
  log(`publicado: ${JSON.stringify(resumo)}`);
  return { publicado: true, resumo, erros };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const diagnostico = process.argv.includes("--diagnostico");
  gerar({ modo: process.env.MODO || "manual", diagnostico, diretorioSaida: diagnostico ? "saida-diagnostico" : "dados" })
    .catch((e) => {
      console.error(e.stack || e.message);
      if (!diagnostico) process.exitCode = 1;
    });
}
