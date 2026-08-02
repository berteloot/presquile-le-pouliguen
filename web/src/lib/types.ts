export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface RouteInfo {
  shortName: string;
  longName: string;
  color: string | null;
  textColor: string | null;
}

export interface Departure {
  t: number; // seconds since service midnight
  trip: string;
  route: string;
  headsign: string;
  service: string;
}

export interface Service {
  days: number[]; // monday..sunday
  start: string; // YYYYMMDD
  end: string;
}

export interface TransitData {
  generated: string;
  feed: Record<string, string>;
  stops: Stop[];
  routes: Record<string, RouteInfo>;
  departures: Record<string, Departure[]>;
  services: Record<string, Service>;
  serviceExceptions: Record<string, Record<string, number>>;
  trips: Record<string, { route: string; headsign: string }>;
  fetchedAt?: Date;
}

export interface NextDeparture {
  time: Date;
  scheduledSeconds: number;
  trip: string;
  routeShort: string;
  routeColor: string | null;
  headsign: string;
  stopName: string;
  delaySeconds: number | null; // null = no real-time info
  tomorrow: boolean;
}

export interface Vehicle {
  id: string;
  tripId: string;
  lat: number;
  lon: number;
  routeShort: string;
  routeLongName: string;
  routeColor: string | null;
  headsign: string;
  timestamp: Date | null;
}

export interface ServiceAlert {
  header: string;
  description: string;
}

export interface WeatherNow {
  temperature: number;
  apparent: number;
  windSpeed: number;
  windGusts: number;
  windDirection: number;
  precipitation: number;
  weatherCode: number;
  sunrise: Date;
  sunset: Date;
  tempMax: number;
  tempMin: number;
  uvMax: number;
  daily: WeatherDay[];
  fetchedAt: Date;
}

export interface WeatherDay {
  date: Date;
  sunrise: Date;
  sunset: Date;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  uvMax: number;
}

export interface MarineSeries {
  times: Date[]; // 15-minute steps, drives the sea-level curve
  seaLevel: (number | null)[];
  hourlyTimes: Date[];
  waveHeight: (number | null)[];
  seaTemp: (number | null)[];
  tideSource: "open-meteo" | "shom";
  tideSourceLabel: string;
  tideGeneratedAt?: Date;
  tideExtrema?: TideExtreme[];
  fetchedAt: Date;
}

export interface TideExtreme {
  type: "high" | "low";
  time: Date;
  level: number;
  coefficient?: number | null;
  officialHeightM?: number | null;
  source?: "open-meteo" | "shom";
}

export interface LocalEvent {
  title: string;
  when: string;
  where: string;
  dateRange?: string;
  location?: string;
  city?: string;
  url?: string;
  note?: string;
  source?: string;
}

export interface CinemaPaxSession {
  film: string;
  date: string;
  time: string;
  version: string;
  film_url: string;
  ticket_url?: string | null;
  special_labels: string[];
  duration_minutes: number | null;
  genres: string;
  age: string;
}

export interface CinemaPaxData {
  generated: string;
  schedule_hash: string;
  cinema: {
    name: string;
    address: string;
    source_url: string;
    tickets_url: string;
    program_pdf_url: string | null;
  };
  source_updated_at: string | null;
  sessions: CinemaPaxSession[];
  notice: string;
}
