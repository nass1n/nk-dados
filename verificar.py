import json, time, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone, timedelta

UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
BRT = timezone(timedelta(hours=-3))

def pedir(url, corpo=None, cabecalhos=None):
    h = {"User-Agent": UA, "Accept": "application/json,text/plain,*/*"}
    h.update(cabecalhos or {})
    dados = json.dumps(corpo).encode() if corpo is not None else None
    if dados: h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=dados, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:500]
    except Exception as e:
        return None, repr(e)

def data(ts):
    return datetime.fromtimestamp(ts, BRT).strftime("%Y-%m-%d %H:%M") if ts else None

print("agora (BRT):", datetime.now(BRT).strftime("%Y-%m-%d %H:%M"))

# 1) Yahoo, como o app faz hoje (TIO=F, 1 dia em 5 min) e o histórico diário
for sim in ["TIO=F"]:
    for faixa, intervalo in [("1d", "5m"), ("1mo", "1d")]:
        st, txt = pedir(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sim)}?range={faixa}&interval={intervalo}")
        print(f"\n== Yahoo {sim} {faixa}/{intervalo} HTTP {st}")
        try:
            r = json.loads(txt)["chart"]["result"][0]
        except Exception:
            print(txt[:300]); continue
        m = r["meta"]
        print({k: m.get(k) for k in ["symbol", "shortName", "longName", "exchangeName", "currency", "regularMarketPrice",
                                     "chartPreviousClose", "previousClose", "regularMarketDayHigh", "regularMarketDayLow",
                                     "regularMarketVolume"]}, "| hora do preço:", data(m.get("regularMarketTime")))
        ts = r.get("timestamp") or []
        q = (r.get("indicators", {}).get("quote") or [{}])[0]
        linhas = [(data(t), c, v) for t, c, v in zip(ts, q.get("close") or [], q.get("volume") or [])]
        print("candles:", len(linhas))
        for l in linhas[-12:]:
            print("  ", l)

# 2) TradingView: busca de símbolos de minério de ferro
for texto in ["iron ore", "FEF", "TIO"]:
    st, txt = pedir("https://symbol-search.tradingview.com/symbol_search/v3/?" + urllib.parse.urlencode(
        {"text": texto, "hl": "1", "exchange": "", "lang": "en", "search_type": "futures", "domain": "production"}),
        cabecalhos={"Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"})
    print(f"\n== TradingView busca '{texto}' HTTP {st}")
    try:
        j = json.loads(txt)
        itens = j.get("symbols", j) if isinstance(j, dict) else j
        for s in itens[:15]:
            print("  ", s.get("exchange"), s.get("symbol"), "|", s.get("description"), "|", s.get("type"), s.get("currency_code"),
                  "| contratos:", [c.get("symbol") for c in (s.get("contracts") or [])][:6])
    except Exception as e:
        print(txt[:300])

# 3) TradingView scanner de futuros: candidatos
COLS = ["name", "description", "close", "change", "change_abs", "currency", "update_mode", "type", "volume",
        "exchange", "high", "low", "open"]
cand = ["SGX:FEF1!", "SGX:FEF2!", "SGX:FEF3!", "SGX:FEF!", "COMEX:TIO1!", "COMEX:TIO2!", "NYMEX:TIO1!",
        "DCE:I1!", "DCE:I2!", "DCE:I!", "SGX:FEFX2026", "SGX:FEFZ2026", "COMEX:TIOX2026", "COMEX:TIOZ2026"]
for mercado in ["futures", "global"]:
    st, txt = pedir(f"https://scanner.tradingview.com/{mercado}/scan",
                    {"symbols": {"tickers": cand, "query": {"types": []}}, "columns": COLS},
                    {"Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"})
    print(f"\n== TradingView scanner {mercado} HTTP {st}")
    try:
        j = json.loads(txt)
        print("totalCount", j.get("totalCount"))
        for d in j.get("data") or []:
            print("  ", d["s"], dict(zip(COLS, d["d"])))
    except Exception:
        print(txt[:400])
