import ICAL from 'ical.js';

export type CalendarEvent = {
  start: Date;
  end: Date;
  allDay: boolean;
  title: string;
};

export type CalendarDay = {
  date: Date;
  events: CalendarEvent[];
};

const ICAL_PROXY = '/api/ical';

export async function fetchCalendar(days = 7): Promise<CalendarDay[]> {
  const res = await fetch(ICAL_PROXY);
  if (!res.ok) throw new Error(`iCal ${res.status}`);
  const text = await res.text();
  if (!text.startsWith('BEGIN:VCALENDAR')) {
    throw new Error('proxy returned non-iCal content — is VITE_ICAL_URL set?');
  }

  const jcal = ICAL.parse(text);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents('vevent');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + days);

  const out: CalendarEvent[] = [];
  const pushEvent = (start: Date, end: Date, allDay: boolean, title: string) => {
    if (start >= windowEnd) return;
    if (end <= today) return;
    out.push({ start, end, allDay, title });
  };

  for (const ve of vevents) {
    const event = new ICAL.Event(ve);
    const title = event.summary || '(No title)';

    if (event.isRecurring()) {
      const iter = event.iterator();
      let next = iter.next();
      let guard = 0;
      while (next && guard++ < 2000) {
        const d = next.toJSDate();
        if (d >= windowEnd) break;
        if (d >= today) {
          const occ = event.getOccurrenceDetails(next);
          pushEvent(
            occ.startDate.toJSDate(),
            occ.endDate.toJSDate(),
            occ.startDate.isDate,
            title,
          );
        }
        next = iter.next();
      }
    } else {
      const start = event.startDate.toJSDate();
      const end = event.endDate.toJSDate();
      pushEvent(start, end, event.startDate.isDate, title);
    }
  }

  const byDay = new Map<string, CalendarEvent[]>();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    byDay.set(d.toDateString(), []);
  }
  for (const ev of out) {
    const key = ev.start.toDateString();
    if (byDay.has(key)) byDay.get(key)!.push(ev);
  }

  return Array.from(byDay.entries()).map(([key, evs]) => ({
    date: new Date(key),
    events: evs.sort((a, b) => a.start.getTime() - b.start.getTime()),
  }));
}
