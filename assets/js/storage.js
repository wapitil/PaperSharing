const NOTE_STORAGE_KEY = "paper-sharing-notes";

export const PaperSharingStorage = {
  async readNotes() {
    try {
      const response = await fetch("/api/notes");
      if (!response.ok) {
        throw new Error("API unavailable");
      }
      return await response.json();
    } catch {
      return readLocalNotes();
    }
  },

  async readMyNotes() {
    try {
      const response = await fetch("/api/my-notes");
      if (!response.ok) {
        throw await responseError(response);
      }
      return await response.json();
    } catch (error) {
      if (!canUseLocalFallback(error)) {
        throw error;
      }
      const userName = currentUserName();
      return readLocalNotes().filter((note) => note.ownerName === userName || (!note.ownerName && note.contributorName === userName));
    }
  },

  async writeNotes(notes) {
    try {
      const createdNotes = [];
      for (const note of notes) {
        createdNotes.push(await this.createNote(note));
      }
      return createdNotes;
    } catch {
      localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(notes));
      return notes;
    }
  },

  async createNote(note) {
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(note),
      });

      if (!response.ok) {
        throw await responseError(response);
      }

      return await response.json();
    } catch (error) {
      if (!canUseLocalFallback(error)) {
        throw error;
      }
      const notes = readLocalNotes();
      const nextNote = { ...note, ownerName: note.ownerName || currentUserName() };
      notes.unshift(nextNote);
      localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(notes));
      return nextNote;
    }
  },

  async updateNote(note) {
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(note),
      });

      if (!response.ok) {
        throw await responseError(response);
      }

      return await response.json();
    } catch (error) {
      if (!canUseLocalFallback(error)) {
        throw error;
      }
      const userName = currentUserName();
      const notes = readLocalNotes();
      const index = notes.findIndex((item) => item.id === note.id && isOwnedBy(item, userName));
      if (index === -1) {
        throw new Error("只能修改自己发表的阅读经验。");
      }
      notes[index] = { ...notes[index], ...note, ownerName: notes[index].ownerName || userName };
      localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(notes));
      return notes[index];
    }
  },

  async deleteNote(noteId) {
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw await responseError(response);
      }

      return true;
    } catch (error) {
      if (!canUseLocalFallback(error)) {
        throw error;
      }
      const userName = currentUserName();
      const notes = readLocalNotes();
      const nextNotes = notes.filter((item) => item.id !== noteId || !isOwnedBy(item, userName));
      localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(nextNotes));
      return true;
    }
  },
};

window.PaperSharingStorage = PaperSharingStorage;

function readLocalNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTE_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function currentUserName() {
  return window.PaperSharingSession?.getUserName() || "";
}

async function responseError(response) {
  let message = "API unavailable";
  try {
    const data = await response.json();
    message = data.error || message;
  } catch {
    // Keep the generic message when the server did not return JSON.
  }

  const error = new Error(message);
  error.status = response.status;
  return error;
}

function canUseLocalFallback(error) {
  return !error?.status;
}

function isOwnedBy(note, userName) {
  return note.ownerName === userName || (!note.ownerName && note.contributorName === userName);
}
