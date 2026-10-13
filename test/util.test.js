import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { abrirZip } from "../src/util/zip.js";
import { decodificar, dividirLinha, lerCsv } from "../src/util/csv.js";
import { baixar } from "../src/util/http.js";
import {
  pascoa, feriadosB3, ehPregao, ultimosPregoes, diasUteis, agoraBrasilia, ultimoPregaoEncerrado, pregaoAnterior,
} from "../src/util/datas.js";
import { normalizar, numero, nomeEmTitulo, arredondar } from "../src/util/texto.js";

const fixture = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url));

test("zip: entradas guardadas e comprimidas", () => {
  const zip = abrirZip(fixture("amostra.zip"));
  assert.deepEqual([...zip.nomes].sort(), ["comprimido.csv", "guardado.txt"]);
  assert.equal(zip.ler("guardado.txt").toString("utf8"), "olá, guardado\n");
  assert.equal(zip.ler("comprimido.csv").toString("utf8"), "a;b\n1;2\n".repeat(50));
  assert.equal(zip.ler("nao-existe.txt"), null);
  assert.match(zip.lerPorPadrao(/\.csv$/).toString(), /^a;b/);
  assert.throws(() => abrirZip(Buffer.from("não sou um zip")), /zip inválido/);
});

test("csv: decodificação, aspas e filtro", () => {
  assert.equal(decodificar(Buffer.from([0x50, 0xe3, 0x6f])), "Pão");
  assert.equal(decodificar(Buffer.from("Pão", "utf8")), "Pão");
  assert.equal(decodificar(Buffer.from("﻿a;b", "utf8")), "a;b");
  assert.deepEqual(dividirLinha('a;"b;c";"d ""e"""'), ["a", "b;c", 'd "e"']);
  assert.deepEqual(dividirLinha("a;;c"), ["a", "", "c"]);
  const texto = "A;B\r\n1;x\r\n2;y\r\n\r\n";
  assert.deepEqual(lerCsv(texto), [{ A: "1", B: "x" }, { A: "2", B: "y" }]);
  assert.deepEqual(lerCsv(texto, { filtro: (o) => o.A === "2" }), [{ A: "2", B: "y" }]);
});

async function comServidor(tratar, fn) {
  const servidor = createServer(tratar);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${servidor.address().port}`);
  } finally {
    servidor.close();
  }
}

test("http: 404 vira null, 500 tenta de novo, esgota tentativas", async () => {
  let falhas = 0;
  await comServidor((req, res) => {
    if (req.url === "/ok") return res.end("conteúdo");
    if (req.url === "/instavel") {
      falhas++;
      if (falhas < 2) { res.statusCode = 500; return res.end(); }
      return res.end("voltou");
    }
    res.statusCode = req.url === "/sempre503" ? 503 : 404;
    res.end();
  }, async (base) => {
    assert.equal((await baixar(`${base}/ok`)).toString(), "conteúdo");
    assert.equal(await baixar(`${base}/nada`), null);
    assert.equal((await baixar(`${base}/instavel`, { esperasMs: [1, 1] })).toString(), "voltou");
    await assert.rejects(baixar(`${base}/sempre503`, { tentativas: 2, esperasMs: [1] }), /falha ao baixar/);
  });
});

test("datas: Páscoa, feriados, pregões e dias úteis", () => {
  assert.equal(pascoa(2026), "2026-04-05");
  assert.equal(pascoa(2027), "2027-03-28");
  const f = feriadosB3(2026);
  for (const d of ["2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01",
    "2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-20", "2026-12-24", "2026-12-25", "2026-12-31"]) {
    assert.ok(f.has(d), d);
  }
  assert.ok(!f.has("2026-02-18"));
  assert.ok(!feriadosB3(2023).has("2023-11-20"));
  assert.equal(ehPregao("2026-10-09"), true);
  assert.equal(ehPregao("2026-10-12"), false);
  assert.equal(pregaoAnterior("2026-10-13"), "2026-10-09");
  assert.deepEqual(ultimosPregoes("2026-10-13", 3), ["2026-10-08", "2026-10-09", "2026-10-13"]);
  assert.equal(diasUteis("2026-10-09", "2026-10-16"), 4);
  assert.equal(diasUteis("2026-10-09", "2026-12-18"), 47);
});

test("datas: horário de Brasília e último pregão encerrado", () => {
  assert.deepEqual(agoraBrasilia(new Date("2026-10-13T01:30:00Z")), { data: "2026-10-12", hora: 22, minuto: 30 });
  assert.equal(ultimoPregaoEncerrado(new Date("2026-10-13T01:30:00Z")), "2026-10-09");
  assert.equal(ultimoPregaoEncerrado(new Date("2026-10-13T21:59:00Z")), "2026-10-09");
  assert.equal(ultimoPregaoEncerrado(new Date("2026-10-13T22:00:00Z")), "2026-10-13");
  assert.equal(ultimoPregaoEncerrado(new Date("2026-10-14T01:30:00Z")), "2026-10-13");
});

test("texto: normalização, números, título e arredondamento", () => {
  assert.equal(normalizar("  Depreciação,   Amortização "), "depreciacao, amortizacao");
  assert.equal(normalizar(null), "");
  assert.equal(numero("71720089.0000000000"), 71720089);
  assert.equal(numero("-0.4849198253"), -0.4849198253);
  assert.equal(numero("1,5"), 1.5);
  assert.equal(numero(""), null);
  assert.equal(numero("abc"), null);
  assert.equal(nomeEmTitulo("PETROBRAS"), "Petrobras");
  assert.equal(nomeEmTitulo("CIA SANEAMENTO BÁSICO ESTADO SÃO PAULO"), "Cia Saneamento Básico Estado São Paulo");
  assert.equal(nomeEmTitulo("BCO SANTANDER (BRASIL) S.A."), "Bco Santander (Brasil) S.A.");
  assert.equal(nomeEmTitulo("CPFL ENERGIA S.A."), "CPFL Energia S.A.");
  assert.equal(nomeEmTitulo("BANCO DO BRASIL"), "Banco do Brasil");
  assert.equal(arredondar(1.23456, 2), 1.23);
  assert.equal(arredondar(-0.005, 2), -0.01);
  assert.equal(arredondar(null, 2), null);
  assert.equal(arredondar(NaN, 2), null);
});
