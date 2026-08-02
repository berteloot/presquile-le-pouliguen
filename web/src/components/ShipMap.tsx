import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { EnrichedShip } from "../lib/ships";
import { formatHours, statusLabel } from "../lib/ships";

interface Props {
  ships: EnrichedShip[];
  selectedShip: EnrichedShip | null;
  onSelect: (ship: EnrichedShip) => void;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markerClass(ship: EnrichedShip, selected: boolean): string {
  const status =
    ship.statusGroup === "Anchored"
      ? "anchored"
      : ship.statusGroup === "Working"
        ? "working"
        : "underway";
  return selected ? `ship-marker ship-marker-${status} ship-marker-active` : `ship-marker ship-marker-${status}`;
}

function popupHtml(ship: EnrichedShip): string {
  return (
    `<div class="ship-popup">` +
    `<h3>${esc(ship.flagEmoji)} ${esc(ship.name)}</h3>` +
    `<p><strong>${esc(ship.vesselType)}</strong> · ${esc(statusLabel(ship.statusGroup))}</p>` +
    `<p>${ship.speedKnots.toFixed(1)} nd · cap ${Math.round(ship.headingDeg)}° · ${ship.coordinateLabel}</p>` +
    `<p>Destination : ${esc(ship.destination)}</p>` +
    `<p>Mouillage : ${esc(formatHours(ship.timeAtAnchorHours))}</p>` +
    `</div>`
  );
}

export default function ShipMap({ ships, selectedShip, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const shipLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [47.24, -2.55],
      zoom: 10,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(map);

    const shore = L.circleMarker([47.269, -2.43], {
      radius: 6,
      color: "#12314b",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 1,
    })
      .bindTooltip("Le Pouliguen / La Baule")
      .addTo(map);
    shore.bindPopup("Repère côtier : Le Pouliguen et La Baule");

    shipLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      shipLayerRef.current = null;
      markerRefs.current = new Map();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = shipLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markerRefs.current = new Map();

    const bounds: [number, number][] = [[47.269, -2.43]];
    for (const ship of ships) {
      bounds.push([ship.position.lat, ship.position.lon]);
      const selected = selectedShip?.mmsi === ship.mmsi;
      const icon = L.divIcon({
        className: "ship-marker-wrap",
        html:
          `<button type="button" class="${markerClass(ship, selected)}" ` +
          `style="--ship-heading:${Math.round(ship.headingDeg)}deg" ` +
          `aria-label="${esc(ship.name)}">` +
          `<span>${ship.statusGroup === "Anchored" ? "●" : "▲"}</span>` +
          `</button>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const marker = L.marker([ship.position.lat, ship.position.lon], { icon })
        .bindTooltip(`${ship.name} · ${statusLabel(ship.statusGroup)}`)
        .bindPopup(popupHtml(ship))
        .on("click", () => onSelect(ship));
      marker.addTo(layer);
      markerRefs.current.set(ship.mmsi, marker);
    }
    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
    }
  }, [ships, selectedShip, onSelect]);

  useEffect(() => {
    if (!selectedShip || !mapRef.current) return;
    const marker = markerRefs.current.get(selectedShip.mmsi);
    if (!marker) return;
    mapRef.current.panTo(marker.getLatLng(), { animate: true });
    marker.openPopup();
  }, [selectedShip]);

  return <div ref={containerRef} className="ship-map" />;
}
