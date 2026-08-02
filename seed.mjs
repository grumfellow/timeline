import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  doc, 
  setDoc, 
  getDocs, 
  query, 
  where, 
  Timestamp 
} from "firebase/firestore";
import fs from 'fs';
import csv from 'csv-parser';

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyDaPqMZevvZoBB758gplmRlFJzA4OHuhO4",
  authDomain: "timeline-36d84.firebaseapp.com",
  projectId: "timeline-36d84",
  storageBucket: "timeline-36d84.firebasestorage.app",
  messagingSenderId: "302861349296",
  appId: "1:302861349296:web:1e48e58032402c86042675",
  measurementId: "G-YD2GBYXE7C"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Helper function to turn a human title into a clean ID (e.g. "Personal History" -> "personal-history")
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
}

// In-memory cache to prevent redundant timeline lookups during the loop
const timelineCache = new Map();

async function getOrCreateTimelineId(timelineTitle) {
  const cleanTitle = timelineTitle ? timelineTitle.trim() : "Default Timeline";
  
  if (timelineCache.has(cleanTitle)) {
    return timelineCache.get(cleanTitle);
  }

  // Generate a URL/Firestore friendly ID slug
  const timelineId = slugify(cleanTitle);
  const timelineRef = doc(db, "timelines", timelineId);

  // setDoc with { merge: true } creates the timeline if missing, or leaves existing fields intact
  await setDoc(timelineRef, {
    title: cleanTitle,
    updatedAt: Timestamp.now()
  }, { merge: true });

  timelineCache.set(cleanTitle, timelineId);
  return timelineId;
}

async function importCSV() {
  const events = [];

  fs.createReadStream('events.csv')
    .pipe(csv())
    .on('data', (row) => events.push(row))
    .on('end', async () => {
      console.log(`🚀 Found ${events.length} rows in CSV. Starting import...`);

      for (const event of events) {
        try {
          // 1. Get column values
          const rawTimelineTitle = event.timeline || "Default Timeline";
          const eventTitle = event.title ? event.title.trim() : "Untitled Event";
          const dateObj = new Date(event.date);

          if (isNaN(dateObj.getTime())) {
            console.warn(`⚠️ Skipping "${eventTitle}": Invalid date "${event.date}"`);
            continue;
          }

          // 2. Resolve parent timeline ID
          const timelineId = await getOrCreateTimelineId(rawTimelineTitle);

          // 3. Add event doc to subcollection: timelines/{timelineId}/events
          const eventsSubcollection = collection(db, "timelines", timelineId, "events");
          const docRef = await addDoc(eventsSubcollection, {
            title: eventTitle,
            date: Timestamp.fromDate(dateObj),
            tier: Number(event.tier) || 1
          });

          console.log(`✔ Added "${eventTitle}" to timeline: '${rawTimelineTitle}' [ID: ${docRef.id}]`);
        } catch (error) {
          console.error(`❌ Failed importing row:`, event, error);
        }
      }

      console.log("🎉 Seeding complete!");
      process.exit(0);
    });
}

importCSV();