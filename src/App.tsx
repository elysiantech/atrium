import { useEffect, useMemo, useState } from 'react';
import { Cloud, CloudRain, CloudSun, Sun, Wind, Sunrise, Camera } from 'lucide-react';
import { fetchCalendar, type CalendarDay } from './lib/calendar';
import {
  geocode,
  fetchWeather,
  type CurrentWeather,
  type DailyForecast,
  type LatLon,
  type WeatherIconType,
} from './lib/weather';
import { getBackgroundImage } from './lib/photo';

const CITY = import.meta.env.VITE_WEATHER_CITY ?? 'Oakland';
const STATE = import.meta.env.VITE_WEATHER_STATE ?? 'CA';

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

export default function App() {
  const [now, setNow] = useState(new Date());
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [current, setCurrent] = useState<CurrentWeather | null>(null);
  const [forecast, setForecast] = useState<DailyForecast[]>([]);
  const [calErr, setCalErr] = useState<string | null>(null);
  const [wxErr, setWxErr] = useState<string | null>(null);

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

  const formatted = useMemo(() => ({
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    day: now.toLocaleDateString([], { weekday: 'long' }),
    monthDay: now.toLocaleDateString([], { month: 'long', day: 'numeric' }),
  }), [now]);

  const bg = getBackgroundImage();
  const sunrise = current?.sunrise
    ? current.sunrise.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '--:--';

  const today = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now]);

  return (
    <div className="w-full h-screen overflow-hidden bg-black text-white font-sans">
      <div
        className="relative h-full w-full"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url('${bg}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
        }}
      >
        <div className="absolute inset-0 bg-black/30" />

        <div className="relative z-10 grid h-full grid-cols-[260px_repeat(7,minmax(0,1fr))] gap-0">
          <div className="flex h-full flex-col justify-between border-r border-white/20 bg-black/30 p-4 md:p-5">
            <div>
              <div className="text-[56px] md:text-[64px] font-thin tracking-tight leading-none whitespace-nowrap">{formatted.time}</div>
              <div className="mt-4 text-[22px] md:text-[26px] font-light leading-none">{formatted.day},</div>
              <div className="mt-2 text-[18px] md:text-[20px] font-thin text-white/90 leading-none">{formatted.monthDay}</div>
            </div>

            <div className="space-y-2 text-white/95">
              <div className="flex items-center gap-2 text-[15px] md:text-[17px]">
                <Wind className="h-4 w-4" />
                <span>{current ? `${current.windMph} mph ${current.windDir}` : '-- mph'}</span>
              </div>
              <div className="flex items-center gap-2 text-[15px] md:text-[17px]">
                <Sunrise className="h-4 w-4" />
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

        <div className="absolute bottom-3 left-3 flex items-center gap-2 text-white/60 text-[12px] md:text-[14px]">
          <Camera className="h-4 w-4" />
          <span>{calErr ? `cal: ${calErr}` : `${CITY}, ${STATE}`}</span>
        </div>
      </div>
    </div>
  );
}
