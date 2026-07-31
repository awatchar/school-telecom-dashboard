import fs from "node:fs";
import path from "node:path";

const spreadsheetId = "1WsQXXIgySH2h1gC-QLK_dNBNhTMgG167x-pWSV5axug";
const sheetName = "Dashboard_Data";
const sourceUrl =
  `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq` +
  `?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
const outputPath = path.resolve("data", "schools.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function boolean(value) {
  return String(value).toUpperCase() === "TRUE";
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const response = await fetch(sourceUrl, {
  headers: {
    "User-Agent": "school-telecom-dashboard-data-sync/1.0",
  },
});
if (!response.ok) {
  throw new Error(`Google Sheet export failed with HTTP ${response.status}`);
}

const parsed = parseCsv(await response.text());
const headers = parsed[0];
const rawRows = parsed.slice(1).map((values) =>
  Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
);
const schools = rawRows
  .filter((row) => boolean(row.include_dashboard))
  .map((row) => ({
    id: row.school_id,
    name: row.school_name,
    address: row.address_clean,
    province: row.province,
    region: row.region,
    type: row.school_type,
    affiliation: row.affiliation,
    applied: boolean(row.applied),
    selected: boolean(row.selected),
    attended: boolean(row.attended),
    score: numberOrNull(row.score_total),
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    dataStatus: row.data_status,
    updatedAt: row.source_updated_at,
  }));

const metadata = {
  generatedAt: new Date().toISOString(),
  source: "Google Sheet: Dashboard_Data",
  counts: {
    schools: schools.length,
    applied: schools.filter((school) => school.applied).length,
    selected: schools.filter((school) => school.selected).length,
    attended: schools.filter((school) => school.attended).length,
    provinces: new Set(schools.map((school) => school.province)).size,
    regions: new Set(schools.map((school) => school.region)).size,
  },
};

const invalid = schools.filter(
  (school) =>
    !Number.isFinite(school.latitude) ||
    !Number.isFinite(school.longitude) ||
    school.latitude < 5 ||
    school.latitude > 21 ||
    school.longitude < 97 ||
    school.longitude > 106,
);
if (invalid.length > 0) {
  throw new Error(`Found ${invalid.length} schools with invalid coordinates`);
}
if (
  metadata.counts.schools !== 345 ||
  metadata.counts.selected !== 316 ||
  metadata.counts.attended !== 250
) {
  throw new Error(
    `Unexpected project totals: ${JSON.stringify(metadata.counts)}`,
  );
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `${JSON.stringify({ metadata, schools }, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(metadata.counts));

