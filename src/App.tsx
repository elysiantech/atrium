import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
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
import { getBackgroundImage, fetchPhotos, photoUrl, type PhotoMeta } from './lib/photo';
import { fetchSettings, readCachedSettings, type DisplaySettings } from './lib/settings';
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

function WeatherIcon({ type, className = '' }: { type: WeatherIconType; className?: string }) {
  if (type === 'rain') return <CloudRain className={className} />;
  if (type === 'partly') return <CloudSun className={className} />;
  if (type === 'sun') return <Sun className={className} />;
  return <Cloud className={className} />;
}

function dayLabel(date: Date, today: Date): string {
  const diff = Math.round((date.getTime() - today.getTime()) / 86400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'long' });
}

const PAST_DAYS = 14;
const FUTURE_DAYS = 14;
const VISIBLE_DAYS = 7;
const RENDERED_DAYS = VISIBLE_DAYS + 2;
const MIN_OFFSET = -PAST_DAYS;
const MAX_OFFSET = FUTURE_DAYS - VISIBLE_DAYS + 1;
const PHOTO_FRAME_TIMEOUT_MS = 60_000;
const PHOTO_FRAME_HOLD_MS = 900;
const PHOTO_SWIPE_THRESHOLD_PX = 56;

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

function isCommuteRefreshTime(date: Date): boolean {
  const hour = date.getHours();
  const minute = date.getMinutes();

  const inMorningWindow = hour >= 7 && hour < 9;
  const inEveningWindow = hour >= 16 && hour < 19;
  if ((inMorningWindow || inEveningWindow) && minute % 15 === 0) return true;

  return (
    (hour === 6 && minute === 0)
    || (hour === 10 && minute === 0)
    || (hour === 12 && minute === 0)
    || (hour === 14 && minute === 0)
    || (hour === 20 && minute === 0)
    || (hour === 21 && minute === 30)
  );
}

function TickerRow({ quotes }: { quotes: Quote[] }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const txRef = useRef(0);
  const widthRef = useRef(0);
  const dragRef = useRef<{ startX: number; startTx: number; pointerId: number } | null>(null);

  const doubled = useMemo(() => (quotes.length ? [...quotes, ...quotes] : []), [quotes]);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || doubled.length === 0) return;
    widthRef.current = el.scrollWidth / 2;
  }, [doubled]);

  useEffect(() => {
    if (doubled.length === 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const w = widthRef.current;
      if (!dragRef.current && w > 0) {
        const speed = w / 90;
        let next = txRef.current - speed * dt;
        if (next <= -w) next += w;
        if (next > 0) next -= w;
        txRef.current = next;
        if (innerRef.current) innerRef.current.style.transform = `translateX(${next}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [doubled]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startTx: txRef.current, pointerId: e.pointerId };
    wrapperRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const w = widthRef.current;
    if (!drag || w <= 0) return;
    let next = drag.startTx + (e.clientX - drag.startX);
    while (next <= -w) next += w;
    while (next > 0) next -= w;
    txRef.current = next;
    if (innerRef.current) innerRef.current.style.transform = `translateX(${next}px)`;
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    wrapperRef.current?.releasePointerCapture(drag.pointerId);
    dragRef.current = null;
  };

  if (!quotes.length) return null;

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full overflow-hidden flex items-center cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div ref={innerRef} className="flex whitespace-nowrap will-change-transform">
        {doubled.map((q, i) => {
          const up = q.changePct >= 0;
          return (
            <span key={i} className="px-6 text-[13px] md:text-[14px] flex items-baseline gap-2 select-none">
              <span className="font-medium text-white">{q.symbol}</span>
              <span className="text-white/80">{q.price.toFixed(2)}</span>
              <span className={up ? 'text-emerald-400' : 'text-rose-400'}>
                {up ? '▲' : '▼'} {Math.abs(q.changePct).toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PhotoLayer({
  url,
  visible,
  transitionMs,
  cropFill,
  reverse = false,
}: {
  url: string;
  visible: boolean;
  transitionMs: number;
  cropFill: boolean;
  reverse?: boolean;
}) {
  const background = {
    backgroundImage: `url('${url}')`,
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${transitionMs}ms ease-in-out`,
      }}
    >
      {!cropFill && (
        <div
          className="absolute inset-[-3%] scale-110 blur-2xl opacity-80"
          style={{ ...background, backgroundSize: 'cover' }}
        />
      )}
      <div
        key={url}
        className={`absolute inset-0 ${cropFill ? 'atrium-photo-motion-fill' : 'atrium-photo-motion-fit'}`}
        style={{
          ...background,
          backgroundSize: cropFill ? 'cover' : 'contain',
          animationDirection: reverse ? 'alternate-reverse' : 'alternate',
        }}
      />
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
  const [photoMeta, setPhotoMeta] = useState<Record<string, PhotoMeta>>({});
  const [photoIdx, setPhotoIdx] = useState(0);
  const [layerA, setLayerA] = useState(true);
  const fallback = getBackgroundImage();
  const [bgA, setBgA] = useState<string>(fallback);
  const [bgB, setBgB] = useState<string>(fallback);
  const [settings, setSettings] = useState<DisplaySettings>(readCachedSettings);
  const [photoFrameMode, setPhotoFrameMode] = useState(false);
  const [frameInteraction, setFrameInteraction] = useState(0);
  const framePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const frameHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameSwipeRef = useRef<{ startX: number; pointerId: number } | null>(null);

  const clearFrameHold = useCallback(() => {
    if (frameHoldTimerRef.current) {
      clearTimeout(frameHoldTimerRef.current);
      frameHoldTimerRef.current = null;
    }
  }, []);

  const armFrameToggle = useCallback(() => {
    clearFrameHold();
    frameHoldTimerRef.current = setTimeout(() => {
      setPhotoFrameMode((active) => !active);
      setFrameInteraction((n) => n + 1);
      framePointersRef.current.clear();
      frameHoldTimerRef.current = null;
    }, PHOTO_FRAME_HOLD_MS);
  }, [clearFrameHold]);

  useEffect(() => () => clearFrameHold(), [clearFrameHold]);

  useEffect(() => {
    if (!photoFrameMode) return;
    const timer = setTimeout(() => setPhotoFrameMode(false), PHOTO_FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [photoFrameMode, frameInteraction]);

  const onRootPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    framePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (framePointersRef.current.size <= 2) armFrameToggle();
  };

  const onRootPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = framePointersRef.current.get(e.pointerId);
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 18) clearFrameHold();
  };

  const onRootPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    framePointersRef.current.delete(e.pointerId);
    if (framePointersRef.current.size < 2) clearFrameHold();
  };

  const onFrameSwipeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (framePointersRef.current.size > 1 || frameSwipeRef.current) return;
    frameSwipeRef.current = { startX: e.clientX, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onFrameSwipeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const swipe = frameSwipeRef.current;
    if (!swipe || swipe.pointerId !== e.pointerId) return;
    frameSwipeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const delta = e.clientX - swipe.startX;
    if (Math.abs(delta) < PHOTO_SWIPE_THRESHOLD_PX || photoIds.length < 2) return;
    setPhotoIdx((i) => (i + (delta < 0 ? 1 : -1) + photoIds.length) % photoIds.length);
    setFrameInteraction((n) => n + 1);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cal = await fetchCalendar(PAST_DAYS, FUTURE_DAYS);
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

  const loadCommutes = useCallback(async () => {
    if (!MAPS_KEY || !HOME || !DESTINATIONS.length) return;
    try {
      const c = await fetchCommuteTimes(HOME, DESTINATIONS, MAPS_KEY);
      c.sort((a, b) => a.minutes - b.minutes);
      setCommutes(c);
      setTrafficErr(null);
    } catch (e) {
      setTrafficErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!MAPS_KEY || !HOME || !DESTINATIONS.length) return;
    let cancelled = false;
    let lastRefreshSlot = '';
    async function tick(force = false) {
      const now = new Date();
      if (!force && !isCommuteRefreshTime(now)) return;
      const refreshSlot = [
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours(),
        now.getMinutes(),
      ].join(':');
      if (refreshSlot === lastRefreshSlot) return;
      lastRefreshSlot = refreshSlot;
      if (!cancelled) await loadCommutes();
    }
    tick(true);
    const t = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [loadCommutes]);

  useEffect(() => {
    fetchPhotos().then(({ ids, meta }) => {
      setPhotoIds(ids);
      setPhotoMeta(meta);
      if (ids.length > 0) {
        const first = photoUrl(ids[0]);
        setBgA(first);
        setLayerA(true);
      }
    });
  }, []);

  useEffect(() => {
    fetchSettings().then(setSettings);
    const t = setInterval(() => fetchSettings().then(setSettings), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (photoIds.length < 2) return;
    const t = setInterval(() => {
      setPhotoIdx((i) => (i + 1) % photoIds.length);
    }, settings.intervalSeconds * 1000);
    return () => clearInterval(t);
  }, [photoIds.length, settings.intervalSeconds]);

  // Swap the off-screen layer on index change, then flip which layer is visible.
  useEffect(() => {
    if (photoIds.length === 0) return;
    const url = photoUrl(photoIds[photoIdx]);
    if (layerA) setBgB(url); else setBgA(url);
    const id = requestAnimationFrame(() => setLayerA((v) => !v));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIdx]);

  // Preload next image into browser cache.
  useEffect(() => {
    if (photoIds.length < 2) return;
    const next = photoUrl(photoIds[(photoIdx + 1) % photoIds.length]);
    const img = new Image();
    img.src = next;
  }, [photoIdx, photoIds]);

  const tickersKey = settings.tickers.join(',');
  useEffect(() => {
    if (!FINNHUB_KEY || tickersKey === '') {
      setQuotes([]);
      return;
    }
    let cancelled = false;
    const tickers = tickersKey.split(',');
    async function load() {
      try {
        const q = await fetchQuotes(tickers, FINNHUB_KEY);
        if (cancelled) return;
        if (q.length > 0) {
          setQuotes(q);
          setStocksErr(null);
        } else {
          setStocksErr('no quote data');
        }
      } catch (e) {
        if (!cancelled) setStocksErr(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    // Large portfolio/watchlist unions can consume one quote request per symbol.
    // Refresh those less aggressively so a household display stays comfortably
    // below the provider's request ceiling.
    const refreshMs = tickers.length > 20 ? 5 * 60_000 : 60_000;
    const t = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [tickersKey]);

  const formatted = useMemo(() => ({
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    day: now.toLocaleDateString([], { weekday: 'long' }),
    monthDay: now.toLocaleDateString([], { month: 'long', day: 'numeric' }),
  }), [now]);

  const currentMeta = photoIds.length > 0 ? photoMeta[photoIds[photoIdx]] : undefined;
  const overlayAlpha = Math.max(0, Math.min(1, (100 - settings.brightness) / 100));
  const transitionMs = settings.fade ? 1200 : 0;
  const sunrise = current?.sunrise
    ? current.sunrise.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '--:--';

  const today = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now]);

  const [dayOffset, setDayOffset] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; currentX: number; pointerId: number } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const resetCalendarViewport = useCallback(() => {
    setNow(new Date());
    setDayOffset(0);
    setDragPx(0);
    setIsDragging(false);
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (dayOffset === 0 || isDragging) return;
    const t = setTimeout(() => setDayOffset(0), 15_000);
    return () => clearTimeout(t);
  }, [dayOffset, isDragging]);

  useEffect(() => {
    if (!photoFrameMode) resetCalendarViewport();
  }, [photoFrameMode, resetCalendarViewport]);

  useEffect(() => {
    let disposed = false;
    let removeResumeListener: (() => void) | undefined;
    const onVisible = () => {
      if (!document.hidden) resetCalendarViewport();
    };

    document.addEventListener('visibilitychange', onVisible);
    void CapacitorApp.addListener('resume', resetCalendarViewport).then((handle) => {
      if (disposed) {
        void handle.remove();
      } else {
        removeResumeListener = () => { void handle.remove(); };
      }
    });

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      removeResumeListener?.();
    };
  }, [resetCalendarViewport]);

  const renderedDays = useMemo(() => {
    const byKey = new Map(days.map((d) => [d.date.toDateString(), d]));
    const out: { date: Date; day: CalendarDay | undefined }[] = [];
    for (let i = 0; i < RENDERED_DAYS; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + dayOffset - 1 + i);
      out.push({ date, day: byKey.get(date.toDateString()) });
    }
    return out;
  }, [dayOffset, days, today]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (!grid) return;
    dragRef.current = { startX: e.clientX, currentX: e.clientX, pointerId: e.pointerId };
    setIsDragging(true);
    grid.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const raw = e.clientX - drag.startX;
    drag.currentX = e.clientX;
    setDragPx(raw);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const grid = gridRef.current;
    const dayWidth = grid && grid.clientWidth > 0 ? grid.clientWidth / VISIBLE_DAYS : 0;
    const deltaDays = dayWidth > 0 ? Math.round(-(drag.currentX - drag.startX) / dayWidth) : 0;
    const next = Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, dayOffset + deltaDays));
    setDayOffset(next);
    setDragPx(0);
    setIsDragging(false);
    if (grid?.hasPointerCapture(drag.pointerId)) grid.releasePointerCapture(drag.pointerId);
    dragRef.current = null;
  };

  return (
    <div
      className="relative w-full h-screen overflow-hidden bg-black text-white font-sans flex flex-col"
      onPointerDown={onRootPointerDown}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerUp}
    >
      <div className="relative flex-1 min-h-0 w-full bg-black">
        <PhotoLayer
          url={bgA}
          visible={layerA}
          transitionMs={transitionMs}
          cropFill={settings.cropFill}
        />
        <PhotoLayer
          url={bgB}
          visible={!layerA}
          transitionMs={transitionMs}
          cropFill={settings.cropFill}
          reverse
        />
        <div className="absolute inset-0 bg-black" style={{ opacity: overlayAlpha }} />
        {settings.showMeta && currentMeta?.filename && (
          <div className="absolute top-3 right-4 z-10 text-[11px] tracking-wide text-white/60">
            {currentMeta.filename}
          </div>
        )}

        <div
          className={`relative z-10 flex h-full ${photoFrameMode ? 'pointer-events-none opacity-0' : ''}`}
          aria-hidden={photoFrameMode}
        >
          <div className="w-[260px] shrink-0 flex h-full flex-col border-r border-white/20 bg-black/30 p-4 md:p-5">
            <div>
              <div className="text-[56px] md:text-[64px] font-thin tracking-tight leading-none whitespace-nowrap">{formatted.time}</div>
              <div className="mt-4 text-[22px] md:text-[26px] font-light leading-none">{formatted.day},</div>
              <div className="mt-2 text-[18px] md:text-[20px] font-thin text-white/90 leading-none">{formatted.monthDay}</div>
            </div>

            {(commutes.length > 0 || trafficErr) && (
              <div
                className="mt-6 cursor-pointer select-none"
                onClick={loadCommutes}
                role="button"
                aria-label="Refresh drive times"
              >
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

          <div
            ref={gridRef}
            className="relative flex-1 overflow-hidden"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div
              className="grid h-full"
              style={{
                width: `${(RENDERED_DAYS / VISIBLE_DAYS) * 100}%`,
                gridTemplateColumns: `repeat(${RENDERED_DAYS}, minmax(0, 1fr))`,
                transform: `translateX(calc(${-100 / RENDERED_DAYS}% + ${isDragging ? dragPx : 0}px))`,
                willChange: 'transform',
              }}
            >
              {renderedDays.map(({ date, day }) => {
                const fc = forecast.find(f => f.date.toDateString() === date.toDateString());
                const isToday = date.toDateString() === today.toDateString();
                const highlightLabel = isToday && dayOffset !== 0;
                return (
                  <div
                    key={date.toDateString()}
                    className={`relative flex h-full flex-col border-r border-white/20 ${isToday ? 'bg-black/30' : 'bg-black/10'}`}
                  >
                    <div className="px-3 pt-3 pb-1 shrink-0">
                      <div className="flex items-baseline gap-2 border-b border-white/20 pb-2">
                        <div className={`text-[28px] md:text-[32px] font-thin leading-none tracking-tight ${highlightLabel ? 'text-sky-400' : ''}`}>{date.getDate()}</div>
                        <div className={`text-[14px] md:text-[16px] font-light leading-none tracking-tight ${highlightLabel ? 'text-sky-400' : ''}`}>{dayLabel(date, today)}</div>
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
          </div>
        </div>

        {calErr && (
          <div className="absolute bottom-3 left-3 text-red-400/80 text-[11px]">
            cal: {calErr}
          </div>
        )}

        {photoFrameMode && (
          <div
            className="absolute inset-0 z-30 overflow-hidden bg-black cursor-grab active:cursor-grabbing"
            style={{ touchAction: 'none' }}
            aria-label="Photo frame. Swipe left or right to change photos. Hold to return to the dashboard."
            onPointerDown={onFrameSwipeDown}
            onPointerUp={onFrameSwipeUp}
            onPointerCancel={onFrameSwipeUp}
          >
            <PhotoLayer
              url={photoIds.length > 0 ? photoUrl(photoIds[photoIdx]) : fallback}
              visible
              transitionMs={transitionMs}
              cropFill
              reverse={photoIdx % 2 === 1}
            />
          </div>
        )}
      </div>

      <div
        className={`h-9 md:h-10 shrink-0 bg-black/80 border-t border-white/10 flex items-center overflow-hidden ${photoFrameMode ? 'pointer-events-none opacity-0' : ''}`}
        aria-hidden={photoFrameMode}
      >
        {quotes.length > 0 ? (
          <TickerRow quotes={quotes} />
        ) : settings.tickers.length === 0 && FINNHUB_KEY && !stocksErr ? (
          <button
            onClick={() => {
              window.history.pushState({}, '', '/connect');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            className="px-4 text-[12px] text-white/50"
          >
            add tickers on /connect
          </button>
        ) : (
          <div className="px-4 text-[12px] text-white/50">
            {stocksErr
              ? `stocks: ${stocksErr}`
              : !FINNHUB_KEY
                ? 'set VITE_FINNHUB_API_KEY in .env'
                : 'loading quotes…'}
          </div>
        )}
      </div>
    </div>
  );
}
