const NEARBY_TOWNS = [
  {
    name: "Batz-sur-Mer",
    distance: "6 km",
    angle: "marais salants, patrimoine paludier, côte sauvage",
    ideas: ["Musée des Marais Salants", "côte sauvage", "petits concerts et fêtes locales"],
    agendaUrl: "https://www.batzsurmer.fr/informations-transversales/agenda",
    activityUrl: "https://www.ot-batzsurmer.fr/agenda-batz-sur-mer.html",
  },
  {
    name: "La Baule-Escoublac",
    distance: "4 km",
    angle: "grande plage, expos, sport, festivals",
    ideas: ["La Baule Jazz Festival", "expositions", "sports de plage et polo"],
    agendaUrl: "https://www.labaule.fr/evenements/",
    activityUrl: "https://www.labaule-guerande.com/explorer/agenda/",
  },
  {
    name: "Pornichet",
    distance: "10 km",
    angle: "animations familiales, marché, hippodrome, plage",
    ideas: ["Les Renc'Arts", "marchés nocturnes", "longe-côte"],
    agendaUrl: "https://ville-pornichet.fr/je-bouge/agenda-de-pornichet/",
    activityUrl: "https://www.pornichet.fr/sejourner/tous-les-evenements-pornichet",
  },
  {
    name: "Saint-Nazaire",
    distance: "22 km",
    angle: "visites industrielles, culture, concerts, front de mer",
    ideas: ["Escal'Atlantic", "base sous-marine", "concerts au VIP"],
    agendaUrl: "https://www.saintnazaire.fr/mon-quotidien/sortir-a-saint-nazaire/",
    activityUrl: "https://www.saint-nazaire-tourisme.com/agenda/",
  },
];

export default function NearbyTowns() {
  return (
    <section className="card card-wide">
      <div className="event-heading">
        <h3>À explorer autour</h3>
        <a
          href="https://www.labaule-guerande.com/explorer/agenda/"
          target="_blank"
          rel="noreferrer"
        >
          agenda destination
        </a>
      </div>
      <div className="nearby-towns">
        {NEARBY_TOWNS.map((town) => (
          <article className="nearby-town" key={town.name}>
            <div className="nearby-town-head">
              <div>
                <strong>{town.name}</strong>
                <p>{town.angle}</p>
              </div>
              <span>{town.distance}</span>
            </div>
            <ul>
              {town.ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
            <div className="nearby-links">
              <a href={town.agendaUrl} target="_blank" rel="noreferrer">
                événements
              </a>
              <a href={town.activityUrl} target="_blank" rel="noreferrer">
                activités
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
