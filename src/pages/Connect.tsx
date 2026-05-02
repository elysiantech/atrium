import { useEffect, useRef, useState } from 'react';
import { fetchSettings, saveSettings, DEFAULT_SETTINGS, type DisplaySettings } from '../lib/settings';

type Status = {
  gphotos: {
    connected: boolean;
    hasSession: boolean;
    sessionExpiresAt: string | null;
    lastSyncAt: string | null;
    pickedCount: number;
    cachedCount: number;
  };
};

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return new Date(iso).toLocaleString();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtExpires(iso: string | null): string {
  if (!iso) return 'unknown';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `in ${days}d ${hours % 24}h`;
  return `in ${hours}h`;
}

const INTERVAL_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: 'Every 15 seconds', seconds: 15 },
  { label: 'Every 30 seconds', seconds: 30 },
  { label: 'Every minute', seconds: 60 },
  { label: 'Every 2 minutes', seconds: 120 },
  { label: 'Every 5 minutes', seconds: 300 },
  { label: 'Every 10 minutes', seconds: 600 },
  { label: 'Every 30 minutes', seconds: 1800 },
];

export default function Connect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [picking, setPicking] = useState(false);
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [tickerInput, setTickerInput] = useState('');
  const confirmTimer = useRef<number | null>(null);

  useEffect(() => {
    setTickerInput(settings.tickers.join(', '));
  }, [settings.tickers]);

  function commitTickers() {
    const parsed = tickerInput
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (parsed.join(',') === settings.tickers.join(',')) return;
    patch({ tickers: parsed });
  }

  async function patch(p: Partial<DisplaySettings>) {
    const next = { ...settings, ...p };
    setSettings(next);
    try { await saveSettings(p); } catch (e) {
      setBanner({ kind: 'error', text: `settings save: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function loadStatus() {
    try {
      const r = await fetch('/api/sources');
      if (r.ok) setStatus(await r.json());
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadStatus();
    fetchSettings().then(setSettings);

    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    if (oauth === 'ok') setBanner({ kind: 'ok', text: 'Connected to Google Photos.' });
    else if (oauth === 'error') setBanner({ kind: 'error', text: `OAuth error: ${params.get('msg') ?? 'unknown'}` });
    if (oauth) {
      const u = new URL(window.location.href);
      u.searchParams.delete('oauth');
      u.searchParams.delete('msg');
      window.history.replaceState({}, '', u.toString());
    }
  }, []);

  useEffect(() => {
    const t = setInterval(loadStatus, 5_000);
    return () => clearInterval(t);
  }, []);

  function connect() {
    const returnTo = window.location.origin + '/connect';
    window.location.href = `/api/sources/gphotos/oauth/start?returnTo=${encodeURIComponent(returnTo)}`;
  }

  async function pick() {
    setPicking(true);
    setBanner(null);
    try {
      const r = await fetch('/api/sources/gphotos/pick', { method: 'POST' });
      if (!r.ok) throw new Error(`pick ${r.status}: ${await r.text()}`);
      const j = (await r.json()) as { pickerUri: string };
      window.open(j.pickerUri, '_blank', 'noopener');
      setBanner({ kind: 'ok', text: 'Picker opened in a new tab. Finish picking — photos appear on the dashboard as they load.' });
      await loadStatus();
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPicking(false);
    }
  }

  function onDisconnectClick() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => setConfirmDisconnect(false), 4000);
      return;
    }
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    setConfirmDisconnect(false);
    disconnect();
  }

  async function disconnect() {
    setBanner(null);
    try {
      const r = await fetch('/api/sources/gphotos/disconnect', { method: 'POST' });
      if (!r.ok) throw new Error(`disconnect ${r.status}: ${await r.text()}`);
      setBanner({ kind: 'ok', text: 'Disconnected. Credentials and cached photos removed.' });
      await loadStatus();
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  const g = status?.gphotos;
  const loaded = status !== null;

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <a href="/" className="text-[13px] text-white/60 hover:text-white/90">← back to dashboard</a>
        <h1 className="mt-4 text-[32px] font-thin tracking-tight">Sources</h1>
        <p className="mt-1 text-[13px] text-white/60">Connect photo sources and manage picks.</p>

        {banner && (
          <div
            className={`mt-6 rounded border px-4 py-3 text-[13px] ${
              banner.kind === 'ok'
                ? 'border-emerald-600/50 bg-emerald-900/20 text-emerald-200'
                : 'border-rose-600/50 bg-rose-900/20 text-rose-200'
            }`}
          >
            {banner.text}
          </div>
        )}

        <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[18px] font-light">Google Photos</div>
              <div className="mt-1 text-[13px] text-white/60">
                {!loaded ? 'Checking…' : g?.connected ? 'Connected' : 'Not connected'}
                {loaded && g?.connected && g.pickedCount > 0 && (
                  <>
                    {' · '}{g.pickedCount} picked
                    {' · '}{g.cachedCount} cached
                  </>
                )}
              </div>
              {loaded && g?.connected && g.lastSyncAt && (
                <div className="mt-1 text-[12px] text-white/50">Last sync {fmtRelative(g.lastSyncAt)}</div>
              )}
              {loaded && g?.connected && g.hasSession && g.sessionExpiresAt && (
                <div className="mt-1 text-[12px] text-white/50">
                  Picker session expires {fmtExpires(g.sessionExpiresAt)}
                </div>
              )}
            </div>
            <div
              className={`h-2 w-2 rounded-full ${
                !loaded ? 'bg-white/20 animate-pulse' : g?.connected ? 'bg-emerald-400' : 'bg-white/30'
              }`}
            />
          </div>

          {loaded && !g?.connected && (
            <div className="mt-6">
              <button
                onClick={connect}
                className="rounded bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90"
              >
                Connect Google Photos
              </button>
              <div className="mt-2 text-[11px] text-white/50">
                OAuth must be completed from a browser on the mini itself (<code>http://localhost:{window.location.port || '5173'}/connect</code>). Google requires a loopback redirect, so connecting from a phone/laptop on the LAN will silently fail.
              </div>
            </div>
          )}

          {loaded && g?.connected && g.pickedCount === 0 && (
            <div className="mt-6">
              <button
                onClick={pick}
                disabled={picking}
                className="rounded bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-40"
              >
                {picking ? 'Opening picker…' : 'Pick your photos →'}
              </button>
              <div className="mt-2 text-[11px] text-white/50">
                Opens the Google Photos picker in a new tab. Select photos on any device — they appear on the dashboard as the rotation cycles.
              </div>
            </div>
          )}

          {loaded && g?.connected && g.pickedCount > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                onClick={pick}
                disabled={picking}
                className="rounded border border-white/20 bg-white/10 px-4 py-2 text-[13px] hover:bg-white/20 disabled:opacity-40"
              >
                Re-pick photos
              </button>
              <button
                onClick={onDisconnectClick}
                className={`ml-auto rounded border px-4 py-2 text-[13px] ${
                  confirmDisconnect
                    ? 'border-rose-500 bg-rose-900/40 text-rose-100 hover:bg-rose-900/60'
                    : 'border-white/20 bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                {confirmDisconnect ? 'Click again to confirm' : 'Disconnect'}
              </button>
            </div>
          )}
        </div>

        <h2 className="mt-12 text-[22px] font-thin tracking-tight">Display</h2>
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-6 space-y-6">
          <div>
            <label className="block text-[13px] font-medium text-white/90">Change photo</label>
            <select
              value={settings.intervalSeconds}
              onChange={(e) => patch({ intervalSeconds: Number(e.target.value) })}
              className="mt-2 w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-[13px] text-white focus:border-white/40 focus:outline-none"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds} className="bg-black">
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-white/90">Brightness</label>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.brightness}
              onChange={(e) => patch({ brightness: Number(e.target.value) })}
              className="mt-2 w-full accent-white"
            />
            <div className="mt-1 text-[11px] text-white/50">
              Lower brightness dims the photo so text is easier to read. ({settings.brightness})
            </div>
          </div>

          <label className="flex items-center gap-3 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showMeta}
              onChange={(e) => patch({ showMeta: e.target.checked })}
              className="h-4 w-4 accent-white"
            />
            <span>Show photo filename</span>
          </label>

          <label className="flex items-center gap-3 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.cropFill}
              onChange={(e) => patch({ cropFill: e.target.checked })}
              className="h-4 w-4 accent-white"
            />
            <span>Crop to fill the entire screen</span>
          </label>

          <label className="flex items-center gap-3 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.fade}
              onChange={(e) => patch({ fade: e.target.checked })}
              className="h-4 w-4 accent-white"
            />
            <span>Fade photos in and out gradually</span>
          </label>
        </div>

        <h2 className="mt-12 text-[22px] font-thin tracking-tight">Widgets</h2>
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-6 space-y-6">
          <div>
            <label className="block text-[13px] font-medium text-white/90">Stock tickers</label>
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              onBlur={commitTickers}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
              placeholder="NVDA, AMD, MSFT"
              className="mt-2 w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-[13px] text-white focus:border-white/40 focus:outline-none"
            />
            <div className="mt-1 text-[11px] text-white/50">
              Comma- or space-separated. Saved on blur or Enter. Requires <code>VITE_FINNHUB_API_KEY</code> in <code>.env</code>.
            </div>
          </div>
        </div>

        <div className="mt-8 text-[11px] text-white/40">
          Cache at <code>cache/photos/</code>. Photos download on first display and stay cached. If Google is unreachable, cached images keep serving.
        </div>
      </div>
    </div>
  );
}
