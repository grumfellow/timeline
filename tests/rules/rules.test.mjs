// Tests for firestore.rules and storage.rules, run against the local Firebase emulator.
// Run from tests/rules with:  npm test
//
// "alice" is the signed-in user in most tests, "bob" is another user, and "anon" is not signed in.

import { readFileSync } from "node:fs";
import { describe, it, before, after, beforeEach } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, writeBatch
} from "firebase/firestore";
import { ref, uploadBytes, deleteObject, getBytes } from "firebase/storage";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const rulesPath = (name) => new URL(`../../${name}`, import.meta.url);

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-timeline",
    firestore: { rules: readFileSync(rulesPath("firestore.rules"), "utf8") },
    storage: { rules: readFileSync(rulesPath("storage.rules"), "utf8") }
  });
});

after(async () => {
  await env.cleanup();
});

const eventData = (title = "Event") => ({ title, date: "2026-09-10T00:00:00.000Z", tier: 1, tags: [] });

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "timelines", "alice-priv"), { title: "Alice private", ownerEmail: ALICE, isPublic: false });
    await setDoc(doc(db, "timelines", "alice-legacy"), { title: "Alice legacy (no isPublic field)", ownerEmail: ALICE });
    await setDoc(doc(db, "timelines", "alice-big"), { title: "Alice big", ownerEmail: ALICE, isPublic: false });
    await setDoc(doc(db, "timelines", "bob-priv"), { title: "Bob private", ownerEmail: BOB, isPublic: false });
    await setDoc(doc(db, "timelines", "bob-pub"), { title: "Bob public", ownerEmail: BOB, isPublic: true });
    for (const t of ["alice-priv", "alice-legacy", "bob-priv", "bob-pub"]) {
      await setDoc(doc(db, "timelines", t, "events", "e1"), eventData("Seed event"));
    }
    // A large timeline, to check batch writes/deletes are not limited by the rules' get() calls.
    for (let start = 0; start < 450; start += 150) {
      const batch = writeBatch(db);
      for (let i = start; i < start + 150; i++) {
        batch.set(doc(db, "timelines", "alice-big", "events", `big${i}`), eventData(`Big ${i}`));
      }
      await batch.commit();
    }
    await setDoc(doc(db, "users", "alice", "timelineViews", "alice-priv"), { zoom: { k: 1, x: 0 } });
    await setDoc(doc(db, "users", "bob", "timelineViews", "bob-priv"), { zoom: { k: 1, x: 0 } });
  });
});

const alice = () => env.authenticatedContext("alice", { email: ALICE });
const bob = () => env.authenticatedContext("bob", { email: BOB });
const anon = () => env.unauthenticatedContext();
const timelines = (ctx) => collection(ctx.firestore(), "timelines");

describe("timelines: reading", () => {
  it("logged-out visitor cannot read a private timeline", async () => {
    await assertFails(getDoc(doc(anon().firestore(), "timelines", "alice-priv")));
  });

  it("logged-out visitor cannot list all timelines", async () => {
    await assertFails(getDocs(timelines(anon())));
  });

  it("logged-out visitor can read a public timeline and query for public ones", async () => {
    await assertSucceeds(getDoc(doc(anon().firestore(), "timelines", "bob-pub")));
    const snap = await assertSucceeds(getDocs(query(timelines(anon()), where("isPublic", "==", true))));
    assertIds(snap, ["bob-pub"]);
  });

  it("owner can query for their own timelines (the app's second query)", async () => {
    const snap = await assertSucceeds(getDocs(query(timelines(alice()), where("ownerEmail", "==", ALICE))));
    assertIds(snap, ["alice-big", "alice-legacy", "alice-priv"]);
  });

  it("signed-in user can query for public timelines (the app's first query)", async () => {
    const snap = await assertSucceeds(getDocs(query(timelines(alice()), where("isPublic", "==", true))));
    assertIds(snap, ["bob-pub"]);
  });

  it("the old 'read every timeline' query is refused, which is why the app was changed", async () => {
    await assertFails(getDocs(timelines(alice())));
  });

  it("a stranger cannot query for someone else's timelines by owner", async () => {
    await assertFails(getDocs(query(timelines(alice()), where("ownerEmail", "==", BOB))));
  });

  it("owner cannot read another user's private timeline, but can read their public one", async () => {
    await assertFails(getDoc(doc(alice().firestore(), "timelines", "bob-priv")));
    await assertSucceeds(getDoc(doc(alice().firestore(), "timelines", "bob-pub")));
  });
});

describe("timelines: writing", () => {
  it("user can create a timeline they own", async () => {
    await assertSucceeds(addDoc(timelines(alice()), { title: "New", ownerEmail: ALICE, isPublic: false }));
  });

  it("user cannot create a timeline owned by someone else", async () => {
    await assertFails(addDoc(timelines(alice()), { title: "Sneaky", ownerEmail: BOB, isPublic: false }));
  });

  it("logged-out visitor cannot create a timeline", async () => {
    await assertFails(addDoc(timelines(anon()), { title: "Anon", ownerEmail: ALICE, isPublic: false }));
  });

  it("owner can rename a timeline and make it public", async () => {
    const ref_ = doc(alice().firestore(), "timelines", "alice-priv");
    await assertSucceeds(updateDoc(ref_, { title: "Renamed" }));
    await assertSucceeds(updateDoc(ref_, { isPublic: true }));
  });

  it("owner cannot hand a timeline to someone else", async () => {
    await assertFails(updateDoc(doc(alice().firestore(), "timelines", "alice-priv"), { ownerEmail: BOB }));
  });

  it("user cannot edit or delete another user's timeline (private or public)", async () => {
    for (const id of ["bob-priv", "bob-pub"]) {
      await assertFails(updateDoc(doc(alice().firestore(), "timelines", id), { title: "Hacked" }));
      await assertFails(deleteDoc(doc(alice().firestore(), "timelines", id)));
    }
  });

  it("logged-out visitor cannot edit or delete a timeline", async () => {
    await assertFails(updateDoc(doc(anon().firestore(), "timelines", "bob-pub"), { title: "Hacked" }));
    await assertFails(deleteDoc(doc(anon().firestore(), "timelines", "bob-pub")));
  });

  it("owner can delete a timeline, as the app does it: events first, then the timeline", async () => {
    const db = alice().firestore();
    const events = await getDocs(collection(db, "timelines", "alice-priv", "events"));
    const batch = writeBatch(db);
    events.forEach((d) => batch.delete(d.ref));
    await assertSucceeds(batch.commit());
    await assertSucceeds(deleteDoc(doc(db, "timelines", "alice-priv")));
  });
});

describe("events", () => {
  it("owner can read, add, edit and delete events on their own timeline", async () => {
    const db = alice().firestore();
    await assertSucceeds(getDocs(collection(db, "timelines", "alice-priv", "events")));
    const added = await assertSucceeds(addDoc(collection(db, "timelines", "alice-priv", "events"), eventData("Chattanooga Trip")));
    await assertSucceeds(updateDoc(added, { tier: 2, tags: ["trips", "family"] }));
    await assertSucceeds(deleteDoc(added));
  });

  it("owner can use a legacy timeline that has no isPublic field", async () => {
    const db = alice().firestore();
    await assertSucceeds(getDocs(collection(db, "timelines", "alice-legacy", "events")));
    await assertSucceeds(addDoc(collection(db, "timelines", "alice-legacy", "events"), eventData()));
  });

  it("anyone can read events of a public timeline, nobody but the owner can read a private one", async () => {
    await assertSucceeds(getDocs(collection(anon().firestore(), "timelines", "bob-pub", "events")));
    await assertSucceeds(getDocs(collection(alice().firestore(), "timelines", "bob-pub", "events")));
    await assertFails(getDocs(collection(alice().firestore(), "timelines", "bob-priv", "events")));
    await assertFails(getDocs(collection(anon().firestore(), "timelines", "bob-priv", "events")));
  });

  it("user cannot add, edit or delete events on another user's timeline (private or public)", async () => {
    const db = alice().firestore();
    for (const t of ["bob-priv", "bob-pub"]) {
      await assertFails(addDoc(collection(db, "timelines", t, "events"), eventData("Injected")));
      await assertFails(updateDoc(doc(db, "timelines", t, "events", "e1"), { title: "Hacked" }));
      await assertFails(deleteDoc(doc(db, "timelines", t, "events", "e1")));
    }
  });

  it("logged-out visitor cannot write events", async () => {
    const db = anon().firestore();
    await assertFails(addDoc(collection(db, "timelines", "bob-pub", "events"), eventData()));
    await assertFails(deleteDoc(doc(db, "timelines", "bob-pub", "events", "e1")));
  });

  it("owner can import and delete hundreds of events in one batch (CSV import / delete timeline)", async () => {
    const db = alice().firestore();
    const insert = writeBatch(db);
    for (let i = 0; i < 450; i++) insert.set(doc(collection(db, "timelines", "alice-priv", "events")), eventData(`Import ${i}`));
    await assertSucceeds(insert.commit());

    const existing = await getDocs(collection(db, "timelines", "alice-big", "events"));
    const remove = writeBatch(db);
    existing.forEach((d) => remove.delete(d.ref));
    await assertSucceeds(remove.commit());
  });

  it("a stranger cannot slip a write to another user's timeline into a batch", async () => {
    const db = alice().firestore();
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "timelines", "alice-priv", "events")), eventData("Mine"));
    batch.set(doc(collection(db, "timelines", "bob-priv", "events")), eventData("Not mine"));
    await assertFails(batch.commit());
  });
});

describe("saved views (users/{uid}/...)", () => {
  it("user can read and write their own saved views", async () => {
    const db = alice().firestore();
    await assertSucceeds(getDoc(doc(db, "users", "alice", "timelineViews", "alice-priv")));
    await assertSucceeds(setDoc(doc(db, "users", "alice", "timelineViews", "alice-priv"), { zoom: { k: 2, x: 5 } }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(db, "users", "alice", "timelineViews", "alice-priv")));
  });

  it("user cannot read or write another user's saved views", async () => {
    const db = alice().firestore();
    await assertFails(getDoc(doc(db, "users", "bob", "timelineViews", "bob-priv")));
    await assertFails(setDoc(doc(db, "users", "bob", "timelineViews", "x"), { zoom: { k: 2, x: 5 } }));
  });

  it("logged-out visitor cannot touch saved views", async () => {
    await assertFails(getDoc(doc(anon().firestore(), "users", "alice", "timelineViews", "alice-priv")));
  });
});

describe("everything else in the database", () => {
  it("is denied, even for signed-in users", async () => {
    const db = alice().firestore();
    await assertFails(setDoc(doc(db, "somethingElse", "x"), { a: 1 }));
    await assertFails(getDoc(doc(db, "somethingElse", "x")));
  });
});

describe("storage: timeline background images", () => {
  const png = () => new Uint8Array([137, 80, 78, 71]);
  const bg = (ctx, timeline, file = "1_bg.png") => ref(ctx.storage(), `timeline-backgrounds/${timeline}/${file}`);

  it("owner can upload an image to their own timeline, and anyone can view it", async () => {
    await assertSucceeds(uploadBytes(bg(alice(), "alice-priv"), png(), { contentType: "image/png" }));
    await assertSucceeds(getBytes(bg(anon(), "alice-priv")));
  });

  it("owner can delete their own timeline's image", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(bg(ctx, "alice-priv"), png(), { contentType: "image/png" });
    });
    await assertSucceeds(deleteObject(bg(alice(), "alice-priv")));
  });

  it("user cannot upload to or delete from another user's timeline", async () => {
    await assertFails(uploadBytes(bg(alice(), "bob-pub"), png(), { contentType: "image/png" }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(bg(ctx, "bob-pub"), png(), { contentType: "image/png" });
    });
    await assertFails(deleteObject(bg(alice(), "bob-pub")));
  });

  it("logged-out visitor cannot upload or delete", async () => {
    await assertFails(uploadBytes(bg(anon(), "alice-priv"), png(), { contentType: "image/png" }));
  });

  it("uploads must be images", async () => {
    await assertFails(uploadBytes(bg(alice(), "alice-priv", "x.html"), new Uint8Array([60, 104]), { contentType: "text/html" }));
  });

  it("uploads must be under 10 MB", async () => {
    await assertFails(uploadBytes(bg(alice(), "alice-priv", "huge.png"), new Uint8Array(11 * 1024 * 1024), { contentType: "image/png" }));
  });

  it("nothing else in the bucket can be written", async () => {
    await assertFails(uploadBytes(ref(alice().storage(), "other/file.png"), png(), { contentType: "image/png" }));
  });
});

function assertIds(snapshot, expected) {
  const actual = snapshot.docs.map((d) => d.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Expected timelines ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}
