import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodificar } from "../src/util/csv.js";
import {
  URLS_CVM, manterUltimaVersao, lerDemonstracoes, lerIndiceDocumentos, lerComposicaoCapital, lerCadastro,
  lerValoresMobiliarios, composicaoDaUnit, escolherNomeCadastro,
} from "../src/fontes/cvm.js";

const fixture = (p) => readFileSync(new URL(`./fixtures/cvm/${p}`, import.meta.url));
const itr = lerDemonstracoes(fixture("itr_cia_aberta_2026.zip"), { doc: "itr", ano: 2026 });

test("URLs oficiais", () => {
  assert.equal(URLS_CVM.dfp(2025), "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_2025.zip");
  assert.equal(URLS_CVM.itr(2026), "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_2026.zip");
  assert.equal(URLS_CVM.fca(2026), "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_2026.zip");
  assert.equal(URLS_CVM.cadastro, "https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv");
});

test("aplica a escala em reais e não escala o lucro por ação", () => {
  const receita = itr.find((l) => l.cdCvm === 9512 && l.demonstracao === "DRE" && l.consolidado && l.conta === "3.01"
    && l.dtIni === "2026-01-01" && l.dtFim === "2026-06-30");
  assert.equal(receita.valor, 293216000000);
  assert.equal(receita.nome, "receita de venda de bens e/ou servicos");
  const lpa = itr.find((l) => l.cdCvm === 9512 && l.consolidado && l.conta === "3.99.01.01" && l.dtIni === "2026-01-01" && l.dtFim === "2026-06-30");
  assert.equal(lpa.valor, 6.6);
});

test("empresa sem consolidado só tem linhas individuais", () => {
  const asai = itr.filter((l) => l.cdCvm === 25372);
  assert.ok(asai.length > 0 && asai.every((l) => !l.consolidado));
  const lucro = asai.find((l) => l.demonstracao === "DRE" && l.conta === "3.11" && l.dtIni === "2026-01-01" && l.dtFim === "2026-06-30");
  assert.equal(lucro.valor, 804000000);
});

test("DFC_MI vira DFC, filtro na leitura e só DRE", () => {
  const so6 = lerDemonstracoes(fixture("itr_cia_aberta_2026.zip"), { doc: "itr", ano: 2026, filtro: (l) => l.conta.startsWith("6.") });
  assert.ok(so6.length > 0 && so6.every((l) => l.demonstracao === "DFC"));
  const dre = lerDemonstracoes(fixture("dfp_cia_aberta_2025.zip"), { doc: "dfp", ano: 2025, apenasDre: true });
  assert.ok(dre.length > 0 && dre.every((l) => l.demonstracao === "DRE"));
});

test("mantém só a última versão", () => {
  const r = manterUltimaVersao([{ k: "a", versao: 1 }, { k: "a", versao: 3 }, { k: "a", versao: 3 }, { k: "b", versao: 1 }], (x) => x.k);
  assert.deepEqual(r, [{ k: "a", versao: 3 }, { k: "a", versao: 3 }, { k: "b", versao: 1 }]);
  assert.ok(itr.filter((l) => l.cdCvm === 4170 && l.dtRefer === "2026-06-30").every((l) => l.versao === 3));
});

test("índice de documentos e composição do capital", () => {
  const indice = lerIndiceDocumentos(fixture("itr_cia_aberta_2026.zip"), { doc: "itr", ano: 2026 });
  assert.ok(indice.some((d) => d.cdCvm === 9512 && d.dtRefer === "2026-06-30" && /^\d{4}-\d{2}-\d{2}$/.test(d.dtReceb)));
  const cap = lerComposicaoCapital(fixture("itr_cia_aberta_2026.zip"), { doc: "itr", ano: 2026 });
  assert.deepEqual(cap.find((c) => c.cnpj === "33.592.510/0001-54" && c.dtRefer === "2026-06-30"), {
    cnpj: "33.592.510/0001-54", dtRefer: "2026-06-30", versao: 3, on: 4255763, pn: 0, total: 4255763,
    onTesouraria: 183397, pnTesouraria: 0, totalTesouraria: 183397,
  });
});

test("cadastro: ativos, bolsa e nome comercial desatualizado", () => {
  const cad = lerCadastro(decodificar(fixture("cad_cia_aberta.csv")));
  assert.deepEqual(cad.get(9512), { cdCvm: 9512, cnpj: "33.000.167/0001-01", nome: "PETROBRAS", setor: "Petróleo e Gás", situacao: "ATIVO" });
  assert.equal(cad.get(22616).nome, "BANCO BTG PACTUAL S/A");
  assert.equal(cad.has(1279), false);
  assert.equal(escolherNomeCadastro("PETROBRAS", "PETRÓLEO BRASILEIRO S.A. - PETROBRAS"), "PETROBRAS");
  assert.equal(escolherNomeCadastro("", "X S.A."), "X S.A.");
});

test("valores mobiliários do FCA", () => {
  const vm = lerValoresMobiliarios(fixture("fca_cia_aberta_2026.zip"), 2026);
  const taee11 = vm.find((v) => v.ticker === "TAEE11");
  assert.equal(taee11.tipo, "Units");
  assert.equal(taee11.composicao, "1 ON / 2 PN");
  assert.equal(taee11.cnpj, "07.859.971/0001-30");
  assert.equal(vm.find((v) => v.ticker === "PETR4").tipo, "Ações Preferenciais");
  assert.ok(vm.every((v) => ["Ações Ordinárias", "Ações Preferenciais", "Units"].includes(v.tipo)));
  const btg = vm.find((v) => v.cnpj === "30.306.294/0001-45");
  assert.equal(btg.ticker, "000000");
  assert.equal(btg.nome, "BCO BTG PACTUAL S.A.");
});

test("composição das units em texto livre", () => {
  assert.deepEqual(composicaoDaUnit("1 ON / 2 PN"), { on: 1, pn: 2 });
  assert.deepEqual(composicaoDaUnit("1 KLBN3 + 4 KLBN4"), { on: 1, pn: 4 });
  assert.deepEqual(composicaoDaUnit("1 ação ordinária e 4 ações preferenciais"), { on: 1, pn: 4 });
  assert.deepEqual(composicaoDaUnit("2 ações preferenciais e 1 ação ordinária"), { on: 1, pn: 2 });
  assert.deepEqual(composicaoDaUnit("1 ON E 2 PNA"), { on: 1, pn: 2 });
  assert.deepEqual(composicaoDaUnit("1 ON e 2PNs"), { on: 1, pn: 2 });
  assert.equal(composicaoDaUnit(""), null);
  assert.equal(composicaoDaUnit("abc"), null);
});
