import { useEffect, useMemo, useState } from "react";
import { fetchPadelCache, type PadelCache, type PadelLink } from "../lib/padel";

const fmtDateTime = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

const PARTNER_LINKS = [
  {
    name: "Tennis Club du Pouliguen",
    provider: "Ten'Up",
    status: "réservation sur le site officiel",
    url: "https://tenup.fft.fr/club/61440146/offres",
  },
  {
    name: "Golf de Guérande",
    provider: "GripRésa / NetGolf",
    status: "départs à vérifier sur la plateforme",
    url: "https://www.grip-resa.com/en/golfs/golf-de-guerande",
  },
  {
    name: "Golf du Croisic",
    provider: "Bookandgolf",
    status: "réservation externe",
    url: "https://www.bookandgolf.com/",
  },
];

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date non transmise";
  return fmtDateTime.format(date);
}

function linkPriority(link: PadelLink): number {
  return ["Inscription", "Cours", "Tournois", "Animations", "Séminaire", "Info"].indexOf(link.kind);
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/\D/g, "")}`;
}

export default function SportsBookings() {
  const [padel, setPadel] = useState<PadelCache | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPadelCache()
      .then((data) => {
        if (!cancelled) setPadel(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const links = useMemo(
    () =>
      (padel?.links ?? [])
        .slice()
        .sort((a, b) => linkPriority(a) - linkPriority(b))
        .slice(0, 6),
    [padel],
  );

  return (
    <section className="card sports-bookings" id="sport-resa">
      <div className="card-heading">
        <div>
          <span className="sports-tag">Sport résa</span>
          <h3>Sports et réservations</h3>
        </div>
        {padel && <span className="sports-cache">mis à jour {dateLabel(padel.generatedAt)}</span>}
      </div>

      {failed && (
        <p className="placeholder">Cache sports indisponible pour le moment.</p>
      )}

      {padel ? (
        <>
          <div className="sports-primary">
            <div>
              <strong>Padel La Baule</strong>
              <p>
                {padel.bookingActivities.detected
                  ? padel.bookingActivities.summary
                  : "Planning public non détecté dans le cache actuel."}
              </p>
            </div>
            <a href={padel.source.siteUrl} target="_blank" rel="noopener noreferrer">
              site officiel
            </a>
          </div>

          {padel.highlights.length > 0 && (
            <ul className="sports-highlights">
              {padel.highlights.slice(0, 2).map((event) => (
                <li key={`${event.title}-${event.when}`}>
                  <strong>{event.title}</strong>
                  <span>{event.when} · {event.note}</span>
                  <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">
                    source
                  </a>
                </li>
              ))}
            </ul>
          )}

          <div className="sports-phone">
            <span>Pistes libres</span>
            <a href={telHref(padel.courtBooking.phone)}>{padel.courtBooking.phone}</a>
            <small>{padel.courtBooking.provider}</small>
          </div>

          {links.length > 0 && (
            <div className="sports-links" aria-label="Liens Padel La Baule">
              {links.map((link) => (
                <a href={link.url} target="_blank" rel="noopener noreferrer" key={`${link.kind}-${link.url}`}>
                  <span>{link.kind}</span>
                  {link.label}
                </a>
              ))}
            </div>
          )}

          {padel.restrictedPages.length > 0 && (
            <p className="meta-line">
              Certaines pages de planning demandent un compte Padel La Baule ;
              la page d'accueil source a été modifiée le{" "}
              {dateLabel(padel.source.homePageModifiedAt)}.
            </p>
          )}
        </>
      ) : (
        !failed && <p className="placeholder">Chargement du cache Padel La Baule…</p>
      )}

      <div className="sports-external">
        {PARTNER_LINKS.map((item) => (
          <a href={item.url} target="_blank" rel="noopener noreferrer" key={item.name}>
            <strong>{item.name}</strong>
            <span>{item.provider} · {item.status}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
