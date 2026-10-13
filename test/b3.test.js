import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirZip } from "../src/util/zip.js";
import { decodificar } from "../src/util/csv.js";
import {
  urlCotahist, lerCotahist, baixarPregao, baixarPregoes, eAcao, eFii, eOpcao, eCandidatoAtivoObjeto,
  classeDaEspecificacao, resumirCotacoes,
} from "../src/fontes/b3.js";

// Recorte real do COTAHIST de 09/10/2026 (ver test/fixtures/LEIAME.md).
const zipAmostra = readFileSync(new URL("./fixtures/b3/COTAHIST_D09102026.ZIP", import.meta.url));
const texto = decodificar(abrirZip(zipAmostra).ler("COTAHIST_D09102026.TXT"));
const registros = lerCotahist(texto);
const por = (t) => registros.find((r) => r.ticker === t);

test("URL do arquivo diário", () => {
  assert.equal(urlCotahist("2026-10-09"), "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D09102026.ZIP");
});

test("lê ações, FIIs e ETFs do layout posicional", () => {
  assert.equal(registros.length, 76);
  assert.deepEqual({ ...por("PETR4") }, {
    data: "2026-10-09", codbdi: "02", ticker: "PETR4", tpmerc: "010", nome: "PETROBRAS", especificacao: "PN      N2",
    abertura: 55.45, maxima: 56.8, minima: 55.1, media: 56.07, fechamento: 56, negocios: 91623, quantidade: 49809400,
    volume: 2793039893, strike: null, vencimento: null, fatorCotacao: 1, isin: "BRPETRACNPR6",
  });
  assert.equal(por("HGLG11").fechamento, 157.58);
  assert.equal(por("HGLG11").isin, "BRHGLGCTF004");
  assert.equal(por("BOVA11").codbdi, "14");
});

test("lê opções com strike, vencimento e ISIN do ativo-objeto", () => {
  const call = por("PETRJ408");
  assert.equal(call.tpmerc, "070");
  assert.equal(call.strike, 39.11);
  assert.equal(call.vencimento, "2026-10-16");
  assert.equal(call.fechamento, 16.69);
  assert.equal(call.isin, "BRPETRACNPR6");
  const put = registros.find((r) => r.tpmerc === "080" && r.ticker.startsWith("PETR"));
  assert.ok(put.strike > 0 && /^\d{4}-\d{2}-\d{2}$/.test(put.vencimento));
});

test("divide os preços pelo fator de cotação", () => {
  const linha = texto.split("\n").find((l) => l.slice(12, 24).trim() === "PETR4").replace(/\r$/, "");
  const comFator = linha.slice(0, 210) + "0001000" + linha.slice(217);
  assert.equal(lerCotahist(comFator)[0].fechamento, 0.056);
});

test("classifica registros", () => {
  assert.ok(eAcao(por("PETR4")) && !eAcao(por("BOVA11")) && !eAcao(por("HGLG11")));
  assert.ok(eFii(por("HGLG11")) && eOpcao(por("PETRJ408")));
  assert.ok(eCandidatoAtivoObjeto(por("BOVA11")) && !eCandidatoAtivoObjeto(por("PETRJ408")));
  assert.equal(classeDaEspecificacao("PN      N2"), "PN");
  assert.equal(classeDaEspecificacao("UNT     N2"), "UNIT");
  assert.equal(classeDaEspecificacao("PNA     N1"), "PNA");
  assert.equal(classeDaEspecificacao(""), null);
});

test("baixa um pregão e devolve null quando o arquivo não existe", async () => {
  const baixar = async (url) => (url === urlCotahist("2026-10-09") ? zipAmostra : null);
  assert.equal((await baixarPregao("2026-10-09", { baixar })).length, 76);
  assert.equal(await baixarPregao("2026-10-08", { baixar }), null);
  const avisos = [];
  const mapa = await baixarPregoes(["2026-10-08", "2026-10-09"], { baixar, log: (m) => avisos.push(m) });
  assert.deepEqual([...mapa.keys()], ["2026-10-09"]);
  assert.ok(avisos.some((m) => m.includes("2026-10-08")));
});

test("resume fechamento e volume médio por ticker", () => {
  const ontem = registros.filter((r) => r.ticker === "PETR4").map((r) => ({ ...r, data: "2026-10-08", fechamento: 50, volume: 1000 }));
  const resumo = resumirCotacoes(new Map([["2026-10-08", ontem], ["2026-10-09", registros]]), eAcao);
  const petr4 = resumo.get("PETR4");
  assert.equal(petr4.fechamento, 56);
  assert.equal(petr4.dataFechamento, "2026-10-09");
  assert.equal(petr4.volumeMedio21d, (2793039893 + 1000) / 2);
  assert.equal(petr4.pregoesComNegocio, 2);
  assert.equal(resumo.get("VALE3").pregoesComNegocio, 1);
  assert.equal(resumo.has("HGLG11"), false);
});
