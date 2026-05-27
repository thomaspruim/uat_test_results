const SPREADSHEET_ID = "1Y4pSI4uDj0DInrjOAOCQ7eGSEITSHraRXOzx3z4t8cQ";
const RESULTS_SHEET = "Results";
const USERS_SHEET = "Users";

const userSelect = document.getElementById("userSelect");
const testSelect = document.getElementById("testSelect");
const sortSelect = document.getElementById("sortSelect");
const refreshBtn = document.getElementById("refreshBtn");
const expandAllBtn = document.getElementById("expandAllBtn");
const collapseAllBtn = document.getElementById("collapseAllBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

let allGroups = [];
const expandedTests = new Set();
const expandedCategories = new Set();

function testSectionKey(group) {
  return `${group.userId}|${group.test}`;
}

function categorySectionKey(group, cat) {
  return `${testSectionKey(group)}|${cat.path || cat.raw}`;
}

function sheetUrl(sheetName) {
  const params = new URLSearchParams({
    tqx: "out:json",
    sheet: sheetName,
  });
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?${params}`;
}

async function fetchSheet(sheetName) {
  const res = await fetch(sheetUrl(sheetName));
  if (!res.ok) throw new Error(`Failed to load ${sheetName} (${res.status})`);
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\((.*)\);?\s*$/s);
  if (!match) throw new Error(`Unexpected response for ${sheetName}`);
  return JSON.parse(match[1]);
}

function cellValue(cell) {
  if (!cell) return "";
  if (cell.v != null && cell.v !== "") return cell.v;
  if (cell.f) return cell.f;
  return "";
}

function rowsFromTable(table) {
  return table.rows.map((row) => row.c.map(cellValue));
}

function parseCategory(raw) {
  const text = String(raw || "").trim();
  if (!text) return { path: "", label: "" };
  const sep = text.indexOf("##");
  if (sep === -1) return { path: text, label: text };
  return {
    path: text.slice(0, sep),
    label: text.slice(sep + 2) || text.slice(0, sep),
  };
}

function isHeaderRow(row) {
  const hasName = Boolean(String(row[0] || "").trim());
  const hasScenario = Boolean(String(row[2] || "").trim());
  const hasTest = row[3] !== "" && row[3] != null;
  return hasName || (hasScenario && hasTest);
}

function parseResults(rows) {
  const groups = [];
  let name = "";
  let userId = "";
  let scenario = "";
  let test = null;
  let current = null;

  const flush = () => {
    if (current && current.categories.length > 0) groups.push(current);
    current = null;
  };

  for (const row of rows) {
    if (isHeaderRow(row)) {
      if (String(row[0] || "").trim()) name = String(row[0]).trim();
      if (String(row[2] || "").trim()) scenario = String(row[2]).trim();
      if (row[3] !== "" && row[3] != null) test = Number(row[3]);
      if (String(row[1] || "").trim()) userId = String(row[1]).trim();

      flush();
      current = {
        name,
        userId,
        scenario,
        test,
        categories: [],
      };
    }

    const categoryRaw = String(row[4] || "").trim();
    if (!categoryRaw) continue;

    if (!current) {
      current = { name, userId, scenario, test, categories: [] };
    }

    const stories = [row[5], row[6], row[7], row[8], row[9]]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const notes = String(row[10] || "").trim();
    const { path, label } = parseCategory(categoryRaw);

    current.categories.push({
      path,
      label,
      raw: categoryRaw,
      stories,
      notes,
    });
  }

  flush();
  return groups;
}

function sortGroups(groups, mode) {
  const sorted = [...groups];
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const byTest = (a, b) => a.test - b.test;
  const byId = (a, b) => a.userId.localeCompare(b.userId);

  switch (mode) {
    case "user-desc":
      sorted.sort((a, b) => byName(b, a) || byTest(a, b));
      break;
    case "test-asc":
      sorted.sort((a, b) => byTest(a, b) || byName(a, b));
      break;
    case "test-desc":
      sorted.sort((a, b) => byTest(b, a) || byName(a, b));
      break;
    case "id-asc":
      sorted.sort((a, b) => byId(a, b) || byTest(a, b));
      break;
    default:
      sorted.sort((a, b) => byName(a, b) || byTest(a, b));
  }
  return sorted;
}

function populateFilters(groups) {
  const prevUser = userSelect.value;
  const prevTest = testSelect.value;

  const users = [...new Map(groups.map((g) => [g.userId, g])).values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const tests = [...new Set(groups.map((g) => g.test).filter((t) => t != null))].sort(
    (a, b) => a - b
  );

  userSelect.innerHTML = '<option value="">All users</option>';
  for (const g of users) {
    const opt = document.createElement("option");
    opt.value = g.userId;
    opt.textContent = `${g.name} (${truncateId(g.userId)})`;
    userSelect.appendChild(opt);
  }

  testSelect.innerHTML = '<option value="">All tests</option>';
  for (const t of tests) {
    const opt = document.createElement("option");
    opt.value = String(t);
    opt.textContent = `Test ${t}`;
    testSelect.appendChild(opt);
  }

  if ([...userSelect.options].some((o) => o.value === prevUser)) userSelect.value = prevUser;
  if ([...testSelect.options].some((o) => o.value === prevTest)) testSelect.value = prevTest;
}

function truncateId(id) {
  if (id.length <= 20) return id;
  return `${id.slice(0, 16)}…`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render() {
  const userFilter = userSelect.value;
  const testFilter = testSelect.value;
  const sortMode = sortSelect.value;

  let filtered = allGroups;
  if (userFilter) filtered = filtered.filter((g) => g.userId === userFilter);
  if (testFilter) filtered = filtered.filter((g) => String(g.test) === testFilter);

  filtered = sortGroups(filtered, sortMode);

  if (filtered.length === 0) {
    resultsEl.innerHTML = `
      <div class="empty-state card">
        <strong>No results match your filters</strong>
        <p>Try selecting a different user or test, or refresh the data.</p>
      </div>`;
    return;
  }

  const totalCategories = filtered.reduce((n, g) => n + g.categories.length, 0);
  statusEl.textContent = `Showing ${filtered.length} test run${filtered.length === 1 ? "" : "s"} · ${totalCategories} recommended categories`;

  resultsEl.innerHTML = filtered
    .map((group) => {
      const testKey = testSectionKey(group);
      const testOpen = expandedTests.has(testKey);

      const categoriesHtml = group.categories
        .map((cat) => {
          const catKey = categorySectionKey(group, cat);
          const catOpen = expandedCategories.has(catKey);
          const storiesHtml =
            cat.stories.length > 0
              ? `<ol class="stories">${cat.stories.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
              : `<p class="category-note">No stories listed</p>`;
          const noteHtml = cat.notes
            ? `<p class="category-note">Note: ${escapeHtml(cat.notes)}</p>`
            : "";

          return `
            <details class="category-card" data-section-key="${escapeHtml(catKey)}"${catOpen ? " open" : ""}>
              <summary class="category-header">
                <span class="collapse-chevron" aria-hidden="true"></span>
                <div class="category-header-text">
                  <h3 class="category-title">${escapeHtml(cat.label)}</h3>
                  ${cat.path ? `<p class="category-path">${escapeHtml(cat.path)}</p>` : ""}
                </div>
                <span class="section-count">${cat.stories.length} stor${cat.stories.length === 1 ? "y" : "ies"}</span>
              </summary>
              <div class="category-body">
                ${storiesHtml}
                ${noteHtml}
              </div>
            </details>`;
        })
        .join("");

      return `
        <details class="test-block" data-section-key="${escapeHtml(testKey)}" data-user-id="${escapeHtml(group.userId)}" data-test="${group.test}"${testOpen ? " open" : ""}>
          <summary class="test-block-header">
            <span class="collapse-chevron" aria-hidden="true"></span>
            <h2>${escapeHtml(group.name)}</h2>
            <span class="test-badge">Test ${group.test ?? "—"}</span>
            <span class="section-count">${group.categories.length} categor${group.categories.length === 1 ? "y" : "ies"}</span>
          </summary>
          <div class="test-block-body">
            <p class="meta">
              <span>User ID: <code>${escapeHtml(group.userId)}</code></span>
              ${group.scenario ? `<span> · Scenario: <code>${escapeHtml(group.scenario)}</code></span>` : ""}
            </p>
            ${categoriesHtml}
          </div>
        </details>`;
    })
    .join("");
}

function setAllSectionsOpen(open) {
  resultsEl.querySelectorAll("details").forEach((el) => {
    el.open = open;
    const key = el.dataset.sectionKey;
    if (!key) return;
    const store = el.classList.contains("test-block") ? expandedTests : expandedCategories;
    if (open) store.add(key);
    else store.delete(key);
  });
}

function handleSectionToggle(event) {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  const key = details.dataset.sectionKey;
  if (!key) return;

  const store = details.classList.contains("test-block") ? expandedTests : expandedCategories;
  if (details.open) store.add(key);
  else store.delete(key);
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

async function loadData() {
  setStatus("Loading spreadsheet…", "loading");
  refreshBtn.disabled = true;

  try {
    const [resultsData, usersData] = await Promise.all([
      fetchSheet(RESULTS_SHEET),
      fetchSheet(USERS_SHEET).catch(() => null),
    ]);

    const rows = rowsFromTable(resultsData.table);
    allGroups = parseResults(rows);

    if (usersData) {
      const userRows = rowsFromTable(usersData.table);
      enrichFromUsersSheet(allGroups, userRows);
    }

    populateFilters(allGroups);
    render();
    setStatus(`Loaded ${allGroups.length} test runs from Google Sheets`);
  } catch (err) {
    console.error(err);
    setStatus(
      `Could not load data: ${err.message}. Ensure the spreadsheet is shared publicly.`,
      "error"
    );
    resultsEl.innerHTML = "";
  } finally {
    refreshBtn.disabled = false;
  }
}

function enrichFromUsersSheet(groups, userRows) {
  const byId = new Map();
  for (const row of userRows.slice(1)) {
    const id = String(row[1] || "").trim();
    if (id) byId.set(id, { name: row[0], user: row[2], homeStation: row[3] });
  }
  for (const g of groups) {
    const info = byId.get(g.userId);
    if (info && !g.name) g.name = info.name;
    if (info) g.userProfile = info.user;
  }
}

[userSelect, testSelect, sortSelect].forEach((el) => {
  el.addEventListener("change", render);
});

refreshBtn.addEventListener("click", loadData);
expandAllBtn.addEventListener("click", () => setAllSectionsOpen(true));
collapseAllBtn.addEventListener("click", () => setAllSectionsOpen(false));
resultsEl.addEventListener("toggle", handleSectionToggle);

loadData();
