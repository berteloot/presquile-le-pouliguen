import type { CinemaPaxData, CinemaPaxSession } from "../lib/types";

interface Props {
  cinema: CinemaPaxData | null;
  now: Date;
  rainy: boolean;
}

const fmtDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});

const fmtUpdated = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

function sessionDate(session: CinemaPaxSession): Date {
  const month = Number(session.date.slice(5, 7));
  const parisOffset = month >= 4 && month <= 10 ? "+02:00" : "+01:00";
  return new Date(`${session.date}T${session.time}:00${parisOffset}`);
}

function finishLabel(session: CinemaPaxSession): string | null {
  if (!session.duration_minutes) return null;
  const finish = sessionDate(session);
  finish.setMinutes(finish.getMinutes() + session.duration_minutes);
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(finish);
}

function isChildFriendly(session: CinemaPaxSession): boolean {
  const haystack = `${session.film} ${session.genres} ${session.age} ${session.special_labels.join(" ")}`.toLowerCase();
  return (
    haystack.includes("animation") ||
    haystack.includes("famille") ||
    haystack.includes("bébés") ||
    haystack.includes("bebes") ||
    haystack.includes("dès ")
  );
}

export default function CinemaPax({ cinema, now, rainy }: Props) {
  if (!cinema || cinema.sessions.length === 0) {
    return null;
  }

  const upcoming = cinema.sessions
    .map((session) => ({ session, startsAt: sessionDate(session) }))
    .filter((item) => item.startsAt.getTime() >= now.getTime() - 15 * 60 * 1000)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const nextSessions = upcoming.slice(0, 5);
  const voCount = upcoming.filter((item) => item.session.version.toUpperCase().includes("VO")).length;
  const childCount = upcoming.filter((item) => isChildFriendly(item.session)).length;
  const generated = new Date(cinema.generated);
  const sourceUpdated = cinema.source_updated_at ? new Date(cinema.source_updated_at) : null;

  return (
    <section className="card card-wide cinema-card">
      <div className="cinema-heading">
        <div>
          <h3>Cinéma Pax</h3>
          <p className="cinema-summary">
            {rainy ? "Bonne option abritée aujourd'hui." : "Les prochaines séances au Pouliguen."}
          </p>
        </div>
        <div className="cinema-actions">
          <a href={cinema.cinema.tickets_url} target="_blank" rel="noopener noreferrer">
            billets
          </a>
          <a href={cinema.cinema.source_url} target="_blank" rel="noopener noreferrer">
            horaires
          </a>
        </div>
      </div>

      <div className="cinema-insights" aria-label="Repères cinéma">
        <span>{upcoming.length} séances à venir</span>
        <span>{voCount} en VO</span>
        <span>{childCount} jeune public</span>
      </div>

      {nextSessions.length > 0 ? (
        <ul className="cinema-sessions">
          {nextSessions.map(({ session, startsAt }) => {
            const finish = finishLabel(session);
            const bookingUrl = session.ticket_url || cinema.cinema.tickets_url;
            return (
              <li key={`${session.date}-${session.time}-${session.film}`}>
                <time dateTime={`${session.date}T${session.time}`}>
                  <strong>{session.time}</strong>
                  <span>{fmtDay.format(startsAt)}</span>
                </time>
                <div>
                  <a href={session.film_url} target="_blank" rel="noopener noreferrer">
                    {session.film}
                  </a>
                  <a className="cinema-book-link" href={bookingUrl} target="_blank" rel="noopener noreferrer">
                    réserver
                  </a>
                  <p>
                    {session.version && <span>{session.version}</span>}
                    {session.duration_minutes && <span>{session.duration_minutes} min</span>}
                    {finish && <span>fin vers {finish}</span>}
                    {session.genres && <span>{session.genres}</span>}
                  </p>
                  {session.special_labels.length > 0 && (
                    <small>{session.special_labels.join(" · ")}</small>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="placeholder">Aucune séance à venir dans le cache actuel.</p>
      )}

      <p className="meta-line">
        Source :{" "}
        <a href={cinema.cinema.source_url} target="_blank" rel="noopener noreferrer">
          site officiel du Cinéma Pax
        </a>
        {cinema.cinema.program_pdf_url && (
          <>
            {" "}
            ·{" "}
            <a href={cinema.cinema.program_pdf_url} target="_blank" rel="noopener noreferrer">
              programme PDF
            </a>
          </>
        )}
        . Cache généré le {fmtUpdated.format(generated)}
        {sourceUpdated && <> · page mise à jour le {fmtUpdated.format(sourceUpdated)}</>}.
      </p>
    </section>
  );
}
