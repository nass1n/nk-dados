import { test } from "node:test";
import assert from "node:assert/strict";
import { lerJurosEua, buscarJurosEua, URL_FED } from "../src/fontes/fed.js";

const resposta = {
  refRates: [{
    effectiveDate: "2026-10-09", type: "EFFR", percentRate: 3.83, percentPercentile1: 3.8, percentPercentile25: 3.82,
    percentPercentile75: 3.84, percentPercentile99: 3.95, volumeInBillions: 101, targetRateFrom: 3.75, targetRateTo: 4,
  }],
};

test("lê a taxa efetiva e a meta do Fed", () => {
  assert.deepEqual(lerJurosEua(resposta), { efetiva: 3.83, metaMin: 3.75, metaMax: 4, data: "2026-10-09" });
  assert.throws(() => lerJurosEua({ refRates: [] }), /refRates/);
  assert.throws(() => lerJurosEua({ refRates: [{ effectiveDate: "2026-10-09" }] }), /sem taxa/);
});

test("busca pela URL pública do Fed de Nova York", async () => {
  const urls = [];
  const r = await buscarJurosEua({ baixar: async (u) => { urls.push(u); return Buffer.from(JSON.stringify(resposta)); } });
  assert.equal(urls[0], URL_FED);
  assert.equal(r.metaMax, 4);
  await assert.rejects(buscarJurosEua({ baixar: async () => Buffer.from("<html>") }), /inválida/);
});
