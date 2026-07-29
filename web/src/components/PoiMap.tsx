import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LAT, LON } from "../config";

export interface PoiMarker {
  lat: number;
  lon: number;
  label: string; // short text or emoji shown in the pin
  color: string;
  title: string; // tooltip
  popupHtml?: string;
}

export interface PoiLine {
  segments: [number, number][][];
  color: string;
  title: string;
  popupHtml?: string;
}

interface Props {
  markers?: PoiMarker[];
  lines?: PoiLine[];
  /** Title of the line to highlight, zoom to, and open. */
  selectedLine?: string | null;
  /** Zoom out to include every line at load. Off by default: with many
      overlapping circuits the initial view should stay on the town. */
  fitToLines?: boolean;
}

export default function PoiMap({
  markers = [],
  lines = [],
  selectedLine,
  fitToLines = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineLayersRef = useRef<Map<string, L.Polyline>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [LAT, LON],
      zoom: 13,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const bounds: [number, number][] = [];
    for (const m of markers) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) continue;
      bounds.push([m.lat, m.lon]);
      const icon = L.divIcon({
        className: "poi-marker-wrap",
        html: `<div class="poi-marker" style="background:${m.color}">${m.label}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker([m.lat, m.lon], { icon }).bindTooltip(m.title);
      if (m.popupHtml) marker.bindPopup(m.popupHtml);
      marker.addTo(map);
    }
    for (const line of lines) {
      if (line.segments.length === 0) continue;
      if (fitToLines) {
        for (const seg of line.segments) bounds.push(...seg);
      }
      const poly = L.polyline(line.segments, {
        color: line.color,
        weight: 3.5,
        opacity: 0.6,
      }).bindTooltip(line.title);
      if (line.popupHtml) poly.bindPopup(line.popupHtml);
      poly.addTo(map);
      lineLayersRef.current.set(line.title, poly);
    }
    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
    }
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      lineLayersRef.current = new Map();
    };
  }, [markers, lines, fitToLines]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedLine) return;
    const target = lineLayersRef.current.get(selectedLine);
    if (!target) return;
    for (const [title, poly] of lineLayersRef.current) {
      poly.setStyle(
        title === selectedLine
          ? { weight: 7, opacity: 1 }
          : { weight: 2.5, opacity: 0.25 },
      );
    }
    target.bringToFront();
    map.fitBounds(target.getBounds(), { padding: [24, 24] });
    target.openPopup();
  }, [selectedLine]);

  return <div ref={containerRef} className="poi-map" />;
}
