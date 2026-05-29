#!/usr/bin/env node
/** Pull Cloudflare zone analytics for secondeyesai.com via wrangler OAuth token. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const hours = Number(process.argv[2] || 18);
const cfgPath = join(homedir(), ".wrangler", "config", "default.toml");
const cfgText = readFileSync(cfgPath, "utf8");
const tokenMatch = cfgText.match(/^oauth_token\s*=\s*"([^"]+)"/m);
const token = tokenMatch?.[1];
if (!token) throw new Error(`oauth_token not found in ${cfgPath}`);

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors || json));
  return json.result;
}

const zones = await cf("/zones?name=secondeyesai.com");
const zoneId = zones[0]?.id;
if (!zoneId) throw new Error("zone not found");

const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
const until = new Date().toISOString();

const query = `
  query ($zoneId: String!, $since: Time!, $until: Time!) {
    viewer {
      zones(filter: { zoneTag: $zoneId }) {
        totals: httpRequests1hGroups(limit: 48, filter: { datetime_geq: $since, datetime_leq: $until }) {
          sum { requests bytes pageViews threats }
          uniq { uniques }
        }
        hourly: httpRequests1hGroups(limit: 48, orderBy: [datetime_ASC], filter: { datetime_geq: $since, datetime_leq: $until }) {
          dimensions { datetime }
          sum { requests bytes pageViews threats cachedRequests cachedBytes }
          uniq { uniques }
        }
        topPaths: httpRequestsAdaptiveGroups(limit: 15, filter: { datetime_geq: $since, datetime_leq: $until }, orderBy: [count_DESC]) {
          count
          dimensions { clientRequestPath }
        }
        statusCodes: httpRequestsAdaptiveGroups(limit: 12, filter: { datetime_geq: $since, datetime_leq: $until }, orderBy: [count_DESC]) {
          count
          dimensions { edgeResponseStatus }
        }
        countries: httpRequestsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_leq: $until }, orderBy: [count_DESC]) {
          count
          dimensions { clientCountryName }
        }
      }
    }
  }`;

const gres = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: { zoneId, since, until } }),
});
const gjson = await gres.json();
if (gjson.errors) throw new Error(JSON.stringify(gjson.errors, null, 2));

const z = gjson.data.viewer.zones[0];
let requests = 0;
let bytes = 0;
let pageViews = 0;
let threats = 0;
let uniques = 0;
for (const g of z.totals) {
  requests += g.sum.requests;
  bytes += g.sum.bytes;
  pageViews += g.sum.pageViews || 0;
  threats += g.sum.threats || 0;
  uniques += g.uniq.uniques;
}

console.log(
  JSON.stringify(
    {
      zone: zones[0].name,
      zoneId,
      window_hours: hours,
      since,
      until,
      totals: { requests, bytes, pageViews, threats, uniques },
      hourly: z.hourly.map((h) => ({
        hour: h.dimensions.datetime,
        requests: h.sum.requests,
        uniques: h.uniq.uniques,
        bytes: h.sum.bytes,
        cached: h.sum.cachedRequests,
      })),
      topPaths: z.topPaths.map((p) => ({ path: p.dimensions.clientRequestPath, count: p.count })),
      statusCodes: z.statusCodes.map((s) => ({ status: s.dimensions.edgeResponseStatus, count: s.count })),
      countries: z.countries.map((c) => ({ country: c.dimensions.clientCountryName, count: c.count })),
    },
    null,
    2
  )
);
