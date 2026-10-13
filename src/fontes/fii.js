import { abrirZip } from "../util/zip.js";
import { decodificar, lerCsv, coluna } from "../util/csv.js";
import { numero } from "../util/texto.js";

export const urlInformeFii = (ano) => `https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_${ano}.zip`;

const IMOVEIS_DETALHE = ["Terrenos", "Imoveis_Renda_Acabados", "Imoveis_Renda_Construcao", "Imoveis_Venda_Acabados",
  "Imoveis_Venda_Construcao", "Outros_Direitos_Reais"];
const PARTICIPACOES = ["Acoes_Sociedades_Atividades_FII", "Cotas_Sociedades_Atividades_FII"];
const PAPEL = ["CRI", "CRI_CRA", "LCI", "LCI_LCA", "Letras_Hipotecarias", "LIG", "Notas_Promissorias", "Debentures",
  "Cedulas_Debentures", "Certificados_Deposito_Valores_Mobiliarios", "Outros_Valores_Mobliarios", "FII", "Outras_Cotas_FI",
  "FDIC", "Fundo_Acoes", "FIP", "Acoes", "Bonus_Subscricao", "CEPAC"];

const cnpjDe = (r) => coluna(r, "CNPJ_Fundo_Classe", "CNPJ_Fundo");

function ultimaVersao(linhas) {
  const mapa = new Map();
  for (const r of linhas) {
    const k = `${cnpjDe(r)}|${r.Data_Referencia}`;
    const v = Number(r.Versao) || 0;
    const atual = mapa.get(k);
    if (!atual || v >= atual.v) mapa.set(k, { v, r });
  }
  return mapa;
}

function lerParte(zip, parte, ano) {
  const buf = zip.lerPorPadrao(new RegExp(`inf_mensal_fii_${parte}_${ano}\\.csv$`)) || zip.lerPorPadrao(new RegExp(`${parte}.*\\.csv$`));
  return buf ? ultimaVersao(lerCsv(decodificar(buf))) : new Map();
}

const soma = (r, campos) => campos.reduce((s, c) => s + (numero(r?.[c]) ?? 0), 0);

export function lerInformes(zipBuffer, ano) {
  const zip = abrirZip(zipBuffer);
  const geral = lerParte(zip, "geral", ano);
  const complemento = lerParte(zip, "complemento", ano);
  const ativo = lerParte(zip, "ativo_passivo", ano);
  const saida = [];
  for (const [k, { r: g }] of geral) {
    const c = complemento.get(k)?.r;
    const a = ativo.get(k)?.r;
    const imoveis = Math.max(numero(a?.Direitos_Bens_Imoveis) ?? 0, soma(a, IMOVEIS_DETALHE)) + soma(a, PARTICIPACOES);
    saida.push({
      cnpj: cnpjDe(g),
      mes: String(g.Data_Referencia).slice(0, 7),
      isin: String(g.Codigo_ISIN ?? "").trim(),
      nome: coluna(g, "Nome_Fundo_Classe", "Nome_Fundo") ?? "",
      segmento: g.Segmento_Atuacao || "",
      mandato: g.Mandato || "",
      cotas: numero(c?.Cotas_Emitidas) || numero(g.Quantidade_Cotas_Emitidas) || null,
      vpCota: numero(c?.Valor_Patrimonial_Cotas),
      patrimonio: numero(c?.Patrimonio_Liquido),
      cotistas: numero(c?.Total_Numero_Cotistas),
      dyMes: numero(c?.Percentual_Dividend_Yield_Mes),
      rendimentosDistribuir: numero(a?.Rendimentos_Distribuir),
      imoveis,
      papel: soma(a, PAPEL),
    });
  }
  return saida;
}
