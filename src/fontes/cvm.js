import { abrirZip } from "../util/zip.js";
import { decodificar, lerCsv, coluna } from "../util/csv.js";
import { normalizar, numero } from "../util/texto.js";

const BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA";
export const URLS_CVM = {
  dfp: (ano) => `${BASE}/DOC/DFP/DADOS/dfp_cia_aberta_${ano}.zip`,
  itr: (ano) => `${BASE}/DOC/ITR/DADOS/itr_cia_aberta_${ano}.zip`,
  fca: (ano) => `${BASE}/DOC/FCA/DADOS/fca_cia_aberta_${ano}.zip`,
  cadastro: `${BASE}/CAD/DADOS/cad_cia_aberta.csv`,
};

export function manterUltimaVersao(registros, chave) {
  const maior = new Map();
  for (const r of registros) {
    const k = chave(r);
    if (!maior.has(k) || r.versao > maior.get(k)) maior.set(k, r.versao);
  }
  return registros.filter((r) => r.versao === maior.get(chave(r)));
}

const TIPOS = [["DRE", "DRE"], ["BPA", "BPA"], ["BPP", "BPP"], ["DFC_MI", "DFC"], ["DFC_MD", "DFC"]];

function lerArquivoCsv(zip, nome) {
  const buf = zip.ler(nome);
  return buf ? decodificar(buf) : null;
}

// Linhas das demonstrações financeiras, em reais (escala aplicada), última versão.
export function lerDemonstracoes(zipBuffer, { doc, ano, apenasDre = false, filtro = () => true }) {
  const zip = abrirZip(zipBuffer);
  const saida = [];
  for (const [tipo, demonstracao] of TIPOS) {
    if (apenasDre && demonstracao !== "DRE") continue;
    for (const sufixo of ["con", "ind"]) {
      const texto = lerArquivoCsv(zip, `${doc}_cia_aberta_${tipo}_${sufixo}_${ano}.csv`);
      if (!texto) continue;
      const linhas = texto.split("\n");
      const cab = linhas[0].replace(/\r$/, "").split(";");
      const i = Object.fromEntries(cab.map((c, k) => [c, k]));
      for (let k = 1; k < linhas.length; k++) {
        let l = linhas[k];
        if (l.endsWith("\r")) l = l.slice(0, -1);
        if (!l) continue;
        const c = l.split(";");
        const conta = c[i.CD_CONTA];
        const valorBruto = numero(c[i.VL_CONTA]);
        if (valorBruto === null) continue;
        const escala = c[i.ESCALA_MOEDA] === "MIL" && !conta.startsWith("3.99") ? 1000 : 1;
        const linha = {
          cdCvm: Number(c[i.CD_CVM]),
          cnpj: c[i.CNPJ_CIA],
          dtRefer: c[i.DT_REFER],
          versao: Number(c[i.VERSAO]),
          doc,
          demonstracao,
          consolidado: sufixo === "con",
          ordem: c[i.ORDEM_EXERC],
          dtIni: i.DT_INI_EXERC !== undefined ? c[i.DT_INI_EXERC] || null : null,
          dtFim: c[i.DT_FIM_EXERC],
          conta,
          nome: normalizar(c[i.DS_CONTA]),
          descricao: c[i.DS_CONTA],
          valor: valorBruto * escala,
          contaFixa: c[i.ST_CONTA_FIXA] === "S",
        };
        if (filtro(linha)) saida.push(linha);
      }
    }
  }
  return manterUltimaVersao(saida, (l) => `${l.cdCvm}|${l.dtRefer}`);
}

export function lerIndiceDocumentos(zipBuffer, { doc, ano }) {
  const texto = lerArquivoCsv(abrirZip(zipBuffer), `${doc}_cia_aberta_${ano}.csv`);
  if (!texto) return [];
  const linhas = lerCsv(texto).map((r) => ({
    cnpj: r.CNPJ_CIA, cdCvm: Number(r.CD_CVM), dtRefer: r.DT_REFER, versao: Number(r.VERSAO), dtReceb: r.DT_RECEB,
  }));
  return manterUltimaVersao(linhas, (r) => `${r.cdCvm}|${r.dtRefer}`);
}

export function lerComposicaoCapital(zipBuffer, { doc, ano }) {
  const texto = lerArquivoCsv(abrirZip(zipBuffer), `${doc}_cia_aberta_composicao_capital_${ano}.csv`);
  if (!texto) return [];
  const n = (v) => numero(v) ?? 0;
  const linhas = lerCsv(texto).map((r) => ({
    cnpj: r.CNPJ_CIA,
    dtRefer: r.DT_REFER,
    versao: Number(r.VERSAO),
    on: n(r.QT_ACAO_ORDIN_CAP_INTEGR),
    pn: n(r.QT_ACAO_PREF_CAP_INTEGR),
    total: n(r.QT_ACAO_TOTAL_CAP_INTEGR),
    onTesouraria: n(r.QT_ACAO_ORDIN_TESOURO),
    pnTesouraria: n(r.QT_ACAO_PREF_TESOURO),
    totalTesouraria: n(r.QT_ACAO_TOTAL_TESOURO),
  }));
  return manterUltimaVersao(linhas, (r) => `${r.cnpj}|${r.dtRefer}`);
}

// Nome comercial, a não ser que ele traga palavra que não está na razão social (nome
// comercial desatualizado, como "BANCO UBS PACTUAL" para o BTG).
export function escolherNomeCadastro(denomComercial, denomSocial) {
  const c = String(denomComercial ?? "").trim();
  const s = String(denomSocial ?? "").trim();
  if (!c) return s;
  if (!s) return c;
  const social = new Set(normalizar(s).split(/[^a-z0-9]+/));
  const fora = normalizar(c).split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !social.has(p));
  return fora.length ? s : c;
}

// Cadastro de companhias abertas: só registros ativos (preferindo o de bolsa).
export function lerCadastro(texto) {
  const mapa = new Map();
  for (const r of lerCsv(texto)) {
    if (r.SIT !== "ATIVO") continue;
    const cdCvm = Number(r.CD_CVM);
    if (!cdCvm) continue;
    const atual = mapa.get(cdCvm);
    if (atual && atual.mercado === "BOLSA") continue;
    mapa.set(cdCvm, {
      cdCvm, cnpj: r.CNPJ_CIA, nome: escolherNomeCadastro(r.DENOM_COMERC, r.DENOM_SOCIAL), setor: r.SETOR_ATIV, situacao: r.SIT, mercado: r.TP_MERC,
    });
  }
  for (const v of mapa.values()) delete v.mercado;
  return mapa;
}

const TIPOS_VM = ["Ações Ordinárias", "Ações Preferenciais", "Units"];

export function lerValoresMobiliarios(zipBuffer, ano) {
  const texto = lerArquivoCsv(abrirZip(zipBuffer), `fca_cia_aberta_valor_mobiliario_${ano}.csv`);
  if (!texto) return [];
  const linhas = lerCsv(texto)
    .map((r) => ({
      cnpj: coluna(r, "CNPJ_Companhia", "CNPJ_CIA"),
      dtRefer: coluna(r, "Data_Referencia", "DT_REFER"),
      versao: Number(coluna(r, "Versao", "VERSAO")),
      nome: r.Nome_Empresarial || "",
      tipo: r.Valor_Mobiliario,
      ticker: String(r.Codigo_Negociacao ?? "").toUpperCase().replace(/\s+/g, ""),
      composicao: r.Composicao_BDR_Unit ?? "",
      fimNegociacao: r.Data_Fim_Negociacao || null,
    }))
    .filter((r) => TIPOS_VM.includes(r.tipo));
  const ultimo = new Map();
  for (const r of linhas) {
    const atual = ultimo.get(r.cnpj);
    if (!atual || r.dtRefer > atual.dtRefer || (r.dtRefer === atual.dtRefer && r.versao > atual.versao)) {
      ultimo.set(r.cnpj, { dtRefer: r.dtRefer, versao: r.versao });
    }
  }
  return linhas.filter((r) => {
    const u = ultimo.get(r.cnpj);
    return r.dtRefer === u.dtRefer && r.versao === u.versao;
  });
}

// Composição da unit em texto livre ("1 ON / 2 PN", "1 KLBN3 + 4 KLBN4", ...).
export function composicaoDaUnit(texto) {
  const t = normalizar(texto);
  const re = /(\d+)\s*(?:ac(?:ao|oes)\s+)?(ordinarias?|preferenciais?|on\b|pn[a-z]?s?\b|[a-z]{4}3\b|[a-z]{4}[4-8]\b)/g;
  let on = 0, pn = 0, achou = false, m;
  while ((m = re.exec(t))) {
    achou = true;
    const q = Number(m[1]);
    const cl = m[2];
    if (cl.startsWith("ordinaria") || cl === "on" || /^[a-z]{4}3$/.test(cl)) on += q;
    else pn += q;
  }
  return achou ? { on, pn } : null;
}
