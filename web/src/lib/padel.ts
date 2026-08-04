const PADEL_DATA_URL = "/data/padel-events.json";

export interface PadelLink {
  label: string;
  url: string;
  kind: "Cours" | "Tournois" | "Animations" | "Inscription" | "Séminaire" | "Info";
}

export interface PadelHighlight {
  title: string;
  when: string;
  note: string;
  sourceUrl: string;
}

export interface PadelRestrictedPage {
  title: string;
  url: string;
  modifiedAt: string;
}

export interface PadelBookingSystem {
  formId: number | null;
  calendars: number[];
  activities: number[];
  start: string;
  end: string;
  slotMinTime: string;
  slotMaxTime: string;
  waitingList: boolean;
  redirectUrls: string[];
}

export interface PadelCache {
  generatedAt: string;
  source: {
    name: string;
    siteUrl: string;
    apiUrl: string;
    homePageModifiedAt: string;
  };
  courtBooking: {
    mode: "phone";
    provider: string;
    phone: string;
    note: string;
  };
  bookingActivities: {
    detected: boolean;
    confidence: "high" | "medium" | "low";
    systems: PadelBookingSystem[];
    summary: string;
  };
  links: PadelLink[];
  highlights: PadelHighlight[];
  restrictedPages: PadelRestrictedPage[];
  platformNotes: string[];
}

export async function fetchPadelCache(): Promise<PadelCache> {
  const response = await fetch(`${PADEL_DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`padel cache HTTP ${response.status}`);
  return (await response.json()) as PadelCache;
}
