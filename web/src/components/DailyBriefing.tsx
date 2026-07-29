import { useMemo } from "react";

const fmtTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
const fmtDayTime = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

interface DailyBriefingProps {
  now: Date;
  weather: any;
  marine: any;
  upcoming: any[];
  lowTides: any[];
  departures: any[];
  trainDepartures: any[];
}

export default function DailyBriefing({
  now,
  weather,
  marine,
  upcoming,
  lowTides,
  departures,
  trainDepartures,
}: DailyBriefingProps) {
  const briefing = useMemo(() => {
    const parts: string[] = [];

    // Time
    const hour = now.getHours();
    if (hour < 12) {
      parts.push("Bonne matinée");
    } else if (hour < 14) {
      parts.push("Bon appétit");
    } else if (hour < 18) {
      parts.push("Bonne après-midi");
    } else {
      parts.push("Bonne soirée");
    }

    // Weather
    if (weather) {
      const temp = Math.round(weather.temperature);
      const conditions = {
        0: "grand soleil",
        1: "grossoleil",
        2: "ciel dégagé",
        3: "nuages légers",
        45: "brouillard",
        51: "bruine légère",
        61: "pluie",
        63: "pluie modérée",
        65: "grosse pluie",
        71: "neige légère",
        73: "neige",
        75: "grosse neige",
        80: "averse légère",
        81: "averse",
        82: "grosse averse",
        95: "orage",
      } as Record<number, string>;

      const weatherText = conditions[weather.weatherCode] || "temps variable";
      parts.push(`il fait ${temp}°C, ${weatherText}`);
    }

    // Tide
    if (upcoming[0]) {
      const tideType = upcoming[0].type === "high" ? "marée haute" : "marée basse";
      const tideTime = fmtTime.format(upcoming[0].time);
      parts.push(`${tideType} à ${tideTime}`);
    }

    // Fishing window
    if (lowTides[0]) {
      const lowTideTime = fmtDayTime.format(lowTides[0].time);
      parts.push(`basse mer à ${lowTideTime} (pêche à pied)`);
    }

    // Next bus
    if (departures[0]) {
      const busTime = fmtTime.format(departures[0].time);
      const busLine = departures[0].routeShort;
      parts.push(`prochain bus ligne ${busLine} à ${busTime}`);
    }

    // Next train
    if (trainDepartures[0]) {
      const trainTime = fmtTime.format(trainDepartures[0].time);
      const trainDest = trainDepartures[0].dest;
      parts.push(`prochain train vers ${trainDest} à ${trainTime}`);
    }

    return parts.join(". ");
  }, [now, weather, marine, upcoming, lowTides, departures, trainDepartures]);

  return (
    <section className="card card-wide">
      <h3>Votre briefing du jour</h3>
      <p className="briefing-text">{briefing}</p>
    </section>
  );
}