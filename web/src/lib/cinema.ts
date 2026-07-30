import { CINEMA_PAX_DATA_URL } from "../config";
import type { CinemaPaxData } from "./types";

export async function fetchCinemaPax(): Promise<CinemaPaxData | null> {
  const res = await fetch(CINEMA_PAX_DATA_URL);
  if (!res.ok) return null;
  return (await res.json()) as CinemaPaxData;
}
