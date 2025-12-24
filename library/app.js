const storageKey = "book-ledger-items";
const bookForm = document.getElementById("bookForm");
const bookList = document.getElementById("bookList");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("search");
const searchToggle = document.getElementById("searchToggle");
const searchContainer = document.querySelector(".search");
const sortSelect = document.getElementById("sort");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const linkCsvBtn = document.getElementById("linkCsvBtn");
const fileInput = document.getElementById("fileInput");
const installBtn = document.getElementById("installBtn");
const titleInput = document.getElementById("title");
const authorInput = document.getElementById("author");
const finishedInput = document.getElementById("finished");
const isbnInput = document.getElementById("isbn");
const yearInput = document.getElementById("year");
const notesInput = document.getElementById("notes");
const scanBtn = document.getElementById("scanBtn");
const lookupIsbnBtn = document.getElementById("lookupIsbnBtn");
const scannerModal = document.getElementById("scannerModal");
const scannerVideo = document.getElementById("scannerVideo");
const scannerStatus = document.getElementById("scannerStatus");
const closeScannerBtn = document.getElementById("closeScanner");
const isbnPickerModal = document.getElementById("isbnPickerModal");
const isbnPickerList = document.getElementById("isbnPickerList");
const isbnPickerEmpty = document.getElementById("isbnPickerEmpty");
const closeIsbnPickerBtn = document.getElementById("closeIsbnPicker");

let books = loadBooks();
let deferredPrompt = null;
let defaultFinishedDate = new Date().toISOString().slice(0, 10);
let scanControls = null;
let scanInProgress = false;
const coverCache = new Map();
const lookupIsbnBtnLabel = lookupIsbnBtn ? lookupIsbnBtn.textContent : "";
const linkCsvBtnLabel = linkCsvBtn ? linkCsvBtn.textContent : "";
const csvDbName = "book-ledger";
const csvSettingsStore = "settings";
let csvFileHandle = null;
let csvAutoSaveEnabled = false;
let csvWriteInProgress = false;
let csvWriteQueued = false;

function generateId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const array = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i += 1) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  array[6] = (array[6] & 0x0f) | 0x40;
  array[8] = (array[8] & 0x3f) | 0x80;
  const hex = Array.from(array, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex
    .slice(10, 16)
    .join("")}`;
}

function updateDefaultFinishedDate() {
  const nextDefault = new Date().toISOString().slice(0, 10);
  if (nextDefault === defaultFinishedDate) return;
  const shouldUpdateInput =
    !bookForm.dataset.editId &&
    (finishedInput.value === "" || finishedInput.value === defaultFinishedDate);
  defaultFinishedDate = nextDefault;
  if (shouldUpdateInput) finishedInput.value = defaultFinishedDate;
}

function loadBooks() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to parse stored books", error);
    return [];
  }
}

function saveBooks() {
  localStorage.setItem(storageKey, JSON.stringify(books));
  queueCsvAutoSave();
}

function normalize(text) {
  return (text || "").toLowerCase();
}

function getOpenLibraryCoverUrl(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(
    isbn
  )}-L.jpg?default=false`;
}

function placeholderCover() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 360">' +
    '<rect width="240" height="360" fill="#efe7da"/>' +
    '<rect x="20" y="20" width="200" height="320" fill="#f9f4ea" stroke="#ddd4c8"/>' +
    '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" ' +
    'font-family="Berkeley Mono, monospace" font-size="18" fill="#6a6259">' +
    "No cover</text></svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function storeCover(book, url) {
  if (!url) return;
  book.cover = url;
  coverCache.set(book.isbn, url);
  saveBooks();
}

async function fetchGoogleBooksCover(isbn) {
  if (coverCache.has(isbn)) return coverCache.get(isbn);
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(
    isbn
  )}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  const item = data.items && data.items[0];
  const imageLinks = item?.volumeInfo?.imageLinks;
  const thumbnail = imageLinks?.thumbnail || imageLinks?.smallThumbnail;
  if (!thumbnail) return null;
  const httpsThumb = thumbnail.replace(/^http:/, "https:");
  coverCache.set(isbn, httpsThumb);
  return httpsThumb;
}

function ensureCover(book, img) {
  if (!book.isbn) return;
  if (book.cover) {
    img.src = book.cover;
    return;
  }
  const openLibraryUrl = getOpenLibraryCoverUrl(book.isbn);
  img.dataset.coverStage = "openlibrary";
  img.src = openLibraryUrl;
  img.onload = () => {
    if (img.dataset.coverStage === "openlibrary") {
      storeCover(book, openLibraryUrl);
    }
  };
  img.onerror = async () => {
    if (img.dataset.coverStage === "openlibrary") {
      img.dataset.coverStage = "google";
      try {
        const googleUrl = await fetchGoogleBooksCover(book.isbn);
        if (googleUrl) {
          img.src = googleUrl;
          storeCover(book, googleUrl);
          return;
        }
      } catch (error) {
        console.warn("Cover lookup failed", error);
      }
      img.dataset.coverStage = "placeholder";
      img.src = placeholderCover();
    } else if (img.dataset.coverStage === "google") {
      img.dataset.coverStage = "placeholder";
      img.src = placeholderCover();
    }
  };
}

function sortBooks(list) {
  const mode = sortSelect.value;
  const sorted = [...list];
  if (mode === "title-asc") {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  } else if (mode === "title-desc") {
    sorted.sort((a, b) => b.title.localeCompare(a.title));
  } else if (mode === "finished-asc") {
    sorted.sort((a, b) => (a.finished || "").localeCompare(b.finished || ""));
  } else {
    sorted.sort((a, b) => (b.finished || "").localeCompare(a.finished || ""));
  }
  return sorted;
}

function renderBooks() {
  const term = normalize(searchInput.value);
  const filtered = books.filter((book) => {
    const haystack = `${book.title} ${book.author} ${book.isbn}`.toLowerCase();
    return haystack.includes(term);
  });

  const sorted = sortBooks(filtered);
  bookList.innerHTML = "";

  sorted.forEach((book) => {
    const card = document.createElement("article");
    card.className = "card";

    const body = document.createElement("div");
    body.className = "card-body";

    const cover = document.createElement("img");
    cover.className = "card-cover";
    cover.alt = book.title ? `Cover for ${book.title}` : "Book cover";
    cover.loading = "lazy";
    if (book.isbn) {
      ensureCover(book, cover);
    } else {
      cover.src = placeholderCover();
    }

    const text = document.createElement("div");

    const title = document.createElement("h3");
    title.textContent = book.title || "Untitled";

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const author = book.author ? `by ${book.author}` : "";
    const isbn = book.isbn ? `ISBN ${book.isbn}` : "";
    const year = book.year ? `(${book.year})` : "";
    const finished = book.finished ? `Finished ${book.finished}` : "";
    meta.textContent = [author, isbn, year, finished].filter(Boolean).join(" ");

    const notes = document.createElement("p");
    notes.textContent = book.notes || "";

    text.append(title, meta, notes);
    body.append(cover, text);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "ghost";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEdit(book));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => removeBook(book.id));

    actions.append(editBtn, deleteBtn);
    card.append(body, actions);
    bookList.append(card);
  });

  emptyState.hidden = sorted.length !== 0;
}

function startEdit(book) {
  bookForm.dataset.editId = book.id;
  titleInput.value = book.title || "";
  authorInput.value = book.author || "";
  isbnInput.value = book.isbn || "";
  yearInput.value = book.year || "";
  finishedInput.value = book.finished || "";
  notesInput.value = book.notes || "";
}

function removeBook(id) {
  books = books.filter((book) => book.id !== id);
  saveBooks();
  renderBooks();
}

function upsertBook(formData) {
  const payload = {
    title: formData.get("title").trim(),
    author: formData.get("author").trim(),
    isbn: formData.get("isbn").trim(),
    year: formData.get("year").trim(),
    finished: formData.get("finished"),
    notes: formData.get("notes").trim(),
  };

  const editId = bookForm.dataset.editId;
  if (editId) {
    books = books.map((book) =>
      book.id === editId
        ? {
            ...book,
            ...payload,
            cover:
              book.isbn && payload.isbn && book.isbn !== payload.isbn
                ? ""
                : book.cover,
          }
        : book
    );
    delete bookForm.dataset.editId;
  } else {
    books.unshift({ id: generateId(), ...payload });
  }

  saveBooks();
  renderBooks();
}

bookForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(bookForm);
  upsertBook(formData);
  bookForm.reset();
  finishedInput.value = defaultFinishedDate;
});

bookForm.addEventListener("reset", () => {
  delete bookForm.dataset.editId;
  finishedInput.value = defaultFinishedDate;
});

searchInput.addEventListener("input", renderBooks);
sortSelect.addEventListener("change", renderBooks);
searchToggle.addEventListener("click", () => {
  const isCollapsed = searchContainer.dataset.collapsed === "true";
  if (isCollapsed) {
    searchContainer.dataset.collapsed = "false";
    searchInput.focus();
  } else if (searchInput.value.trim() === "") {
    searchContainer.dataset.collapsed = "true";
  } else {
    searchInput.focus();
  }
});

searchInput.addEventListener("blur", () => {
  if (searchInput.value.trim() === "") {
    searchContainer.dataset.collapsed = "true";
  }
});

function toCsvValue(value) {
  const escaped = String(value || "").replace(/"/g, '""');
  return `"${escaped}"`;
}

function serializeCsv(items) {
  const headers = ["title", "author", "isbn", "year", "finished", "notes"];
  const lines = [headers.join(",")];
  items.forEach((item) => {
    const row = headers.map((key) => toCsvValue(item[key] || ""));
    lines.push(row.join(","));
  });
  return lines.join("\n");
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      current.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (value || current.length) {
        current.push(value);
        rows.push(current);
        current = [];
        value = "";
      }
    } else {
      value += char;
    }
  }

  if (value || current.length) {
    current.push(value);
    rows.push(current);
  }

  return rows;
}

function importCsvText(text) {
  const rows = parseCsv(text.trim());
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase());

  return rows.slice(1).map((row) => {
    const entry = { id: generateId() };
    headers.forEach((header, index) => {
      entry[header] = row[index] ? row[index].trim() : "";
    });
    return entry;
  });
}

async function importCsvWithPicker() {
  const [fileHandle] = await window.showOpenFilePicker({
    types: [
      {
        description: "CSV Files",
        accept: { "text/csv": [".csv"] },
      },
    ],
  });
  const file = await fileHandle.getFile();
  return file.text();
}

async function exportCsvWithPicker(content) {
  const fileHandle = await window.showSaveFilePicker({
    suggestedName: "book-ledger.csv",
    types: [
      {
        description: "CSV Files",
        accept: { "text/csv": [".csv"] },
      },
    ],
  });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function openSettingsDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(csvDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(csvSettingsStore);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getSetting(key) {
  const db = await openSettingsDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(csvSettingsStore, "readonly");
    const store = tx.objectStore(csvSettingsStore);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function setSetting(key, value) {
  const db = await openSettingsDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(csvSettingsStore, "readwrite");
    const store = tx.objectStore(csvSettingsStore);
    store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queryCsvPermission(handle) {
  if (!handle?.queryPermission) return "denied";
  return handle.queryPermission({ mode: "readwrite" });
}

async function requestCsvPermission(handle) {
  if (!handle?.requestPermission) return false;
  const next = await handle.requestPermission({ mode: "readwrite" });
  return next === "granted";
}

function updateCsvLinkButton() {
  if (!linkCsvBtn) return;
  if (!csvFileHandle) {
    linkCsvBtn.textContent = linkCsvBtnLabel || "Link CSV";
    return;
  }
  linkCsvBtn.textContent = csvAutoSaveEnabled
    ? "CSV Auto-save On"
    : "Enable CSV Auto-save";
}

async function writeCsvToLinkedFile() {
  if (!csvFileHandle || !csvAutoSaveEnabled) return;
  const content = serializeCsv(books);
  const writable = await csvFileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function queueCsvAutoSave() {
  if (!csvFileHandle || !csvAutoSaveEnabled) return;
  if (csvWriteInProgress) {
    csvWriteQueued = true;
    return;
  }
  csvWriteInProgress = true;
  writeCsvToLinkedFile()
    .catch((error) => {
      console.warn("Auto-save failed", error);
    })
    .finally(() => {
      csvWriteInProgress = false;
      if (csvWriteQueued) {
        csvWriteQueued = false;
        queueCsvAutoSave();
      }
    });
}

async function linkCsvFile() {
  if (!("showSaveFilePicker" in window)) {
    window.alert("CSV auto-save is not supported in this browser.");
    return;
  }
  const handle = await window.showSaveFilePicker({
    suggestedName: "book-ledger.csv",
    types: [{ description: "CSV Files", accept: { "text/csv": [".csv"] } }],
  });
  const granted = await requestCsvPermission(handle);
  if (!granted) {
    window.alert("Permission is required to auto-save the CSV.");
    return;
  }
  csvFileHandle = handle;
  csvAutoSaveEnabled = true;
  try {
    await setSetting("csvFileHandle", handle);
  } catch (error) {
    console.warn("Failed to store CSV handle", error);
  }
  updateCsvLinkButton();
  queueCsvAutoSave();
}

async function unlinkCsvFile() {
  csvFileHandle = null;
  csvAutoSaveEnabled = false;
  await setSetting("csvFileHandle", null);
  updateCsvLinkButton();
}

async function initCsvAutoSave() {
  if (!("showSaveFilePicker" in window)) {
    updateCsvLinkButton();
    return;
  }
  try {
    const storedHandle = await getSetting("csvFileHandle");
    if (!storedHandle) {
      updateCsvLinkButton();
      return;
    }
    const permission = await queryCsvPermission(storedHandle);
    csvFileHandle = storedHandle;
    csvAutoSaveEnabled = permission === "granted";
    updateCsvLinkButton();
  } catch (error) {
    console.warn("Failed to restore CSV auto-save", error);
    updateCsvLinkButton();
  }
}

function downloadCsv(content) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "book-ledger.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleImport() {
  try {
    let text = "";
    if ("showOpenFilePicker" in window) {
      text = await importCsvWithPicker();
    } else {
      fileInput.click();
      return;
    }

    const imported = importCsvText(text);
    if (!imported.length) return;
    const shouldReplace = window.confirm(
      "Replace your current list with the imported CSV?"
    );
    if (shouldReplace) {
      books = imported;
    } else {
      books = [...imported, ...books];
    }
    saveBooks();
    renderBooks();
  } catch (error) {
    console.warn("Import cancelled or failed", error);
  }
}

function handleFileInput(event) {
  const file = event.target.files[0];
  if (!file) return;
  file.text().then((text) => {
    const imported = importCsvText(text);
    if (!imported.length) return;
    const shouldReplace = window.confirm(
      "Replace your current list with the imported CSV?"
    );
    books = shouldReplace ? imported : [...imported, ...books];
    saveBooks();
    renderBooks();
  });
}

async function handleExport() {
  const content = serializeCsv(books);
  try {
    if ("showSaveFilePicker" in window) {
      await exportCsvWithPicker(content);
    } else {
      downloadCsv(content);
    }
  } catch (error) {
    console.warn("Export cancelled or failed", error);
  }
}

async function fetchIsbnRecord(isbn) {
  const response = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(
      isbn
    )}&format=json&jscmd=data`
  );
  if (!response.ok) return null;
  const data = await response.json();
  const record = data[`ISBN:${isbn}`];
  if (!record) return null;
  const title = record.title || "";
  const authorNames = (record.authors || []).map((author) => author.name);
  const authorText = authorNames.join(", ");
  const publishDate = record.publish_date || "";
  const coverUrl = record.cover?.large || record.cover?.medium || record.cover?.small;
  const yearMatch = publishDate.match(/\\d{4}/);

  return {
    title,
    authorText,
    year: yearMatch ? yearMatch[0] : "",
    coverUrl,
    languages: record.languages || [],
  };
}

async function lookupIsbn(isbn) {
  if (!isbn) return;
  try {
    const record = await fetchIsbnRecord(isbn);
    if (!record) return;
    const { title, authorText, year, coverUrl } = record;

    if (!bookForm.dataset.editId && titleInput.value.trim() === "") {
      titleInput.value = title;
    }
    if (!bookForm.dataset.editId && authorInput.value.trim() === "") {
      authorInput.value = authorText;
    }
    if (!bookForm.dataset.editId && yearInput.value.trim() === "" && year) {
      yearInput.value = year;
    }
    if (coverUrl && isbn) {
      coverCache.set(isbn, coverUrl);
    }
  } catch (error) {
    console.warn("ISBN lookup failed", error);
  }
}

function pickIsbn(candidates) {
  if (!Array.isArray(candidates)) return "";
  const cleaned = candidates
    .map((candidate) => String(candidate || "").toUpperCase())
    .map((candidate) => candidate.replace(/[^0-9X]/g, ""))
    .filter(Boolean);
  const isbn13 = cleaned.find((candidate) => /^\\d{13}$/.test(candidate));
  if (isbn13) return isbn13;
  const isbn10 = cleaned.find((candidate) => /^\\d{9}[0-9X]$/.test(candidate));
  return isbn10 || cleaned[0] || "";
}

function rankIsbnCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  const cleaned = candidates
    .map((candidate) => String(candidate || "").toUpperCase())
    .map((candidate) => candidate.replace(/[^0-9X]/g, ""))
    .filter(Boolean);
  const isbn13 = cleaned.filter((candidate) => /^\\d{13}$/.test(candidate));
  const isbn10 = cleaned.filter((candidate) => /^\\d{9}[0-9X]$/.test(candidate));
  const other = cleaned.filter(
    (candidate) =>
      !/^\\d{13}$/.test(candidate) && !/^\\d{9}[0-9X]$/.test(candidate)
  );
  return [...isbn13, ...isbn10, ...other];
}

function getLanguageStatus(record) {
  const languages = record?.languages;
  if (!Array.isArray(languages) || languages.length === 0) return "unknown";
  const hasEnglish = languages.some((lang) => {
    if (typeof lang === "string") return lang === "eng";
    if (lang && typeof lang === "object") {
      const key = lang.key || "";
      return key.includes("/languages/eng") || key === "eng";
    }
    return false;
  });
  return hasEnglish ? "english" : "non-english";
}

async function fetchSearchDocs(params) {
  const response = await fetch(
    `https://openlibrary.org/search.json?${params.toString()}`
  );
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.docs) ? data.docs : [];
}

async function fetchWorkIsbnCandidates(workKey) {
  if (!workKey || typeof workKey !== "string") return [];
  try {
    const response = await fetch(
      `https://openlibrary.org${workKey}/editions.json?limit=20`
    );
    if (!response.ok) return [];
    const data = await response.json();
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const candidates = [];
    entries.forEach((entry) => {
      candidates.push(...(entry.isbn_13 || []), ...(entry.isbn_10 || []));
    });
    return candidates;
  } catch (error) {
    console.warn("Work edition lookup failed", error);
  }
  return [];
}

async function fetchEditionIsbnCandidates(editionKeys) {
  const keys = Array.isArray(editionKeys) ? editionKeys.slice(0, 4) : [];
  const candidates = [];
  for (const key of keys) {
    try {
      const response = await fetch(
        `https://openlibrary.org/api/books?bibkeys=OLID:${encodeURIComponent(
          key
        )}&format=json&jscmd=data`
      );
      if (!response.ok) continue;
      const data = await response.json();
      const record = data[`OLID:${key}`];
      if (!record) continue;
      candidates.push(
        ...(record.isbn_13 || []),
        ...(record.isbn_10 || []),
        ...(record.identifiers?.isbn_13 || []),
        ...(record.identifiers?.isbn_10 || [])
      );
    } catch (error) {
      console.warn("Edition lookup failed", error);
    }
  }
  return candidates;
}

async function collectIsbnCandidatesBySearch(title, author) {
  const normalizedTitle = (title || "").trim();
  const normalizedAuthor = (author || "").trim();
  if (!normalizedTitle && !normalizedAuthor) return [];

  const params = new URLSearchParams();
  if (normalizedTitle) params.set("title", normalizedTitle);
  if (normalizedAuthor) params.set("author", normalizedAuthor);
  params.set(
    "fields",
    "key,isbn,first_publish_year,author_name,edition_key,language"
  );
  params.set("limit", "5");

  const collectFromDocs = async (docs, maxTotal) => {
    const set = new Set();
    const orderedDocs = [];
    const englishDocs = [];
    const otherDocs = [];

    docs.forEach((doc) => {
      if (Array.isArray(doc.language) && doc.language.includes("eng")) {
        englishDocs.push(doc);
      } else {
        otherDocs.push(doc);
      }
    });
    orderedDocs.push(...englishDocs, ...otherDocs);

    const addCandidates = (candidates, limit) => {
      const ranked = rankIsbnCandidates(candidates).slice(0, limit);
      ranked.forEach((isbn) => {
        if (set.size < maxTotal) set.add(isbn);
      });
    };

    for (const doc of orderedDocs) {
      addCandidates(doc.isbn || [], 4);
      if (set.size >= maxTotal) break;
      const workCandidates = await fetchWorkIsbnCandidates(doc.key);
      addCandidates(workCandidates, 4);
      if (set.size >= maxTotal) break;
      const editionCandidates = await fetchEditionIsbnCandidates(doc.edition_key);
      addCandidates(editionCandidates, 3);
      if (set.size >= maxTotal) break;
    }

    return Array.from(set);
  };

  params.set("language", "eng");
  const englishDocs = await fetchSearchDocs(params);
  const englishCandidates = await collectFromDocs(englishDocs, 10);
  if (englishCandidates.length) return englishCandidates;

  params.delete("language");
  const fallbackDocs = await fetchSearchDocs(params);
  return collectFromDocs(fallbackDocs, 10);
}

async function lookupIsbnByMetadata() {
  return collectIsbnCandidatesBySearch(
    titleInput.value,
    authorInput.value
  );
}

function renderIsbnPickerList(items) {
  isbnPickerList.innerHTML = "";
  isbnPickerEmpty.hidden = items.length !== 0;
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "isbn-option";

    const img = document.createElement("img");
    img.alt = item.title ? `Cover for ${item.title}` : "Book cover";
    img.loading = "lazy";
    img.src = getOpenLibraryCoverUrl(item.isbn);
    img.onerror = () => {
      img.src = placeholderCover();
    };

    const text = document.createElement("div");
    const title = document.createElement("p");
    title.className = "isbn-option-title";
    title.textContent = item.title || "Unknown title";

    const meta = document.createElement("p");
    meta.className = "isbn-option-meta";
    const parts = [
      item.authorText ? `by ${item.authorText}` : "",
      item.isbn ? `ISBN ${item.isbn}` : "",
      item.languageLabel || "",
    ];
    meta.textContent = parts.filter(Boolean).join(" · ");

    text.append(title, meta);
    button.append(img, text);
    button.addEventListener("click", () => {
      isbnInput.value = item.isbn;
      if (isbnPickerModal.open) isbnPickerModal.close();
      lookupIsbn(item.isbn);
    });

    isbnPickerList.append(button);
  });
}

async function openIsbnPicker(candidates) {
  isbnPickerEmpty.hidden = true;
  isbnPickerList.innerHTML = "";
  if (!isbnPickerModal.open) isbnPickerModal.showModal();
  if (!candidates.length) {
    isbnPickerEmpty.hidden = false;
    return;
  }

  const records = await Promise.all(
    candidates.map(async (isbn) => {
      const record = await fetchIsbnRecord(isbn);
      return { isbn, record };
    })
  );

  const normalizedTitle = normalize(titleInput.value);
  const normalizedAuthor = normalize(authorInput.value);
  const items = records.map(({ isbn, record }) => {
    const status = record ? getLanguageStatus(record) : "unknown";
    const languageLabel =
      status === "english"
        ? "English"
        : status === "non-english"
          ? "Other language"
          : "Language unknown";
    return {
      isbn,
      title: record?.title || "",
      authorText: record?.authorText || "",
      languageLabel,
      score:
        (status === "english" ? 0 : status === "unknown" ? 1 : 2) +
        (record?.title && normalize(record.title).includes(normalizedTitle)
          ? -0.5
          : 0) +
        (record?.authorText &&
        normalize(record.authorText).includes(normalizedAuthor)
          ? -0.25
          : 0),
    };
  });

  items.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.isbn.localeCompare(b.isbn);
  });

  renderIsbnPickerList(items);
}

function setLookupButtonState(isLoading, label) {
  if (!lookupIsbnBtn) return;
  lookupIsbnBtn.disabled = isLoading;
  lookupIsbnBtn.textContent = label || lookupIsbnBtnLabel;
}

function setScannerStatus(message) {
  scannerStatus.textContent = message;
}

function stopScanner() {
  if (scanControls) {
    scanControls.stop();
    scanControls = null;
  }
  if (scannerVideo.srcObject) {
    scannerVideo.srcObject.getTracks().forEach((track) => track.stop());
    scannerVideo.srcObject = null;
  }
  scanInProgress = false;
  if (scannerModal.open) scannerModal.close();
}

async function startScanner() {
  if (scanInProgress) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    window.alert("Camera access is not supported in this browser.");
    return;
  }
  scanInProgress = true;
  scannerModal.showModal();
  setScannerStatus("Starting camera...");

  try {
    if (!window.ZXingBrowser) {
      throw new Error("ZXing not available");
    }
    const codeReader = new ZXingBrowser.BrowserMultiFormatReader();
    scanControls = await codeReader.decodeFromVideoDevice(
      undefined,
      scannerVideo,
      (result, error, controls) => {
        if (result) {
          const text = result.getText();
          isbnInput.value = text;
          setScannerStatus(`Detected ${text}`);
          stopScanner();
          lookupIsbn(text);
        } else if (error && error.name !== "NotFoundException") {
          setScannerStatus("Scanning...");
        } else {
          setScannerStatus("Scanning...");
        }
      }
    );
  } catch (error) {
    console.warn("Scanner failed to start", error);
    setScannerStatus("Unable to access the camera.");
    scanInProgress = false;
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.hidden = false;
});

installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js");
  });
}

scanBtn.addEventListener("click", startScanner);
closeScannerBtn.addEventListener("click", stopScanner);
scannerModal.addEventListener("close", () => {
  if (scanInProgress) stopScanner();
});
closeIsbnPickerBtn.addEventListener("click", () => {
  if (isbnPickerModal.open) isbnPickerModal.close();
});
isbnPickerModal.addEventListener("close", () => {
  isbnPickerList.innerHTML = "";
  isbnPickerEmpty.hidden = true;
});
if (linkCsvBtn) {
  linkCsvBtn.addEventListener("click", async () => {
    if (csvFileHandle && csvAutoSaveEnabled) {
      const shouldUnlink = window.confirm(
        "Stop auto-saving to the linked CSV file?"
      );
      if (shouldUnlink) await unlinkCsvFile();
      return;
    }
    if (csvFileHandle && !csvAutoSaveEnabled) {
      const granted = await requestCsvPermission(csvFileHandle);
      csvAutoSaveEnabled = granted;
      updateCsvLinkButton();
      if (!granted) {
        window.alert("Permission is required to auto-save the CSV.");
        return;
      }
      queueCsvAutoSave();
      return;
    }
    try {
      await linkCsvFile();
    } catch (error) {
      console.warn("CSV linking cancelled or failed", error);
    }
  });
}
lookupIsbnBtn.addEventListener("click", async () => {
  const isbn = isbnInput.value.trim();
  if (isbn) {
    lookupIsbn(isbn);
    return;
  }

  const title = titleInput.value.trim();
  const author = authorInput.value.trim();
  if (!title && !author) {
    window.alert("Add a title or author to search for an ISBN.");
    return;
  }

  setLookupButtonState(true, "Searching...");
  try {
    const candidates = await lookupIsbnByMetadata();
    if (!candidates.length) {
      window.alert("No ISBN found for that search.");
      return;
    }
    await openIsbnPicker(candidates);
  } catch (error) {
    console.warn("Title search failed", error);
    window.alert("ISBN search failed.");
  } finally {
    setLookupButtonState(false);
  }
});

importBtn.addEventListener("click", handleImport);
exportBtn.addEventListener("click", handleExport);
fileInput.addEventListener("change", handleFileInput);
isbnInput.addEventListener("change", (event) => {
  lookupIsbn(event.target.value.trim());
});

renderBooks();
finishedInput.value = defaultFinishedDate;
setInterval(updateDefaultFinishedDate, 60 * 1000);
initCsvAutoSave();
