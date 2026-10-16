// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// LOOK-UPS FOR THE PROJECT'S LOCATION, in the user's own browser (user, 2026-10-16): the energy code the state and county adopted
// (SITE › energy code › Choose… › Find…), and the utility that serves the site and its residential rate (BOM › tariff › Search…).
// Links only — what the user reads there comes back by hand, with its source. Pure: no I/O.

/** USPS state codes → the state's name, as DOE's state pages name them (energycodes.gov/status/states/<name>) */
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
export const stateName = (s: string | null | undefined): string | null => (s ? STATE_NAMES[s.trim().toUpperCase()] ?? (s.trim().length > 2 ? s.trim() : null) : null);

const web = (q: string): string => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
const place = (county: string | null, state: string | null): string => [county ? `${county} County` : "", stateName(state) ?? state ?? ""].filter(Boolean).join(", ");

export interface LookLink { label: string; url: string; tip: string }

/** THE ENERGY CODE IN FORCE where the site is: DOE's page for the state (its adopted residential and commercial codes, with dates —
 *  read 2026-10-16), and a web search for the county's own adoption (a state may leave the code to its counties and towns) */
export function energyCodeLinks(state: string | null, county: string | null): LookLink[] {
  const name = stateName(state);
  const out: LookLink[] = [];
  // the page's name: the state's, hyphenated ("new-york"); the District's is "washington-dc" (each probed 2026-10-16)
  const slug = name === "District of Columbia" ? "washington-dc" : name?.toLowerCase().replace(/ /g, "-");
  if (name) out.push({ label: `DOE: ${name}'s energy codes`, url: `https://www.energycodes.gov/status/states/${slug}`,
    tip: "the U.S. Department of Energy's Building Energy Codes Program page for the state: the residential and commercial codes it adopted, and when" });
  out.push({ label: "search the web", url: web(`${place(county, state) || "my county"} residential energy code adopted IECC`), tip: "a web search for the code your county or town adopted" });
  out.push({ label: "DOE: every state", url: "https://www.energycodes.gov/state-portal", tip: "DOE's state portal, every state's code status" });
  return out;
}

/** THE UTILITY AND ITS RATE where the site is: OpenEI's U.S. Utility Rate Database by ZIP code (residential rates — read 2026-10-16:
 *  apps.openei.org/USURDB/?utilRateFindByZip=…), and a web search for the residential rate schedule */
export function utilityLinks(zip: string | null, state: string | null, county: string | null, city?: string | null): LookLink[] {
  const out: LookLink[] = [];
  const z = (zip ?? "").trim();
  out.push(/^\d{5}$/.test(z)
    ? { label: `OpenEI: utilities and rates for ${z}`, url: `https://apps.openei.org/USURDB/?utilRateFindByZip=${z}&sectors%5B%5D=Residential`, tip: "the U.S. Utility Rate Database (NREL's OpenEI): the utilities serving the ZIP code and their residential rate schedules" }
    : { label: "OpenEI: U.S. Utility Rate Database", url: "https://apps.openei.org/USURDB/", tip: "the U.S. Utility Rate Database (NREL's OpenEI): search by ZIP code or utility name" });
  const where = [city, place(county, state)].filter(Boolean).join(", ") || "my address";
  out.push({ label: "search the web", url: web(`${where} electric utility residential rate schedule tariff pdf`), tip: "a web search for the utility serving the site and its published residential schedule" });
  return out;
}

/** a five-digit ZIP code in an address line, if it holds one */
export const zipIn = (s: string | null | undefined): string | null => /\b(\d{5})(?:-\d{4})?\b/.exec(s ?? "")?.[1] ?? null;
