export type WeatherIconType = 'rain' | 'partly' | 'cloud' | 'sun';

export type LatLon = { lat: number; lon: number };

export type CurrentWeather = {
  tempF: number;
  description: string;
  icon: WeatherIconType;
  windMph: number;
  windDir: string;
  sunrise: Date;
};

export type DailyForecast = {
  date: Date;
  highF: number;
  lowF: number;
  icon: WeatherIconType;
};

export type WeatherBundle = {
  current: CurrentWeather;
  forecast: DailyForecast[];
};

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

function windDir(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function iconFromWmo(code: number): WeatherIconType {
  if (code === 0) return 'sun';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3 || code === 45 || code === 48) return 'cloud';
  if (code >= 71 && code <= 86) return 'cloud';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  return 'cloud';
}

function descFromWmo(code: number): string {
  if (code === 0) return 'clear sky';
  if (code === 1) return 'mainly clear';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain showers';
  if (code >= 85 && code <= 86) return 'snow showers';
  if (code >= 95) return 'thunderstorm';
  return '';
}

export async function geocode(city: string): Promise<LatLon> {
  const q = encodeURIComponent(city);
  const res = await fetch(`${GEO}?name=${q}&count=1&language=en&country_code=US&format=json`);
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const j = (await res.json()) as { results?: Array<{ latitude: number; longitude: number }> };
  if (!j.results?.length) throw new Error(`no geocode result for ${city}`);
  return { lat: j.results[0].latitude, lon: j.results[0].longitude };
}

type ForecastResponse = {
  current: {
    temperature_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise: string[];
  };
};

export async function fetchWeather(lat: number, lon: number): Promise<WeatherBundle> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise',
    timezone: 'auto',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
  });
  const res = await fetch(`${FORECAST}?${params}`);
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const j = (await res.json()) as ForecastResponse;

  const current: CurrentWeather = {
    tempF: Math.round(j.current.temperature_2m),
    description: descFromWmo(j.current.weather_code),
    icon: iconFromWmo(j.current.weather_code),
    windMph: Math.round(j.current.wind_speed_10m),
    windDir: windDir(j.current.wind_direction_10m ?? 0),
    sunrise: new Date(j.daily.sunrise[0]),
  };

  const forecast: DailyForecast[] = j.daily.time.slice(0, 7).map((dateStr, i) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return {
      date: new Date(y, m - 1, d),
      highF: Math.round(j.daily.temperature_2m_max[i]),
      lowF: Math.round(j.daily.temperature_2m_min[i]),
      icon: iconFromWmo(j.daily.weather_code[i]),
    };
  });

  return { current, forecast };
}
