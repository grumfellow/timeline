import * as d3 from 'd3';
import { db } from './firebase.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';

const CREATE_TIMELINE_VALUE = "__create_new__";

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-");
}

function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Function to add a new event document to Firestore
async function createEvent(timelineId, eventData) {
  try {
    const eventsRef = collection(db, "timelines", timelineId, "events");
    const docRef = await addDoc(eventsRef, {
      title: eventData.title,
      date: Timestamp.fromDate(eventData.date),
      tier: eventData.tier
    });

    console.log(`Successfully added event '${eventData.title}' with ID: ${docRef.id}`);
    return { id: docRef.id, ...eventData };
  } catch (error) {
    console.error("Error creating event in Firestore:", error);
    throw error;
  }
}

async function updateEvent(timelineId, eventId, eventData) {
  try {
    const eventRef = doc(db, "timelines", timelineId, "events", eventId);
    await updateDoc(eventRef, {
      title: eventData.title,
      date: Timestamp.fromDate(eventData.date),
      tier: eventData.tier
    });

    console.log(`Successfully updated event '${eventData.title}' with ID: ${eventId}`);
    return { id: eventId, ...eventData };
  } catch (error) {
    console.error("Error updating event in Firestore:", error);
    throw error;
  }
}

async function deleteEvent(timelineId, eventId) {
  try {
    const eventRef = doc(db, "timelines", timelineId, "events", eventId);
    await deleteDoc(eventRef);
    console.log(`Successfully deleted event with ID: ${eventId}`);
  } catch (error) {
    console.error("Error deleting event from Firestore:", error);
    throw error;
  }
}

// Wire up Modal UI & Form Listeners (add + edit)
function setupEventModal(getCurrentTimelineId, onEventsChanged) {
  const modal = document.getElementById("eventModal");
  const openBtn = document.getElementById("openAddEventBtn");
  const cancelBtn = document.getElementById("cancelModalBtn");
  const form = document.getElementById("eventForm");
  const modalTitle = document.getElementById("eventModalTitle");
  const submitBtn = document.getElementById("eventSubmitBtn");
  const deleteBtn = document.getElementById("deleteEventBtn");

  if (!modal || !openBtn || !form) return null;

  let editingEventId = null;

  function closeModal() {
    modal.style.display = "none";
    form.reset();
    editingEventId = null;
    modalTitle.textContent = "Add New Event";
    submitBtn.textContent = "Save Event";
    if (deleteBtn) deleteBtn.style.display = "none";
  }

  function openAdd() {
    editingEventId = null;
    form.reset();
    modalTitle.textContent = "Add New Event";
    submitBtn.textContent = "Save Event";
    if (deleteBtn) deleteBtn.style.display = "none";
    modal.style.display = "flex";
  }

  function openEdit(event) {
    editingEventId = event.id;
    modalTitle.textContent = "Edit Event";
    submitBtn.textContent = "Save";
    document.getElementById("eventTitle").value = event.title;
    document.getElementById("eventDate").value = formatDateForInput(event.date);
    document.getElementById("eventTier").value = String(event.tier);
    if (deleteBtn) deleteBtn.style.display = "inline-block";
    modal.style.display = "flex";
  }

  openBtn.addEventListener("click", openAdd);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  if (deleteBtn) {
    const deleteConfirmModal = document.getElementById("deleteConfirmModal");
    const deleteConfirmMessage = document.getElementById("deleteConfirmMessage");
    const deleteConfirmCancelBtn = document.getElementById("deleteConfirmCancelBtn");
    const deleteConfirmOkBtn = document.getElementById("deleteConfirmOkBtn");

    function closeDeleteConfirm() {
      if (deleteConfirmModal) deleteConfirmModal.style.display = "none";
    }

    deleteBtn.addEventListener("click", () => {
      if (!editingEventId || !deleteConfirmModal || !deleteConfirmMessage) return;

      const title = document.getElementById("eventTitle").value.trim() || "this event";
      deleteConfirmMessage.textContent = `Delete "${title}"? This cannot be undone.`;
      deleteConfirmModal.style.display = "flex";
    });

    if (deleteConfirmCancelBtn) {
      deleteConfirmCancelBtn.addEventListener("click", closeDeleteConfirm);
    }

    if (deleteConfirmOkBtn) {
      deleteConfirmOkBtn.addEventListener("click", async () => {
        if (!editingEventId) {
          closeDeleteConfirm();
          return;
        }

        const activeTimelineId = getCurrentTimelineId();
        if (!activeTimelineId) {
          alert("Please select a timeline first.");
          closeDeleteConfirm();
          return;
        }

        try {
          await deleteEvent(activeTimelineId, editingEventId);
          closeDeleteConfirm();
          closeModal();
          onEventsChanged();
        } catch (err) {
          alert("Failed to delete event. Check console for details.");
          closeDeleteConfirm();
        }
      });
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const activeTimelineId = getCurrentTimelineId();
    if (!activeTimelineId) {
      alert("Please select a timeline first.");
      return;
    }

    const titleInput = document.getElementById("eventTitle").value.trim();
    const dateInput = document.getElementById("eventDate").value;
    const tierInput = Number(document.getElementById("eventTier").value) || 1;

    if (!titleInput || !dateInput) return;

    const [year, month, day] = dateInput.split("-");
    const eventDate = new Date(year, month - 1, day);
    const payload = { title: titleInput, date: eventDate, tier: tierInput };

    try {
      if (editingEventId) {
        await updateEvent(activeTimelineId, editingEventId, payload);
      } else {
        await createEvent(activeTimelineId, payload);
      }

      closeModal();
      onEventsChanged();
    } catch (err) {
      alert(`Failed to ${editingEventId ? "update" : "save"} event. Check console for details.`);
    }
  });

  return { openAdd, openEdit };
}

async function createTimeline(title) {
  const cleanTitle = title.trim();
  const timelineId = slugify(cleanTitle);
  if (!timelineId) throw new Error("Invalid timeline title");

  const timelineRef = doc(db, "timelines", timelineId);
  await setDoc(timelineRef, {
    title: cleanTitle,
    createdAt: Timestamp.now()
  }, { merge: true });

  console.log(`Successfully created timeline '${cleanTitle}' with ID: ${timelineId}`);
  return timelineId;
}

function setupTimelineModal(onTimelineCreated) {
  const modal = document.getElementById("timelineModal");
  const form = document.getElementById("timelineForm");
  const cancelBtn = document.getElementById("cancelTimelineBtn");

  if (!modal || !form) return null;

  let restoreTimelineId = null;

  function close(restoreSelection = true) {
    modal.style.display = "none";
    form.reset();
    if (restoreSelection && restoreTimelineId) {
      const selectEl = document.getElementById("timelineSelect");
      if (selectEl) selectEl.value = restoreTimelineId;
    }
  }

  function open(previousTimelineId) {
    restoreTimelineId = previousTimelineId || null;
    form.reset();
    modal.style.display = "flex";
    document.getElementById("timelineTitle")?.focus();
  }

  if (cancelBtn) cancelBtn.addEventListener("click", () => close(true));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const titleInput = document.getElementById("timelineTitle").value.trim();
    if (!titleInput) return;

    try {
      const newTimelineId = await createTimeline(titleInput);
      close(false);
      onTimelineCreated(newTimelineId);
    } catch (err) {
      alert("Failed to create timeline. Check console for details.");
    }
  });

  return { open };
}

// Fetch events for a specific timeline ID
async function loadEvents(timelineId = "personal-timeline") {
  try {
    const eventsRef = collection(db, "timelines", timelineId, "events");
    const querySnapshot = await getDocs(eventsRef);
    const eventsData = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const rawDate = data.date || data.timestamp;

      let parsedDate = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate);
      if (isNaN(parsedDate.getTime())) return;

      eventsData.push({
        id: doc.id,
        title: data.title || "Untitled Event",
        date: parsedDate,
        tier: Number(data.tier) || 1
      });
    });

    return eventsData;
  } catch (error) {
    console.error(`Error loading timeline '${timelineId}':`, error);
    return [];
  }
}

// Fetch all timeline documents from Firestore and populate the dropdown
async function loadTimelineOptions(selectedId = null) {
  const selectEl = document.getElementById("timelineSelect");
  if (!selectEl) return null;

  try {
    const timelinesSnapshot = await getDocs(collection(db, "timelines"));

    selectEl.innerHTML = "";

    let firstTimelineId = null;

    timelinesSnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const option = document.createElement("option");

      option.value = docSnap.id;
      option.textContent = data.title || docSnap.id;

      selectEl.appendChild(option);

      if (!firstTimelineId) {
        firstTimelineId = docSnap.id;
      }
    });

    const createOption = document.createElement("option");
    createOption.value = CREATE_TIMELINE_VALUE;
    createOption.textContent = "+ Create New Timeline...";
    selectEl.appendChild(createOption);

    const idToSelect = selectedId && selectedId !== CREATE_TIMELINE_VALUE
      ? selectedId
      : firstTimelineId;

    if (idToSelect) {
      selectEl.value = idToSelect;
      return idToSelect;
    }

    return null;
  } catch (error) {
    console.error("Error loading timeline options from Firestore:", error);
    return null;
  }
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx]?.trim() ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function parseEventDate(dateStr) {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
    return isNaN(dateObj.getTime()) ? null : dateObj;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
    return isNaN(dateObj.getTime()) ? null : dateObj;
  }

  const dateObj = new Date(trimmed);
  return isNaN(dateObj.getTime()) ? null : dateObj;
}

async function importEventsToTimeline(timelineId, rows) {
  const results = { imported: 0, skipped: 0, skippedRows: [] };
  const validEvents = [];

  for (const row of rows) {
    const title = (row.title || "").trim() || "Untitled Event";
    const dateObj = parseEventDate(row.date);

    if (!dateObj) {
      results.skipped++;
      results.skippedRows.push(`"${title}" (invalid date: "${row.date || ""}")`);
      continue;
    }

    validEvents.push({
      title,
      date: dateObj,
      tier: Number(row.tier) || 1
    });
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < validEvents.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = validEvents.slice(i, i + BATCH_SIZE);

    for (const event of chunk) {
      const eventRef = doc(collection(db, "timelines", timelineId, "events"));
      batch.set(eventRef, {
        title: event.title,
        date: Timestamp.fromDate(event.date),
        tier: event.tier
      });
    }

    await batch.commit();
    results.imported += chunk.length;
  }

  return results;
}

function setupCsvImport(getCurrentTimelineId, onImportComplete) {
  const openBtn = document.getElementById("openImportCsvBtn");
  const modal = document.getElementById("csvImportModal");
  const form = document.getElementById("csvImportForm");
  const cancelBtn = document.getElementById("cancelCsvImportBtn");
  const fileInput = document.getElementById("csvFileInput");
  const statusEl = document.getElementById("csvImportStatus");
  const importBtn = document.getElementById("csvImportBtn");

  if (!openBtn || !modal || !form || !fileInput) return;

  function closeModal() {
    modal.style.display = "none";
    form.reset();
    if (statusEl) {
      statusEl.style.display = "none";
      statusEl.textContent = "";
    }
    if (importBtn) importBtn.disabled = false;
  }

  function openModal() {
    form.reset();
    if (statusEl) {
      statusEl.style.display = "none";
      statusEl.textContent = "";
    }
    if (importBtn) importBtn.disabled = false;
    modal.style.display = "flex";
  }

  openBtn.addEventListener("click", () => {
    openModal();
    if (!getCurrentTimelineId() && statusEl) {
      statusEl.style.display = "block";
      statusEl.style.color = "#b45309";
      statusEl.textContent = "Please select a timeline before importing.";
    }
  });

  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const activeTimelineId = getCurrentTimelineId();
    if (!activeTimelineId) {
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "#b45309";
        statusEl.textContent = "Please select a timeline before importing.";
      }
      return;
    }

    const file = fileInput.files?.[0];
    if (!file) {
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "#b45309";
        statusEl.textContent = "Please choose a CSV file to import.";
      }
      return;
    }

    if (importBtn) importBtn.disabled = true;
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.style.color = "#334155";
      statusEl.textContent = "Importing events...";
    }

    try {
      const text = await file.text();
      const rows = parseCSV(text);

      if (rows.length === 0) {
        if (statusEl) {
          statusEl.style.color = "#b45309";
          statusEl.textContent = "No data rows found in the CSV file.";
        }
        if (importBtn) importBtn.disabled = false;
        return;
      }

      const results = await importEventsToTimeline(activeTimelineId, rows);

      let message = `Imported ${results.imported} event${results.imported === 1 ? "" : "s"}.`;
      if (results.skipped > 0) {
        message += ` Skipped ${results.skipped} row${results.skipped === 1 ? "" : "s"} with invalid dates.`;
      }

      if (statusEl) {
        statusEl.style.color = results.skipped > 0 ? "#b45309" : "#15803d";
        statusEl.textContent = message;
      }

      if (results.imported > 0) {
        onImportComplete();
      }

      if (importBtn) importBtn.disabled = false;
    } catch (err) {
      console.error("CSV import failed:", err);
      if (statusEl) {
        statusEl.style.color = "#b45309";
        statusEl.textContent = "Failed to import CSV. Check console for details.";
      }
      if (importBtn) importBtn.disabled = false;
    }
  });
}

const container = document.getElementById("timeline-container");
const width = container.clientWidth;
const height = container.clientHeight;
const margin = { top: 40, right: 40, bottom: 60, left: 40 };

const svg = d3.select("#timeline-container")
  .append("svg")
  .attr("width", width)
  .attr("height", height);

const axisY = height - margin.bottom;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
ctx.font = "500 11px system-ui, -apple-system, sans-serif";

function getTextWidth(text) {
  return ctx.measureText(text).width;
}

const xBaseScale = d3.scaleTime()
  .domain([new Date(1960, 0, 1), new Date(2030, 0, 1)])
  .range([margin.left, width - margin.right]);

const xAxis = d3.axisBottom(xBaseScale).tickSizeOuter(0).tickPadding(10);

const gAxis = svg.append("g")
  .attr("class", "axis")
  .attr("transform", `translate(0, ${axisY})`);

const gLines = svg.append("g").attr("class", "lines-group");
const gEvents = svg.append("g").attr("class", "events-group");

let openEditEventModal = null;

const formatMillisecond = d3.timeFormat(".%L"),
      formatSecond      = d3.timeFormat(":%S"),
      formatMinute      = d3.timeFormat("%I:%M"),
      formatHour        = d3.timeFormat("%I %p"),
      formatDay         = d3.timeFormat("%b %d"),
      formatWeek        = d3.timeFormat("%b %d"),
      formatMonth       = d3.timeFormat("%B"),
      formatYear        = d3.timeFormat("%Y");

function multiScaleFormat(date) {
  return (d3.timeSecond(date) < date ? formatMillisecond
    : d3.timeMinute(date) < date ? formatSecond
    : d3.timeHour(date) < date ? formatMinute
    : d3.timeDay(date) < date ? formatHour
    : d3.timeMonth(date) < date ? (d3.timeWeek(date) < date ? formatDay : formatWeek)
    : d3.timeYear(date) < date ? formatMonth
    : formatYear)(date);
}

function resolveStrictCollisions(visibleEvents, scale) {
  const horizontalBuffer = 20;
  const verticalStep = 28;
  const baseY = axisY - 18;

  const items = visibleEvents.map(d => {
    const textW = getTextWidth(d.title);
    const targetX = scale(d.date);
    return {
      ...d,
      targetX: targetX,
      left: targetX - 10,
      right: targetX + 10 + textW + horizontalBuffer,
      y: baseY
    };
  });

  items.sort((a, b) => a.targetX - b.targetX);

  const laneRightEdges = [];

  items.forEach(item => {
    let lane = 0;
    while (laneRightEdges[lane] !== undefined && laneRightEdges[lane] > item.left) {
      lane++;
    }
    item.y = baseY - (lane * verticalStep);
    laneRightEdges[lane] = item.right;
  });

  return items;
}

async function init() {
  let activeTimelineId = await loadTimelineOptions();
  let previousTimelineId = activeTimelineId;
  let eventsData = activeTimelineId ? await loadEvents(activeTimelineId) : [];
  let currentTransform = d3.zoomIdentity;

  const keywordInput = document.getElementById("keywordFilterInput");

  function getFilteredEvents() {
    const query = keywordInput ? keywordInput.value.trim().toLowerCase() : "";
    if (!query) return eventsData;
    return eventsData.filter(d => d.title.toLowerCase().includes(query));
  }

  function renderCurrentTimeline() {
    const filtered = getFilteredEvents();
    const currentScale = currentTransform.rescaleX(xBaseScale);
    updateTimeline(currentScale, currentTransform.k, filtered);
  }

  function refreshChart(data) {
    const extent = d3.extent(data, d => d.date);
    if (extent[0] && extent[1]) {
      xBaseScale.domain([
        d3.timeYear.offset(extent[0], -1),
        d3.timeYear.offset(extent[1], 1)
      ]);
    } else {
      xBaseScale.domain([new Date(1960, 0, 1), new Date(2030, 0, 1)]);
    }
    currentTransform = d3.zoomIdentity;
    svg.call(zoom.transform, d3.zoomIdentity);
    updateTimeline(xBaseScale, 1, getFilteredEvents());
  }

  function zoomed(event) {
    currentTransform = event.transform;
    const newXScale = event.transform.rescaleX(xBaseScale);
    updateTimeline(newXScale, event.transform.k, getFilteredEvents());
  }

  if (keywordInput) {
    keywordInput.addEventListener("input", () => {
      renderCurrentTimeline();
    });
  }

  const zoom = d3.zoom()
    .scaleExtent([1, 80])
    .extent([[margin.left, 0], [width - margin.right, height]])
    .translateExtent([[margin.left, -Infinity], [width - margin.right, Infinity]])
    .on("zoom", zoomed);

  svg.call(zoom);
  refreshChart(eventsData);

  const selectEl = document.getElementById("timelineSelect");

  const timelineModal = setupTimelineModal(async (newTimelineId) => {
    activeTimelineId = newTimelineId;
    previousTimelineId = newTimelineId;
    await loadTimelineOptions(newTimelineId);
    eventsData = [];
    refreshChart(eventsData);
  });

  if (selectEl) {
    selectEl.addEventListener("change", async (e) => {
      const selected = e.target.value;

      if (selected === CREATE_TIMELINE_VALUE) {
        if (timelineModal) timelineModal.open(previousTimelineId);
        return;
      }

      previousTimelineId = selected;
      activeTimelineId = selected;
      eventsData = await loadEvents(activeTimelineId);
      refreshChart(eventsData);
    });
  }

  const eventModal = setupEventModal(
    () => activeTimelineId,
    async () => {
      eventsData = await loadEvents(activeTimelineId);
      refreshChart(eventsData);
    }
  );

  if (eventModal) {
    openEditEventModal = eventModal.openEdit;
  }

  setupCsvImport(
    () => activeTimelineId,
    async () => {
      eventsData = await loadEvents(activeTimelineId);
      refreshChart(eventsData);
    }
  );
}

init();

function updateTimeline(scale, zoomFactor, eventsData) {
  const maxTicks = Math.floor((width - margin.left - margin.right) / 75);

// Apply the multi-scale formatter directly
  xAxis.ticks(maxTicks).tickFormat(multiScaleFormat);
  gAxis.call(xAxis.scale(scale));

  let maxVisibleTier = 1;
  if (zoomFactor >= 10) maxVisibleTier = 3;
  else if (zoomFactor >= 3) maxVisibleTier = 2;

  const visibleData = eventsData.filter(d => d.tier <= maxVisibleTier);
  const positionedNodes = resolveStrictCollisions(visibleData, scale);

  const lines = gLines.selectAll(".leader-line")
    .data(positionedNodes, d => d.id);

  lines.exit().remove();

  lines.enter()
    .append("line")
    .attr("class", "leader-line")
    .merge(lines)
    .attr("x1", d => d.targetX)
    .attr("y1", axisY)
    .attr("x2", d => d.targetX)
    .attr("y2", d => d.y);

  const nodes = gEvents.selectAll(".event-node")
    .data(positionedNodes, d => d.id);

  nodes.exit().remove();

  const enterNodes = nodes.enter()
    .append("g")
    .attr("class", d => `event-node event-tier-${d.tier}`);

  enterNodes.append("circle");
  
  enterNodes.append("text")
    .attr("class", "event-label")
    .attr("x", 8)
    .attr("dy", "0.35em");

  const allNodes = enterNodes.merge(nodes);

  allNodes.select("text").text(d => d.title);
  allNodes
    .attr("class", d => `event-node event-tier-${d.tier}`)
    .attr("transform", d => `translate(${d.targetX}, ${d.y})`);

  const handleEventClick = (event, d) => {
    event.stopPropagation();
    if (openEditEventModal) openEditEventModal(d);
  };

  allNodes.select("circle")
    .style("cursor", "pointer")
    .on("click", handleEventClick);

  allNodes.select("text")
    .style("cursor", "pointer")
    .on("click", handleEventClick);
}
