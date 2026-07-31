import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  path.join("data", "schools.json"),
];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`Missing required file: ${file}`);
  }
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const requiredIds = [
  "map",
  "kpi-applied",
  "stage-filter",
  "province-filter",
  "province-ranking",
  "school-table-body",
];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) {
    throw new Error(`Missing required dashboard element: #${id}`);
  }
}

const data = JSON.parse(
  fs.readFileSync(path.join(root, "data", "schools.json"), "utf8"),
);
const schools = data.schools;
const uniqueIds = new Set(schools.map((school) => school.id));
const privateCoordinateFields = [
  "geoAccuracy",
  "geoStatus",
  "geoSource",
  "geoLabel",
];
const exposedCoordinateFields = schools.filter((school) =>
  privateCoordinateFields.some((field) =>
    Object.prototype.hasOwnProperty.call(school, field),
  ),
);
const invalidCoordinates = schools.filter(
  (school) =>
    !Number.isFinite(school.latitude) ||
    !Number.isFinite(school.longitude) ||
    school.latitude < 5 ||
    school.latitude > 21 ||
    school.longitude < 97 ||
    school.longitude > 106,
);

const actual = {
  schools: schools.length,
  uniqueIds: uniqueIds.size,
  applied: schools.filter((school) => school.applied).length,
  selected: schools.filter((school) => school.selected).length,
  attended: schools.filter((school) => school.attended).length,
  exposedCoordinateFields: exposedCoordinateFields.length,
  invalidCoordinates: invalidCoordinates.length,
  provinces: new Set(schools.map((school) => school.province)).size,
};

const expected = {
  schools: 345,
  uniqueIds: 345,
  applied: 345,
  selected: 316,
  attended: 250,
  exposedCoordinateFields: 0,
  invalidCoordinates: 0,
  provinces: 71,
};

for (const [key, value] of Object.entries(expected)) {
  if (actual[key] !== value) {
    throw new Error(
      `Validation failed for ${key}: expected ${value}, received ${actual[key]}`,
    );
  }
}

console.log(JSON.stringify({ valid: true, ...actual }, null, 2));

