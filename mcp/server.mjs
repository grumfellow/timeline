// MCP server for the Timeline app.
// Lets Claude list timelines and add / update / delete events, using the same
// Firestore data layout and date format as the web app (see ../main.js).
//
// Signs in with the same email + password you use in the app, so the app's own
// ownership rules apply: only timelines you own can be changed.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  setLogLevel
} from "firebase/firestore";

// stdout carries the MCP protocol, so anything that logs there would corrupt it.
console.log = console.error;

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, ".env.local"));
} catch {
  // No credentials file yet; sign-in reports a helpful message on first use.
}

// Public web config, identical to ../firebase.js (not a secret).
const firebaseConfig = {
  apiKey: "AIzaSyDaPqMZevvZoBB758gplmRlFJzA4OHuhO4",
  authDomain: "timeline-36d84.firebaseapp.com",
  projectId: "timeline-36d84",
  storageBucket: "timeline-36d84.firebasestorage.app",
  messagingSenderId: "302861349296",
  appId: "1:302861349296:web:1e48e58032402c86042675"
};

setLogLevel("error");
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

let signInPromise = null;

function ensureSignedIn() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!signInPromise) {
    const email = process.env.TIMELINE_EMAIL;
    const password = process.env.TIMELINE_PASSWORD;
    if (!email || !password) {
      return Promise.reject(new Error(
        "Not configured: create mcp/.env.local with TIMELINE_EMAIL and TIMELINE_PASSWORD " +
        "(see mcp/.env.example), then restart Claude."
      ));
    }
    signInPromise = signInWithEmailAndPassword(auth, email, password)
      .then((cred) => cred.user)
      .catch((err) => {
        signInPromise = null;
        const bad = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"];
        throw new Error(
          bad.includes(err.code)
            ? "Sign-in failed: the email or password in mcp/.env.local is wrong."
            : `Sign-in failed: ${err.message}`
        );
      });
  }
  return signInPromise;
}

// ---------- dates (mirrors parseEventDate in ../main.js) ----------

function createUTCDate(year, month = 0, day = 1) {
  const d = new Date(Date.UTC(0, 0, 1));
  d.setUTCFullYear(year, month, day);
  return d;
}

// Accepts M/D/YYYY, YYYY-MM-DD, or a bare year, optionally followed by BC/BCE/AD/CE.
function parseEventDate(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const isBC = /\s*(BC|BCE)$/i.test(trimmed);
  const cleaned = trimmed.replace(/\s*(BC|BCE|AD|CE)$/i, "").trim();
  const fixBC = (y) => (isBC ? -(Math.abs(y) - 1) : y);
  let d = null;

  let m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/);
  if (m) d = createUTCDate(fixBC(Number(m[3])), Number(m[1]) - 1, Number(m[2]));
  if (!m) {
    m = cleaned.match(/^(-?\d+)-(\d{2})-(\d{2})$/);
    if (m) d = createUTCDate(fixBC(Number(m[1])), Number(m[2]) - 1, Number(m[3]));
  }
  if (!m) {
    m = cleaned.match(/^(-?\d+)$/);
    if (m) d = createUTCDate(fixBC(Number(m[1])), 0, 1);
  }
  if (!m) d = new Date(cleaned);
  return d && !isNaN(d.getTime()) ? d : null;
}

// Rejects things like 2/31/2026 that JS would silently roll into March.
function parseStrict(input, label) {
  const d = parseEventDate(input);
  if (!d) {
    throw new Error(`Invalid ${label} "${input}". Use M/D/YYYY, YYYY-MM-DD, or a year like "44 BC".`);
  }
  const slash = String(input).trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{1,4}\s*(BC|BCE|AD|CE)?$/i);
  if (slash && (d.getUTCMonth() + 1 !== Number(slash[1]) || d.getUTCDate() !== Number(slash[2]))) {
    throw new Error(`Invalid ${label} "${input}": that day doesn't exist.`);
  }
  return d;
}

function toDate(raw) {
  if (!raw) return null;
  if (raw.toDate) return raw.toDate();
  const d = typeof raw === "string" ? parseEventDate(raw) || new Date(raw) : new Date(raw);
  return d && !isNaN(d.getTime()) ? d : null;
}

function fmt(d) {
  if (!d) return null;
  const iso = d.toISOString();
  return d.getUTCFullYear() >= 0 && d.getUTCFullYear() <= 9999 ? iso.slice(0, 10) : iso;
}

// ---------- Firestore helpers ----------

const norm = (s) => String(s).replace(/[‘’]/g, "'").trim().toLowerCase();

// Security rules only allow reading timelines that are public or owned by the signed-in
// user, so ask for those two sets explicitly instead of reading the whole collection.
async function loadTimelines(user) {
  const ref = collection(db, "timelines");
  const [publicSnap, ownedSnap] = await Promise.all([
    getDocs(query(ref, where("isPublic", "==", true))),
    getDocs(query(ref, where("ownerEmail", "==", user.email)))
  ]);
  const byId = new Map();
  for (const d of [...publicSnap.docs, ...ownedSnap.docs]) {
    const data = d.data();
    byId.set(d.id, {
      id: d.id,
      title: data.title || d.id,
      ownerEmail: data.ownerEmail || null,
      isPublic: data.isPublic === true
    });
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const isOwner = (tl, user) =>
  Boolean(tl.ownerEmail && tl.ownerEmail.toLowerCase() === user.email.toLowerCase());

// Finds a timeline by exact id or by title (case-insensitive, curly quotes ok).
async function resolveTimeline(ref, { requireOwner }) {
  const user = await ensureSignedIn();
  const all = await loadTimelines(user);
  const visible = all.filter((t) => t.isPublic || isOwner(t, user));
  const wanted = norm(ref);
  const matches = visible.filter((t) => t.id === ref || norm(t.title) === wanted);
  if (matches.length === 0) {
    const names = visible.filter((t) => isOwner(t, user)).map((t) => `"${t.title}"`).join(", ");
    throw new Error(`No timeline matches "${ref}". Your timelines: ${names || "(none)"}.`);
  }
  const owned = matches.filter((t) => isOwner(t, user));
  const pool = owned.length ? owned : matches;
  if (pool.length > 1) {
    const list = pool.map((t) => `${t.title} (id ${t.id})`).join("; ");
    throw new Error(`"${ref}" matches more than one timeline: ${list}. Use the id instead.`);
  }
  const tl = pool[0];
  if (requireOwner && !isOwner(tl, user)) {
    throw new Error(
      `"${tl.title}" is owned by ${tl.ownerEmail || "someone else"}, and you (${user.email}) can only change your own timelines.`
    );
  }
  return tl;
}

function shapeEvent(id, data) {
  const tags = Array.isArray(data.tags)
    ? data.tags
    : typeof data.tags === "string" ? data.tags.split(",") : [];
  return {
    id,
    title: data.title || "Untitled Event",
    start_date: fmt(toDate(data.date || data.timestamp)),
    end_date: fmt(toDate(data.endDate || data.end_date)),
    tier: Number(data.tier) || 1,
    tags: tags.map((t) => String(t).trim()).filter(Boolean)
  };
}

async function loadEvents(timelineId) {
  const snap = await getDocs(collection(db, "timelines", timelineId, "events"));
  return snap.docs.map((d) => shapeEvent(d.id, d.data()));
}

function cleanTags(tags) {
  const seen = new Set();
  return tags.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

// ---------- MCP tools ----------

const server = new McpServer({ name: "timeline", version: "1.0.0" });

const respond = (fn) => async (args) => {
  try {
    const result = await fn(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err.message || String(err) }] };
  }
};

const timelineArg = z.string().describe('Timeline title (e.g. "Glenn\'s Timeline") or its id');
const tierArg = z.number().int().min(1).max(3).describe("Importance tier, 1 to 3");

server.registerTool(
  "list_timelines",
  {
    title: "List timelines",
    description:
      "List the timelines the signed-in user can see. Timelines with writable=true are owned by the user and can be changed.",
    inputSchema: {}
  },
  respond(async () => {
    const user = await ensureSignedIn();
    const all = await loadTimelines(user);
    return all
      .filter((t) => t.isPublic || isOwner(t, user))
      .map((t) => ({ id: t.id, title: t.title, writable: isOwner(t, user), public: t.isPublic }));
  })
);

server.registerTool(
  "list_events",
  {
    title: "List events",
    description:
      "List events on a timeline, sorted by start date. Use this to find an event's id before updating or deleting it.",
    inputSchema: {
      timeline: timelineArg,
      search: z.string().optional().describe("Only events whose title contains this text"),
      tag: z.string().optional().describe("Only events with this tag"),
      from: z.string().optional().describe("Only events starting on/after this date"),
      to: z.string().optional().describe("Only events starting on/before this date"),
      limit: z.number().int().min(1).max(500).optional().describe("Max events to return (default 100)")
    }
  },
  respond(async ({ timeline, search, tag, from, to, limit }) => {
    const tl = await resolveTimeline(timeline, { requireOwner: false });
    let events = await loadEvents(tl.id);
    if (search) events = events.filter((e) => norm(e.title).includes(norm(search)));
    if (tag) events = events.filter((e) => e.tags.some((t) => norm(t) === norm(tag)));
    if (from) {
      const f = fmt(parseStrict(from, "from date"));
      events = events.filter((e) => e.start_date && e.start_date >= f);
    }
    if (to) {
      const t = fmt(parseStrict(to, "to date"));
      events = events.filter((e) => e.start_date && e.start_date <= t);
    }
    events.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    const total = events.length;
    events = events.slice(0, limit ?? 100);
    return { timeline: tl.title, total_matching: total, returned: events.length, events };
  })
);

server.registerTool(
  "add_event",
  {
    title: "Add event",
    description:
      "Add an event to one of the user's timelines. Dates accept M/D/YYYY or YYYY-MM-DD (or a year like '44 BC'). " +
      "Refuses to add an exact duplicate (same title and start date) unless allow_duplicate is true.",
    inputSchema: {
      timeline: timelineArg,
      title: z.string().min(1).describe("Event title"),
      start_date: z.string().describe("Start date, e.g. 9/10/2026"),
      end_date: z.string().optional().describe("End date, for events that span several days"),
      tier: tierArg.optional().describe("Importance tier 1-3 (default 1)"),
      tags: z.array(z.string()).optional().describe('Tags, e.g. ["trips"]'),
      allow_duplicate: z.boolean().optional()
    }
  },
  respond(async ({ timeline, title, start_date, end_date, tier, tags, allow_duplicate }) => {
    const tl = await resolveTimeline(timeline, { requireOwner: true });
    const start = parseStrict(start_date, "start date");
    const end = end_date ? parseStrict(end_date, "end date") : null;
    if (end && end < start) throw new Error("The end date is before the start date.");

    if (!allow_duplicate) {
      const dup = (await loadEvents(tl.id)).find(
        (e) => norm(e.title) === norm(title) && e.start_date === fmt(start)
      );
      if (dup) {
        throw new Error(
          `"${dup.title}" on ${dup.start_date} already exists on "${tl.title}" (id ${dup.id}). Nothing was added.`
        );
      }
    }

    // Same stored shape as createEvent() in ../main.js.
    const data = {
      title: title.trim(),
      date: start.toISOString(),
      tier: tier ?? 1,
      tags: cleanTags(tags ?? [])
    };
    if (end) data.endDate = end.toISOString();
    const ref = await addDoc(collection(db, "timelines", tl.id, "events"), data);
    return { added: shapeEvent(ref.id, data), timeline: tl.title };
  })
);

server.registerTool(
  "update_event",
  {
    title: "Update event",
    description:
      "Change fields of an existing event on one of the user's timelines. Only the fields you pass are changed. " +
      "Get the event_id from list_events. Pass end_date as an empty string to remove the end date.",
    inputSchema: {
      timeline: timelineArg,
      event_id: z.string().describe("Event id from list_events"),
      title: z.string().min(1).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional().describe("Empty string removes the end date"),
      tier: tierArg.optional(),
      tags: z.array(z.string()).optional().describe("Replaces the full tag list")
    }
  },
  respond(async ({ timeline, event_id, title, start_date, end_date, tier, tags }) => {
    const tl = await resolveTimeline(timeline, { requireOwner: true });
    const current = (await loadEvents(tl.id)).find((e) => e.id === event_id);
    if (!current) throw new Error(`No event with id ${event_id} on "${tl.title}".`);

    const patch = {};
    if (title !== undefined) patch.title = title.trim();
    if (start_date !== undefined) patch.date = parseStrict(start_date, "start date").toISOString();
    if (end_date !== undefined) {
      patch.endDate = end_date.trim() === "" ? null : parseStrict(end_date, "end date").toISOString();
    }
    if (tier !== undefined) patch.tier = tier;
    if (tags !== undefined) patch.tags = cleanTags(tags);
    if (Object.keys(patch).length === 0) throw new Error("Nothing to change: no fields were provided.");

    const newStart = patch.date ? patch.date.slice(0, 10) : current.start_date;
    const newEnd = patch.endDate !== undefined ? (patch.endDate ? patch.endDate.slice(0, 10) : null) : current.end_date;
    if (newEnd && newStart && newEnd < newStart) throw new Error("The end date is before the start date.");

    const ref = doc(db, "timelines", tl.id, "events", event_id);
    await updateDoc(ref, patch);
    const after = (await loadEvents(tl.id)).find((e) => e.id === event_id);
    return { before: current, after, timeline: tl.title };
  })
);

server.registerTool(
  "delete_event",
  {
    title: "Delete event",
    description:
      "PERMANENTLY delete an event from one of the user's timelines. Only call this when the user has clearly asked " +
      "to delete that specific event. Get the event_id from list_events and tell the user which event is being removed.",
    inputSchema: {
      timeline: timelineArg,
      event_id: z.string().describe("Event id from list_events")
    }
  },
  respond(async ({ timeline, event_id }) => {
    const tl = await resolveTimeline(timeline, { requireOwner: true });
    const current = (await loadEvents(tl.id)).find((e) => e.id === event_id);
    if (!current) throw new Error(`No event with id ${event_id} on "${tl.title}". Nothing was deleted.`);
    await deleteDoc(doc(db, "timelines", tl.id, "events", event_id));
    return { deleted: current, timeline: tl.title };
  })
);

await server.connect(new StdioServerTransport());
// Exit when the host closes our input, so no orphaned process is left holding the database open.
process.stdin.on("end", () => process.exit(0));
console.error("Timeline MCP server ready.");
