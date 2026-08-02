import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

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
export const db = getFirestore(app);