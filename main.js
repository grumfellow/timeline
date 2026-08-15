import * as d3 from 'd3';
import { db, auth, storage } from './firebase.js';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
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

// URL parameter management for bookmarking/sharing timelines
function getTimelineIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('timeline') || null;
}

function setTimelineUrlParam(timelineId) {
  if (!timelineId) return;
  const params = new URLSearchParams(window.location.search);
  params.set('timeline', timelineId);
  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({ timelineId }, '', newUrl);
}

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-");
}

function formatDateForInput(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");

  if (y <= 0) {
    const bcYear = Math.abs(y - 1);
    return `${bcYear}-${m}-${d} BC`;
  }
  return `${y}-${m}-${d}`;
}

function createUTCDate(year, month = 0, day = 1) {
  const dateObj = new Date(Date.UTC(0, 0, 1));
  dateObj.setUTCFullYear(year, month, day);
  return dateObj;
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
      date: eventData.date instanceof Date ? eventData.date.toISOString() : String(eventData.date),
      tier: eventData.tier,
      tags: eventData.tags || []
    };
    if (eventData.endDate) {
      docData.endDate = eventData.endDate instanceof Date ? eventData.endDate.toISOString() : String(eventData.endDate);
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
      date: eventData.date instanceof Date ? eventData.date.toISOString() : String(eventData.date),
      tier: eventData.tier,
      tags: eventData.tags || []
    };
    if (eventData.endDate) {
      docData.endDate = eventData.endDate instanceof Date ? eventData.endDate.toISOString() : String(eventData.endDate);
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

    const eventDate = parseEventDate(dateInput);
    if (!eventDate) {
      alert("Invalid start date. Use YYYY-MM-DD or YYYY BC.");
      return;
    }

    let eventEndDate = null;
    if (endDateInput) {
      eventEndDate = parseEventDate(endDateInput);
      if (!eventEndDate) {
        alert("Invalid end date. Use YYYY-MM-DD or YYYY BC.");
        return;
      }
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
  if (!cleanTitle) throw new Error("Invalid timeline title");

  // Use addDoc to let Firestore generate a unique GUID instead of using slugified name
  const timelinesRef = collection(db, "timelines");
  const docRef = await addDoc(timelinesRef, {
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
  });

  const timelineId = docRef.id;
  console.log(`Successfully created timeline '${cleanTitle}' with ID: ${timelineId}`);
  return timelineId;
}

async function uploadBackgroundImage(file, timelineId) {
  try {
    const ts = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-_]/g, '_');
    const path = `timeline-backgrounds/${timelineId}/${ts}_${safeName}`;
    const storageReference = storageRef(storage, path);
    await uploadBytes(storageReference, file, { contentType: file.type });
    const url = await getDownloadURL(storageReference);
    return url;
  } catch (err) {
    console.error('Failed to upload background image:', err);
    throw err;
  }
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
      backgroundImageUrl: (updates.settings.backgroundImageUrl !== undefined) ? updates.settings.backgroundImageUrl : (meta.settings?.backgroundImageUrl || null),
      backgroundImageMode: (updates.settings.backgroundImageMode !== undefined) ? updates.settings.backgroundImageMode : (meta.settings?.backgroundImageMode || 'stretch'),
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

async function loadUserTimelineView(timelineId) {
  const currentUser = auth.currentUser;
  if (!currentUser || !timelineId) return null;

  try {
    const viewDoc = await getDoc(doc(db, "users", currentUser.uid, "timelineViews", timelineId));
    if (!viewDoc.exists()) return null;
    return viewDoc.data();
  } catch (err) {
    console.error("Error loading user timeline view:", err);
    return null;
  }
}

async function saveUserTimelineView(timelineId) {
  const currentUser = auth.currentUser;
  if (!currentUser || !timelineId) return;

  const viewData = {
    zoom: {
      k: currentTransform.k,
      x: currentTransform.x
    },
    savedAt: Timestamp.now()
  };

  if (lastSavedView && lastSavedView.k === viewData.zoom.k && lastSavedView.x === viewData.zoom.x) {
    return;
  }

  lastSavedView = { ...viewData.zoom };

  try {
    const viewRef = doc(db, "users", currentUser.uid, "timelineViews", timelineId);
    await setDoc(viewRef, viewData, { merge: true });
  } catch (err) {
    console.error("Error saving user timeline view:", err);
  }
}

function scheduleSaveUserTimelineView(timelineId) {
  if (zoomSaveTimeout) {
    clearTimeout(zoomSaveTimeout);
  }

  zoomSaveTimeout = setTimeout(() => {
    saveUserTimelineView(timelineId).catch(() => {});
    zoomSaveTimeout = null;
  }, 700);
}

// Delete a timeline and all its associated data
async function deleteTimeline(timelineId) {
  if (!auth.currentUser) throw new Error("Must be logged in to delete a timeline.");
  
  try {
    // Delete all events in this timeline
    const eventsRef = collection(db, "timelines", timelineId, "events");
    const eventsSnapshot = await getDocs(eventsRef);
    
    const batch = writeBatch(db);
    eventsSnapshot.forEach((eventDoc) => {
      batch.delete(eventDoc.ref);
    });
    
    // Delete all user timeline views
    const viewsRef = collection(db, "userTimelineViews");
    const viewsQuery = getDocs(viewsRef);
    (await viewsQuery).forEach((viewDoc) => {
      if (viewDoc.data().timelineId === timelineId) {
        batch.delete(viewDoc.ref);
      }
    });
    
    // Delete the timeline document itself
    batch.delete(doc(db, "timelines", timelineId));
    
    await batch.commit();
    console.log(`Successfully deleted timeline '${timelineId}' and all associated data`);
  } catch (error) {
    console.error(`Error deleting timeline '${timelineId}':`, error);
    throw error;
  }
}

function setupTimelineModal(onTimelineCreated, onTimelineRenamed) {
  const modal = document.getElementById("timelineModal");
  const modalTitle = document.getElementById("timelineModalTitle");
  const form = document.getElementById("timelineForm");
  const cancelBtn = document.getElementById("cancelTimelineBtn");
  const submitBtn = document.getElementById("createTimelineBtn");
  const deleteBtn = document.getElementById("deleteTimelineBtn");
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
    if (deleteBtn) deleteBtn.style.display = "none";

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
  const bgFileInput = document.getElementById('timelineBgFile');
  const bgModeSelect = document.getElementById('timelineBgMode');
  const bgPreview = document.getElementById('timelineBgPreview');
  const bgRemoveBtn = document.getElementById('timelineBgRemoveBtn');

  let selectedBgFile = null;
  let existingBgUrl = null;

  function setTimelineInputs(settings = DEFAULT_TIMELINE_SETTINGS, isPublic = false, title = "") {
    if (titleInput) titleInput.value = title;
    if (publicInput) publicInput.checked = isPublic;
    if (backgroundInput) backgroundInput.value = settings.backgroundColor || DEFAULT_TIMELINE_SETTINGS.backgroundColor;
    if (fontColorInput) fontColorInput.value = settings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor;
    if (tier1Input) tier1Input.value = settings.tierColors?.[1] || DEFAULT_TIMELINE_SETTINGS.tierColors[1];
    if (tier2Input) tier2Input.value = settings.tierColors?.[2] || DEFAULT_TIMELINE_SETTINGS.tierColors[2];
    if (tier3Input) tier3Input.value = settings.tierColors?.[3] || DEFAULT_TIMELINE_SETTINGS.tierColors[3];
    // background image handling
    existingBgUrl = settings.backgroundImageUrl || null;
    if (bgModeSelect) bgModeSelect.value = settings.backgroundImageMode || 'stretch';
    if (bgPreview) {
      if (existingBgUrl) {
        bgPreview.src = existingBgUrl;
        bgPreview.style.display = 'block';
        if (bgRemoveBtn) bgRemoveBtn.style.display = 'inline-block';
      } else {
        bgPreview.src = '';
        bgPreview.style.display = 'none';
        if (bgRemoveBtn) bgRemoveBtn.style.display = 'none';
      }
    }
    if (bgFileInput) bgFileInput.value = '';
    selectedBgFile = null;
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
    if (deleteBtn) deleteBtn.style.display = "inline-block";
    modal.style.display = "flex";
    titleInput?.focus();
  }

  if (cancelBtn) cancelBtn.addEventListener("click", () => close(true));

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (!renamingTimelineId) return;
      
      const meta = timelineMetaMap.get(renamingTimelineId);
      const timelineName = meta?.title || renamingTimelineId;
      
      // Confirmation dialog
      const confirmed = confirm(
        `Are you sure you want to delete "${timelineName}"?\n\nThis will permanently delete the timeline and all its events. This action cannot be undone.`
      );
      
      if (!confirmed) return;
      
      try {
        deleteBtn.disabled = true;
        deleteBtn.textContent = "Deleting...";
        
        await deleteTimeline(renamingTimelineId);
        
        // Close modal
        close(false);
        
        // Clear active timeline and events
        activeTimelineId = null;
        eventsData = [];
        
        // Reload timeline options without selecting any
        const selectEl = document.getElementById("timelineSelect");
        if (selectEl) {
          selectEl.value = "";
        }
        await loadTimelineOptions(null);
        
        // Clear UI for no timeline selected
        updateUIForTimelineOwner(null);
        refreshChart([]);
      } catch (err) {
        console.error("Error deleting timeline:", err);
        alert("Failed to delete timeline. Please try again.");
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete Timeline";
      }
    });
  }

  if (bgFileInput) {
    bgFileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      selectedBgFile = f;
      const reader = new FileReader();
      reader.onload = () => {
        if (bgPreview) {
          bgPreview.src = reader.result;
          bgPreview.style.display = 'block';
        }
        if (bgRemoveBtn) bgRemoveBtn.style.display = 'inline-block';
      };
      reader.readAsDataURL(f);
    });
  }

  if (bgRemoveBtn) {
    bgRemoveBtn.addEventListener('click', () => {
      selectedBgFile = null;
      existingBgUrl = null;
      if (bgPreview) { bgPreview.src = ''; bgPreview.style.display = 'none'; }
      if (bgFileInput) bgFileInput.value = '';
      bgRemoveBtn.style.display = 'none';
    });
  }
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
      submitBtn.disabled = true;

      // If a file was selected, upload it first so we can include URL in the initial settings
      if (selectedBgFile) {
        try {
          const uploadTargetId = renamingTimelineId || slugify(val);
          const uploadedUrl = await uploadBackgroundImage(selectedBgFile, uploadTargetId);
          timelineData.settings.backgroundImageUrl = uploadedUrl;
          timelineData.settings.backgroundImageMode = bgModeSelect?.value || 'stretch';
        } catch (uploadErr) {
          console.error('Background upload failed:', uploadErr);
          alert('Failed to upload background image. Please try again.');
          submitBtn.disabled = false;
          return;
        }
      } else if (existingBgUrl === null) {
        // explicitly removed image
        timelineData.settings.backgroundImageUrl = null;
        timelineData.settings.backgroundImageMode = null;
      } else if (existingBgUrl) {
        timelineData.settings.backgroundImageUrl = existingBgUrl;
        timelineData.settings.backgroundImageMode = bgModeSelect?.value || 'stretch';
      }

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
      console.error('Failed to save timeline:', err);
      alert(`Failed to ${renamingTimelineId ? "save" : "create"} timeline. Check console for details.`);
    } finally {
      submitBtn.disabled = false;
    }
  });

  return { openCreate, openRename };
}

// Helper to update controls (add event, import CSV, AI import, rename, public checkbox) based on current user ownership
function updateUIForTimelineOwner(timelineId) {
  const currentUser = auth.currentUser;
  const userEmail = currentUser ? currentUser.email : null;
  const meta = timelineMetaMap.get(timelineId);

  const isOwner = Boolean(currentUser && meta && meta.ownerEmail === userEmail);

  // Toggle buttons for adding events / CSV import / AI import / rename
  const openAddEventBtn = document.getElementById("openAddEventBtn");
  const openImportCsvBtn = document.getElementById("openImportCsvBtn");
  const openAiImportBtn = document.getElementById("openAiImportBtn");
  const renameTimelineBtn = document.getElementById("renameTimelineBtn");
  const shareTimelineBtn = document.getElementById("shareTimelineBtn");

  if (openAddEventBtn) openAddEventBtn.style.display = isOwner ? "inline-block" : "none";
  if (openImportCsvBtn) openImportCsvBtn.style.display = isOwner ? "inline-block" : "none";
  if (openAiImportBtn) openAiImportBtn.style.display = isOwner ? "inline-block" : "none";
  if (renameTimelineBtn) renameTimelineBtn.style.display = isOwner ? "inline-block" : "none";
  // Share button is visible to all users who can view this timeline
  if (shareTimelineBtn) shareTimelineBtn.style.display = timelineId ? "inline-block" : "none";

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
      let parsedDate = null;

      if (rawDate?.toDate) {
        parsedDate = rawDate.toDate();
      } else if (typeof rawDate === 'string') {
        parsedDate = parseEventDate(rawDate) || new Date(rawDate);
      } else {
        parsedDate = new Date(rawDate);
      }
      if (!parsedDate || isNaN(parsedDate.getTime())) return;

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
let currentFontSize = 11;
let currentTransform = d3.zoomIdentity;
let zoomSaveTimeout = null;
let lastSavedView = null;

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
          backgroundImageUrl: savedSettings.backgroundImageUrl || null,
          backgroundImageMode: savedSettings.backgroundImageMode || 'stretch',
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
  const upperTrimmed = trimmed.toUpperCase();
  const bcMatch = upperTrimmed.match(/\s*(BC|BCE)$/);
  const adMatch = upperTrimmed.match(/\s*(AD|CE)$/);
  const isBC = Boolean(bcMatch);
  const isAD = Boolean(adMatch);
  const cleaned = trimmed.replace(/\s*(BC|BCE|AD|CE)$/i, "").trim();

  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/);
  if (slashMatch) {
    const [, month, day, yearStr] = slashMatch;
    let year = Number(yearStr);
    if (isBC) year = -(Math.abs(year) - 1);
    const dateObj = createUTCDate(year, Number(month) - 1, Number(day));
    return isNaN(dateObj.getTime()) ? null : dateObj;
  }

  const isoMatch = cleaned.match(/^(-?\d+)-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yearStr, month, day] = isoMatch;
    let year = Number(yearStr);
    if (isBC) year = -(Math.abs(year) - 1);
    const dateObj = createUTCDate(year, Number(month) - 1, Number(day));
    return isNaN(dateObj.getTime()) ? null : dateObj;
  }

  const yearOnlyMatch = cleaned.match(/^(-?\d+)$/);
  if (yearOnlyMatch) {
    let year = Number(yearOnlyMatch[1]);
    if (isBC) year = -(Math.abs(year) - 1);
    const dateObj = createUTCDate(year, 0, 1);
    return isNaN(dateObj.getTime()) ? null : dateObj;
  }

  const dateObj = new Date(cleaned);
  return isNaN(dateObj.getTime()) ? null : dateObj;
}

function getNormalizedEventKey(title, dateObj) {
  if (!title || !dateObj || Number.isNaN(dateObj.getTime())) return null;
  const normalizedTitle = String(title).trim().toLowerCase();
  const dateKey = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000));
  return `${normalizedTitle}::${dateKey.toISOString().slice(0, 10)}`;
}

async function importEventsToTimeline(timelineId, rows) {
  const results = { imported: 0, skipped: 0, duplicates: 0, skippedRows: [] };
  const validEvents = [];
  const existingEventKeys = new Set();
  const importedEventKeys = new Set();

  try {
    const existingEventsSnapshot = await getDocs(collection(db, "timelines", timelineId, "events"));
    existingEventsSnapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      const title = data.title || "";
      const dateValue = data.date?.toDate ? data.date.toDate() : parseEventDate(data.date);
      const key = getNormalizedEventKey(title, dateValue);
      if (key) existingEventKeys.add(key);
    });
  } catch (error) {
    console.error("Error loading existing events for duplicate detection:", error);
  }

  for (const row of rows) {
    const title = (row.title || "").trim() || "Untitled Event";
    const dateObj = parseEventDate(row.date || row.start_date);

    if (!dateObj) {
      results.skipped++;
      results.skippedRows.push(`"${title}" (invalid date: "${row.date || row.start_date || ""}")`);
      continue;
    }

    const eventKey = getNormalizedEventKey(title, dateObj);
    if (!eventKey) {
      results.skipped++;
      results.skippedRows.push(`"${title}" (invalid date: "${row.date || row.start_date || ""}")`);
      continue;
    }

    if (existingEventKeys.has(eventKey) || importedEventKeys.has(eventKey)) {
      results.duplicates++;
      results.skippedRows.push(`"${title}" (${dateObj.toISOString().slice(0, 10)})`);
      continue;
    }

    importedEventKeys.add(eventKey);

    const endDateObj = parseEventDate(row.end_date || row.enddate);

    const rawTags = row.tags ?? row.tag ?? [];
    const tags = Array.isArray(rawTags)
      ? rawTags.map(t => String(t).trim()).filter(Boolean)
      : String(rawTags || "")
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
      if (results.duplicates > 0) {
        message += ` Skipped ${results.duplicates} duplicate event${results.duplicates === 1 ? "" : "s"} already in the timeline.`;
      }
      if (results.skipped > 0) {
        message += ` Skipped ${results.skipped} row${results.skipped === 1 ? "" : "s"} with invalid dates.`;
      }

      if (statusEl) {
        statusEl.style.color = (results.skipped > 0 || results.duplicates > 0) ? "#b45309" : "#15803d";
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

const GEMINI_API_KEY_STORAGE_KEY = "timelineGeminiApiKey";
const GEMINI_MODEL_STORAGE_KEY = "timelineGeminiModel";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

function getSavedGeminiApiKey() {
  try {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || "";
  } catch (error) {
    console.warn("Unable to read saved Gemini API key:", error);
    return "";
  }
}

function setSavedGeminiApiKey(apiKey) {
  try {
    if (!apiKey) {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, apiKey.trim());
  } catch (error) {
    console.warn("Unable to save Gemini API key:", error);
  }
}

function getSavedGeminiModel() {
  try {
    const stored = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY);
    return stored && stored.trim() ? stored.trim() : DEFAULT_GEMINI_MODEL;
  } catch (error) {
    console.warn("Unable to read saved Gemini model:", error);
    return DEFAULT_GEMINI_MODEL;
  }
}

function setSavedGeminiModel(model) {
  try {
    const normalized = (model || DEFAULT_GEMINI_MODEL).trim();
    localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, normalized);
  } catch (error) {
    console.warn("Unable to save Gemini model:", error);
  }
}

function normalizeAiEventRow(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return null;

  const title = String(rawRow.title || rawRow.name || rawRow.event || rawRow.label || "").trim();
  if (!title) return null;

  const dateValue = rawRow.date || rawRow.start_date || rawRow.startDate || rawRow.when || "";
  if (!dateValue) return null;

  const normalized = {
    title,
    date: String(dateValue).trim()
  };

  if (rawRow.end_date || rawRow.endDate) {
    normalized.end_date = String(rawRow.end_date || rawRow.endDate).trim();
  }

  const tierValue = Number(rawRow.tier ?? rawRow.importance ?? rawRow.priority ?? 1);
  if (Number.isFinite(tierValue)) {
    normalized.tier = Math.min(3, Math.max(1, tierValue));
  } else {
    normalized.tier = 1;
  }

  const tagsValue = rawRow.tags || rawRow.tag || rawRow.categories || rawRow.labels || [];
  if (Array.isArray(tagsValue)) {
    normalized.tags = tagsValue.map(tag => String(tag).trim()).filter(Boolean).slice(0, 20);
  } else if (typeof tagsValue === "string") {
    normalized.tags = tagsValue.split(",").map(tag => tag.trim()).filter(Boolean).slice(0, 20);
  }

  return normalized;
}

function parseGeminiGeneratedEvents(apiResponse) {
  const contentText = apiResponse?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("\n")
    .trim();

  if (!contentText) {
    throw new Error("Gemini did not return any generated content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(contentText);
  } catch (error) {
    const codeFenceMatch = contentText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const fallbackText = codeFenceMatch ? codeFenceMatch[1] : contentText.replace(/^[^\[]+/, "").replace(/[^\]]+$/, "");
    try {
      parsed = JSON.parse(fallbackText);
    } catch (fallbackError) {
      throw new Error("Gemini output was not valid JSON. Please adjust the prompt to request an array of events.");
    }
  }

  const eventArray = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.events)
      ? parsed.events
      : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.items)
          ? parsed.items
          : null;

  if (!eventArray) {
    throw new Error("Gemini output did not include a valid event array.");
  }

  const rows = eventArray
    .map((item) => normalizeAiEventRow(item))
    .filter(Boolean);

  if (!rows.length) {
    throw new Error("Gemini returned no usable events. Please refine the prompt.");
  }

  return rows;
}

function setupAiImport(getCurrentTimelineId, onImportComplete) {
  const openBtn = document.getElementById("openAiImportBtn");
  const modal = document.getElementById("aiImportModal");
  const form = document.getElementById("aiImportForm");
  const cancelBtn = document.getElementById("cancelAiImportBtn");
  const apiKeyInput = document.getElementById("geminiApiKeyInput");
  const modelInput = document.getElementById("geminiModelInput");
  const promptInput = document.getElementById("aiPromptInput");
  const statusEl = document.getElementById("aiImportStatus");
  const importBtn = document.getElementById("aiImportBtn");
  const saveApiKeyBtn = document.getElementById("saveGeminiApiKeyBtn");

  if (!openBtn || !modal || !form || !apiKeyInput || !modelInput || !promptInput) return;

  apiKeyInput.value = getSavedGeminiApiKey();
  modelInput.value = getSavedGeminiModel();

  function closeModal() {
    modal.style.display = "none";
    form.reset();
    apiKeyInput.value = getSavedGeminiApiKey();
    modelInput.value = getSavedGeminiModel();
    if (statusEl) {
      statusEl.style.display = "none";
      statusEl.textContent = "";
    }
    if (importBtn) importBtn.disabled = false;
  }

  function openModal() {
    apiKeyInput.value = getSavedGeminiApiKey();
    modelInput.value = getSavedGeminiModel();
    form.reset();
    apiKeyInput.value = getSavedGeminiApiKey();
    modelInput.value = getSavedGeminiModel();
    if (statusEl) {
      statusEl.style.display = "none";
      statusEl.textContent = "";
    }
    if (importBtn) importBtn.disabled = false;
    modal.style.display = "flex";
  }

  if (saveApiKeyBtn) {
    saveApiKeyBtn.addEventListener("click", () => {
      const key = apiKeyInput.value.trim();
      if (!key) {
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.style.color = "#b45309";
          statusEl.textContent = "Enter an API key before saving it.";
        }
        return;
      }
      setSavedGeminiApiKey(key);
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "#15803d";
        statusEl.textContent = "Gemini API key saved locally for future imports.";
      }
    });
  }

  openBtn.addEventListener("click", () => {
    openModal();
    if (!getCurrentTimelineId() && statusEl) {
      statusEl.style.display = "block";
      statusEl.style.color = "#b45309";
      statusEl.textContent = "Please select a timeline before generating events.";
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
        statusEl.textContent = "Please select a timeline before generating events.";
      }
      return;
    }

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "#b45309";
        statusEl.textContent = "Please enter your Gemini API key first.";
      }
      return;
    }

    const modelName = (modelInput.value || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
    setSavedGeminiModel(modelName);

    const prompt = promptInput.value.trim();
    if (!prompt) {
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "#b45309";
        statusEl.textContent = "Please describe the events you want generated.";
      }
      return;
    }

    setSavedGeminiApiKey(apiKey);

    if (importBtn) importBtn.disabled = true;
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.style.color = "#334155";
      statusEl.textContent = "Generating events with Gemini...";
    }

    try {
      const requestBody = {
        contents: [{
          role: "user",
          parts: [{
            text: `You are a historical timeline event generator. Generate a JSON array of events matching the user's request. 
Return only valid JSON, no markdown fences, no explanatory text.
Each item must have these exact fields: 
- title: string
- date: string in a supported format such as YYYY-MM-DD, YYYY, or YYYY BC
- end_date: optional string if it spans a range
- tier: integer from 1 to 3
- tags: array of strings
Rules:
- Keep dates realistic and usable by the timeline app.
- Use title strings only, not bullets or extra narration.
- Ensure each object is valid JSON.
- If the user request is broad, pick a set of meaningful events rather than a huge list.
- Prefer 5 to 25 events unless the request is explicit.
User request: ${prompt}`
          }]
        }]
      };

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Gemini API request failed (${response.status}): ${detail}`);
      }

      const data = await response.json();
      const rows = parseGeminiGeneratedEvents(data);
      const results = await importEventsToTimeline(activeTimelineId, rows);

      let message = `Generated and imported ${results.imported} event${results.imported === 1 ? "" : "s"}.`;
      if (results.duplicates > 0) {
        message += ` Skipped ${results.duplicates} duplicate event${results.duplicates === 1 ? "" : "s"} already in the timeline.`;
      }
      if (results.skipped > 0) {
        message += ` Skipped ${results.skipped} row${results.skipped === 1 ? "" : "s"} with invalid dates.`;
      }

      if (statusEl) {
        statusEl.style.color = (results.skipped > 0 || results.duplicates > 0) ? "#b45309" : "#15803d";
        statusEl.textContent = message;
      }

      if (results.imported > 0) {
        onImportComplete();
      }
    } catch (err) {
      console.error("AI event generation failed:", err);
      if (statusEl) {
        statusEl.style.color = "#b45309";
        statusEl.textContent = err.message || "Failed to generate events with Gemini.";
      }
    } finally {
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

function computeRightLabelReserve(events) {
  if (!events || events.length === 0) return 0;
  let maxW = 0;
  events.forEach(e => {
    try {
      const w = getTextWidth(e.title || "");
      if (w > maxW) maxW = w;
    } catch (err) {
      // ignore measurement errors
    }
  });
  // add buffer for icon, padding and some breathing room
  return Math.ceil(maxW) + 28;
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

  const fontSlider = document.getElementById('fontSizeSlider');
  const fontSizeValue = document.getElementById('fontSizeValue');
  if (fontSlider) {
    fontSlider.value = currentFontSize;
    if (fontSizeValue) fontSizeValue.textContent = `${currentFontSize}px`;
    fontSlider.addEventListener('input', (e) => {
      currentFontSize = Number(e.target.value);
      if (fontSizeValue) fontSizeValue.textContent = `${currentFontSize}px`;
      applyFontSize();
      renderCurrentTimeline();
    });
  }

  setupAuthModal(async (user) => {
    // Check if timeline ID is provided in URL, use that as starting point
    const urlTimelineId = getTimelineIdFromUrl();
    activeTimelineId = urlTimelineId || activeTimelineId;
    
    activeTimelineId = await loadTimelineOptions(activeTimelineId);
    previousTimelineId = activeTimelineId;
    
    // Update URL with the selected timeline
    if (activeTimelineId) {
      setTimelineUrlParam(activeTimelineId);
    }
    
    updateUIForTimelineOwner(activeTimelineId);
    applyTimelineStyles(timelineMetaMap.get(activeTimelineId));
    eventsData = activeTimelineId ? await loadEvents(activeTimelineId) : [];
    applyFontSize();
    const initialView = activeTimelineId ? await loadUserTimelineView(activeTimelineId) : null;
    const transform = initialView?.zoom ? d3.zoomIdentity.translate(initialView.zoom.x || 0, 0).scale(initialView.zoom.k || 1) : d3.zoomIdentity;
    refreshChart(eventsData, transform);
  });

  function applyFontSize() {
    const size = Number(currentFontSize) || 11;
    // update canvas measurement font
    ctx.font = `500 ${size}px system-ui, -apple-system, sans-serif`;

    // update axis and event label sizes
    try {
      gAxis.selectAll('text').style('font-size', `${size}px`);
      gEvents.selectAll('.event-node text').style('font-size', `${size}px`);
    } catch (err) {
      // ignore if selections not ready
    }

    // update DOM elements like title and tag badges
    const titleEl = document.querySelector('h2');
    if (titleEl) titleEl.style.fontSize = `${size + 6}px`;
    document.querySelectorAll('.tag-badge').forEach(el => {
      el.style.fontSize = `${Math.max(10, size - 1)}px`;
    });
  }

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
    if (containerEl) {
      // background color as fallback
      containerEl.style.background = currentTimelineSettings.backgroundColor || DEFAULT_TIMELINE_SETTINGS.backgroundColor;
      // apply background image if present
      if (currentTimelineSettings.backgroundImageUrl) {
        containerEl.style.backgroundImage = `url('${currentTimelineSettings.backgroundImageUrl}')`;
        if ((currentTimelineSettings.backgroundImageMode || 'stretch') === 'tile') {
          containerEl.style.backgroundRepeat = 'repeat';
          containerEl.style.backgroundSize = 'auto';
          containerEl.style.backgroundPosition = 'center';
        } else {
          // stretch while preserving the full image
          containerEl.style.backgroundRepeat = 'no-repeat';
          containerEl.style.backgroundSize = 'contain';
          containerEl.style.backgroundPosition = 'center';
        }
      } else {
        containerEl.style.backgroundImage = '';
        containerEl.style.backgroundRepeat = '';
        containerEl.style.backgroundSize = '';
        containerEl.style.backgroundPosition = '';
      }
    }
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
    // ensure font sizes are applied after style change
    applyFontSize();
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

  function refreshChart(data, initialTransform = null) {
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

    // full pixel range across container
    xBaseScale.range([margin.left, width - margin.right]);

    // Reserve time on the right (extend domain) so labels for last events fit
    try {
      const reserve = computeRightLabelReserve(data);
      const innerW = Math.max(100, width - margin.left - margin.right);
      const domain = xBaseScale.domain();
      const durationMs = domain[1].getTime() - domain[0].getTime();
      const extraMs = Math.round((reserve / innerW) * Math.max(1, durationMs));
      const extendedEnd = new Date(domain[1].getTime() + extraMs + 1000);
      xBaseScale.domain([domain[0], extendedEnd]);
    } catch (err) {
      // if anything fails, fall back to original domain
    }

    if (initialTransform) {
      currentTransform = initialTransform;
    } else {
      currentTransform = d3.zoomIdentity;
    }

    svg.call(zoom.transform, currentTransform);
    const scale = currentTransform.rescaleX(xBaseScale);
    updateTimeline(scale, currentTransform.k, getFilteredEvents());
  }

  function zoomed(event) {
    currentTransform = event.transform;
    const newXScale = event.transform.rescaleX(xBaseScale);
    updateTimeline(newXScale, event.transform.k, getFilteredEvents());

    if (auth.currentUser && activeTimelineId) {
      scheduleSaveUserTimelineView(activeTimelineId);
    }
  }

  const resetTimelineViewBtn = document.getElementById("resetTimelineViewBtn");
  if (resetTimelineViewBtn) {
    resetTimelineViewBtn.addEventListener("click", () => {
      if (!eventsData || eventsData.length === 0) return;

      const extent = d3.extent(eventsData, d => d.date);
      if (extent[0] && extent[1]) {
        xBaseScale.domain([
          d3.timeYear.offset(extent[0], -1),
          d3.timeYear.offset(extent[1], 1)
        ]);
      } else {
        xBaseScale.domain([new Date(1960, 0, 1), new Date(2030, 0, 1)]);
      }

      xBaseScale.range([margin.left, width - margin.right]);

      try {
        const reserve = computeRightLabelReserve(eventsData);
        const innerW = Math.max(100, width - margin.left - margin.right);
        const domain = xBaseScale.domain();
        const durationMs = domain[1].getTime() - domain[0].getTime();
        const extraMs = Math.round((reserve / innerW) * Math.max(1, durationMs));
        const extendedEnd = new Date(domain[1].getTime() + extraMs + 1000);
        xBaseScale.domain([domain[0], extendedEnd]);
      } catch (err) {
        // ignore and keep default domain
      }

      currentTransform = d3.zoomIdentity;
      svg.call(zoom.transform, currentTransform);
      const scale = currentTransform.rescaleX(xBaseScale);
      updateTimeline(scale, currentTransform.k, getFilteredEvents());

      if (auth.currentUser && activeTimelineId) {
        scheduleSaveUserTimelineView(activeTimelineId);
      }
    });
  }

  // Share timeline button - copies current URL to clipboard
  const shareTimelineBtn = document.getElementById("shareTimelineBtn");
  if (shareTimelineBtn) {
    shareTimelineBtn.addEventListener("click", async () => {
      if (!activeTimelineId) return;
      
      try {
        const url = `${window.location.origin}${window.location.pathname}?timeline=${activeTimelineId}`;
        await navigator.clipboard.writeText(url);
        
        // Show feedback
        const originalText = shareTimelineBtn.textContent;
        shareTimelineBtn.textContent = "✓ Copied to clipboard!";
        shareTimelineBtn.style.background = "#059669";
        
        setTimeout(() => {
          shareTimelineBtn.textContent = originalText;
          shareTimelineBtn.style.background = "#7c3aed";
        }, 2000);
      } catch (err) {
        console.error("Failed to copy URL:", err);
        alert("Failed to copy URL. You can manually copy it from the browser address bar.");
      }
    });
  }

  if (keywordInput) {
    keywordInput.addEventListener("input", () => {
      renderCurrentTimeline();
    });
  }

  const zoom = d3.zoom()
    .scaleExtent([1, 500])
    .extent([[margin.left, 0], [width - margin.right, height]])
    // allow panning well past the right edge (extra padding)
    .translateExtent([[margin.left - 10000, -Infinity], [width - margin.right + 10000, Infinity]])
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
      // Update URL when new timeline is created
      setTimelineUrlParam(activeTimelineId);
      updateUIForTimelineOwner(activeTimelineId);
      // apply styles for the newly created timeline and refresh view
      applyTimelineStyles(timelineMetaMap.get(activeTimelineId));
      eventsData = [];
      refreshChart(eventsData);
    },
    async (renamedTimelineId) => {
      await loadTimelineOptions(renamedTimelineId);
      // Update URL when timeline is renamed
      setTimelineUrlParam(renamedTimelineId);
      updateUIForTimelineOwner(renamedTimelineId);
      // Immediately apply updated settings and refresh events
      applyTimelineStyles(timelineMetaMap.get(renamedTimelineId));
      eventsData = renamedTimelineId ? await loadEvents(renamedTimelineId) : [];
      const transformedView = renamedTimelineId ? await loadUserTimelineView(renamedTimelineId) : null;
      const transform = transformedView?.zoom ? d3.zoomIdentity.translate(transformedView.zoom.x || 0, 0).scale(transformedView.zoom.k || 1) : d3.zoomIdentity;
      refreshChart(eventsData, transform);
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
      
      // Update URL when timeline is selected for bookmarking
      setTimelineUrlParam(activeTimelineId);
      
      updateUIForTimelineOwner(activeTimelineId);
      applyTimelineStyles(timelineMetaMap.get(activeTimelineId));
      eventsData = activeTimelineId ? await loadEvents(activeTimelineId) : [];
      const initialView = activeTimelineId ? await loadUserTimelineView(activeTimelineId) : null;
      const transform = initialView?.zoom ? d3.zoomIdentity.translate(initialView.zoom.x || 0, 0).scale(initialView.zoom.k || 1) : d3.zoomIdentity;
      refreshChart(eventsData, transform);
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
    const leftDate = currentTransform.rescaleX(xBaseScale).invert(margin.left);

    width = container.clientWidth;
    height = container.clientHeight;
    axisY = height - margin.bottom;

    svg.attr("width", width).attr("height", height);
    xBaseScale.range([margin.left, width - margin.right]);
    // extend domain to reserve time on the right for labels
    try {
      const reserve = computeRightLabelReserve(eventsData);
      const innerW = Math.max(100, width - margin.left - margin.right);
      const domain = xBaseScale.domain();
      const durationMs = domain[1].getTime() - domain[0].getTime();
      const extraMs = Math.round((reserve / innerW) * Math.max(1, durationMs));
      const extendedEnd = new Date(domain[1].getTime() + extraMs + 1000);
      xBaseScale.domain([domain[0], extendedEnd]);

      // loosen translateExtent so user can pan past the last event
      const extraPan = Math.max(1000, reserve + 200);
      zoom.extent([[margin.left, 0], [width - margin.right, height]])
          .translateExtent([[margin.left - 10000, -Infinity], [width - margin.right + extraPan, Infinity]]);
    } catch (err) {
      gAxis.attr("transform", `translate(0, ${axisY})`);
      zoom.extent([[margin.left, 0], [width - margin.right, height]])
          .translateExtent([[margin.left - 10000, -Infinity], [width - margin.right + 10000, Infinity]]);
    }
    gAxis.attr("transform", `translate(0, ${axisY})`);

    currentTransform = d3.zoomIdentity
      .translate(margin.left - currentTransform.k * xBaseScale(leftDate), 0)
      .scale(currentTransform.k);

    svg.call(zoom.transform, currentTransform);
  });

  setupCsvImport(
    () => activeTimelineId,
    async () => {
      eventsData = await loadEvents(activeTimelineId);
      refreshChart(eventsData);
    }
  );

  setupAiImport(
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
    .style("fill", currentTimelineSettings.fontColor || DEFAULT_TIMELINE_SETTINGS.fontColor)
    .style("font-size", `${currentFontSize}px`);

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
