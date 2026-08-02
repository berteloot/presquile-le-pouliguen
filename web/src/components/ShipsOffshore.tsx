import { useCallback, useEffect, useMemo, useState } from "react";
import ShipMap from "./ShipMap";
import {
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

function numberLabel(value: number): string {
  return value.toLocaleString("fr-FR");
}

function knownValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return !/^(non connu|non confirm|non déclar|unknown|n\/a)$/i.test(value.trim());
}

function dimensionLabel(value: number, unit: string): string {
  return value > 0 ? `${numberLabel(value)} ${unit}` : "non transmise";
}

function optionalText(value: string | null | undefined, fallback = "non transmis"): string {
  return knownValue(value) ? (value ?? fallback) : fallback;
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
          <span className="ship-kicker">{ship.flagEmoji} {ship.flagCountry}</span>
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
            <dt>IMO</dt>
            <dd>{optionalText(ship.imo)}</dd>
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
            <dd>{optionalText(ship.destination, "non déclarée")}</dd>
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
  const [shipScope, setShipScope] = useState<ShipScope>("horizon");
  const [selectedType, setSelectedType] = useState<ShipTypeGroup | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<ShipStatusGroup | "all">("all");
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("why");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
          (selectedType === "all" || ship.vesselTypeGroup === selectedType) &&
          (selectedStatus === "all" || ship.statusGroup === selectedStatus),
      ),
    [scopedShips, selectedType, selectedStatus],
  );
  const stats = useMemo(() => offshoreShipStats(filteredShips), [filteredShips]);
  const selectedShip =
    filteredShips.find((ship) => ship.mmsi === selectedMmsi) ?? filteredShips[0] ?? null;
  const interestingFacts = useMemo(
    () =>
      filteredShips
        .slice()
        .sort((a, b) => {
          const waitA = a.timeAtAnchorHours ?? -1;
          const waitB = b.timeAtAnchorHours ?? -1;
          return waitB - waitA || b.grossTonnage - a.grossTonnage;
        })
        .slice(0, 3),
    [filteredShips],
  );
  const generatedAt = cache ? formatDateTime(cache.generatedAt) : "";
  const isDemoCache = cache?.sourceMode !== "api-cache";

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
        <SourceStamp generatedAt={generatedAt} sourceMode={cache?.sourceMode} />
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

          {!isDemoCache && (
            <>
              <div className="ship-focus">
                <div>
                  <span>Vue par défaut</span>
                  <strong>Gros navires au mouillage visibles depuis la côte</strong>
                  <p>
                    Tankers, cargos et grands navires marchands immobiles dans la
                    zone que l'on voit sur l'horizon. Les petits AIS restent
                    accessibles dans la vue complète.
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
                      ? "gros navires au mouillage"
                      : `${stats.anchoredCount} au mouillage · ${stats.movingCount} en route`
                  }
                />
                <StatCard
                  label="Attente moyenne"
                  value={formatHours(stats.averageWaitHours)}
                  note="mouillages mesurés"
                />
                <StatCard
                  label="Plus grand"
                  value={stats.largestShip ? `${stats.largestShip.lengthM} m` : "n/a"}
                  note={stats.largestShip?.name ?? "aucun navire"}
                />
                <StatCard
                  label="Plus lourd"
                  value={stats.biggestTonnage ? `${numberLabel(stats.biggestTonnage.grossTonnage)} GT` : "n/a"}
                  note={stats.biggestTonnage?.name ?? "aucun navire"}
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
                            <span>{ship.flagEmoji}</span>
                            <strong>{ship.name}</strong>
                            <small>
                              {ship.vesselType} · {statusLabel(ship.statusGroup)} ·{" "}
                              {ship.distanceFromLePouliguenKm.toFixed(1)} km
                              {shipScope === "horizon" ? " · horizon" : ""}
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
                  {shipScope === "horizon"
                    ? "Aucun gros navire au mouillage détecté dans la fenêtre AIS actuelle. Essayez Tout AIS ou attendez le prochain rafraîchissement."
                    : "Aucun navire ne correspond aux filtres."}
                </p>
              )}

              {interestingFacts.length > 0 && (
                <section className="interesting-facts">
                  <div className="event-heading">
                    <h3>Interesting Facts</h3>
                    <span>{filteredShips.length} navires filtrés</span>
                  </div>
                  <ul>
                    {interestingFacts.map((ship) => (
                      <li key={ship.mmsi}>{ship.fact}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <p className="meta-line">
            {isDemoCache
              ? "Données : cache de démonstration. Les positions, ports précédents et explications ne doivent pas être interprétés comme des observations AIS réelles."
              : "Données : cache AIS API. Les origines, ports précédents et explications restent estimés quand l'historique AIS complet manque."}
          </p>
        </>
      ) : (
        <p className="placeholder">Chargement du cache AIS…</p>
      )}
    </section>
  );
}

function SourceStamp({
  generatedAt,
  sourceMode,
}: {
  generatedAt: string;
  sourceMode?: OffshoreShipCache["sourceMode"];
}) {
  return (
    <div className="ship-source">
      <span>{sourceMode === "api-cache" ? "cache API AIS" : "démo non GPS"}</span>
      {generatedAt && <small>{generatedAt}</small>}
    </div>
  );
}
