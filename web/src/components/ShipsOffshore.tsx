import { useCallback, useEffect, useMemo, useState } from "react";
import ShipMap from "./ShipMap";
import {
  decodeAisRoute,
  enrichShipCache,
  fetchOffshoreShips,
  formatDateTime,
  formatHours,
  offshoreShipStats,
  statusLabel,
  uniqueShipStatuses,
  uniqueShipTypes,
  type EnrichedShip,
  type OffshoreShipCache,
  type ShipStatusGroup,
  type ShipTypeGroup,
} from "../lib/ships";

type DetailTab = "ais" | "why";
type ShipScope = "horizon" | "all";

const TYPE_LABELS: Record<ShipTypeGroup, string> = {
  Cargo: "Cargo",
  Tanker: "Tankers",
  Passenger: "Passagers",
  Fishing: "Pêche",
  Service: "Service",
  Other: "Autres",
};

const STATUS_LABELS: Record<ShipStatusGroup, string> = {
  Anchored: "Au mouillage",
  Underway: "En route",
  Working: "En opération",
  Moored: "À quai",
};
const EXTERNAL_AIS_FULL_URL =
  "https://www.vesselfinder.com/?latitude=47.18&longitude=-2.38&zoom=9";
const MY_SHIP_TRACKING_URL =
  "https://www.myshiptracking.com/?lat=47.18&lng=-2.38&zoom=9";
const VESSELFINDER_EMBED_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #e7f3f7;
      }
    </style>
  </head>
  <body>
    <script>
      var width = "100%";
      var height = "430";
      var latitude = "47.18";
      var longitude = "-2.38";
      var zoom = "9";
      var names = true;
    </script>
    <script src="https://www.vesselfinder.com/aismap.js"></script>
  </body>
</html>`;

function numberLabel(value: number): string {
  return value.toLocaleString("fr-FR");
}

function knownValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return !/^(undefined|null|non connu.*|non confirm.*|non déclar.*|unknown|n\/a)$/i.test(
    value.trim(),
  );
}

function dimensionLabel(value: number, unit: string): string {
  return value > 0 ? `${numberLabel(value)} ${unit}` : "non transmise";
}

function optionalText(value: string | null | undefined, fallback = "non transmis"): string {
  return knownValue(value) ? (value ?? fallback) : fallback;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesShipSearch(ship: EnrichedShip, searchTerm: string): boolean {
  const query = normalizeSearch(searchTerm);
  if (!query) return true;

  return [
    ship.name,
    ship.mmsi,
    ship.imo,
    ship.callSign,
    ship.flagCountry,
    ship.flagCountryLabel,
    ship.vesselType,
    ship.vesselTypeGroup,
    ship.navStatus,
    ship.destination,
    ship.destinationLabel,
    ship.destinationCodeLabel,
    ship.lastDeparturePort.name,
    ship.lastDeparturePort.country,
  ]
    .filter((value): value is string => typeof value === "string" && knownValue(value))
    .some((value) => normalizeSearch(value).includes(query));
}

function shipNames(ships: EnrichedShip[], max = 2): string {
  const names = ships.slice(0, max).map((ship) => ship.name);
  if (ships.length > max) names.push(`+${ships.length - max}`);
  return names.join(", ");
}

function plural(count: number, singular: string, pluralLabel: string): string {
  return count > 1 ? pluralLabel : singular;
}

function hoursSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return Math.max(0, (Date.now() - time) / 3_600_000);
}

function buildInterestingFacts(ships: EnrichedShip[]): string[] {
  const facts: string[] = [];
  const addFact = (fact: string | null | undefined) => {
    if (fact && !facts.includes(fact)) facts.push(fact);
  };

  const anchored = ships.filter((ship) => ship.statusGroup === "Anchored");
  const tankers = ships.filter((ship) => ship.vesselTypeGroup === "Tanker");
  const cargoes = ships.filter((ship) => ship.vesselTypeGroup === "Cargo");
  const dongesShips = ships.filter((ship) => /donges|frdon/i.test(ship.destinationLabel));
  const routeShip = ships.find((ship) => knownValue(ship.destination) && decodeAisRoute(ship.destination));
  const largestShip = ships
    .filter((ship) => ship.lengthM > 0)
    .sort((a, b) => b.lengthM - a.lengthM)[0];
  const longestWait = anchored
    .filter((ship) => ship.timeAtAnchorHours != null)
    .sort((a, b) => (b.timeAtAnchorHours ?? 0) - (a.timeAtAnchorHours ?? 0))[0];
  const foreignShips = ships.filter((ship) => ship.flagCode !== "FR");
  const missingDestinations = ships.filter((ship) => !knownValue(ship.destination));

  if (dongesShips.length > 0) {
    addFact(
      dongesShips.length === 1
        ? `${dongesShips[0].name} déclare Donges comme destination AIS, typique des escales pétrolières de l'estuaire.`
        : `${dongesShips.length} ${plural(dongesShips.length, "navire déclare", "navires déclarent")} Donges côté AIS : ${shipNames(dongesShips, 3)}.`,
    );
  } else if (tankers.length > 0) {
    addFact(
      `${tankers.length} ${plural(tankers.length, "tanker est", "tankers sont")} dans la sélection : ${shipNames(tankers, 3)}.`,
    );
  }

  if (routeShip) {
    const route = decodeAisRoute(routeShip.destination);
    if (route) {
      addFact(
        /donges/i.test(route)
          ? `${routeShip.name} affiche une route AIS ${route}, un indice fort vers le terminal pétrolier de l'estuaire.`
          : `${routeShip.name} affiche une route AIS ${route}, ce qui donne un indice rare sur son voyage.`,
      );
    }
  }

  if (largestShip) {
    addFact(
      `${largestShip.name} est la plus grande silhouette AIS ici : ${largestShip.lengthM} m à ${largestShip.distanceFromLePouliguenKm.toFixed(1)} km du Pouliguen.`,
    );
  }

  if (longestWait?.timeAtAnchorHours != null && longestWait.timeAtAnchorHours >= 1) {
    addFact(
      `${longestWait.name} a le mouillage le plus long mesuré dans ce cache : ${formatHours(longestWait.timeAtAnchorHours)}.`,
    );
  }

  if (cargoes.length > 0 && tankers.length === 0) {
    addFact(
      `${cargoes.length} ${plural(cargoes.length, "cargo ressort", "cargos ressortent")} dans la sélection : ${shipNames(cargoes, 3)}.`,
    );
  }

  if (foreignShips.length >= 2) {
    addFact(
      `${foreignShips.length} pavillons non français apparaissent dans ce filtre, surtout ${shipNames(foreignShips, 3)}.`,
    );
  }

  if (missingDestinations.length >= Math.max(3, Math.ceil(ships.length / 2))) {
    addFact(
      `${missingDestinations.length} AIS sur ${ships.length} ne déclarent pas de destination exploitable ; les explications restent donc volontairement prudentes.`,
    );
  }

  return facts.slice(0, 4);
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="ship-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function ShipDetail({
  ship,
  tab,
  onTabChange,
}: {
  ship: EnrichedShip;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  return (
    <section className="ship-detail" aria-label={`Détail ${ship.name}`}>
      <div className="ship-detail-head">
        <div>
          <span className="ship-kicker">{ship.flagEmoji} Pavillon : {ship.flagCountryLabel}</span>
          <h3>{ship.name}</h3>
          <p>{ship.aiSummary}</p>
        </div>
        <span className={`ship-status-pill ship-status-${ship.statusGroup.toLowerCase()}`}>
          {STATUS_LABELS[ship.statusGroup]}
        </span>
      </div>

      <div className="ship-tabs" role="tablist" aria-label="Détail du navire">
        <button
          type="button"
          className={tab === "ais" ? "ship-tab ship-tab-active" : "ship-tab"}
          onClick={() => onTabChange("ais")}
          role="tab"
          aria-selected={tab === "ais"}
        >
          AIS
        </button>
        <button
          type="button"
          className={tab === "why" ? "ship-tab ship-tab-active" : "ship-tab"}
          onClick={() => onTabChange("why")}
          role="tab"
          aria-selected={tab === "why"}
        >
          Pourquoi ce navire est ici ?
        </button>
      </div>

      {tab === "why" ? (
        <div className="ship-why">
          <p>{ship.whyHere}</p>
          <dl>
            <div>
              <dt>Contexte</dt>
              <dd>{ship.cargoContext ?? "Contexte cargo non confirmé"}</dd>
            </div>
            <div>
              <dt>Origine estimée</dt>
              <dd>
                {knownValue(ship.lastDeparturePort.name)
                  ? `${ship.lastDeparturePort.country}, via ${ship.lastDeparturePort.name}`
                  : "non confirmée par le cache AIS"}
              </dd>
            </div>
            <div>
              <dt>Zone</dt>
              <dd>{ship.areaName}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <dl className="ship-facts">
          <div>
            <dt>MMSI</dt>
            <dd>{ship.mmsi}</dd>
          </div>
          <div>
            <dt>IMO</dt>
            <dd>{optionalText(ship.imo)}</dd>
          </div>
          <div>
            <dt>Indicatif</dt>
            <dd>{optionalText(ship.callSign)}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{ship.vesselType}</dd>
          </div>
          <div>
            <dt>Longueur</dt>
            <dd>{dimensionLabel(ship.lengthM, "m")}</dd>
          </div>
          <div>
            <dt>Largeur</dt>
            <dd>{dimensionLabel(ship.beamM ?? 0, "m")}</dd>
          </div>
          <div>
            <dt>Tonnage</dt>
            <dd>{dimensionLabel(ship.grossTonnage, "GT")}</dd>
          </div>
          <div>
            <dt>Vitesse</dt>
            <dd>{ship.speedKnots.toFixed(1)} nd</dd>
          </div>
          <div>
            <dt>Cap</dt>
            <dd>{Math.round(ship.headingDeg)}°</dd>
          </div>
          <div>
            <dt>Statut</dt>
            <dd>{ship.navStatus}</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{ship.destinationCodeLabel}</dd>
          </div>
          <div>
            <dt>Dernier port</dt>
            <dd>{optionalText(ship.lastDeparturePort.name, "non connu")}</dd>
          </div>
          <div>
            <dt>Départ</dt>
            <dd>{formatDateTime(ship.lastDeparturePort.departedAt)}</dd>
          </div>
          <div>
            <dt>ETA</dt>
            <dd>{formatDateTime(ship.eta)}</dd>
          </div>
          <div>
            <dt>Mouillage</dt>
            <dd>{formatHours(ship.timeAtAnchorHours)}</dd>
          </div>
          <div>
            <dt>Dernier captage AIS</dt>
            <dd>{formatDateTime(ship.updatedAt)}</dd>
          </div>
          <div>
            <dt>Coordonnées</dt>
            <dd>{ship.coordinateLabel}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>
              {ship.distanceFromLePouliguenKm.toFixed(1)} km du Pouliguen ·{" "}
              {ship.distanceFromLaBauleKm.toFixed(1)} km de La Baule
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

export default function ShipsOffshore() {
  const [cache, setCache] = useState<OffshoreShipCache | null>(null);
  const [shipScope, setShipScope] = useState<ShipScope>("all");
  const [shipSearch, setShipSearch] = useState("");
  const [selectedType, setSelectedType] = useState<ShipTypeGroup | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<ShipStatusGroup | "all">("all");
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("why");
  const [failed, setFailed] = useState(false);

  const refreshShips = useCallback(() => {
    let cancelled = false;
    fetchOffshoreShips()
      .then((data) => {
        if (!cancelled) setCache(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cleanup = refreshShips();
    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      cleanup();
      cleanup = refreshShips();
    };
    const interval = window.setInterval(refreshIfVisible, 60_000);
    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("hashchange", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      cleanup();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("hashchange", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshShips]);

  const ships = useMemo(() => (cache ? enrichShipCache(cache) : []), [cache]);
  const horizonShips = useMemo(
    () =>
      ships
        .filter((ship) => ship.isHorizonTarget)
        .sort(
          (a, b) =>
            b.horizonScore - a.horizonScore ||
            (b.lengthM || 0) - (a.lengthM || 0) ||
            a.distanceFromLePouliguenKm - b.distanceFromLePouliguenKm,
        ),
    [ships],
  );
  const scopedShips = shipScope === "horizon" ? horizonShips : ships;
  const shipTypes = useMemo(() => uniqueShipTypes(scopedShips), [scopedShips]);
  const shipStatuses = useMemo(() => uniqueShipStatuses(scopedShips), [scopedShips]);
  const filteredShips = useMemo(
    () =>
      scopedShips.filter(
        (ship) =>
          matchesShipSearch(ship, shipSearch) &&
          (selectedType === "all" || ship.vesselTypeGroup === selectedType) &&
          (selectedStatus === "all" || ship.statusGroup === selectedStatus),
      ),
    [scopedShips, shipSearch, selectedType, selectedStatus],
  );
  const stats = useMemo(() => offshoreShipStats(filteredShips), [filteredShips]);
  const selectedShip =
    filteredShips.find((ship) => ship.mmsi === selectedMmsi) ?? filteredShips[0] ?? null;
  const interestingFacts = useMemo(() => buildInterestingFacts(filteredShips), [filteredShips]);
  const generatedAt = cache ? formatDateTime(cache.generatedAt) : "";
  const lastRefreshAttemptAt = cache?.lastRefreshAttemptAt
    ? formatDateTime(cache.lastRefreshAttemptAt)
    : "";
  const isDemoCache = cache?.sourceMode !== "api-cache";
  const isPreservedCache =
    cache?.refreshStatus === "stale-preserved" || cache?.refreshStatus === "error-preserved";
  const isExpiredPreservedCache =
    isPreservedCache && (hoursSince(cache?.generatedAt) ?? 0) > 24;

  const selectShip = useCallback((ship: EnrichedShip) => {
    setSelectedMmsi(ship.mmsi);
  }, []);

  const changeScope = useCallback((scope: ShipScope) => {
    setShipScope(scope);
    setSelectedType("all");
    setSelectedStatus("all");
    setSelectedMmsi(null);
  }, []);

  if (failed) {
    return (
      <section className="card card-wide ships-card" id="navires">
        <h2>Navires au large</h2>
        <p className="placeholder">Cache AIS indisponible pour le moment.</p>
      </section>
    );
  }

  return (
    <section className="card card-wide ships-card" id="navires">
      <div className="ships-header">
        <div>
          <span className="section-eyebrow">
            {isDemoCache ? "Démo AIS offshore" : "AIS offshore"}
          </span>
          <h2>Navires au large</h2>
          <p>
            {cache?.coverageLabel ?? "Chargement des navires..."}
          </p>
        </div>
        <SourceStamp
          generatedAt={generatedAt}
          lastRefreshAttemptAt={lastRefreshAttemptAt}
          refreshStatus={cache?.refreshStatus}
          sourceMode={cache?.sourceMode}
        />
      </div>

      {cache ? (
        <>
          {isDemoCache && (
            <div className="ship-live-missing">
              <strong>AIS réel non connecté</strong>
              <p>
                Les noms et positions du cache local sont une maquette, pas des
                navires observés maintenant au large du Pouliguen. Pour éviter
                toute confusion, la carte live est masquée tant qu'un vrai flux
                AIS n'alimente pas le cache.
              </p>
              <ul>
                <li>AISstream : flux WebSocket temps réel avec clé API.</li>
                <li>VesselAPI : requête par zone avec positions, statut, cap et ETA.</li>
                <li>AISHub : accès au flux agrégé si une station AIS locale est partagée.</li>
              </ul>
              <p className="meta-line">
                Renseigner ensuite <code>AISSTREAM_API_KEY</code> puis lancer{" "}
                <code>tools/build_ais_cache.mjs</code> pour publier un cache
                statique réellement rafraîchi, sans serveur payant en continu.
              </p>
            </div>
          )}

          {!isDemoCache && isPreservedCache && (
            <div className="ship-live-missing">
              <strong>Dernier captage AIS connu</strong>
              <p>
                Les positions affichées datent du dernier cache non vide. Le
                refresh automatique tourne encore, mais la dernière fenêtre
                AISstream gratuite n'a pas renvoyé de navire exploitable dans
                la baie de Saint-Nazaire.
              </p>
              {cache.refreshMessage && <p>{cache.refreshMessage}</p>}
              {isExpiredPreservedCache && (
                <p>
                  La carte et la liste courante sont masquées pour éviter de
                  présenter d'anciennes positions comme des navires présents
                  maintenant.
                </p>
              )}
            </div>
          )}

          {!isDemoCache && isExpiredPreservedCache && (
            <ExternalAisFallback />
          )}

          {!isDemoCache && !isExpiredPreservedCache && (
            <>
              <div className="ship-focus">
                <div>
                  <span>Vue par défaut</span>
                  <strong>Gros navires au mouillage visibles depuis la côte</strong>
                  <p>
                    La vue complète affiche tous les AIS captés dans la baie.
                    Le filtre Horizon isole seulement les silhouettes immobiles
                    les plus plausibles au large.
                  </p>
                </div>
                <div className="ship-scope" role="tablist" aria-label="Vue navires">
                  <button
                    type="button"
                    className={shipScope === "horizon" ? "ship-scope-active" : ""}
                    onClick={() => changeScope("horizon")}
                    role="tab"
                    aria-selected={shipScope === "horizon"}
                  >
                    Horizon
                    <small>{horizonShips.length}</small>
                  </button>
                  <button
                    type="button"
                    className={shipScope === "all" ? "ship-scope-active" : ""}
                    onClick={() => changeScope("all")}
                    role="tab"
                    aria-selected={shipScope === "all"}
                  >
                    Tout AIS
                    <small>{ships.length}</small>
                  </button>
                </div>
              </div>

              <div className="ship-controls" aria-label="Filtres navires">
                <label className="ship-search">
                  Recherche
                  <span>
                    <input
                      type="search"
                      value={shipSearch}
                      onChange={(event) => {
                        setShipSearch(event.target.value);
                        setSelectedMmsi(null);
                      }}
                      placeholder="Nom, MMSI, IMO, destination..."
                      aria-label="Rechercher un navire"
                    />
                    {shipSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setShipSearch("");
                          setSelectedMmsi(null);
                        }}
                      >
                        Effacer
                      </button>
                    )}
                  </span>
                </label>
                <label>
                  Type
                  <select
                    value={selectedType}
                    onChange={(event) =>
                      setSelectedType(event.target.value as ShipTypeGroup | "all")
                    }
                  >
                    <option value="all">Tous</option>
                    {shipTypes.map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Statut
                  <select
                    value={selectedStatus}
                    onChange={(event) =>
                      setSelectedStatus(event.target.value as ShipStatusGroup | "all")
                    }
                  >
                    <option value="all">Tous</option>
                    {shipStatuses.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="ship-stats">
                <StatCard
                  label={shipScope === "horizon" ? "À l'horizon" : "Navires"}
                  value={String(stats.count)}
                  note={
                    shipScope === "horizon"
                      ? "grandes silhouettes au mouillage"
                      : `${stats.anchoredCount} au mouillage · ${stats.movingCount} en route`
                  }
                />
                <StatCard
                  label="Attente moyenne"
                  value={formatHours(stats.averageWaitHours)}
                  note="mouillages AIS mesurés"
                />
                <StatCard
                  label="Plus grand"
                  value={stats.largestShip ? `${stats.largestShip.lengthM} m` : "non transmis"}
                  note={stats.largestShip?.name ?? "longueur AIS manquante"}
                />
                <StatCard
                  label="Plus lourd"
                  value={stats.biggestTonnage ? `${numberLabel(stats.biggestTonnage.grossTonnage)} GT` : "non transmis"}
                  note={stats.biggestTonnage?.name ?? "tonnage AIS manquant"}
                />
              </div>

              {filteredShips.length > 0 ? (
                <div className="ship-layout">
                  <div>
                    <ShipMap
                      ships={filteredShips}
                      selectedShip={selectedShip}
                      onSelect={selectShip}
                    />
                    <ul className="ship-list" aria-label="Navires détectés">
                      {filteredShips.map((ship) => (
                        <li key={ship.mmsi}>
                          <button
                            type="button"
                            className={selectedShip?.mmsi === ship.mmsi ? "ship-row ship-row-active" : "ship-row"}
                            onClick={() => selectShip(ship)}
                          >
                            <span className="ship-row-flag">
                              <span aria-hidden="true">{ship.flagEmoji}</span>
                              <em>{ship.flagCountryLabel}</em>
                            </span>
                            <strong>{ship.name}</strong>
                            <small>
                              {ship.vesselType} · {statusLabel(ship.statusGroup)} ·{" "}
                              {ship.distanceFromLePouliguenKm.toFixed(1)} km
                              {shipScope === "horizon" ? " · horizon" : ""}
                              <br />
                              Dernier captage AIS : {formatDateTime(ship.updatedAt)}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {selectedShip && (
                    <ShipDetail
                      ship={selectedShip}
                      tab={detailTab}
                      onTabChange={setDetailTab}
                    />
                  )}
                </div>
              ) : (
                <p className="placeholder">
                  {shipSearch
                    ? `Aucun navire ne correspond à "${shipSearch}".`
                    : shipScope === "horizon"
                    ? "Aucun gros navire au mouillage détecté dans la fenêtre AIS actuelle. Essayez Tout AIS ou attendez le prochain rafraîchissement."
                    : "Aucun navire ne correspond aux filtres."}
                </p>
              )}

              {interestingFacts.length > 0 && (
                <section className="interesting-facts">
                  <div className="event-heading">
                    <h3>À remarquer</h3>
                    <span>{filteredShips.length} navires filtrés</span>
                  </div>
                  <ul>
                    {interestingFacts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <p className="meta-line">
            {isDemoCache
              ? "Données : cache de démonstration. Les positions, ports précédents et explications ne doivent pas être interprétés comme des observations AIS réelles."
              : isPreservedCache
                ? "Données : dernier cache AIS API conservé. Les positions sont le dernier captage connu, pas une nouvelle position live confirmée."
              : "Données : cache AIS API. Les origines, ports précédents et explications restent estimés quand l'historique AIS complet manque."}
          </p>
        </>
      ) : (
        <p className="placeholder">Chargement du cache AIS…</p>
      )}
    </section>
  );
}

function ExternalAisFallback() {
  return (
    <section className="external-ais-fallback" aria-label="Carte AIS externe">
      <div className="external-ais-copy">
        <div>
          <span className="section-eyebrow">Carte AIS externe live</span>
          <h3>Navires actuels via VesselFinder</h3>
          <p>
            Notre flux AIS enrichi est vide pour la baie. Cette carte externe
            gratuite affiche les positions disponibles dans le réseau
            VesselFinder autour du Pouliguen, La Baule et Saint-Nazaire.
          </p>
        </div>
        <div className="external-ais-links">
          <a href={EXTERNAL_AIS_FULL_URL} target="_blank" rel="noreferrer">
            Ouvrir VesselFinder
          </a>
          <a href={MY_SHIP_TRACKING_URL} target="_blank" rel="noreferrer">
            Essayer MyShipTracking
          </a>
        </div>
      </div>
      <iframe
        title="Carte AIS VesselFinder autour du Pouliguen et Saint-Nazaire"
        srcDoc={VESSELFINDER_EMBED_HTML}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
      <p className="meta-line">
        Source externe : VesselFinder. Les détails enrichis, explications et
        filtres du site reviendront dès qu'un nouveau captage AIS local non
        vide sera disponible.
      </p>
    </section>
  );
}

function SourceStamp({
  generatedAt,
  lastRefreshAttemptAt,
  refreshStatus,
  sourceMode,
}: {
  generatedAt: string;
  lastRefreshAttemptAt: string;
  refreshStatus?: OffshoreShipCache["refreshStatus"];
  sourceMode?: OffshoreShipCache["sourceMode"];
}) {
  const hasSeparateCheck = lastRefreshAttemptAt && lastRefreshAttemptAt !== generatedAt;
  const label =
    sourceMode !== "api-cache"
      ? "démo non GPS"
      : refreshStatus === "live"
        ? "cache API AIS"
        : "dernier captage AIS";
  return (
    <div className="ship-source">
      <span>{label}</span>
      {generatedAt && <small>capté {generatedAt}</small>}
      {hasSeparateCheck && <small>vérifié {lastRefreshAttemptAt}</small>}
    </div>
  );
}
