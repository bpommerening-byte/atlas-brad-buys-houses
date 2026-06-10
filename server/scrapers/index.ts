import { Lead, CountyConfig } from "./base.js";
import * as wisconsin from "./wisconsin.js";

export function getDateRange(daysBack = 30): { fromDate: string; toDate: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysBack);
  return {
    fromDate: from.toISOString().split("T")[0],
    toDate: to.toISOString().split("T")[0],
  };
}

export async function runAllScrapers(
  counties: CountyConfig[],
  fromDate: string,
  toDate: string,
  onProgress?: (msg: string) => void
): Promise<{ leads: Lead[]; errors: string[] }> {
  const allLeads: Lead[] = [];
  const errors: string[] = [];

  const wiCounties = counties.filter((c) => c.state === "WI");
  if (wiCounties.length > 0) {
    try {
      onProgress?.(`Scraping Wisconsin (Dane, Rock, Door — all lead types)...`);
      const leads = await wisconsin.scrapeAll(fromDate, toDate);
      allLeads.push(...leads);
      onProgress?.(`✓ WI: ${leads.length} leads found`);
    } catch (e) {
      const msg = `Error scraping WI: ${(e as Error).message}`;
      errors.push(msg);
      onProgress?.(`✗ ${msg}`);
    }
  }

  return { leads: allLeads, errors };
}
