import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gerar } from "../src/gerar.js";
import { URLS_CVM } from "../src/fontes/cvm.js";
import { urlCotahist } from "../src/fontes/b3.js";
import { urlInformeFii } from "../src/fontes/fii.js";
import { URL_SELIC, buscarSelic } from "../src/fontes/bcb.js";
import { URL_FED } from "../src/fontes/fed.js";
import { validarAcoes, validarFiis, validarMercado, validarOpcoes, LIMITES_PADRAO } from "../src/validar.js";

const fixture = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url));
const arquivos = {
  [urlCotahist("2026-10-08")]: fixture("b3/COTAHIST_D08102026.ZIP"),
  [urlCotahist("2026-10-09")]: fixture("b3/COTAHIST_D09102026.ZIP"),
  [URL_SELIC]: Buffer.from('[{"data":"04/11/2026","valor":"13.75"}]'),
  [URL_FED]: Buffer.from('{"refRates":[{"effectiveDate":"2026-10-09","percentRate":3.83,"targetRateFrom":3.75,"targetRateTo":4}]}'),
  [URLS_CVM.cadastro]: fixture("cvm/cad_cia_aberta.csv"),
  [URLS_CVM.fca(2026)]: fixture("cvm/fca_cia_aberta_2026.zip"),
  [URLS_CVM.dfp(2025)]: fixture("cvm/dfp_cia_aberta_2025.zip"),
  [URLS_CVM.dfp(2021)]: fixture("cvm/dfp_cia_aberta_2021.zip"),
  [URLS_CVM.itr(2026)]: fixture("cvm/itr_cia_aberta_2026.zip"),
  [urlInformeFii(2025)]: fixture("fii/inf_mensal_fii_2025.zip"),
  [urlInformeFii(2026)]: fixture("fii/inf_mensal_fii_2026.zip"),
};
const baixar = async (url) => arquivos[url] ?? null;
const limites = { minAcoes: 3, acoesObrigatorias: ["PETR4", "VALE3", "ITUB4"], minFiis: 3, fiisObrigatorios: ["HGLG11", "KNRI11", "MXRF11"],
  minAtivosOpcoes: 3, ativosObrigatorios: ["PETR4", "VALE3", "BOVA11"] };
const ler = (dir, p) => JSON.parse(readFileSync(path.join(dir, p), "utf8"));

test("Selic do Banco Central", async () => {
  assert.deepEqual(await buscarSelic({ baixar }), { valor: 13.75, data: "2026-11-04" });
  await assert.rejects(buscarSelic({ baixar: async () => Buffer.from("[]") }));
});

test("validação: faixa vira null com aviso; poucos itens é erro", () => {
  const acao = (x = {}) => ({ pl: 5, pvp: 1, margemLiquida: 10, roe: 15, dy12m: 6, dividaLiqEbitda: 1, cagrReceita5a: 5, cagrLucro5a: 5, ...x });
  const acoes = { PETR4: acao({ pl: 5000 }), VALE3: acao(), ITUB4: acao({ dy12m: -1 }) };
  const r = validarAcoes(acoes, { ...LIMITES_PADRAO, minAcoes: 3 });
  assert.equal(r.ok, true);
  assert.equal(acoes.PETR4.pl, null);
  assert.equal(acoes.ITUB4.dy12m, null);
  assert.equal(r.avisos.length, 2);
  const r2 = validarAcoes({ PETR4: acao() }, LIMITES_PADRAO);
  assert.ok(!r2.ok && r2.erros.some((e) => e.includes("300")) && r2.erros.some((e) => e.includes("VALE3")));
  const fiis = { HGLG11: { pvp: 20, dy12m: 8 }, KNRI11: { pvp: 1, dy12m: 70 }, MXRF11: { pvp: 1, dy12m: 11 } };
  assert.equal(validarFiis(fiis, { ...LIMITES_PADRAO, minFiis: 3 }).ok, true);
  assert.equal(fiis.HGLG11.pvp, null);
  assert.equal(fiis.KNRI11.dy12m, null);
  assert.equal(validarMercado({ pregao: "2026-10-09", selic: 13.75 }, "2026-10-09").ok, true);
  assert.equal(validarMercado({ pregao: "2026-10-08", selic: 13.75 }, "2026-10-09").ok, false);
  const serie = { ticker: "X", tipo: "call", strike: 10, vencimento: "2026-11-19", premio: 1, dataUltimoNegocio: "2026-10-01", vi: 500, delta: 1 };
  const op = validarOpcoes({ indice: { pregao: "2026-10-09", selic: 13.75, ativos: [{ ticker: "PETR4" }] }, arquivos: { PETR4: { fechamentoAtivo: 10, series: [serie] } } }, LIMITES_PADRAO);
  assert.equal(serie.vi, null);
  assert.equal(serie.delta, null);
  assert.equal(op.ok, false);
});

test("gera os arquivos a partir das fontes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nk-dados-"));
  const r = await gerar({ agora: new Date("2026-10-10T12:00:00Z"), baixar, diretorioSaida: dir, limites, log: () => {} });
  assert.equal(r.publicado, true);
  const mercado = ler(dir, "mercado.json");
  assert.equal(mercado.pregao, "2026-10-09");
  assert.equal(mercado.selic, 13.75);
  assert.equal(mercado.fontes.b3, "2026-10-09");
  assert.match(mercado.geradoEm, /-03:00$/);
  assert.deepEqual(mercado.jurosEua, { efetiva: 3.83, metaMin: 3.75, metaMax: 4, data: "2026-10-09" });
  assert.equal(mercado.fontes.fed, "2026-10-09");
  assert.equal(ler(dir, "acoes.json").PETR4.pl, 5.41);
  assert.equal(ler(dir, "fiis.json").HGLG11.dy12m, 8.36);
  assert.ok(ler(dir, "opcoes/indice.json").ativos.some((a) => a.ticker === "PETR4"));
  assert.ok(existsSync(path.join(dir, "opcoes/PETR4.json")));
});

test("sem a resposta do Fed os juros dos EUA ficam nulos e o resto publica", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nk-dados-"));
  const semFed = async (url) => (url === URL_FED ? null : arquivos[url] ?? null);
  const r = await gerar({ agora: new Date("2026-10-10T12:00:00Z"), baixar: semFed, diretorioSaida: dir, limites, log: () => {} });
  assert.equal(r.publicado, true);
  assert.equal(ler(dir, "mercado.json").jurosEua, null);
});

test("execução noturna sem o arquivo do pregão termina sem publicar", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nk-dados-"));
  const r = await gerar({ agora: new Date("2026-10-14T01:30:00Z"), baixar, diretorioSaida: dir, modo: "noturno", limites, log: () => {} });
  assert.equal(r.publicado, false);
  assert.equal(existsSync(path.join(dir, "mercado.json")), false);
  await assert.rejects(gerar({ agora: new Date("2026-10-14T10:30:00Z"), baixar, diretorioSaida: dir, modo: "matinal", limites, log: () => {} }));
});
