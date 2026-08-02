import * as d3 from 'd3';
import { db } from './firebase.js';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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
async function loadTimelineOptions() {
  const selectEl = document.getElementById("timelineSelect");
  if (!selectEl) return null;

  try {
    // 1. Fetch all parent documents in the 'timelines' collection
    const timelinesSnapshot = await getDocs(collection(db, "timelines"));
    
    // Clear the hardcoded static HTML options
    selectEl.innerHTML = "";

    let firstTimelineId = null;

    // 2. Loop through each timeline document
    timelinesSnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const option = document.createElement("option");
      
      // Store the doc ID (e.g., "personal-history") as the value
      option.value = docSnap.id; 
      // Display the nice title (e.g., "Personal History") as text
      option.textContent = data.title || docSnap.id;
      
      selectEl.appendChild(option);

      if (!firstTimelineId) {
        firstTimelineId = docSnap.id;
      }
    });

    return firstTimelineId;
  } catch (error) {
    console.error("Error loading timeline options from Firestore:", error);
    return null;
  }
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
  // Populate dropdown with real Firestore timelines and get the first one's ID
  const activeTimelineId = await loadTimelineOptions();
  
  if (!activeTimelineId) {
    console.warn("No timelines found in Firestore!");
    return;
  }

  // Fetch events for the selected timeline
  const eventsData = await loadEvents(activeTimelineId);

  // Set up scale domain
  const extent = d3.extent(eventsData, d => d.date);
  if (extent[0] && extent[1]) {
    xBaseScale.domain([
      d3.timeYear.offset(extent[0], -1),
      d3.timeYear.offset(extent[1], 1)
    ]);
  }

  // Zoom setup & initial render
  function zoomed(event) {
    const newXScale = event.transform.rescaleX(xBaseScale);
    updateTimeline(newXScale, event.transform.k, eventsData);
  }

  const zoom = d3.zoom()
    .scaleExtent([1, 80])
    .extent([[margin.left, 0], [width - margin.right, height]])
    .translateExtent([[margin.left, -Infinity], [width - margin.right, Infinity]])
    .on("zoom", zoomed);

  svg.call(zoom);
  updateTimeline(xBaseScale, 1, eventsData);

  // Re-fetch events when dropdown changes
  const selectEl = document.getElementById("timelineSelect");
  if (selectEl) {
    selectEl.addEventListener("change", async (e) => {
      const selectedId = e.target.value;
      const newEvents = await loadEvents(selectedId);

      const newExtent = d3.extent(newEvents, d => d.date);
      if (newExtent[0] && newExtent[1]) {
        xBaseScale.domain([
          d3.timeYear.offset(newExtent[0], -1),
          d3.timeYear.offset(newExtent[1], 1)
        ]);
      }

      svg.call(zoom.transform, d3.zoomIdentity);
      updateTimeline(xBaseScale, 1, newEvents);
    });
  }
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
  allNodes.attr("transform", d => `translate(${d.targetX}, ${d.y})`);
}

document.getElementById('timelineSelect').addEventListener('change', async (e) => {
  const selectedId = e.target.value;
  const newEvents = await loadEvents(selectedId);
  
  // Re-adjust axis extent & update D3 timeline
  const extent = d3.extent(newEvents, d => d.date);
  if (extent[0] && extent[1]) {
    xBaseScale.domain([
      d3.timeYear.offset(extent[0], -1),
      d3.timeYear.offset(extent[1], 1)
    ]);
  }

  updateTimeline(xBaseScale, 1, newEvents);
});
