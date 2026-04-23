import { useEffect, useMemo, useState } from 'react';
import { Cloud, CloudRain, CloudSun, Sun, Wind, Sunrise, Car } from 'lucide-react';
import { fetchCalendar, type CalendarDay } from './lib/calendar';
import {
  geocode,
  fetchWeather,
  type CurrentWeather,
  type DailyForecast,
  type LatLon,
  type WeatherIconType,
} from './lib/weather';
import { getBackgroundImage, fetchPhotoIds, photoUrl } from './lib/photo';
import {
  fetchCommuteTimes,
  parseDestinations,
  type Commute,
} from './lib/traffic';
import { fetchQuotes, type Quote } from './lib/stocks';

const CITY = import.meta.env.VITE_WEATHER_CITY ?? 'Oakland';
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';
const HOME = import.meta.env.VITE_HOME_ADDRESS ?? '';
const DESTINATIONS = parseDestinations(import.meta.env.VITE_COMMUTE ?? '');
const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_API_KEY ?? '';
const TICKERS = (import.meta.env.VITE_TICKERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function WeatherIcon({ type, className = '' }: { type: WeatherIconType; className?: string }) {
  if (type === 'rain') return <CloudRain className={className} />;
  if (type === 'partly') return <CloudSun className={className} />;
  if (type === 'sun') return <Sun className={className} />;
  return <Cloud className={className} />;
}

function dayLabel(date: Date, idx: number): string {
  if (idx === 0) return 'Today';
  if (idx === 1) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'long' });
}

function footerLabel(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
}

function formatEventTime(ev: { start: Date; allDay: boolean }): string {
  if (ev.allDay) return 'All day';
  return ev.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function trafficColor(minutes: number, typical: number): string {
  if (!typical) return 'text-white/95';
  const ratio = minutes / typical;
  if (ratio >= 1.25) return 'text-rose-400';
  if (ratio >= 1.10) return 'text-amber-300';
  return 'text-white/95';
}

function TickerRow({ quotes }: { quotes: Quote[] }) {
  if (!quotes.length) return null;
  const doubled = [...quotes, ...quotes];
  return (
    <div className="flex animate-marquee whitespace-nowrap">
      {doubled.map((q, i) => {
        const up = q.changePct >= 0;
        return (
          <span key={i} className="px-6 text-[13px] md:text-[14px] flex items-baseline gap-2">
            <span className="font-medium text-white">{q.symbol}</span>
            <span className="text-white/80">{q.price.toFixed(2)}</span>
            <span className={up ? 'text-emerald-400' : 'text-rose-400'}>
              {up ? '▲' : '▼'} {Math.abs(q.changePct).toFixed(2)}%
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [current, setCurrent] = useState<CurrentWeather | null>(null);
  const [forecast, setForecast] = useState<DailyForecast[]>([]);
  const [commutes, setCommutes] = useState<Commute[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [calErr, setCalErr] = useState<string | null>(null);
  const [wxErr, setWxErr] = useState<string | null>(null);
  const [trafficErr, setTrafficErr] = useState<string | null>(null);
  const [stocksErr, setStocksErr] = useState<string | null>(null);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [photoIdx, setPhotoIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cal = await fetchCalendar(7);
        if (!cancelled) { setDays(cal); setCalErr(null); }
      } catch (e) {
        if (!cancelled) setCalErr(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const t = setInterval(load, 15 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let coords: LatLon | null = null;

    async function load() {
      try {
        if (!coords) coords = await geocode(CITY);
        const { current: c, forecast: f } = await fetchWeather(coords.lat, coords.lon);
        if (!cancelled) { setCurrent(c); setForecast(f); setWxErr(null); }
      } catch (e) {
        if (!cancelled) setWxErr(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!MAPS_KEY || !HOME || !DESTINATIONS.length) return;
    let cancelled = false;
    async function load() {
      try {
        const c = await fetchCommuteTimes(HOME, DESTINATIONS, MAPS_KEY);
        c.sort((a, b) => a.minutes - b.minutes);
        if (!cancelled) { setCommutes(c); setTrafficErr(null); }
      } catch (e) {
        if (!cancelled) setTrafficErr(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    fetchPhotoIds().then(setPhotoIds);
  }, []);

  useEffect(() => {
    if (photoIds.length < 2) return;
    const t = setInterval(() => {
      setPhotoIdx((i) => (i + 1) % photoIds.length);
    }, 60_000);
    return () => clearInterval(t);
  }, [photoIds.length]);

  useEffect(() => {
    if (photoIds.length < 2) return;
    const next = photoUrl(photoIds[(photoIdx + 1) % photoIds.length]);
    const img = new Image();
    img.src = next;
  }, [photoIdx, photoIds]);

  useEffect(() => {
    if (!FINNHUB_KEY || !TICKERS.length) return;
    let cancelled = false;
    async function load() {
      try {
        const q = await fetchQuotes(TICKERS, FINNHUB_KEY);
        if (!cancelled) { setQuotes(q); setStocksErr(null); }
      } catch (e) {
        if (!cancelled) setStocksErr(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const formatted = useMemo(() => ({
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    day: now.toLocaleDateString([], { weekday: 'long' }),
    monthDay: now.toLocaleDateString([], { month: 'long', day: 'numeric' }),
  }), [now]);

  const bg = photoIds.length > 0 ? photoUrl(photoIds[photoIdx]) : getBackgroundImage();
  const sunrise = current?.sunrise
    ? current.sunrise.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '--:--';

  const today = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now]);

  return (
    <div className="w-full h-screen overflow-hidden bg-black text-white font-sans flex flex-col">
      <div
        className="relative flex-1 min-h-0 w-full"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url('${bg}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
        }}
      >
        <div className="absolute inset-0 bg-black/30" />

        <div className="relative z-10 grid h-full grid-cols-[260px_repeat(7,minmax(0,1fr))] gap-0">
          <div className="flex h-full flex-col border-r border-white/20 bg-black/30 p-4 md:p-5">
            <div>
              <div className="text-[56px] md:text-[64px] font-thin tracking-tight leading-none whitespace-nowrap">{formatted.time}</div>
              <div className="mt-4 text-[22px] md:text-[26px] font-light leading-none">{formatted.day},</div>
              <div className="mt-2 text-[18px] md:text-[20px] font-thin text-white/90 leading-none">{formatted.monthDay}</div>
            </div>

            {(commutes.length > 0 || trafficErr) && (
              <div className="mt-6">
                <div className="flex items-center gap-2 text-[10px] md:text-[11px] tracking-[0.18em] text-white/60 uppercase mb-2">
                  <Car className="h-3.5 w-3.5" />
                  <span>Drive Times</span>
                </div>
                <div className="space-y-1">
                  {commutes.map((c) => (
                    <div key={c.label} className="flex items-baseline justify-between gap-2 text-[14px] md:text-[15px] leading-none">
                      <span className="text-white/95 truncate">{c.label}</span>
                      <span className={`font-light tabular-nums shrink-0 ${trafficColor(c.minutes, c.typicalMinutes)}`}>{c.minutes} min</span>
                    </div>
                  ))}
                  {trafficErr && <div className="mt-1 text-[10px] text-red-400/80 break-words">{trafficErr}</div>}
                </div>
              </div>
            )}

            <div className="mt-auto space-y-1 text-white/95">
              <div className="flex items-center gap-2 text-[14px] md:text-[15px]">
                <Wind className="h-3.5 w-3.5" />
                <span>{current ? `${current.windMph} mph ${current.windDir}` : '-- mph'}</span>
              </div>
              <div className="flex items-center gap-2 text-[14px] md:text-[15px]">
                <Sunrise className="h-3.5 w-3.5" />
                <span>{sunrise}</span>
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div className="text-[56px] md:text-[64px] font-thin leading-none">
                  {current ? `${current.tempF}°` : '--°'}
                </div>
                <WeatherIcon type={current?.icon ?? 'cloud'} className="h-14 w-14 md:h-16 md:w-16 text-white shrink-0" />
              </div>
              {wxErr && <div className="text-[11px] text-red-400/80 break-words">wx: {wxErr}</div>}
            </div>
          </div>

          {Array.from({ length: 7 }).map((_, idx) => {
            const day = days[idx];
            const date = day?.date ?? new Date(today.getTime() + idx * 86400_000);
            const fc = forecast.find(f => f.date.toDateString() === date.toDateString());
            return (
              <div
                key={idx}
                className={`relative flex h-full flex-col border-r border-white/20 ${idx === 2 || idx === 3 ? 'bg-black/20' : 'bg-black/10'}`}
              >
                <div className="px-3 pt-3 pb-1 shrink-0">
                  <div className="flex items-baseline gap-2 border-b border-white/20 pb-2">
                    <div className="text-[28px] md:text-[32px] font-thin leading-none tracking-tight">{date.getDate()}</div>
                    <div className="text-[14px] md:text-[16px] font-light leading-none tracking-tight">{dayLabel(date, idx)}</div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 px-3 pt-2 overflow-hidden">
                  {day?.events.map((ev, i) => (
                    <div key={i} className="relative pl-3 mb-2">
                      <div className="absolute left-0 top-0 h-full w-1 rounded-full bg-fuchsia-600" />
                      <div className="text-white">
                        <div className="text-[11px] md:text-[12px] font-normal text-white/80 tracking-tight leading-none mb-0.5">{formatEventTime(ev)}</div>
                        <div className="text-[13px] md:text-[14px] font-normal leading-[1.15] tracking-tight">{ev.title}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-3 pb-4 pt-2 flex h-[120px] shrink-0 flex-col items-center justify-end">
                  {fc ? (
                    <>
                      <div className="mb-1 text-[12px] md:text-[13px] font-light tracking-[0.18em] text-white/90">{footerLabel(date)}</div>
                      <WeatherIcon type={fc.icon} className="h-10 w-10 md:h-12 md:w-12 text-white/95" />
                      <div className="mt-1 text-[14px] md:text-[15px] font-light text-white/90">
                        {fc.highF} <span className="text-white/60">{fc.lowF}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {calErr && (
          <div className="absolute bottom-3 left-3 text-red-400/80 text-[11px]">
            cal: {calErr}
          </div>
        )}
      </div>

      <div className="h-9 md:h-10 shrink-0 bg-black/80 border-t border-white/10 flex items-center overflow-hidden">
        {quotes.length > 0 ? (
          <TickerRow quotes={quotes} />
        ) : (
          <div className="px-4 text-[12px] text-white/50">
            {stocksErr ? `stocks: ${stocksErr}` : FINNHUB_KEY ? 'loading quotes…' : 'set VITE_FINNHUB_API_KEY in .env'}
          </div>
        )}
      </div>
    </div>
  );
}
