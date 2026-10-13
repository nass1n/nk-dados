// Datas como texto YYYY-MM-DD; contas em UTC para não depender do fuso da máquina.
const DIA = 86400000;
const paraMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const paraData = (ms) => new Date(ms).toISOString().slice(0, 10);

export function somarDias(data, n) {
  return paraData(paraMs(data) + n * DIA);
}

export function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

const cacheFeriados = new Map();
export function feriadosB3(ano) {
  if (cacheFeriados.has(ano)) return cacheFeriados.get(ano);
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-24", "12-25", "12-31"];
  if (ano >= 2024) fixos.push("11-20");
  const p = pascoa(ano);
  const s = new Set(fixos.map((x) => `${ano}-${x}`));
  for (const n of [-48, -47, -2, 60]) s.add(somarDias(p, n));
  cacheFeriados.set(ano, s);
  return s;
}

export function ehPregao(data) {
  const dia = new Date(paraMs(data)).getUTCDay();
  return dia !== 0 && dia !== 6 && !feriadosB3(+data.slice(0, 4)).has(data);
}

export function pregaoAnterior(data) {
  let d = somarDias(data, -1);
  while (!ehPregao(d)) d = somarDias(d, -1);
  return d;
}

export function ultimosPregoes(dataFinal, n) {
  const lista = [];
  let d = ehPregao(dataFinal) ? dataFinal : pregaoAnterior(dataFinal);
  while (lista.length < n) {
    lista.unshift(d);
    d = pregaoAnterior(d);
  }
  return lista;
}

// Pregões d com inicio < d ≤ fim.
export function diasUteis(inicio, fim) {
  if (fim <= inicio) return 0;
  let n = 0;
  for (let d = somarDias(inicio, 1); d <= fim; d = somarDias(d, 1)) if (ehPregao(d)) n++;
  return n;
}

// Brasil sem horário de verão desde 2019: UTC−3 fixo.
export function agoraBrasilia(date = new Date()) {
  const b = new Date(date.getTime() - 3 * 3600000);
  return { data: b.toISOString().slice(0, 10), hora: b.getUTCHours(), minuto: b.getUTCMinutes() };
}

export function ultimoPregaoEncerrado(date = new Date()) {
  const { data, hora } = agoraBrasilia(date);
  if (ehPregao(data) && hora >= 19) return data;
  return pregaoAnterior(data);
}
