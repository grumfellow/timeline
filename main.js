import * as d3 from 'd3';
import { db, auth } from './firebase.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';

const CREATE_TIMELINE_VALUE = "__create_new__";

const DEFAULT_TIMELINE_SETTINGS = {
  backgroundColor: "#1e293b",
  fontColor: "#e2e8f0",
  tierColors: {
    1: "#ef4444",
    2: "#3b82f6",
    3: "#10b981"
  }
};

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-");
}

function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function setupAuthModal(onAuthSuccess) {
  const openAuthBtn = document.getElementById("openAuthBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const userInfoSpan = document.getElementById("userInfo");

  const modal = document.getElementById("authModal");
  const modalTitle = document.getElementById("authModalTitle");
  const toggleModeBtn = document.getElementById("toggleAuthModeBtn");
  const form = document.getElementById("authForm");
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const submitBtn = document.getElementById("authSubmitBtn");
  const cancelBtn = document.getElementById("cancelAuthBtn");
  const errorMsg = document.getElementById("authErrorMsg");

  let isSignUpMode = false;

  function closeModal() {
    if (modal) modal.style.display = "none";
    if (form) form.reset();
    if (errorMsg) {
      errorMsg.style.display = "none";
      errorMsg.textContent = "";
    }
  }

  function openModal(signUp = false) {
    isSignUpMode = signUp;
    updateModalMode();
    if (form) form.reset();
    if (errorMsg) {
      errorMsg.style.display = "none";
      errorMsg.textContent = "";
    }
    if (modal) modal.style.display = "flex";
  }

  function updateModalMode() {
    if (isSignUpMode) {
      modalTitle.textContent = "Sign Up";
      submitBtn.textContent = "Create Account";
      toggleModeBtn.textContent = "Already have an account? Sign In";
    } else {
      modalTitle.textContent = "Sign In";
      submitBtn.textContent = "Sign In";
      toggleModeBtn.textContent = "Need an account? Sign Up";
    }
  }

  if (openAuthBtn) openAuthBtn.addEventListener("click", () => openModal(false));
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  if (toggleModeBtn) {
    toggleModeBtn.addEventListener("click", () => {
      isSignUpMode = !isSignUpMode;
      updateModalMode();
      if (errorMsg) {
        errorMsg.style.display = "none";
        errorMsg.textContent = "";
      }
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
      } catch (err) {
        console.error("Error signing out:", err);
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (errorMsg) {
        errorMsg.style.display = "none";
        errorMsg.textContent = "";
      }

      submitBtn.disabled = true;

      try {
        if (isSignUpMode) {
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
        closeModal();
      } catch (err) {
        console.error("Auth error:", err);
        let msg = err.message || "Authentication failed.";
        if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
          msg = "Invalid email or password.";
        } else if (err.code === "auth/email-already-in-use") {
          msg = "An account with this email already exists.";
        } else if (err.code === "auth/weak-password") {
          msg = "Password should be at least 6 characters.";
        }
        if (errorMsg) {
          errorMsg.textContent = msg;
          errorMsg.style.display = "block";
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // Listen for Firebase auth state updates
  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (openAuthBtn) openAuthBtn.style.display = "none";
      if (signOutBtn) signOutBtn.style.display = "inline-block";
      if (userInfoSpan) {
        userInfoSpan.textContent = `Logged in as: ${user.email}`;
        userInfoSpan.style.display = "inline-block";
      }
    } else {
      if (openAuthBtn) openAuthBtn.style.display = "inline-block";
      if (signOutBtn) signOutBtn.style.display = "none";
      if (userInfoSpan) {
        userInfoSpan.textContent = "";
        userInfoSpan.style.display = "none";
      }
    }
    if (onAuthSuccess) onAuthSuccess(user);
  });
}

// Function to add a new event document to Firestore
async function createEvent(timelineId, eventData) {
  if (!auth.currentUser) throw new Error("Must be logged in to create an event.");
  try {
    const eventsRef = collection(db, "timelines", timelineId, "events");
    const docData = {
      title: eventData.title,
      date: Timestamp.fromDate(eventData.date),
      tier: eventData.tier,
      tags: eventData.tags || []
    };
    if (eventData.endDate) {
      docData.endDate = Timestamp.fromDate(eventData.endDate);
    }

    const docRef = await addDoc(eventsRef, docData);

    console.log(`Successfully added event '${eventData.title}' with ID: ${docRef.id}`);
    return { id: docRef.id, ...eventData };
  } catch (error) {
    console.error("Error creating event in Firestore:", error);
    throw error;
  }
}

async function updateEvent(timelineId, eventId, eventData) {
  if (!auth.currentUser) throw new Error("Must be logged in to update an event.");
  try {
    const eventRef = doc(db, "timelines", timelineId, "events", eventId);
    const docData = {
      title: eventData.title,
      date: Timestamp.fromDate(eventData.date),
      tier: eventData.tier,
      tags: eventData.tags || []
    };
    if (eventData.endDate) {
      docData.endDate = Timestamp.fromDate(eventData.endDate);
    } else {
      docData.endDate = null;
    }

    await updateDoc(eventRef, docData);

    console.log(`Successfully updated event '${eventData.title}' with ID: ${eventId}`);
    return { id: eventId, ...eventData };
  } catch (error) {
    console.error("Error updating event in Firestore:", error);
    throw error;
  }
}

async function deleteEvent(timelineId, eventId) {
  if (!auth.currentUser) throw new Error("Must be logged in to delete an event.");
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
    document.getElementById("eventEndDate").value = event.endDate ? formatDateForInput(event.endDate) : "";
    document.getElementById("eventTier").value = String(event.tier);
    document.getElementById("eventTags").value = (event.tags || []).join(", ");
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
    const endDateInput = document.getElementById("eventEndDate").value;
    const tierInput = Number(document.getElementById("eventTier").value) || 1;
    const tagsInput = document.getElementById("eventTags").value
      .split(",")
      .map(t => t.trim())
      .filter(t => t.length > 0);

    if (!titleInput || !dateInput) return;

    const [year, month, day] = dateInput.split("-");
    const eventDate = new Date(year, month - 1, day);

    let eventEndDate = null;
    if (endDateInput) {
      const [ey, em, ed] = endDateInput.split("-");
      eventEndDate = new Date(ey, em - 1, ed);
    }

    const payload = { 
      title: titleInput, 
      date: eventDate, 
      endDate: eventEndDate,
      tier: tierInput, 
      tags: tagsInput 
    };

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

async function createTimeline(title, settings = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Must be logged in to create a timeline.");

  const cleanTitle = title.trim();
  const timelineId = slugify(cleanTitle);
  if (!timelineId) throw new Error("Invalid timeline title");

  const timelineRef = doc(db, "timelines", timelineId);
  await setDoc(timelineRef, {
    title: cleanTitle,
    ownerEmail: currentUser.email,
    isPublic: settings.isPublic === true,
    createdAt: Timestamp.now(),
    settings: {
      backgroundColor: settings.backgroundColor || DEFAULT_TIMELINE_SETTINGS.backgroundColor,
      fontColor: settings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor,
      tierColors: {
        1: (settings.tierColors?.[1] || DEFAULT_TIMELINE_SETTINGS.tierColors[1]),
        2: (settings.tierColors?.[2] || DEFAULT_TIMELINE_SETTINGS.tierColors[2]),
        3: (settings.tierColors?.[3] || DEFAULT_TIMELINE_SETTINGS.tierColors[3])
      }
    }
  }, { merge: true });

  console.log(`Successfully created timeline '${cleanTitle}' with ID: ${timelineId}`);
  return timelineId;
}

async function updateTimelineSettings(timelineId, updates) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Must be logged in to update timeline settings.");

  const meta = timelineMetaMap.get(timelineId);
  if (!meta || meta.ownerEmail !== currentUser.email) {
    throw new Error("Only the owner can update this timeline.");
  }

  const payload = { updatedAt: Timestamp.now() };

  if (typeof updates.title === "string") {
    const cleanTitle = updates.title.trim();
    if (!cleanTitle) throw new Error("Invalid timeline title");
    payload.title = cleanTitle;
  }

  if (typeof updates.isPublic === "boolean") {
    payload.isPublic = updates.isPublic;
  }

  if (updates.settings) {
    payload.settings = {
      backgroundColor: updates.settings.backgroundColor || meta.settings?.backgroundColor || DEFAULT_TIMELINE_SETTINGS.backgroundColor,
      fontColor: updates.settings.fontColor || meta.settings?.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor,
      tierColors: {
        1: updates.settings.tierColors?.[1] || meta.settings?.tierColors?.[1] || DEFAULT_TIMELINE_SETTINGS.tierColors[1],
        2: updates.settings.tierColors?.[2] || meta.settings?.tierColors?.[2] || DEFAULT_TIMELINE_SETTINGS.tierColors[2],
        3: updates.settings.tierColors?.[3] || meta.settings?.tierColors?.[3] || DEFAULT_TIMELINE_SETTINGS.tierColors[3]
      }
    };
  }

  const timelineRef = doc(db, "timelines", timelineId);
  await updateDoc(timelineRef, payload);

  if (meta) {
    if (payload.title) meta.title = payload.title;
    if (payload.isPublic !== undefined) meta.isPublic = payload.isPublic;
    if (payload.settings) meta.settings = payload.settings;
  }
}

function setupTimelineModal(onTimelineCreated, onTimelineRenamed) {
  const modal = document.getElementById("timelineModal");
  const modalTitle = document.getElementById("timelineModalTitle");
  const form = document.getElementById("timelineForm");
  const cancelBtn = document.getElementById("cancelTimelineBtn");
  const submitBtn = document.getElementById("createTimelineBtn");
  const titleInput = document.getElementById("timelineTitle");

  if (!modal || !form) return null;

  let restoreTimelineId = null;
  let renamingTimelineId = null;

  function close(restoreSelection = true) {
    modal.style.display = "none";
    form.reset();
    renamingTimelineId = null;
    if (modalTitle) modalTitle.textContent = "Create New Timeline";
    if (submitBtn) submitBtn.textContent = "Save";

    if (restoreSelection && restoreTimelineId) {
      const selectEl = document.getElementById("timelineSelect");
      if (selectEl) selectEl.value = restoreTimelineId;
    }
  }

  const publicInput = document.getElementById("timelinePublicInput");
  const backgroundInput = document.getElementById("timelineBackgroundColor");
  const fontColorInput = document.getElementById("timelineFontColor");
  const tier1Input = document.getElementById("tier1Color");
  const tier2Input = document.getElementById("tier2Color");
  const tier3Input = document.getElementById("tier3Color");

  function setTimelineInputs(settings = DEFAULT_TIMELINE_SETTINGS, isPublic = false, title = "") {
    if (titleInput) titleInput.value = title;
    if (publicInput) publicInput.checked = isPublic;
    if (backgroundInput) backgroundInput.value = settings.backgroundColor || DEFAULT_TIMELINE_SETTINGS.backgroundColor;
    if (fontColorInput) fontColorInput.value = settings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor;
    if (tier1Input) tier1Input.value = settings.tierColors?.[1] || DEFAULT_TIMELINE_SETTINGS.tierColors[1];
    if (tier2Input) tier2Input.value = settings.tierColors?.[2] || DEFAULT_TIMELINE_SETTINGS.tierColors[2];
    if (tier3Input) tier3Input.value = settings.tierColors?.[3] || DEFAULT_TIMELINE_SETTINGS.tierColors[3];
  }

  function openCreate(previousTimelineId) {
    renamingTimelineId = null;
    restoreTimelineId = previousTimelineId || null;
    setTimelineInputs(DEFAULT_TIMELINE_SETTINGS, false, "");
    if (modalTitle) modalTitle.textContent = "Create New Timeline";
    if (submitBtn) submitBtn.textContent = "Create";
    modal.style.display = "flex";
    titleInput?.focus();
  }

  function openRename(timelineId, currentTitle) {
    renamingTimelineId = timelineId;
    restoreTimelineId = timelineId;
    const meta = timelineMetaMap.get(timelineId);
    const settings = meta?.settings || DEFAULT_TIMELINE_SETTINGS;
    const isPublic = meta?.isPublic === true;
    setTimelineInputs(settings, isPublic, currentTitle || "");
    if (modalTitle) modalTitle.textContent = "Edit Timeline";
    if (submitBtn) submitBtn.textContent = "Save";
    modal.style.display = "flex";
    titleInput?.focus();
  }

  if (cancelBtn) cancelBtn.addEventListener("click", () => close(true));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const val = titleInput.value.trim();
    if (!val) return;

    const settings = {
      backgroundColor: backgroundInput?.value || DEFAULT_TIMELINE_SETTINGS.backgroundColor,
      fontColor: fontColorInput?.value || DEFAULT_TIMELINE_SETTINGS.fontColor,
      tierColors: {
        1: tier1Input?.value || DEFAULT_TIMELINE_SETTINGS.tierColors[1],
        2: tier2Input?.value || DEFAULT_TIMELINE_SETTINGS.tierColors[2],
        3: tier3Input?.value || DEFAULT_TIMELINE_SETTINGS.tierColors[3]
      }
    };

    const timelineData = {
      title: val,
      isPublic: publicInput?.checked === true,
      settings
    };

    try {
      if (renamingTimelineId) {
        await updateTimelineSettings(renamingTimelineId, timelineData);
        const targetId = renamingTimelineId;
        close(false);
        if (onTimelineRenamed) onTimelineRenamed(targetId);
      } else {
        const newTimelineId = await createTimeline(val, timelineData);
        close(false);
        if (onTimelineCreated) onTimelineCreated(newTimelineId);
      }
    } catch (err) {
      alert(`Failed to ${renamingTimelineId ? "save" : "create"} timeline. Check console for details.`);
    }
  });

  return { openCreate, openRename };
}

// Helper to update controls (add event, import CSV, rename, public checkbox) based on current user ownership
function updateUIForTimelineOwner(timelineId) {
  const currentUser = auth.currentUser;
  const userEmail = currentUser ? currentUser.email : null;
  const meta = timelineMetaMap.get(timelineId);

  const isOwner = Boolean(currentUser && meta && meta.ownerEmail === userEmail);

  // Toggle buttons for adding events / CSV import / rename
  const openAddEventBtn = document.getElementById("openAddEventBtn");
  const openImportCsvBtn = document.getElementById("openImportCsvBtn");
  const renameTimelineBtn = document.getElementById("renameTimelineBtn");

  if (openAddEventBtn) openAddEventBtn.style.display = isOwner ? "inline-block" : "none";
  if (openImportCsvBtn) openImportCsvBtn.style.display = isOwner ? "inline-block" : "none";
  if (renameTimelineBtn) renameTimelineBtn.style.display = isOwner ? "inline-block" : "none";

  // Timeline public checkbox control
  const visibilityContainer = document.getElementById("timelineVisibilityContainer");
  const publicCheckbox = document.getElementById("timelinePublicCheckbox");

  if (visibilityContainer && publicCheckbox) {
    if (isOwner && meta) {
      visibilityContainer.style.display = "flex";
      publicCheckbox.checked = meta.isPublic === true;
    } else {
      visibilityContainer.style.display = "none";
    }
  }
}
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

      const rawEndDate = data.endDate || data.end_date;
      let parsedEndDate = null;
      if (rawEndDate) {
        const d = rawEndDate?.toDate ? rawEndDate.toDate() : new Date(rawEndDate);
        if (!isNaN(d.getTime())) parsedEndDate = d;
      }

      const rawTags = Array.isArray(data.tags) 
        ? data.tags 
        : (typeof data.tags === 'string' ? data.tags.split(',') : []);
      const tags = rawTags.map(t => String(t).trim()).filter(Boolean);

      eventsData.push({
        id: doc.id,
        title: data.title || "Untitled Event",
        date: parsedDate,
        endDate: parsedEndDate,
        tier: Number(data.tier) || 1,
        tags: tags
      });
    });

    return eventsData;
  } catch (error) {
    console.error(`Error loading timeline '${timelineId}':`, error);
    return [];
  }
}

// Map of loaded timeline metadata by timelineId
let timelineMetaMap = new Map();
let currentTimelineSettings = { ...DEFAULT_TIMELINE_SETTINGS };

// Fetch all timeline documents from Firestore and populate the dropdown based on user permissions
async function loadTimelineOptions(selectedId = null) {
  const selectEl = document.getElementById("timelineSelect");
  if (!selectEl) return null;

  const currentUser = auth.currentUser;
  const userEmail = currentUser ? currentUser.email : null;

  try {
    const timelinesSnapshot = await getDocs(collection(db, "timelines"));

    selectEl.innerHTML = "";
    timelineMetaMap.clear();

    let firstTimelineId = null;

    timelinesSnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const ownerEmail = data.ownerEmail || null;
      const isPublic = data.isPublic === true;
      const savedSettings = data.settings || {};
      const tierColors = {
        1: savedSettings.tierColors?.[1] || DEFAULT_TIMELINE_SETTINGS.tierColors[1],
        2: savedSettings.tierColors?.[2] || DEFAULT_TIMELINE_SETTINGS.tierColors[2],
        3: savedSettings.tierColors?.[3] || DEFAULT_TIMELINE_SETTINGS.tierColors[3]
      };

      timelineMetaMap.set(docSnap.id, {
        id: docSnap.id,
        title: data.title || docSnap.id,
        ownerEmail: ownerEmail,
        isPublic: isPublic,
        settings: {
          backgroundColor: savedSettings.backgroundColor || DEFAULT_TIMELINE_SETTINGS.backgroundColor,
          fontColor: savedSettings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor,
          tierColors
        }
      });

      // Filter timelines: show if public OR if owned by current logged in user
      const canView = isPublic || (userEmail && ownerEmail === userEmail);

      if (canView) {
        const option = document.createElement("option");
        option.value = docSnap.id;
        option.textContent = data.title || docSnap.id;
        selectEl.appendChild(option);

        if (!firstTimelineId) {
          firstTimelineId = docSnap.id;
        }
      }
    });

    // Option to create new timeline (only if user is logged in)
    if (currentUser) {
      const createOption = document.createElement("option");
      createOption.value = CREATE_TIMELINE_VALUE;
      createOption.textContent = "+ Create New Timeline...";
      selectEl.appendChild(createOption);
    }

    if (selectEl.options.length === 0) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "No timelines available";
      selectEl.appendChild(emptyOption);
      return null;
    }

    let idToSelect = null;
    if (selectedId && selectedId !== CREATE_TIMELINE_VALUE) {
      // Verify if user can access the selectedId
      const meta = timelineMetaMap.get(selectedId);
      if (meta && (meta.isPublic || (userEmail && meta.ownerEmail === userEmail))) {
        idToSelect = selectedId;
      }
    }

    if (!idToSelect) {
      idToSelect = firstTimelineId;
    }

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
    const dateObj = parseEventDate(row.date || row.start_date);

    if (!dateObj) {
      results.skipped++;
      results.skippedRows.push(`"${title}" (invalid date: "${row.date || row.start_date || ""}")`);
      continue;
    }

    const endDateObj = parseEventDate(row.end_date || row.enddate);

    const tags = (row.tags || row.tag || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);

    validEvents.push({
      title,
      date: dateObj,
      endDate: endDateObj,
      tier: Number(row.tier) || 1,
      tags
    });
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < validEvents.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = validEvents.slice(i, i + BATCH_SIZE);

        for (const event of chunk) {
            const eventRef = doc(collection(db, "timelines", timelineId, "events"));
      const docData = {
        title: event.title,
        date: Timestamp.fromDate(event.date),
        tier: event.tier,
        tags: event.tags || []
      };
      if (event.endDate) {
        docData.endDate = Timestamp.fromDate(event.endDate);
      }
      batch.set(eventRef, docData);
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
let width = container.clientWidth;
let height = container.clientHeight;
const margin = { top: 40, right: 40, bottom: 60, left: 40 };

const svg = d3.select("#timeline-container")
  .append("svg")
  .attr("width", width)
  .attr("height", height);

let axisY = height - margin.bottom;

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
    const startX = scale(d.date);
    const endX = d.endDate ? scale(d.endDate) : startX;
    const isRange = d.endDate && endX > startX;

    // Anchor point for leader line: mid-point if range, startX if single date
    const targetX = isRange ? (startX + endX) / 2 : startX;

    // Boundary for horizontal collision avoidance
    const minLeft = Math.min(startX, endX) - 10;
    const maxRight = Math.max(startX, endX) + 10 + textW + horizontalBuffer;

    return {
      ...d,
      targetX,
      startX,
      endX,
      isRange,
      left: minLeft,
      right: maxRight,
      y: baseY
    };
  });

  items.sort((a, b) => a.startX - b.startX);

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
  let activeTimelineId = null;
  let previousTimelineId = null;
  let eventsData = [];
  let currentTransform = d3.zoomIdentity;
  let selectedTags = new Set();

  const keywordInput = document.getElementById("keywordFilterInput");
  const tagFilterContainer = document.getElementById("tagFilterContainer");
  const publicCheckbox = document.getElementById("timelinePublicCheckbox");

  if (publicCheckbox) {
    publicCheckbox.addEventListener("change", async (e) => {
      if (!activeTimelineId || !auth.currentUser) return;
      const isChecked = e.target.checked;
      try {
        const timelineRef = doc(db, "timelines", activeTimelineId);
        await updateDoc(timelineRef, { isPublic: isChecked });
        const meta = timelineMetaMap.get(activeTimelineId);
        if (meta) meta.isPublic = isChecked;
      } catch (err) {
        console.error("Error updating timeline public status:", err);
        alert("Failed to update timeline visibility.");
        e.target.checked = !isChecked;
      }
    });
  }

  setupAuthModal(async (user) => {
    activeTimelineId = await loadTimelineOptions(activeTimelineId);
    previousTimelineId = activeTimelineId;
    updateUIForTimelineOwner(activeTimelineId);
    applyTimelineStyles(timelineMetaMap.get(activeTimelineId));
    eventsData = activeTimelineId ? await loadEvents(activeTimelineId) : [];
    refreshChart(eventsData);
  });

  function applyTimelineStyles(meta) {
    const settings = meta?.settings || DEFAULT_TIMELINE_SETTINGS;
    currentTimelineSettings = {
      ...DEFAULT_TIMELINE_SETTINGS,
      ...settings,
      tierColors: {
        ...DEFAULT_TIMELINE_SETTINGS.tierColors,
        ...(settings.tierColors || {})
      }
    };

    const containerEl = document.getElementById("timeline-container");
    const titleEl = document.querySelector("h2");
    if (containerEl) containerEl.style.background = currentTimelineSettings.backgroundColor;
    if (titleEl) titleEl.style.color = currentTimelineSettings.fontColor;
    // Update axis colors immediately
    try {
      gAxis.selectAll("text").style("fill", currentTimelineSettings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor);
      gAxis.selectAll("path, line").style("stroke", currentTimelineSettings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor);

      // Update existing event nodes (circles, range lines, and labels)
      if (gEvents) {
        gEvents.selectAll('.event-node').select('circle')
          .style('fill', d => (currentTimelineSettings.tierColors?.[d.tier] || DEFAULT_TIMELINE_SETTINGS.tierColors[d.tier]))
          .style('stroke', d => (currentTimelineSettings.tierColors?.[d.tier] || DEFAULT_TIMELINE_SETTINGS.tierColors[d.tier]));

        gEvents.selectAll('.event-node').select('line.range-line')
          .style('stroke', d => (currentTimelineSettings.tierColors?.[d.tier] || DEFAULT_TIMELINE_SETTINGS.tierColors[d.tier]));

        gEvents.selectAll('.event-node').select('text')
          .style('fill', currentTimelineSettings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor);
      }
    } catch (err) {
      // Non-fatal: if selections aren't ready yet, ignore.
      console.warn('applyTimelineStyles: failed to update svg nodes immediately', err);
    }
  }

  function renderTagBadges() {
    if (!tagFilterContainer) return;
    tagFilterContainer.innerHTML = "";

    // Extract all unique tags across events in the timeline
    const allTags = new Set();
    eventsData.forEach(event => {
      (event.tags || []).forEach(tag => allTags.add(tag));
    });

    const sortedTags = Array.from(allTags).sort((a, b) => a.localeCompare(b));

    if (sortedTags.length === 0) {
      tagFilterContainer.innerHTML = `<span style="font-size: 12px; color: #64748b;">No tags</span>`;
      selectedTags.clear();
      return;
    }

    sortedTags.forEach(tag => {
      const badge = document.createElement("span");
      badge.className = `tag-badge${selectedTags.has(tag) ? " active" : ""}`;
      badge.textContent = tag;

      badge.addEventListener("click", () => {
        if (selectedTags.has(tag)) {
          selectedTags.delete(tag);
        } else {
          selectedTags.add(tag);
        }
        renderTagBadges();
        renderCurrentTimeline();
      });

      tagFilterContainer.appendChild(badge);
    });
  }

  function getFilteredEvents() {
    let filtered = eventsData;

        // Filter by selected tags (match events that contain AT LEAST ONE selected tag)
    if (selectedTags.size > 0) {
      filtered = filtered.filter(event => {
        const eventTags = new Set((event.tags || []).map(t => t.toLowerCase()));
        return Array.from(selectedTags).some(tag => eventTags.has(tag.toLowerCase()));
      });
    }

    // Filter by keyword query
    const query = keywordInput ? keywordInput.value.trim().toLowerCase() : "";
    if (query) {
      filtered = filtered.filter(d => 
        d.title.toLowerCase().includes(query) ||
        (d.tags || []).some(t => t.toLowerCase().includes(query))
      );
    }

    return filtered;
  }

  function renderCurrentTimeline() {
    const filtered = getFilteredEvents();
    const currentScale = currentTransform.rescaleX(xBaseScale);
    updateTimeline(currentScale, currentTransform.k, filtered);
  }

  function refreshChart(data) {
    selectedTags.clear();
    renderTagBadges();
    applyTimelineStyles(timelineMetaMap.get(activeTimelineId));

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
  const renameTimelineBtn = document.getElementById("renameTimelineBtn");

  const timelineModal = setupTimelineModal(
    async (newTimelineId) => {
      activeTimelineId = newTimelineId;
      previousTimelineId = newTimelineId;
      await loadTimelineOptions(newTimelineId);
      updateUIForTimelineOwner(activeTimelineId);
      // apply styles for the newly created timeline and refresh view
      applyTimelineStyles(timelineMetaMap.get(activeTimelineId));
      eventsData = [];
      refreshChart(eventsData);
    },
    async (renamedTimelineId) => {
      await loadTimelineOptions(renamedTimelineId);
      updateUIForTimelineOwner(renamedTimelineId);
      // Immediately apply updated settings and refresh events
      applyTimelineStyles(timelineMetaMap.get(renamedTimelineId));
      eventsData = renamedTimelineId ? await loadEvents(renamedTimelineId) : [];
      refreshChart(eventsData);
    }
  );

  if (renameTimelineBtn) {
    renameTimelineBtn.addEventListener("click", () => {
      if (!activeTimelineId) return;
      const meta = timelineMetaMap.get(activeTimelineId);
      if (timelineModal && meta) {
        timelineModal.openRename(activeTimelineId, meta.title);
      }
    });
  }

  if (selectEl) {
    selectEl.addEventListener("change", async (e) => {
      const selected = e.target.value;

      if (selected === CREATE_TIMELINE_VALUE) {
        if (timelineModal) timelineModal.openCreate(previousTimelineId);
        return;
      }

      previousTimelineId = selected;
      activeTimelineId = selected;
      updateUIForTimelineOwner(activeTimelineId);
      applyTimelineStyles(timelineMetaMap.get(activeTimelineId));
      eventsData = activeTimelineId ? await loadEvents(activeTimelineId) : [];
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

    window.addEventListener("resize", () => {
    width = container.clientWidth;
    height = container.clientHeight;
    axisY = height - margin.bottom;

    svg.attr("width", width).attr("height", height);
    xBaseScale.range([margin.left, width - margin.right]);
    gAxis.attr("transform", `translate(0, ${axisY})`);
    zoom.extent([[margin.left, 0], [width - margin.right, height]])
        .translateExtent([[margin.left, -Infinity], [width - margin.right, Infinity]]);

    renderCurrentTimeline();
  });

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
  gAxis.selectAll("text").attr("fill", currentTimelineSettings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor);
  gAxis.selectAll("path, line").attr("stroke", currentTimelineSettings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor);

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

  // Dot for single events
  enterNodes.append("circle");

  // Line segment for range events
  enterNodes.append("line")
    .attr("class", "range-line");
  
  enterNodes.append("text")
    .attr("class", "event-label")
    .attr("dy", "0.35em");

  const allNodes = enterNodes.merge(nodes);

  // Toggle circle vs range-line visibility based on whether event has a range
  allNodes.select("circle")
    .style("display", d => d.isRange ? "none" : "block")
    .style("fill", d => currentTimelineSettings.tierColors[d.tier] || DEFAULT_TIMELINE_SETTINGS.tierColors[d.tier])
    .style("stroke", d => currentTimelineSettings.tierColors[d.tier] || DEFAULT_TIMELINE_SETTINGS.tierColors[d.tier]);

  allNodes.select("line.range-line")
    .style("display", d => d.isRange ? "block" : "none")
    .attr("x1", d => d.startX - d.targetX)
    .attr("y1", 0)
    .attr("x2", d => d.endX - d.targetX)
    .attr("y2", 0)
    .style("stroke", d => currentTimelineSettings.tierColors[d.tier] || DEFAULT_TIMELINE_SETTINGS.tierColors[d.tier]);

  allNodes.select("text")
    .text(d => d.title)
    .attr("x", d => d.isRange ? (d.endX - d.targetX) + 8 : 8)
    .style("fill", currentTimelineSettings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor);

  allNodes
    .attr("class", d => `event-node event-tier-${d.tier}`)
    .attr("transform", d => `translate(${d.targetX}, ${d.y})`);

    const handleEventClick = (event, d) => {
    event.stopPropagation();
    const currentUser = auth.currentUser;
    const userEmail = currentUser ? currentUser.email : null;
    const selectEl = document.getElementById("timelineSelect");
    const currentTimelineId = selectEl ? selectEl.value : null;
    const meta = currentTimelineId ? timelineMetaMap.get(currentTimelineId) : null;
    const isOwner = Boolean(currentUser && meta && meta.ownerEmail === userEmail);

    if (isOwner && openEditEventModal) {
      openEditEventModal(d);
    }
  };

    allNodes.select("circle")
    .style("cursor", "pointer")
    .on("click", handleEventClick);

  allNodes.select("line.range-line")
    .style("cursor", "pointer")
    .on("click", handleEventClick);

  allNodes.select("text")
    .style("cursor", "pointer")
    .on("click", handleEventClick);
}
