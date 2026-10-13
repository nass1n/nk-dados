import { abrirZip } from "../util/zip.js";
import { decodificar } from "../util/csv.js";

// COTAHIST diário da B3 (layout posicional de 245 colunas).
export function urlCotahist(data) {
  const [a, m, d] = data.split("-");
  return `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D${d}${m}${a}.ZIP`;
}

const campo = (l, ini, fim) => l.slice(ini - 1, fim);
const inteiro = (l, ini, fim) => Number(campo(l, ini, fim)) || 0;
const dataIso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export function lerCotahist(texto) {
  const registros = [];
  for (let linha of texto.split("\n")) {
    if (linha.endsWith("\r")) linha = linha.slice(0, -1);
    if (!linha.startsWith("01") || linha.length < 242) continue;
    const fator = inteiro(linha, 211, 217) || 1;
    const preco = (ini, fim) => inteiro(linha, ini, fim) / 100 / fator;
    const tpmerc = campo(linha, 25, 27);
    const opcao = tpmerc === "070" || tpmerc === "080";
    const venc = campo(linha, 203, 210);
    registros.push({
      data: dataIso(campo(linha, 3, 10)),
      codbdi: campo(linha, 11, 12),
      ticker: campo(linha, 13, 24).trim(),
      tpmerc,
      nome: campo(linha, 28, 39).trim(),
      especificacao: campo(linha, 40, 49),
      abertura: preco(57, 69),
      maxima: preco(70, 82),
      minima: preco(83, 95),
      media: preco(96, 108),
      fechamento: preco(109, 121),
      negocios: inteiro(linha, 148, 152),
      quantidade: inteiro(linha, 153, 170),
      volume: inteiro(linha, 171, 188) / 100,
      strike: opcao ? inteiro(linha, 189, 201) / 100 : null,
      vencimento: opcao && venc !== "99991231" ? dataIso(venc) : null,
      fatorCotacao: fator,
      isin: campo(linha, 231, 242).trim(),
    });
  }
  return registros;
}

export async function baixarPregao(data, { baixar }) {
  const buf = await baixar(urlCotahist(data));
  if (!buf) return null;
  let txt;
  try {
    txt = abrirZip(buf).lerPorPadrao(/\.TXT$/i);
  } catch {
    return null;
  }
  if (!txt) return null;
  const registros = lerCotahist(decodificar(txt));
  return registros.length ? registros : null;
}

export async function baixarPregoes(datas, { baixar, log = console.log }) {
  const mapa = new Map();
  const faltaram = [];
  for (const d of datas) {
    const r = await baixarPregao(d, { baixar });
    if (r) mapa.set(d, r);
    else faltaram.push(d);
  }
  if (faltaram.length) log(`aviso: COTAHIST não encontrado para ${faltaram.join(", ")}`);
  return mapa;
}

export const eAcao = (r) => r.tpmerc === "010" && ["02", "07", "08"].includes(r.codbdi);
export const eFii = (r) => r.tpmerc === "010" && r.codbdi === "12";
export const eOpcao = (r) => r.tpmerc === "070" || r.tpmerc === "080";
export const eCandidatoAtivoObjeto = (r) => r.tpmerc === "010" && ["02", "07", "08", "12", "14"].includes(r.codbdi);

export function classeDaEspecificacao(especificacao) {
  const t = String(especificacao ?? "").trim().split(/\s+/)[0];
  if (!t) return null;
  if (t === "UNT") return "UNIT";
  return ["ON", "PN", "PNA", "PNB", "PNC", "PND", "CI"].includes(t) ? t : null;
}

// Resumo por ticker: fechamento do pregão mais recente com negócio e volume médio
// (pregão sem negócio conta como zero).
export function resumirCotacoes(pregoes, filtro) {
  const datas = [...pregoes.keys()].sort();
  const resumo = new Map();
  for (const d of datas) {
    for (const r of pregoes.get(d)) {
      if (!filtro(r)) continue;
      let c = resumo.get(r.ticker);
      if (!c) {
        c = { ticker: r.ticker, isin: r.isin, nome: r.nome, especificacao: r.especificacao, codbdi: r.codbdi,
          fechamento: null, dataFechamento: null, volumeTotal: 0, pregoesComNegocio: 0 };
        resumo.set(r.ticker, c);
      }
      c.fechamento = r.fechamento;
      c.dataFechamento = d;
      c.isin = r.isin;
      c.nome = r.nome;
      c.especificacao = r.especificacao;
      c.codbdi = r.codbdi;
      c.volumeTotal += r.volume;
      c.pregoesComNegocio++;
    }
  }
  for (const c of resumo.values()) {
    c.volumeMedio21d = datas.length ? c.volumeTotal / datas.length : 0;
    delete c.volumeTotal;
  }
  return resumo;
}
