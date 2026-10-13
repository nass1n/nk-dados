import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirZip } from "../src/util/zip.js";
import { decodificar } from "../src/util/csv.js";
import { lerDemonstracoes, lerComposicaoCapital, lerCadastro, lerValoresMobiliarios } from "../src/fontes/cvm.js";
import { lerCotahist, resumirCotacoes, eAcao } from "../src/fontes/b3.js";
import {
  linhaRelevante, agruparEmpresas, calcularEmpresa, montarAcoes, rotuloPeriodo, dozeMeses, cagr,
  acoesEmCirculacao, indicadoresDoTicker, setorExibicao, vincularPorNome,
} from "../src/regras/acoes.js";

// Gabarito conferido na investigação com as mesmas planilhas (Python/pandas) e com os
// números públicos do Status Invest em 12/10/2026.
const fixture = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url));
const linhas = [
  ...lerDemonstracoes(fixture("cvm/dfp_cia_aberta_2025.zip"), { doc: "dfp", ano: 2025, filtro: linhaRelevante }),
  ...lerDemonstracoes(fixture("cvm/dfp_cia_aberta_2021.zip"), { doc: "dfp", ano: 2021, apenasDre: true, filtro: linhaRelevante }),
  ...lerDemonstracoes(fixture("cvm/itr_cia_aberta_2026.zip"), { doc: "itr", ano: 2026, filtro: linhaRelevante }),
];
const capital = [
  ...lerComposicaoCapital(fixture("cvm/dfp_cia_aberta_2025.zip"), { doc: "dfp", ano: 2025 }),
  ...lerComposicaoCapital(fixture("cvm/itr_cia_aberta_2026.zip"), { doc: "itr", ano: 2026 }),
];
const empresas = agruparEmpresas(linhas);
const f = (cd) => calcularEmpresa(empresas.get(cd), { capital });
const perto = (real, esperado, tol = 1) => assert.ok(Math.abs(real - esperado) <= tol, `${real} ≠ ${esperado}`);

test("Petrobras: 12 meses até 2T26, dívida com arrendamento e EBITDA com D&A desacumulada", () => {
  const p = f(9512);
  assert.equal(p.tipo, "empresa");
  assert.equal(p.periodo, "2T26");
  assert.equal(p.dataBalanco, "2026-06-30");
  perto(p.receita, 548493000000);
  perto(p.lucroBruto, 277512000000);
  perto(p.ebit, 185746000000);
  perto(p.lucro, 133376000000);
  perto(p.da, 87577000000);
  perto(p.ebitda, 273323000000);
  perto(p.dividaBruta, 366533000000);
  perto(p.caixa, 53764000000);
  perto(p.dividaLiquida, 312769000000);
  perto(p.plControladores, 480950000000);
  perto(p.dividendosPagos, 38327000000);
  assert.deepEqual(p.acoes, { total: 12888732761, on: 7442231382, pn: 5446501379, escala: 1, modo: "liquido" });
  perto(p.cagrReceita5a, 12.8318, 0.001);
});

test("Assaí: só individual, arrendamento em outras contas e ações em milhares", () => {
  const a = f(25372);
  perto(a.dividaBruta, 16282000000 + 10711000000);
  perto(a.lucro, 965000000);
  perto(a.receita, 77566000000);
  assert.deepEqual(a.acoes, { total: 1338440000, on: 1338440000, pn: 0, escala: 1000, modo: "liquido" });
});

test("Sabesp e Klabin: controladores em branco usam o lucro da controladora", () => {
  perto(f(14443).lucro, 8040221000);
  assert.equal(f(14443).acoes.total, 3506830477);
  assert.equal(f(12653).acoes.total, 6152895333);
});

test("Cosan: PL dos controladores e prejuízo", () => {
  const c = f(19836);
  perto(c.plControladores, 4968466000);
  perto(c.lucro, -8892040000);
  assert.equal(c.acoes.total, 3944366465);
});

test("Vale: ações em milhares já líquidas da tesouraria", () => {
  const v = f(4170);
  assert.deepEqual(v.acoes, { total: 4255763000, on: 4255763000, pn: 0, escala: 1000, modo: "bruto" });
  perto(v.lucro, 10369000000);
});

test("bancos: sem dívida nem EBITDA; sem LPA informado a escala sai do VPA", () => {
  const i = f(19348);
  assert.equal(i.tipo, "banco");
  assert.equal(i.dividaBruta, null);
  assert.equal(i.ebitda, null);
  perto(i.lucro, 46828000000);
  assert.equal(i.acoes.total, 11026869000);
  const btg = f(22616);
  assert.equal(btg.tipo, "banco");
  assert.equal(btg.acoes.escala, 1);
});

test("funções auxiliares", () => {
  assert.equal(rotuloPeriodo("2026-06-30"), "2T26");
  assert.equal(rotuloPeriodo("2025-12-31"), "4T25");
  assert.ok(Math.abs(cagr(100, 161.051) - 10) < 1e-9);
  assert.equal(cagr(-5, 10), null);
  const fy = { doc: "dfp", dtRefer: "2025-12-31" };
  const ultimo = { doc: "itr", dtRefer: "2026-06-30" };
  const valores = { "2025-01-01|2025-12-31": 100, "2026-01-01|2026-06-30": 60, "2025-01-01|2025-06-30": 40 };
  assert.equal(dozeMeses({ fy, ultimo }, (_d, i, f2) => valores[`${i}|${f2}`] ?? null), 120);
  assert.equal(dozeMeses({ fy, ultimo: fy }, (_d, i, f2) => valores[`${i}|${f2}`] ?? null), 100);
  assert.equal(dozeMeses({ fy, ultimo }, () => null), null);
  assert.equal(setorExibicao("Emp. Adm. Part. - Energia Elétrica"), "Energia Elétrica");
  assert.equal(setorExibicao("Emp. Adm. Part. - Sem Setor Principal"), "Holdings");
  assert.equal(setorExibicao("Petróleo e Gás"), "Petróleo e Gás");
  assert.equal(vincularPorNome("BTGP BANCO", [{ cnpj: "1", nome: "BCO BTG PACTUAL S.A." }, { cnpj: "2", nome: "OUTRA CIA" }]), "1");
  assert.equal(vincularPorNome("BANCO", [{ cnpj: "1", nome: "BCO BTG PACTUAL S.A." }]), null);
});

test("ações em circulação conferidas pelo LPA informado", () => {
  const cap = { on: 900, pn: 0, total: 1000, onTesouraria: 100, pnTesouraria: 0, totalTesouraria: 100 };
  assert.equal(acoesEmCirculacao({ capital: cap, lucroAno: 900, lpaInformado: 1 }).modo, "liquido");
  assert.equal(acoesEmCirculacao({ capital: { ...cap, total: 1, on: 1, totalTesouraria: 0, onTesouraria: 0 }, lucroAno: 900, lpaInformado: 0.9 }).escala, 1000);
  assert.equal(acoesEmCirculacao({ capital: cap, lucroAno: 900, lpaInformado: 50 }), null);
});

test("indicadores por ticker, inclusive unit", () => {
  const fundamentos = { lucro: 1e9, plControladores: 1e10, acoes: { total: 1e9 } };
  assert.deepEqual(indicadoresDoTicker({ fundamentos, classe: "UNIT", composicao: { on: 1, pn: 2 }, fechamento: 30 }), { lpa: 3, vpa: 30, pl: 10, pvp: 1 });
  assert.deepEqual(indicadoresDoTicker({ fundamentos, classe: "UNIT", composicao: null, fechamento: 30 }), { lpa: null, vpa: null, pl: null, pvp: null });
  assert.equal(indicadoresDoTicker({ fundamentos: { ...fundamentos, lucro: -1e9 }, classe: "ON", composicao: null, fechamento: 30 }).pl, null);
});

test("monta acoes.json por ticker", () => {
  const z = (n) => decodificar(abrirZip(fixture(`b3/${n}`)).lerPorPadrao(/\.TXT$/));
  const cotacoes = resumirCotacoes(new Map([["2026-10-09", lerCotahist(z("COTAHIST_D09102026.ZIP"))]]), eAcao);
  const acoes = montarAcoes({
    empresas, capital,
    cadastro: lerCadastro(decodificar(fixture("cvm/cad_cia_aberta.csv"))),
    valoresMobiliarios: lerValoresMobiliarios(fixture("cvm/fca_cia_aberta_2026.zip"), 2026),
    cotacoes,
  });
  const p = acoes.PETR4;
  assert.equal(p.cvm, 9512);
  assert.equal(p.empresa, "Petrobras");
  assert.equal(p.setor, "Petróleo e Gás");
  assert.equal(p.classe, "PN");
  assert.equal(p.fechamento, 56);
  assert.equal(p.dataFechamento, "2026-10-09");
  assert.equal(p.volumeMedio21d, 2793039893);
  assert.equal(p.lpa, 10.3483);
  assert.equal(p.vpa, 37.3155);
  assert.equal(p.pl, 5.41);
  assert.equal(p.pvp, 1.5);
  assert.equal(p.roe, 27.73);
  assert.equal(p.margemLiquida, 24.32);
  assert.equal(p.dividaLiqEbitda, 1.14);
  assert.equal(p.valorMercado, Math.round(63.06 * 7442231382 + 56 * 5446501379));
  assert.equal(p.dy12m, 4.95);
  assert.equal(acoes.PETR3.classe, "ON");
  assert.equal(acoes.VALE3.pl, 27.87);
  assert.equal(acoes.ITUB4.tipo, "banco");
  assert.equal(acoes.ITUB4.dividaLiqEbitda, null);
  assert.equal(acoes.TAEE11.classe, "UNIT");
  assert.equal(acoes.TAEE11.lpa, Math.round(acoes.TAEE3.lpa * 3 * 1e4) / 1e4);
  assert.equal(acoes.BPAC11.empresa, "Banco BTG Pactual");
  assert.ok(acoes.BPAC11.pl > 0 && acoes.KLBN11.pvp > 0);
});
