import { useMemo } from "react";
import type { AgendaEvent } from "../lib/capatlantique";
import type { TideExtreme, WeatherDay, WeatherNow } from "../lib/types";

interface ComingDaysProps {
  weather: WeatherNow | null;
  agenda: AgendaEvent[];
  extrema: TideExtreme[];
  now: Date;
}

const fmtDayDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Paris",
});

const fmtDayShort = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});

const fmtTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

export default function ComingDays({
  weather,
  agenda,
  extrema,
  now,
}: ComingDaysProps) {
  const nextDays = useMemo(() => {
    const days: {
      date: Date;
      weather: WeatherDay | null;
      tides: TideExtreme[];
      events: AgendaEvent[];
    }[] = [];
    for (let i = 1; i <= 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      date.setHours(12, 0, 0, 0);

      const dayWeather = weather?.daily.find((day) => sameLocalDay(day.date, date)) ?? null;

      const dayTides = extrema.filter((e) => sameLocalDay(e.time, date));

      const dayEvents = agenda.filter((e) => {
        if (!e.dateRange) return false;
        return e.dateRange.toLowerCase().includes(fmtDayShort.format(date).toLowerCase()) ||
               e.dateRange.toLowerCase().includes(fmtDayDate.format(date).toLowerCase());
      });

      days.push({
        date,
        weather: dayWeather,
        tides: dayTides,
        events: dayEvents,
      });
    }
    return days;
  }, [weather, agenda, extrema, now]);

  return (
    <section className="card card-wide">
      <h3>La météo des jours à venir</h3>
      {nextDays.length > 0 ? (
        <div className="coming-days">
          {nextDays.map((day, i) => (
            <div key={i} className="coming-day">
              <div className="coming-day-header">
                <span className="coming-day-date">{fmtDayShort.format(day.date)}</span>
                {day.weather && (
                  <span className="coming-day-weather">
                    {weatherEmoji(day.weather.weatherCode)} {Math.round(day.weather.tempMax)}° /{" "}
                    {Math.round(day.weather.tempMin)}°
                  </span>
                )}
              </div>
              {day.tides.length > 0 && (
                <div className="coming-day-tides">
                  {day.tides.map((tide: any, j: number) => (
                    <span key={j} className="tide-mini">
                      {tide.type === "high" ? " haute" : " basse"} {fmtTime.format(tide.time)}
                    </span>
                  ))}
                </div>
              )}
              {day.events.length > 0 && (
                <div className="coming-day-events">
                  {day.events.map((evt: any, j: number) => (
                    <span key={j} className="event-mini">{evt.title}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="placeholder">Aucune information disponible pour les jours à venir.</p>
      )}
    </section>
  );
}
