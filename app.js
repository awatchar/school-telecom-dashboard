const DATA_URL = "./data/schools.json";
const LIVE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1WsQXXIgySH2h1gC-QLK_dNBNhTMgG167x-pWSV5axug/gviz/tq?tqx=out:csv&sheet=Dashboard_Data";
const TABLE_PAGE_SIZE = 50;
const STAGE_LABELS = {
  applied: "สมัครทั้งหมด",
  selected: "ผ่านการคัดเลือก",
  attended: "เข้าร่วมอบรม",
};
const REGION_COLORS = [
  "#0c4a6e",
  "#0d9488",
  "#14b8a6",
  "#22d3ee",
  "#84cc16",
  "#f59e0b",
];

const state = {
  schools: [],
  metadata: null,
  filtered: [],
  tableLimit: TABLE_PAGE_SIZE,
  map: null,
  markers: null,
  mapResizeObserver: null,
};

const elements = {};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  cacheElements();
  bindControls();

  try {
    const data = await loadDashboardData();
    state.schools = data.schools;
    state.metadata = data.metadata;
    populateFilters();
    renderGlobalMetrics();
    initializeMap();
    updateDashboard({ fitMap: true });
    elements.loadingOverlay.classList.add("hidden");
    refreshMapLayout(true);
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => refreshMapLayout(true));
    }
    window.setTimeout(() => refreshMapLayout(true), 300);
  } catch (error) {
    showError(error);
  }
}

async function loadDashboardData() {
  try {
    const response = await fetch(LIVE_CSV_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Google Sheet export returned ${response.status}`);
    }
    return buildDataFromCsv(await response.text());
  } catch (liveError) {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `โหลดข้อมูลไม่สำเร็จทั้งจาก Google Sheet และข้อมูลสำรอง (${response.status})`,
      );
    }
    return response.json();
  }
}

function buildDataFromCsv(csvText) {
  const parsed = parseCsv(csvText);
  const headers = parsed[0];
  const rawRows = parsed.slice(1).map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    ),
  );
  const schools = rawRows
    .filter((row) => csvBoolean(row.include_dashboard))
    .map((row) => ({
      id: row.school_id,
      name: row.school_name,
      address: row.address_clean,
      province: row.province,
      region: row.region,
      type: row.school_type,
      affiliation: row.affiliation,
      applied: csvBoolean(row.applied),
      selected: csvBoolean(row.selected),
      attended: csvBoolean(row.attended),
      score: csvNumber(row.score_total),
      latitude: csvNumber(row.latitude),
      longitude: csvNumber(row.longitude),
      dataStatus: row.data_status,
      updatedAt: row.source_updated_at,
    }));
  return {
    metadata: {
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
    },
    schools,
  };
}

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

function csvBoolean(value) {
  return String(value).toUpperCase() === "TRUE";
}

function csvNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cacheElements() {
  [
    "updated-at",
    "hero-provinces",
    "coverage-progress",
    "coverage-caption",
    "kpi-applied",
    "kpi-selected",
    "kpi-attended",
    "kpi-provinces",
    "kpi-regions",
    "selected-rate",
    "attended-rate",
    "province-percent",
    "province-ring",
    "coverage-provinces",
    "coverage-regions",
    "search-input",
    "stage-filter",
    "region-filter",
    "province-filter",
    "reset-filters",
    "visible-count",
    "active-filter-summary",
    "funnel-chart",
    "province-ranking",
    "ranking-stage",
    "region-chart",
    "school-table-body",
    "table-caption",
    "show-more",
    "loading-overlay",
  ].forEach((id) => {
    elements[toCamelCase(id)] = document.getElementById(id);
  });
}

function bindControls() {
  elements.searchInput.addEventListener(
    "input",
    debounce(() => {
      state.tableLimit = TABLE_PAGE_SIZE;
      updateDashboard({ fitMap: false });
    }, 180),
  );

  [
    elements.stageFilter,
    elements.regionFilter,
    elements.provinceFilter,
  ].forEach((control) => {
    control.addEventListener("change", () => {
      if (control === elements.regionFilter) updateProvinceOptions();
      state.tableLimit = TABLE_PAGE_SIZE;
      updateDashboard({ fitMap: true });
    });
  });

  elements.resetFilters.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.stageFilter.value = "applied";
    elements.regionFilter.value = "all";
    updateProvinceOptions();
    elements.provinceFilter.value = "all";
    state.tableLimit = TABLE_PAGE_SIZE;
    updateDashboard({ fitMap: true });
  });

  elements.showMore.addEventListener("click", () => {
    state.tableLimit += TABLE_PAGE_SIZE;
    renderTable(state.filtered);
  });
}

function populateFilters() {
  const regions = uniqueSorted(state.schools.map((school) => school.region));
  fillSelect(elements.regionFilter, regions, "ทุกภูมิภาค");
  updateProvinceOptions();
}

function updateProvinceOptions() {
  const selectedRegion = elements.regionFilter.value;
  const previous = elements.provinceFilter.value;
  const provinces = uniqueSorted(
    state.schools
      .filter(
        (school) =>
          selectedRegion === "all" || school.region === selectedRegion,
      )
      .map((school) => school.province),
  );
  fillSelect(elements.provinceFilter, provinces, "ทุกจังหวัด");
  if (provinces.includes(previous)) elements.provinceFilter.value = previous;
}

function fillSelect(select, values, allLabel) {
  select.innerHTML = "";
  select.add(new Option(allLabel, "all"));
  values.forEach((value) => select.add(new Option(value, value)));
}

function renderGlobalMetrics() {
  const counts = state.metadata.counts;
  const selectedRate = percent(counts.selected, counts.applied);
  const attendedRate = percent(counts.attended, counts.selected);
  const provinceCoverage = percent(counts.provinces, 77);
  const regionCount =
    counts.regions ?? new Set(state.schools.map((school) => school.region)).size;

  elements.kpiApplied.textContent = formatNumber(counts.applied);
  elements.kpiSelected.textContent = formatNumber(counts.selected);
  elements.kpiAttended.textContent = formatNumber(counts.attended);
  elements.kpiProvinces.textContent = formatNumber(counts.provinces);
  elements.kpiRegions.textContent = formatNumber(regionCount);
  elements.selectedRate.textContent = `${selectedRate}%`;
  elements.attendedRate.textContent = `${attendedRate}%`;
  elements.heroProvinces.textContent = formatNumber(counts.provinces);
  elements.coverageProgress.style.width = `${provinceCoverage}%`;
  elements.coverageCaption.textContent =
    `ครอบคลุม ${counts.provinces} จาก 77 จังหวัดทั่วประเทศ`;

  elements.provincePercent.textContent = `${provinceCoverage}%`;
  elements.coverageProvinces.textContent = `${formatNumber(counts.provinces)} / 77`;
  elements.coverageRegions.textContent = `${formatNumber(regionCount)} ภูมิภาค`;
  elements.provinceRing.style.setProperty(
    "--coverage",
    `${provinceCoverage}%`,
  );

  const sourceDate = newestSourceDate(state.schools);
  const date = sourceDate || new Date(state.metadata.generatedAt);
  elements.updatedAt.textContent =
    `อัปเดต ${new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
    }).format(date)}`;
}

function initializeMap() {
  state.map = L.map("map", {
    zoomControl: true,
    minZoom: 5,
    maxZoom: 18,
    scrollWheelZoom: false,
  }).setView([13.2, 101], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(state.map);

  state.markers = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 48,
    spiderfyOnMaxZoom: true,
  });
  state.map.addLayer(state.markers);

  const mapElement = document.getElementById("map");
  const handleResize = debounce(() => refreshMapLayout(false), 80);
  state.mapResizeObserver = new ResizeObserver(handleResize);
  state.mapResizeObserver.observe(mapElement);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(() => refreshMapLayout(false), 150);
  });
}

function refreshMapLayout(fitMap) {
  if (!state.map) return;
  window.requestAnimationFrame(() => {
    state.map.invalidateSize({ animate: false, pan: false });
    if (fitMap && state.filtered.length > 0) {
      renderMap(state.filtered, true);
    }
  });
}

function updateDashboard({ fitMap }) {
  const filters = getFilters();
  const baseFiltered = applyFilters(state.schools, filters, {
    includeStage: false,
  });
  const filtered = applyFilters(baseFiltered, filters, { includeStage: true });
  state.filtered = filtered;

  elements.visibleCount.textContent = formatNumber(filtered.length);
  elements.activeFilterSummary.textContent = buildFilterSummary(filters);
  elements.rankingStage.textContent = STAGE_LABELS[filters.stage];

  renderMap(filtered, fitMap);
  renderFunnel(baseFiltered);
  renderProvinceRanking(filtered);
  renderRegions(filtered);
  renderTable(filtered);
}

function getFilters() {
  return {
    query: normalize(elements.searchInput.value),
    stage: elements.stageFilter.value,
    region: elements.regionFilter.value,
    province: elements.provinceFilter.value,
  };
}

function applyFilters(schools, filters, { includeStage }) {
  return schools.filter((school) => {
    if (includeStage && !school[filters.stage]) return false;
    if (filters.region !== "all" && school.region !== filters.region) return false;
    if (
      filters.province !== "all" &&
      school.province !== filters.province
    ) {
      return false;
    }
    if (filters.query) {
      const haystack = normalize(
        `${school.name} ${school.province} ${school.region} ${school.affiliation} ${school.address}`,
      );
      if (!haystack.includes(filters.query)) return false;
    }
    return true;
  });
}

function buildFilterSummary(filters) {
  const parts = [];
  if (filters.region !== "all") parts.push(filters.region);
  if (filters.province !== "all") parts.push(`จังหวัด${filters.province}`);
  if (filters.query) parts.push(`คำค้น “${elements.searchInput.value.trim()}”`);
  return parts.length > 0 ? `· ${parts.join(" · ")}` : "จากข้อมูลทั้งหมด";
}

function renderMap(schools, fitMap) {
  state.markers.clearLayers();
  const bounds = [];

  schools.forEach((school) => {
    if (!Number.isFinite(school.latitude) || !Number.isFinite(school.longitude)) {
      return;
    }
    const icon = L.divIcon({
      className: "",
      html: '<div class="school-marker" style="--marker-color:#14b8a6"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 20],
      popupAnchor: [0, -20],
    });
    const marker = L.marker([school.latitude, school.longitude], {
      icon,
      title: school.name,
    }).bindPopup(buildPopup(school));
    state.markers.addLayer(marker);
    bounds.push([school.latitude, school.longitude]);
  });

  if (fitMap && bounds.length > 0) {
    state.map.fitBounds(bounds, {
      padding: [24, 24],
      maxZoom: bounds.length === 1 ? 10 : 8,
    });
  }
}

function buildPopup(school) {
  const stages = [
    school.applied ? "สมัคร" : "",
    school.selected ? "ผ่านคัดเลือก" : "",
    school.attended ? "เข้าอบรม" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const score =
    school.score == null
      ? ""
      : `<p><b>คะแนน:</b> ${formatNumber(school.score)}</p>`;

  return `
    <div class="popup-school">
      <strong>${escapeHtml(school.name)}</strong>
      <p>${escapeHtml(school.province)} · ${escapeHtml(school.region)}</p>
      <p>${escapeHtml(stages)}</p>
      <div class="popup-meta">
        <p>${escapeHtml(school.affiliation || "ไม่ระบุสังกัด")}</p>
        ${score}
      </div>
    </div>`;
}

function renderFunnel(schools) {
  const values = [
    {
      label: "สมัคร",
      value: schools.filter((school) => school.applied).length,
      color: "#0c4a6e",
    },
    {
      label: "ผ่านคัดเลือก",
      value: schools.filter((school) => school.selected).length,
      color: "#0d9488",
    },
    {
      label: "เข้าอบรม",
      value: schools.filter((school) => school.attended).length,
      color: "#65a30d",
    },
  ];
  const max = Math.max(values[0].value, 1);
  elements.funnelChart.innerHTML = values
    .map(
      (item) => `
        <div class="funnel-row">
          <span class="funnel-label">${item.label}</span>
          <div class="funnel-track">
            <span class="funnel-fill" style="--fill:${item.color};width:${(item.value / max) * 100}%">
              ${percent(item.value, max)}%
            </span>
          </div>
          <strong class="funnel-value">${formatNumber(item.value)}</strong>
        </div>`,
    )
    .join("");
}

function renderProvinceRanking(schools) {
  const counts = groupCounts(schools, (school) => school.province)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "th"))
    .slice(0, 12);
  const max = Math.max(counts[0]?.count || 0, 1);

  elements.provinceRanking.innerHTML =
    counts.length === 0
      ? emptyState("ไม่พบข้อมูลจังหวัดตามตัวกรอง")
      : counts
          .map(
            (item) => `
              <div class="ranking-row">
                <span class="ranking-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                <div class="ranking-track"><span style="width:${(item.count / max) * 100}%"></span></div>
                <strong class="ranking-count">${formatNumber(item.count)}</strong>
              </div>`,
          )
          .join("");
}

function renderRegions(schools) {
  const counts = groupCounts(schools, (school) => school.region).sort(
    (left, right) => right.count - left.count,
  );
  const max = Math.max(counts[0]?.count || 0, 1);
  elements.regionChart.innerHTML =
    counts.length === 0
      ? emptyState("ไม่พบข้อมูลภูมิภาคตามตัวกรอง")
      : counts
          .map(
            (item, index) => `
              <div class="region-row">
                <span class="region-label">${escapeHtml(item.name)}</span>
                <div class="region-bar" style="--region-color:${REGION_COLORS[index % REGION_COLORS.length]}">
                  <span style="width:${(item.count / max) * 100}%"></span>
                </div>
                <strong class="region-value">${formatNumber(item.count)}</strong>
              </div>`,
          )
          .join("");
}

function renderTable(schools) {
  const ordered = [...schools].sort(
    (left, right) =>
      left.province.localeCompare(right.province, "th") ||
      left.name.localeCompare(right.name, "th"),
  );
  const visible = ordered.slice(0, state.tableLimit);

  elements.schoolTableBody.innerHTML =
    visible.length === 0
      ? `<tr><td colspan="4">${emptyState("ไม่พบสถานศึกษาตามตัวกรอง")}</td></tr>`
      : visible.map(buildTableRow).join("");

  elements.tableCaption.textContent =
    `แสดง ${formatNumber(visible.length)} จาก ${formatNumber(ordered.length)} รายการ`;
  elements.showMore.hidden = visible.length >= ordered.length;
}

function buildTableRow(school) {
  const stages = [
    school.applied
      ? '<span class="status-pill applied">สมัคร</span>'
      : "",
    school.selected
      ? '<span class="status-pill selected">ผ่านคัดเลือก</span>'
      : "",
    school.attended
      ? '<span class="status-pill attended">เข้าอบรม</span>'
      : "",
  ]
    .filter(Boolean)
    .join("");
  return `
    <tr>
      <td>
        <span class="school-name">${escapeHtml(school.name)}</span>
        <span class="school-affiliation">${escapeHtml(school.affiliation || "ไม่ระบุสังกัด")}</span>
      </td>
      <td>${escapeHtml(school.province)}<br><span class="school-affiliation">${escapeHtml(school.region)}</span></td>
      <td><div class="status-stack">${stages}</div></td>
      <td>${school.score == null ? "—" : formatNumber(school.score)}</td>
    </tr>`;
}

function groupCounts(items, keyFunction) {
  const counts = new Map();
  items.forEach((item) => {
    const name = keyFunction(item) || "ไม่ระบุ";
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return Array.from(counts, ([name, count]) => ({ name, count }));
}

function newestSourceDate(schools) {
  const dates = schools
    .map((school) => new Date(school.updatedAt))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function showError(error) {
  elements.loadingOverlay.innerHTML = `
    <div class="error-card">
      <p class="section-kicker">Data unavailable</p>
      <h2>ไม่สามารถเตรียม Dashboard ได้</h2>
      <p>${escapeHtml(error.message || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ")}</p>
      <p>กรุณาลองรีเฟรชหน้าเว็บอีกครั้ง</p>
    </div>`;
}

function emptyState(message) {
  return `<p style="color:#64748b;font-size:.8rem;margin:12px 0">${escapeHtml(message)}</p>`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "th"),
  );
}

function percent(value, total) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("th-TH").format(value);
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0E4D\u0E32/g, "\u0E33")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(callback, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

