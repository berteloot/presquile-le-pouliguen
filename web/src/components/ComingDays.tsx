import { useMemo } from "react";

interface ComingDaysProps {
  weather: any;
  agenda: any[];
  extrema: any[];
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

export default function ComingDays({
  weather,
  agenda,
  extrema,
  now,
}: ComingDaysProps) {
  const nextDays = useMemo(() => {
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      date.setHours(12, 0, 0, 0);

      // Find weather for this day
      const dayWeather = weather?.daily && weather.daily.time
        ? weather.daily.time.map((t: string, idx: number) => ({
            date: new Date(t),
            tempMax: weather.daily.temperature_2m_max?.[idx],
            tempMin: weather.daily.temperature_2m_min?.[idx],
            code: weather.daily.weather_code?.[idx],
          })).find((w: any) => {
            const wd = new Date(w.date);
            return wd.getDate() === date.getDate() &&
                   wd.getMonth() === date.getMonth() &&
                   wd.getFullYear() === date.getFullYear();
          })
        : null;

      // Find tides for this day
      const dayTides = extrema.filter((e: any) => {
        const tideDate = new Date(e.time);
        return tideDate.getDate() === date.getDate() &&
               tideDate.getMonth() === date.getMonth() &&
               tideDate.getFullYear() === date.getFullYear();
      });

      // Find events for this day
      const dayEvents = agenda.filter((e: any) => {
        if (!e.dateRange) return false;
        return e.dateRange.toLowerCase().includes(fmtDayShort.format(date).toLowerCase()) ||
               e.dateRange.toLowerCase().includes(fmtDayDate.format(date).toLowerCase());
      });

      if (dayWeather || dayTides.length > 0 || dayEvents.length > 0) {
        days.push({
          date,
          weather: dayWeather,
          tides: dayTides,
          events: dayEvents,
        });
      }
    }
    return days;
  }, [weather, agenda, extrema, now]);

  return (
    <section className="card card-wide">
      <h3>Les jours à venir</h3>
      {nextDays.length > 0 ? (
        <div className="coming-days">
          {nextDays.map((day, i) => (
            <div key={i} className="coming-day">
              <div className="coming-day-header">
                <span className="coming-day-date">{fmtDayShort.format(day.date)}</span>
                {day.weather && (
                  <span className="coming-day-weather">
                    {weatherEmoji(day.weather.code)} {day.weather.tempMax}° / {day.weather.tempMin}°
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
