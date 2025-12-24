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
const fileInput = document.getElementById("fileInput");
const installBtn = document.getElementById("installBtn");
const titleInput = document.getElementById("title");
const authorInput = document.getElementById("author");
const finishedInput = document.getElementById("finished");
const isbnInput = document.getElementById("isbn");
const yearInput = document.getElementById("year");
const notesInput = document.getElementById("notes");
const scanBtn = document.getElementById("scanBtn");
const scannerModal = document.getElementById("scannerModal");
const scannerVideo = document.getElementById("scannerVideo");
const scannerStatus = document.getElementById("scannerStatus");
const closeScannerBtn = document.getElementById("closeScanner");

let books = loadBooks();
let deferredPrompt = null;
let defaultFinishedDate = new Date().toISOString().slice(0, 10);
let scanControls = null;
let scanInProgress = false;
const coverCache = new Map();

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
      book.id === editId ? { ...book, ...payload } : book
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

async function lookupIsbn(isbn) {
  if (!isbn) return;
  try {
    const response = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(
        isbn
      )}&format=json&jscmd=data`
    );
    if (!response.ok) return;
    const data = await response.json();
    const record = data[`ISBN:${isbn}`];
    if (!record) return;
    const title = record.title || "";
    const authorNames = (record.authors || []).map((author) => author.name);
    const authorText = authorNames.join(", ");
    const publishDate = record.publish_date || "";
    const coverUrl = record.cover?.large || record.cover?.medium || record.cover?.small;

    if (!bookForm.dataset.editId && titleInput.value.trim() === "") {
      titleInput.value = title;
    }
    if (!bookForm.dataset.editId && authorInput.value.trim() === "") {
      authorInput.value = authorText;
    }
    if (!bookForm.dataset.editId && yearInput.value.trim() === "" && publishDate) {
      const match = publishDate.match(/\\d{4}/);
      if (match) yearInput.value = match[0];
    }
    if (coverUrl && isbn) {
      coverCache.set(isbn, coverUrl);
    }
  } catch (error) {
    console.warn("ISBN lookup failed", error);
  }
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

importBtn.addEventListener("click", handleImport);
exportBtn.addEventListener("click", handleExport);
fileInput.addEventListener("change", handleFileInput);
isbnInput.addEventListener("change", (event) => {
  lookupIsbn(event.target.value.trim());
});

renderBooks();
finishedInput.value = defaultFinishedDate;
setInterval(updateDefaultFinishedDate, 60 * 1000);
