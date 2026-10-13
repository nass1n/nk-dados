import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirZip } from "../src/util/zip.js";
import { decodificar } from "../src/util/csv.js";
import { lerCotahist, resumirCotacoes, eFii } from "../src/fontes/b3.js";
import { urlInformeFii, lerInformes } from "../src/fontes/fii.js";
import { tipoFii, rendimentoPorCota, montarFiis, nomeCurtoFii } from "../src/regras/fiis.js";

const fixture = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url));
const informes = [...lerInformes(fixture("fii/inf_mensal_fii_2025.zip"), 2025), ...lerInformes(fixture("fii/inf_mensal_fii_2026.zip"), 2026)];
const texto = decodificar(abrirZip(fixture("b3/COTAHIST_D09102026.ZIP")).ler("COTAHIST_D09102026.TXT"));
const cotacoes = resumirCotacoes(new Map([["2026-10-09", lerCotahist(texto)]]), eFii);

test("URL do informe mensal", () => {
  assert.equal(urlInformeFii(2026), "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_2026.zip");
});

test("lê e junta os três arquivos do informe", () => {
  const h = informes.find((i) => i.isin === "BRHGLGCTF004" && i.mes === "2026-08");
  assert.equal(h.cnpj, "11.728.688/0001-47");
  assert.equal(h.segmento, "Multicategoria");
  assert.equal(h.cotistas, 608345);
  assert.ok(Math.abs(h.vpCota - 165.951408188109) < 1e-9);
  assert.ok(Math.abs(h.dyMes - 0.007027) < 1e-9);
  assert.ok(h.imoveis > 0 && h.papel >= 0);
});

test("tipo pela composição do ativo", () => {
  const ultimo = (isin) => informes.filter((i) => i.isin === isin).sort((a, b) => a.mes.localeCompare(b.mes)).at(-1);
  assert.equal(tipoFii(ultimo("BRHGLGCTF004")), "Tijolo");
  assert.equal(tipoFii(ultimo("BRKNCRCTF000")), "Papel");
  assert.equal(tipoFii(ultimo("BRMXRFCTF008")), "Papel");
  assert.equal(tipoFii({ imoveis: 50, papel: 50, segmento: "" }), "Híbrido");
  assert.equal(tipoFii({ imoveis: 0, papel: 0, segmento: "Híbrido" }), "Híbrido");
});

test("rendimento por cota", () => {
  assert.equal(rendimentoPorCota({ dyMes: 0.0066, vpCota: 166.41, rendimentosDistribuir: 50161919.5, cotas: 45601745 }), 50161919.5 / 45601745);
  assert.ok(Math.abs(rendimentoPorCota({ dyMes: 0.0091, vpCota: 103.06, rendimentosDistribuir: 0, cotas: 1 }) - 0.937846) < 1e-6);
  assert.ok(Math.abs(rendimentoPorCota({ dyMes: 0.66, vpCota: 100, rendimentosDistribuir: 0, cotas: 1 }) - 0.66) < 1e-9);
  assert.equal(rendimentoPorCota({ dyMes: null, vpCota: 100, rendimentosDistribuir: 0, cotas: 1 }), null);
});

test("nome curto do fundo", () => {
  assert.equal(nomeCurtoFii("PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO"), "Pátria Log");
  assert.equal(nomeCurtoFii("FII MAXI RENDA RL"), "Maxi Renda");
});

test("monta fiis.json", () => {
  const fiis = montarFiis({ informes, cotacoes, pregao: "2026-10-09" });
  assert.deepEqual(Object.keys(fiis), ["BTLG11", "HGLG11", "KNCR11", "KNRI11", "MXRF11"]);
  const h = fiis.HGLG11;
  assert.equal(h.nome, "Pátria Log");
  assert.equal(h.tipo, "Tijolo");
  assert.equal(h.informe, "2026-08");
  assert.equal(h.fechamento, 157.58);
  assert.equal(h.vpCota, 165.95);
  assert.equal(h.pvp, 0.95);
  assert.equal(h.cotistas, 608345);
  assert.equal(h.liquidezMedia21d, 24678117);
  assert.deepEqual(h.rendimentos.map((r) => r.mes), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
    "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  assert.deepEqual(h.rendimentos.map((r) => r.porCota), [1.1, 1.1, 0.9574, 1.1, 1.1, 1.1, 1.1, 1.0734, 1.1, 1.1, 1.17, 1.1695]);
  assert.equal(h.dy12m, 8.36);
  assert.equal(fiis.MXRF11.tipo, "Papel");
  assert.equal(fiis.KNRI11.dy12m, 7.9);
});

test("fundo com informe velho fica de fora", () => {
  assert.deepEqual(montarFiis({ informes, cotacoes, pregao: "2027-01-15" }), {});
});
