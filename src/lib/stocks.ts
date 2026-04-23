export type Quote = {
  symbol: string;
  price: number;
  changePct: number;
};

const FINNHUB = 'https://finnhub.io/api/v1/quote';

export async function fetchQuotes(symbols: string[], apiKey: string): Promise<Quote[]> {
  const results = await Promise.allSettled(
    symbols.map(async (raw) => {
      const symbol = raw.trim().replace('-', '.');
      const res = await fetch(`${FINNHUB}?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
      if (!res.ok) throw new Error(`finnhub ${res.status} for ${symbol}`);
      const j = (await res.json()) as { c: number; dp: number };
      if (!j.c || Number.isNaN(j.c)) throw new Error(`no data for ${symbol}`);
      return { symbol, price: j.c, changePct: j.dp ?? 0 };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<Quote> => r.status === 'fulfilled')
    .map((r) => r.value);
}
