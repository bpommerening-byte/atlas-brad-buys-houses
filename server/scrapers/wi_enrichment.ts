/**
 * Wisconsin County Assessor Enrichment
 *
 * Enriches leads by reverse-searching county assessor/parcel databases to fill:
 *   - owner_name (if only address known)
 *   - property_address (if only name known)
 *   - mailing_address (always attempted)
 *
 * Sources:
 *   Dane County  → accessdane.danecounty.gov (owner search + parcel detail)
 *   Rock County  → WI Statewide Parcels FeatureServer (ESRI ArcGIS)
 *   Door County  → gis.co.door.wi.us ArcGIS MapServer layer 8
 *   Fallback     → WI Statewide Parcels FeatureServer (covers all WI counties)
 */

import fetch from "node-fetch";
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface EnrichedParcel {
  owner_name: string;
  property_address: string;
  mailing_address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  parcel_id?: string;
}

// ─── Dane County ─────────────────────────────────────────────────────────────

async function daneLookupByName(
  lastName: string,
  firstName = ""
): Promise<EnrichedParcel | null> {
  try {
    const params = new URLSearchParams({
      "Owner.LastName": lastName.toUpperCase(),
      "Owner.FirstName": firstName.toUpperCase(),
      "Owner.MiddleName": "",
      "Owner.SelectedMunicipality": "0",
      formName: "owner",
    });
    const url = `https://accessdane.danecounty.gov/Parcel/Search?${params}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Find first parcel link in results table
    const firstLink = $("table a[href*='/Parcel/']").first().attr("href");
    if (!firstLink) return null;

    // Fetch parcel detail
    const detailUrl = `https://accessdane.danecounty.gov${firstLink}`;
    const detailRes = await fetch(detailUrl, {
      headers: { "User-Agent": UA },
    });
    const detailHtml = await detailRes.text();
    return parseDaneParcelDetail(detailHtml, "Dane");
  } catch {
    return null;
  }
}

async function daneLookupByAddress(address: string): Promise<EnrichedParcel | null> {
  try {
    // Parse house number and street name from address
    const parts = address.trim().split(/\s+/);
    const houseNum = parts[0] || "";
    const streetName = parts.slice(1).join(" ").replace(/\s+(RD|ST|AVE|DR|LN|CT|WAY|BLVD|PL|CIR|TRL|HWY|HIGHWAY)\.?$/i, "");

    const params = new URLSearchParams({
      "Address.HouseNumber": houseNum,
      "Address.StreetName": streetName,
      "Address.SelectedMunicipality": "0",
      formName: "parcel_address",
    });
    const url = `https://accessdane.danecounty.gov/Parcel/Search?${params}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const firstLink = $("table a[href*='/Parcel/']").first().attr("href");
    if (!firstLink) return null;

    const detailUrl = `https://accessdane.danecounty.gov${firstLink}`;
    const detailRes = await fetch(detailUrl, {
      headers: { "User-Agent": UA },
    });
    const detailHtml = await detailRes.text();
    return parseDaneParcelDetail(detailHtml, "Dane");
  } catch {
    return null;
  }
}

function parseDaneParcelDetail(html: string, county: string): EnrichedParcel | null {
  try {
    const $ = cheerio.load(html);
    const text = $.text();

    // Extract owner name
    const ownerMatch = text.match(/Current Owner\s*\n?\s*([A-Z][A-Z\s,\.]+?)(?:\n|Current Co-Owner|Primary Address)/);
    const ownerName = ownerMatch ? ownerMatch[1].trim() : "";

    // Extract primary address (property address)
    const primaryMatch = text.match(/Primary Address\s*\n?\s*([0-9][^\n]+)/);
    const propertyAddress = primaryMatch ? primaryMatch[1].trim() : "";

    // Extract billing/mailing address
    const billingMatch = text.match(/Billing Address\s*\n?\s*([0-9][^\n]+)\s*\n\s*([^\n]+WI[^\n]+)/);
    let mailingAddress = "";
    let city = "";
    let state = "WI";
    let zip = "";

    if (billingMatch) {
      mailingAddress = billingMatch[1].trim();
      const cityStateZip = billingMatch[2].trim();
      const czMatch = cityStateZip.match(/^(.+?)\s+WI\s+(\d{5})/);
      if (czMatch) {
        city = czMatch[1].trim();
        zip = czMatch[2];
      }
    }

    if (!ownerName && !propertyAddress) return null;

    return {
      owner_name: ownerName,
      property_address: propertyAddress,
      mailing_address: mailingAddress,
      city,
      state,
      zip,
      county,
    };
  } catch {
    return null;
  }
}

// ─── WI Statewide Parcels (Rock + Dane fallback) ─────────────────────────────

const WI_PARCEL_URL =
  "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels/FeatureServer/0/query";
const WI_FIELDS = "OWNERNME1,OWNERNME2,SITEADRESS,PSTLADRESS,PLACENAME,ZIPCODE,STATE,CONAME";

async function wiStatewideByName(
  ownerName: string,
  countyName: string
): Promise<EnrichedParcel | null> {
  try {
    // Extract last name for search
    const lastName = ownerName.split(/[\s,]+/)[0].toUpperCase();
    const params = new URLSearchParams({
      where: `CONAME='${countyName}' AND OWNERNME1 LIKE '%${lastName}%'`,
      outFields: WI_FIELDS,
      returnGeometry: "false",
      resultRecordCount: "5",
      f: "json",
    });
    const res = await fetch(`${WI_PARCEL_URL}?${params}`, {
      headers: { "User-Agent": UA },
    });
    const data = (await res.json()) as { features?: { attributes: Record<string, string> }[] };
    const features = data.features || [];
    if (!features.length) return null;

    // Find best match (exact name match preferred)
    const best =
      features.find((f) =>
        f.attributes.OWNERNME1?.toUpperCase().includes(ownerName.toUpperCase().split(/[\s,]+/)[0])
      ) || features[0];

    const attrs = best.attributes;
    const mailingParts = (attrs.PSTLADRESS || "").split(/\s{2,}/);
    return {
      owner_name: attrs.OWNERNME1 || ownerName,
      property_address: attrs.SITEADRESS || "",
      mailing_address: mailingParts[0] || attrs.PSTLADRESS || "",
      city: attrs.PLACENAME || "",
      state: attrs.STATE || "WI",
      zip: attrs.ZIPCODE || "",
      county: attrs.CONAME || countyName,
    };
  } catch {
    return null;
  }
}

async function wiStatewideByAddress(
  address: string,
  countyName: string
): Promise<EnrichedParcel | null> {
  try {
    // Extract street name keyword for search
    const parts = address.trim().split(/\s+/);
    const keyword = parts.slice(1, 3).join(" ").toUpperCase();
    const params = new URLSearchParams({
      where: `CONAME='${countyName}' AND SITEADRESS LIKE '%${keyword}%'`,
      outFields: WI_FIELDS,
      returnGeometry: "false",
      resultRecordCount: "5",
      f: "json",
    });
    const res = await fetch(`${WI_PARCEL_URL}?${params}`, {
      headers: { "User-Agent": UA },
    });
    const data = (await res.json()) as { features?: { attributes: Record<string, string> }[] };
    const features = data.features || [];
    if (!features.length) return null;

    // Find best match by house number
    const houseNum = parts[0];
    const best =
      features.find((f) => f.attributes.SITEADRESS?.startsWith(houseNum)) || features[0];

    const attrs = best.attributes;
    const mailingParts = (attrs.PSTLADRESS || "").split(/\s{2,}/);
    return {
      owner_name: attrs.OWNERNME1 || "",
      property_address: attrs.SITEADRESS || address,
      mailing_address: mailingParts[0] || attrs.PSTLADRESS || "",
      city: attrs.PLACENAME || "",
      state: attrs.STATE || "WI",
      zip: attrs.ZIPCODE || "",
      county: attrs.CONAME || countyName,
    };
  } catch {
    return null;
  }
}

// ─── Door County ──────────────────────────────────────────────────────────────

const DOOR_PARCEL_URL =
  "https://gis.co.door.wi.us/arcgis/rest/services/Parcel_Map_Image/MapServer/8/query";
const DOOR_FIELDS = "LAST_NAME,FIRST_NAME,CO_OWNER,MAILING_AD,CITY,STATE,ZIP_CODE,PROPERTY_A,MUNICIPALI";

async function doorLookupByName(ownerName: string): Promise<EnrichedParcel | null> {
  try {
    const lastName = ownerName.split(/[\s,]+/)[0].toUpperCase();
    const params = new URLSearchParams({
      where: `LAST_NAME LIKE '%${lastName}%'`,
      outFields: DOOR_FIELDS,
      returnGeometry: "false",
      resultRecordCount: "5",
      f: "json",
    });
    const res = await fetch(`${DOOR_PARCEL_URL}?${params}`, {
      headers: { "User-Agent": UA },
    });
    const data = (await res.json()) as { features?: { attributes: Record<string, string> }[] };
    const features = data.features || [];
    if (!features.length) return null;

    const attrs = features[0].attributes;
    return {
      owner_name: `${attrs.LAST_NAME}, ${attrs.FIRST_NAME}`.trim().replace(/^,\s*/, ""),
      property_address: attrs.PROPERTY_A || "",
      mailing_address: attrs.MAILING_AD || "",
      city: attrs.CITY || "",
      state: attrs.STATE || "WI",
      zip: attrs.ZIP_CODE || "",
      county: "Door",
    };
  } catch {
    return null;
  }
}

async function doorLookupByAddress(address: string): Promise<EnrichedParcel | null> {
  try {
    const parts = address.trim().split(/\s+/);
    const keyword = parts.slice(1, 3).join(" ").toUpperCase();
    const params = new URLSearchParams({
      where: `PROPERTY_A LIKE '%${keyword}%'`,
      outFields: DOOR_FIELDS,
      returnGeometry: "false",
      resultRecordCount: "5",
      f: "json",
    });
    const res = await fetch(`${DOOR_PARCEL_URL}?${params}`, {
      headers: { "User-Agent": UA },
    });
    const data = (await res.json()) as { features?: { attributes: Record<string, string> }[] };
    const features = data.features || [];
    if (!features.length) return null;

    const houseNum = parts[0];
    const best =
      features.find((f) => f.attributes.PROPERTY_A?.startsWith(houseNum)) || features[0];

    const attrs = best.attributes;
    return {
      owner_name: `${attrs.LAST_NAME}, ${attrs.FIRST_NAME}`.trim().replace(/^,\s*/, ""),
      property_address: attrs.PROPERTY_A || address,
      mailing_address: attrs.MAILING_AD || "",
      city: attrs.CITY || "",
      state: attrs.STATE || "WI",
      zip: attrs.ZIP_CODE || "",
      county: "Door",
    };
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enrich a lead by county.
 * Pass either ownerName OR propertyAddress (or both).
 * Returns enriched parcel data or null if not found.
 */
export async function enrichLead(opts: {
  county: "Dane" | "Rock" | "Door";
  ownerName?: string;
  propertyAddress?: string;
}): Promise<EnrichedParcel | null> {
  const { county, ownerName, propertyAddress } = opts;

  // Try name-based lookup first (more specific)
  if (ownerName && ownerName.trim().length > 2) {
    let result: EnrichedParcel | null = null;

    if (county === "Dane") {
      const nameParts = ownerName.trim().split(/[\s,]+/);
      result = await daneLookupByName(nameParts[0], nameParts[1] || "");
      if (!result) result = await wiStatewideByName(ownerName, "Dane");
    } else if (county === "Rock") {
      result = await wiStatewideByName(ownerName, "Rock");
    } else if (county === "Door") {
      result = await doorLookupByName(ownerName);
      if (!result) result = await wiStatewideByName(ownerName, "Door");
    }

    if (result) return result;
  }

  // Fall back to address-based lookup
  if (propertyAddress && propertyAddress.trim().length > 5) {
    if (county === "Dane") {
      const result = await daneLookupByAddress(propertyAddress);
      if (result) return result;
      return wiStatewideByAddress(propertyAddress, "Dane");
    } else if (county === "Rock") {
      return wiStatewideByAddress(propertyAddress, "Rock");
    } else if (county === "Door") {
      const result = await doorLookupByAddress(propertyAddress);
      if (result) return result;
      return wiStatewideByAddress(propertyAddress, "Door");
    }
  }

  return null;
}
