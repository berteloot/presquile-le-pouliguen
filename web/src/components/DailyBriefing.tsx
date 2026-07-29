import { useMemo } from "react";
import { weatherLabel, windDirectionLabel } from "../lib/openmeteo";
import type { TrainDeparture } from "../lib/trains";
import type { MarineSeries, NextDeparture, TideExtreme, WeatherNow } from "../lib/types";

const fmtTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

interface DailyBriefingProps {
  now: Date;
  weather: WeatherNow | null;
  marine: MarineSeries | null;
  upcoming: TideExtreme[];
  lowTides: TideExtreme[];
  departures: NextDeparture[];
  trainDepartures: TrainDeparture[];
}

function greeting(hour: number): string {
  if (hour < 12) return "Bonne matinée";
  if (hour < 14) return "Bon appétit";
  if (hour < 18) return "Bonne après-midi";
  return "Bonne soirée";
}

function timeLabel(date: Date, now: Date): string {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dateStart = new Date(date);
  dateStart.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dateStart.getTime() - dayStart.getTime()) / 86_400_000);
  const time = fmtTime.format(date);
  if (diffDays === 0) return time;
  if (diffDays === 1) return `demain ${time}`;
  return time;
}

function relativeLabel(date: Date, now: Date): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (minutes > 0 && minutes < 60) return `dans ${minutes} min`;
  if (minutes >= 60 && minutes < 24 * 60) return `dans ${Math.round(minutes / 60)} h`;
  if (minutes < 0 && minutes > -60) return `il y a ${Math.abs(minutes)} min`;
  if (minutes <= -60 && minutes > -24 * 60) return `il y a ${Math.round(Math.abs(minutes) / 60)} h`;
  return "";
}

function latestBefore(times: Date[], values: (number | null)[], now: Date): number | null {
  let best: number | null = null;
  for (let i = 0; i < times.length; i++) {
    if (times[i].getTime() <= now.getTime() && values[i] != null) {
      best = values[i];
    }
  }
  return best;
}

function delayLabel(delaySeconds: number | null): string {
  if (delaySeconds == null) return "";
  if (delaySeconds >= 60) return `, retard estimé ${Math.round(delaySeconds / 60)} min`;
  return ", annoncé à l'heure";
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
  const { lead, items } = useMemo(() => {
    let leadText = `${greeting(now.getHours())}.`;
    const rows: string[] = [];

    if (weather) {
      const condition = weatherLabel(weather.weatherCode).toLowerCase();
      leadText = `${greeting(now.getHours())}. Il fait ${Math.round(
        weather.temperature,
      )}°C, ${condition}, avec un vent ${windDirectionLabel(
          weather.windDirection,
        )} à ${Math.round(weather.windSpeed)} km/h.`;

      if (weather.uvMax >= 7 && now.getHours() < 18) {
        rows.push(`UV élevé aujourd'hui (${Math.round(weather.uvMax)}) : chapeau et crème utiles.`);
      } else if (weather.precipitation > 0 || weather.weatherCode >= 51) {
        rows.push("Gardez une veste de pluie sous la main pour les déplacements courts.");
      } else if (weather.windGusts >= 35) {
        rows.push(`Rafales jusqu'à ${Math.round(weather.windGusts)} km/h : ça peut tirer sur la côte.`);
      } else {
        rows.push("Météo plutôt simple pour sortir, avec une couche légère si vous restez près de l'eau.");
      }
    }

    const nextTide = upcoming[0];
    if (nextTide) {
      const kind = nextTide.type === "high" ? "marée haute" : "marée basse";
      const rel = relativeLabel(nextTide.time, now);
      rows.push(`Prochaine ${kind} à ${timeLabel(nextTide.time, now)}${rel ? `, ${rel}` : ""}.`);
    }

    const nextLowTide = lowTides.find((tide) => tide.time.getTime() >= now.getTime()) ?? lowTides[0];
    if (nextLowTide && nextLowTide.time.getTime() !== nextTide?.time.getTime()) {
      const lowTidePast = nextLowTide.time.getTime() < now.getTime();
      rows.push(
        lowTidePast
          ? `La basse mer utile pour la pêche à pied est passée à ${timeLabel(nextLowTide.time, now)}.`
          : `Pour la pêche à pied, repère de basse mer à ${timeLabel(nextLowTide.time, now)}.`,
      );
    }

    if (marine) {
      const seaTemp = latestBefore(marine.hourlyTimes, marine.seaTemp, now);
      const waves = latestBefore(marine.hourlyTimes, marine.waveHeight, now);
      if (seaTemp != null || waves != null) {
        const seaBits = [];
        if (seaTemp != null) seaBits.push(`eau ${seaTemp.toFixed(1)}°C`);
        if (waves != null) seaBits.push(`vagues ${waves.toFixed(1)} m`);
        rows.push(`Côté mer : ${seaBits.join(", ")}.`);
      }
    }

    if (departures[0]) {
      const bus = departures[0];
      const destination = bus.headsign ? ` vers ${bus.headsign}` : "";
      rows.push(
        `Bus : ligne ${bus.routeShort} à ${timeLabel(bus.time, now)}${destination}${delayLabel(
          bus.delaySeconds,
        )}.`,
      );
    }

    if (trainDepartures[0]) {
      const train = trainDepartures[0];
      rows.push(
        `Train : ${train.isTgv ? "TGV" : "TER"} vers ${train.dest} à ${timeLabel(
          train.time,
          now,
        )}${delayLabel(train.delaySeconds)}.`,
      );
    }

    return {
      lead: leadText,
      items: rows.slice(0, 5),
    };
  }, [now, weather, marine, upcoming, lowTides, departures, trainDepartures]);

  return (
    <section className="card card-wide">
      <h3>Votre briefing du jour</h3>
      <p className="briefing-text">{lead}</p>
      {items.length > 0 && (
        <ul className="briefing-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
