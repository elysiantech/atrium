export type Destination = {
  label: string;
  address: string;
};

export type Commute = {
  label: string;
  minutes: number;
  typicalMinutes: number;
};

const ROUTES = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

export function parseDestinations(raw: string): Destination[] {
  return raw
    .split('||')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const sep = pair.indexOf('|');
      if (sep === -1) return null;
      return {
        label: pair.slice(0, sep).trim(),
        address: pair.slice(sep + 1).trim(),
      };
    })
    .filter((d): d is Destination => d !== null);
}

type RouteMatrixElement = {
  originIndex: number;
  destinationIndex: number;
  duration?: string;
  staticDuration?: string;
  condition?: string;
};

function secondsToMinutes(s?: string): number {
  if (!s) return 0;
  return Math.round(parseInt(s.replace('s', ''), 10) / 60);
}

export async function fetchCommuteTimes(
  origin: string,
  destinations: Destination[],
  apiKey: string,
): Promise<Commute[]> {
  if (!destinations.length) return [];
  const body = {
    origins: [{ waypoint: { address: origin } }],
    destinations: destinations.map((d) => ({ waypoint: { address: d.address } })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };
  const res = await fetch(ROUTES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,staticDuration,condition',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`routes ${res.status}`);
  const rows = (await res.json()) as RouteMatrixElement[];
  return rows
    .filter((r) => r.condition === 'ROUTE_EXISTS' && r.duration)
    .map((r) => ({
      label: destinations[r.destinationIndex]?.label ?? '',
      minutes: secondsToMinutes(r.duration),
      typicalMinutes: secondsToMinutes(r.staticDuration ?? r.duration),
    }))
    .filter((c) => c.label);
}
