import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirZip } from "../src/util/zip.js";
import { decodificar } from "../src/util/csv.js";
import { lerCotahist } from "../src/fontes/b3.js";
import { diasUteis } from "../src/util/datas.js";
import { cdfNormal, taxaContinua, precoBlackScholes, gregas, volatilidadeImplicita, montarOpcoes } from "../src/regras/opcoes.js";

const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const base = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 };
const ler = (n) => lerCotahist(decodificar(abrirZip(readFileSync(new URL(`./fixtures/b3/${n}`, import.meta.url))).lerPorPadrao(/\.TXT$/)));

test("distribuição normal", () => {
  perto(cdfNormal(0), 0.5, 1e-7);
  perto(cdfNormal(1.96), 0.9750021, 1e-6);
  perto(cdfNormal(-1.96), 0.0249979, 1e-6);
});

test("preço e gregas contra valores de referência", () => {
  perto(precoBlackScholes({ tipo: "call", ...base }), 10.4506, 1e-4);
  perto(precoBlackScholes({ tipo: "put", ...base }), 5.5735, 1e-4);
  const c = gregas({ tipo: "call", ...base });
  perto(c.delta, 0.6368, 1e-4);
  perto(c.gama, 0.018762, 1e-6);
  perto(c.vega, 0.37524, 1e-5);
  perto(c.theta, -6.41404 / 252, 1e-6);
  const p = gregas({ tipo: "put", ...base });
  perto(p.delta, -0.3632, 1e-4);
  perto(p.theta, -1.65789 / 252, 1e-6);
  perto(taxaContinua(13.75), Math.log(1.1375), 1e-15);
});

test("volatilidade implícita reconstrói o prêmio", () => {
  const premio = precoBlackScholes({ tipo: "put", S: 56, K: 54, T: 30 / 252, r: taxaContinua(13.75), sigma: 0.31 });
  perto(volatilidadeImplicita({ tipo: "put", premio, S: 56, K: 54, T: 30 / 252, r: taxaContinua(13.75) }), 0.31, 1e-5);
  assert.equal(volatilidadeImplicita({ tipo: "call", premio: 15, S: 100, K: 80, T: 0.1, r: 0.1 }), null);
});

test("monta grade e índice com dois pregões reais", () => {
  const pregoes = new Map([["2026-10-08", ler("COTAHIST_D08102026.ZIP")], ["2026-10-09", ler("COTAHIST_D09102026.ZIP")]]);
  const { indice, arquivos } = montarOpcoes({ pregoes, pregao: "2026-10-09", selic: 13.75 });
  assert.equal(indice.pregao, "2026-10-09");
  assert.deepEqual(indice.ativos.map((a) => a.ticker).sort(), ["BOVA11", "PETR3", "PETR4", "VALE3"]);
  const petr4 = indice.ativos.find((a) => a.ticker === "PETR4");
  assert.equal(petr4.raiz, "PETR");
  assert.equal(petr4.nome, "PETROBRAS");
  assert.equal(petr4.series, arquivos.PETR4.series.length);
  assert.ok(indice.maisNegociadas.length > 0 && indice.maisNegociadas.length <= 10);
  assert.ok(indice.maisNegociadas.every((m, i, l) => i === 0 || l[i - 1].volume >= m.volume));
  const s = arquivos.PETR4.series.find((x) => x.ticker === "PETRK403");
  assert.deepEqual({ tipo: s.tipo, strike: s.strike, vencimento: s.vencimento, premio: s.premio, dataUltimoNegocio: s.dataUltimoNegocio },
    { tipo: "call", strike: 39.16, vencimento: "2026-11-19", premio: 16.96, dataUltimoNegocio: "2026-10-09" });
  assert.equal(arquivos.PETR4.fechamentoAtivo, 56);
  assert.ok(arquivos.PETR3.series.length > 0, "séries sobre PETR3 vão para o arquivo da PETR3");
  const r = taxaContinua(13.75);
  for (const arquivo of Object.values(arquivos)) {
    for (const serie of arquivo.series) {
      assert.ok(serie.vencimento > "2026-10-09");
      if (serie.vi === null) { assert.equal(serie.delta, null); continue; }
      const S = serie.dataUltimoNegocio === "2026-10-09" ? arquivo.fechamentoAtivo : null;
      if (S === null) continue;
      const T = diasUteis(serie.dataUltimoNegocio, serie.vencimento) / 252;
      const preco = precoBlackScholes({ tipo: serie.tipo, S, K: serie.strike, T, r, sigma: serie.vi / 100 });
      assert.ok(Math.abs(preco - serie.premio) < 0.01, serie.ticker);
    }
  }
});

test("ativo-objeto pela raiz quando o ISIN não aparece", () => {
  const registros = ler("COTAHIST_D09102026.ZIP").map((x) => (x.ticker === "PETRK403" ? { ...x, isin: "BRXXXXXXXXX0" } : x));
  const { arquivos } = montarOpcoes({ pregoes: new Map([["2026-10-09", registros]]), pregao: "2026-10-09", selic: 13.75 });
  assert.ok(arquivos.PETR4.series.some((s) => s.ticker === "PETRK403"), "PETR4 é o papel PETR de maior volume");
});
