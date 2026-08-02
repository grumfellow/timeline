import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, Timestamp } from "firebase/firestore";
import fs from 'fs';
import csv from 'csv-parser';

// 1. Your Firebase Configuration (Paste your actual keys here)
const firebaseConfig = {
  apiKey: "AIzaSyDaPqMZevvZoBB758gplmRlFJzA4OHuhO4",
  authDomain: "timeline-36d84.firebaseapp.com",
  projectId: "timeline-36d84",
  storageBucket: "timeline-36d84.firebasestorage.app",
  messagingSenderId: "302861349296",
  appId: "1:302861349296:web:1e48e58032402c86042675",
  measurementId: "G-YD2GBYXE7C"
};

// 2. Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 3. Read and upload the CSV file
async function importCSV() {
  const events = [];

  // Read the CSV file line by line
  fs.createReadStream('events.csv')
    .pipe(csv())
    .on('data', (row) => {
      // Store each CSV row into our local events list
      events.push(row);
    })
    .on('end', async () => {
      console.log(`🚀 Found ${events.length} events in CSV. Starting import to Firestore...`);

      for (const event of events) {
        try {
          // Convert the CSV date string into a JavaScript Date object
          const dateObj = new Date(event.date);

          // Skip invalid dates
          if (isNaN(dateObj.getTime())) {
            console.warn(`⚠️ Skipping "${event.title}": Invalid date "${event.date}"`);
            continue;
          }

          // Write document to Firestore 'events' collection
          const docRef = await addDoc(collection(db, "events"), {
            title: event.title.trim(),
            date: Timestamp.fromDate(dateObj),
            tier: Number(event.tier) || 1
          });

          console.log(`✔ Added: "${event.title}" [ID: ${docRef.id}]`);
        } catch (error) {
          console.error(`❌ Failed to import "${event.title}":`, error);
        }
      }

      console.log("🎉 Database population complete!");
      process.exit(0);
    });
}

importCSV();