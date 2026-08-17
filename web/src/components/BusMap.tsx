import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LAT, LON, VEHICLES_REFRESH_MS } from "../config";
import { fetchVehicles, nextDepartures } from "../lib/transit";
import { escapeHtml as esc, textContent } from "../lib/html";
import type { TransitData, Vehicle } from "../lib/types";

interface Props {
  data: TransitData;
  delays: Map<string, number>;
}

const TICKETS_URL = "https://www.lilapresquile.fr";

const ROUTE_FALLBACK_COLORS: Record<string, string> = {
  "6": "#0d7ab8",
  "5": "#7a3fa0",
  "1": "#c23b22",
  "4": "#3a7d44",
  "13": "#b0812c",
};

const fmtTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

function vehicleColor(v: Vehicle): string {
  if (v.routeColor) return `#${v.routeColor}`;
  return ROUTE_FALLBACK_COLORS[v.routeShort] ?? "#c2571a";
}

export default function BusMap({ data, delays }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const busLayerRef = useRef<L.LayerGroup | null>(null);
  const delaysRef = useRef(delays);
  delaysRef.current = delays;
  const userMarkerRef = useRef<L.Marker | null>(null);
  const [vehicleCount, setVehicleCount] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);

  const locateMe = () => {
    setLocateError(null);
    if (!navigator.geolocation) {
      setLocateError("La localisation n'est pas disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const map = mapRef.current;
        if (!map) return;
        if (userMarkerRef.current) {
          userMarkerRef.current.setLatLng([latitude, longitude]);
        } else {
          const icon = L.divIcon({
            className: "user-dot-wrap",
            html: `<div class="user-dot"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          });
          userMarkerRef.current = L.marker([latitude, longitude], { icon })
            .bindTooltip("Vous êtes ici")
            .addTo(map);
        }
        map.setView([latitude, longitude], 15);
      },
      () => {
        setLocateError(
          "Impossible de vous localiser. Autorisez la localisation dans votre navigateur.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [LAT, LON],
      zoom: 13,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(map);

    // One marker per stop name, click shows the next departures there.
    const stopLayer = L.layerGroup().addTo(map);
    const groups = new Map<string, { lat: number; lon: number; ids: string[] }>();
    for (const s of data.stops) {
      const g = groups.get(s.name);
      if (g) g.ids.push(s.id);
      else groups.set(s.name, { lat: s.lat, lon: s.lon, ids: [s.id] });
    }
    for (const [name, g] of groups) {
      const marker = L.circleMarker([g.lat, g.lon], {
        radius: 5,
        color: "#31536b",
        weight: 1.5,
        fillColor: "#ffffff",
        fillOpacity: 0.9,
      })
        .bindTooltip(textContent(name))
        .addTo(stopLayer);
      marker.bindPopup(() => {
        const deps = nextDepartures(data, g.ids, delaysRef.current, 4);
        const rows = deps
          .map((d) => {
            const delay =
              d.delaySeconds != null && d.delaySeconds >= 60
                ? ` <em class="pop-delay">+${Math.round(d.delaySeconds / 60)} min</em>`
                : "";
            const dest = d.headsign || "";
            return `<li><span class="pop-badge">${esc(d.routeShort)}</span> ` +
              `<span class="pop-dest">${esc(dest ? "vers " + dest : "")}</span> ` +
              `<strong>${fmtTime.format(d.time)}</strong>${delay}</li>`;
          })
          .join("");
        return (
          `<div class="stop-popup"><h3>${esc(name)}</h3>` +
          (rows
            ? `<ul>${rows}</ul>`
            : `<p>Plus de passage prévu aujourd'hui.</p>`) +
          `<a href="${TICKETS_URL}" target="_blank" rel="noopener noreferrer">Billets et horaires complets</a></div>`
        );
      });
    }

    busLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      busLayerRef.current = null;
      userMarkerRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const vehicles = await fetchVehicles(data);
        if (cancelled || !busLayerRef.current) return;
        busLayerRef.current.clearLayers();
        for (const v of vehicles) {
          const corridor = v.routeLongName;
          const dest = v.headsign || corridor;
          const delay = v.tripId ? delaysRef.current.get(v.tripId) : undefined;
          const icon = L.divIcon({
            className: "bus-marker-wrap",
            html: `<div class="bus-marker" style="background:${vehicleColor(v)}">${esc(v.routeShort || "?")}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });
          const popup =
            `<div class="bus-popup"><h3>Ligne ${esc(v.routeShort || "?")}</h3>` +
            (corridor ? `<p class="pop-corridor">${esc(corridor)}</p>` : "") +
            (v.headsign ? `<p>Direction ${esc(v.headsign)}</p>` : "") +
            (delay != null && delay >= 60
              ? `<p class="pop-delay">Retard estimé : ${Math.round(delay / 60)} min</p>`
              : delay != null
                ? `<p class="pop-ontime">À l'heure</p>`
                : "") +
            (v.timestamp
              ? `<p class="pop-meta">Position de ${fmtTime.format(v.timestamp)}</p>`
              : "") +
            `<a href="${TICKETS_URL}" target="_blank" rel="noopener noreferrer">Billets et infos ligne</a></div>`;
          L.marker([v.lat, v.lon], { icon })
            .bindTooltip(
              textContent(`Ligne ${v.routeShort}${dest ? " vers " + dest : ""}`),
            )
            .bindPopup(popup)
            .addTo(busLayerRef.current);
        }
        setVehicleCount(vehicles.length);
        setUpdatedAt(new Date());
      } catch {
        if (!cancelled) setVehicleCount(null);
      }
    };
    refresh();
    const id = setInterval(refresh, VEHICLES_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [data]);

  return (
    <div>
      <button type="button" className="locate-btn" onClick={locateMe}>
        Me situer sur la carte
      </button>
      {locateError && <p className="locate-error">{locateError}</p>}
      <div ref={containerRef} className="bus-map" />
      <p className="map-status">
        {vehicleCount === null
          ? "Positions des bus indisponibles pour le moment."
          : vehicleCount === 0
            ? "Aucun bus en circulation actuellement sur le réseau."
            : `${vehicleCount} bus en circulation sur le réseau Lila Presqu'île` +
              (updatedAt
                ? `, mis à jour à ${updatedAt.toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}`
                : "") + ". Touchez un bus ou un arrêt pour le détail."}
      </p>
    </div>
  );
}
