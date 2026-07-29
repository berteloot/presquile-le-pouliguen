import type { AgendaEvent } from "../lib/capatlantique";
import type { RoadInfo } from "../lib/localdata";
import type { TrainDeparture } from "../lib/trains";
import type { MarineSeries, NextDeparture, TideExtreme, WeatherNow } from "../lib/types";

const fmtTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

interface VisitPlannerProps {
  now: Date;
  weather: WeatherNow | null;
  marine: MarineSeries | null;
  upcoming: TideExtreme[];
  lowTides: TideExtreme[];
  departures: NextDeparture[];
  trainDepartures: TrainDeparture[];
  roadInfo: RoadInfo[] | null;
  agenda: AgendaEvent[];
}

function latestBefore(times: Date[], values: (number | null)[], now: Date): number | null {
  let best: number | null = null;
  for (let i = 0; i < times.length; i++) {
    if (times[i].getTime() <= now.getTime() && values[i] != null) best = values[i];
  }
  return best;
}

function timeLabel(date: Date, now: Date): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 1) return `demain ${fmtTime.format(date)}`;
  return fmtTime.format(date);
}

export default function VisitPlanner({
  now,
  weather,
  marine,
  upcoming,
  lowTides,
  departures,
  trainDepartures,
  roadInfo,
  agenda,
}: VisitPlannerProps) {
  const seaTemp = marine ? latestBefore(marine.hourlyTimes, marine.seaTemp, now) : null;
  const waves = marine ? latestBefore(marine.hourlyTimes, marine.waveHeight, now) : null;
  const nextLowTide = lowTides.find((tide) => tide.time.getTime() >= now.getTime()) ?? null;
  const nextTide = upcoming[0] ?? null;
  const seaBits = [
    seaTemp != null ? `eau ${seaTemp.toFixed(1)}°C` : null,
    waves != null ? `vagues ${waves.toFixed(1)} m` : null,
  ].filter(Boolean);
  const todaysEvents = agenda.filter((event) => {
    const dateShort = new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Europe/Paris",
    }).format(now);
    const dateLong = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Europe/Paris",
    }).format(now);
    const range = event.dateRange.toLowerCase();
    return range.includes(dateShort.toLowerCase()) || range.includes(dateLong.toLowerCase());
  });

  const beachText = weather
    ? weather.uvMax >= 7
      ? `Plage agréable, mais UV ${Math.round(weather.uvMax)} : privilégier matin ou fin d'après-midi.`
      : weather.weatherCode >= 51
        ? "Plage possible entre les averses, avec une option abri à proximité."
        : "Bon créneau plage si le vent reste confortable."
    : "Conditions plage en cours de chargement.";

  const coastText =
    weather && weather.windGusts >= 35
      ? `Côte sauvage belle mais exposée : rafales autour de ${Math.round(weather.windGusts)} km/h.`
      : nextLowTide
        ? `Pour marcher bas sur l'estran, viser la basse mer à ${timeLabel(nextLowTide.time, now)}.`
        : nextTide
          ? `Prochaine ${nextTide.type === "high" ? "marée haute" : "marée basse"} à ${timeLabel(
              nextTide.time,
              now,
            )}.`
          : "Côte sauvage : partir tôt ou en fin de journée reste le meilleur réflexe.";

  const mobilityText = departures[0]
    ? `Bus ligne ${departures[0].routeShort} à ${timeLabel(departures[0].time, now)}.`
    : trainDepartures[0]
      ? `Train vers ${trainDepartures[0].dest} à ${timeLabel(trainDepartures[0].time, now)}.`
      : roadInfo && roadInfo.length > 0
        ? `Routes : ${roadInfo[0].nature.toLowerCase()} à ${roadInfo[0].distanceKm} km.`
        : "Pas d'alerte transport notable dans les données disponibles.";

  const eventText =
    todaysEvents[0]
      ? `${todaysEvents[0].title}${todaysEvents[0].location ? `, ${todaysEvents[0].location}` : ""}.`
      : agenda[0]
        ? `À surveiller : ${agenda[0].title}.`
        : "Consulter l'agenda municipal pour les animations du jour.";

  return (
    <section className="card card-wide">
      <h3>Préparer sa sortie</h3>
      <div className="visit-planner">
        <article>
          <span>Plage</span>
          <strong>{beachText}</strong>
          {seaBits.length > 0 && <small>{seaBits.join(" · ")}</small>}
        </article>
        <article>
          <span>Côte</span>
          <strong>{coastText}</strong>
          <small>Astuce : éviter les heures les plus chargées en saison.</small>
        </article>
        <article>
          <span>Sans voiture</span>
          <strong>{mobilityText}</strong>
          <small>Vérifier le sens et l'arrêt avant de partir.</small>
        </article>
        <article>
          <span>À faire</span>
          <strong>{eventText}</strong>
          <small>
            <a href="https://www.lepouliguen.fr/evenements/" target="_blank" rel="noreferrer">
              agenda complet
            </a>
          </small>
        </article>
      </div>
    </section>
  );
}
