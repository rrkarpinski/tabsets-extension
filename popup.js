const STORAGE_KEY_LAST_FOLDER_ID = 'lastSelectedFolderId';

const folderSelect = document.getElementById('folderSelect');
const saveDirectly = document.getElementById('saveDirectly');
const childFolderWrap = document.getElementById('childFolderWrap');
const childFolderName = document.getElementById('childFolderName');
const writeModeWrap = document.getElementById('writeModeWrap');
const highlightCount = document.getElementById('highlightCount');
const folderWarning = document.getElementById('folderWarning');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

let highlightedTabs = [];
let folderMap = new Map();
let protectedFolderIds = new Set();
let overwriteDecision = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'danger' : '';
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function folderDepthTitle(node, depth) {
  const title = node.title || '(untitled folder)';
  return `${'— '.repeat(depth)}${title}`;
}

function flattenFolders(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    if (!node.url) {
      out.push({
        id: node.id,
        title: folderDepthTitle(node, depth),
        rawTitle: node.title || '(untitled folder)',
        parentId: node.parentId || null
      });
      if (node.children?.length) flattenFolders(node.children, depth + 1, out);
    }
  }
  return out;
}

function getSelectedWriteMode() {
  return document.querySelector('input[name="writeMode"]:checked').value;
}

function filterBookmarkableTabs(tabs) {
  return tabs.filter(tab => {
    const url = tab.url || '';
    return /^https?:/i.test(url) || /^file:/i.test(url);
  });
}

function isDirectChildOfRoot(folder) {
  return folder && folder.parentId === '0';
}

function isProtectedOverwriteFolder(folderId) {
  return protectedFolderIds.has(folderId);
}

function buildFolderPath(folderId) {
  const parts = [];
  let current = folderMap.get(folderId);

  while (current && current.id !== '0') {
    if (current.rawTitle && current.rawTitle !== '(untitled folder)') {
      parts.unshift(current.rawTitle);
    }
    current = current.parentId ? folderMap.get(current.parentId) : null;
  }

  return parts.join('/');
}

async function loadHighlightedTabs() {
  const tabs = await chrome.tabs.query({ highlighted: true, currentWindow: true });
  highlightedTabs = filterBookmarkableTabs(tabs);
  highlightCount.textContent = `Highlighted tabs selected: ${highlightedTabs.length}`;

  if (highlightedTabs.length === 0) {
    setStatus('No highlighted bookmarkable tabs found. Highlight tabs first, then reopen the popup.', true);
    saveBtn.disabled = true;
  } else {
    setStatus(`Ready to save ${highlightedTabs.length} highlighted tab(s).`);
    saveBtn.disabled = false;
  }
}

async function loadFolders() {
  const tree = await chrome.bookmarks.getTree();
  const folders = flattenFolders(tree);
  folderMap = new Map(folders.map(folder => [folder.id, folder]));

  protectedFolderIds = new Set(
    folders
      .filter(folder => folder.parentId === '0' && folder.rawTitle !== '(untitled folder)')
      .map(folder => folder.id)
  );

  const selectableFolders = folders.filter(folder => folder.id !== '0');

  folderSelect.innerHTML = selectableFolders
    .map(folder => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.title)}</option>`)
    .join('');

  const stored = await chrome.storage.local.get(STORAGE_KEY_LAST_FOLDER_ID);
  const storedFolderId = stored[STORAGE_KEY_LAST_FOLDER_ID];

  if (storedFolderId && selectableFolders.some(folder => folder.id === storedFolderId)) {
    folderSelect.value = storedFolderId;
    return;
  }

  const bookmarksBar = selectableFolders.find(
    folder => folder.parentId === '0' && /bookmark/i.test(folder.rawTitle) && /bar/i.test(folder.rawTitle)
  );
  const otherBookmarks = selectableFolders.find(
    folder => folder.parentId === '0' && /other/i.test(folder.rawTitle)
  );
  const fallback = bookmarksBar || otherBookmarks || selectableFolders[0];

  if (fallback) {
    folderSelect.value = fallback.id;
  }
}

async function persistSelectedFolder() {
  const folderId = folderSelect.value;
  if (!folderId) return;
  await chrome.storage.local.set({ [STORAGE_KEY_LAST_FOLDER_ID]: folderId });
}

async function getFolderChildren(folderId) {
  return chrome.bookmarks.getChildren(folderId);
}

function resetOverwriteDecision() {
  overwriteDecision = null;
}

function renderOverwriteWarning(message, actions = []) {
  folderWarning.innerHTML = '';
  folderWarning.classList.remove('hidden');

  const text = document.createElement('div');
  text.textContent = message;
  folderWarning.appendChild(text);

  if (actions.length > 0) {
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'warning-actions';

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      if (action.secondary) button.classList.add('secondary-btn');
      button.addEventListener('click', action.onClick);
      actionsWrap.appendChild(button);
    }

    folderWarning.appendChild(actionsWrap);
  }
}

function clearWarning() {
  folderWarning.innerHTML = '';
  folderWarning.classList.add('hidden');
}

function updateModeVisibility() {
  const direct = saveDirectly.checked;
  childFolderWrap.classList.toggle('hidden', direct);
  writeModeWrap.classList.toggle('hidden', !direct);
}

async function updateFolderWarning() {
  resetOverwriteDecision();
  clearWarning();

  if (!saveDirectly.checked || getSelectedWriteMode() !== 'overwrite') {
    return;
  }

  const folderId = folderSelect.value;
  if (!folderId) return;

  const selectedFolder = folderMap.get(folderId);
  if (isProtectedOverwriteFolder(folderId) && isDirectChildOfRoot(selectedFolder)) {
    renderOverwriteWarning(
      'Overwrite is disabled for top-level folders like Bookmarks Bar and Other bookmarks. You can still append there or create a child folder inside them.'
    );
    return;
  }

  const children = await getFolderChildren(folderId);
  const subfolders = children.filter(item => !item.url);
  const bookmarks = children.filter(item => !!item.url);

  if (subfolders.length > 0) {
    renderOverwriteWarning(
      `This folder currently contains ${bookmarks.length} bookmark(s) and ${subfolders.length} subfolder(s). Choose how overwrite should behave:`,
      [
        {
          label: 'Overwrite recursively',
          onClick: () => {
            overwriteDecision = { recursive: true };
            updateFolderWarning();
          }
        },
        {
          label: 'Overwrite bookmarks, keep folders',
          onClick: () => {
            overwriteDecision = { recursive: false };
            updateFolderWarning();
          }
        }
      ]
    );
    return;
  }

  overwriteDecision = { recursive: false };
  renderOverwriteWarning(
    `This folder currently contains ${bookmarks.length} bookmark(s) and no subfolders. Overwrite will replace those bookmarks only.`
  );
}

async function removeFolderContents(folderId, recursive) {
  const children = await chrome.bookmarks.getChildren(folderId);
  for (const child of children) {
    if (child.url) {
      await chrome.bookmarks.remove(child.id);
    } else if (recursive) {
      await chrome.bookmarks.removeTree(child.id);
    }
  }
}

async function createBookmarks(folderId, tabs) {
  for (const tab of tabs) {
    await chrome.bookmarks.create({
      parentId: folderId,
      title: tab.title || tab.url,
      url: tab.url
    });
  }
}

async function handleSave() {
  try {
    saveBtn.disabled = true;
    setStatus('Working...');

    if (highlightedTabs.length === 0) {
      throw new Error('No highlighted bookmarkable tabs found.');
    }

    const selectedFolderId = folderSelect.value;
    if (!selectedFolderId) {
      throw new Error('Please choose a folder.');
    }

    await persistSelectedFolder();

    let targetFolderId = selectedFolderId;

    if (!saveDirectly.checked) {
      const name = childFolderName.value.trim();
      if (!name) {
        throw new Error('Please enter a name for the new child folder.');
      }

      const createdFolder = await chrome.bookmarks.create({
        parentId: selectedFolderId,
        title: name
      });

      targetFolderId = createdFolder.id;
      folderMap.set(createdFolder.id, {
        id: createdFolder.id,
        rawTitle: name,
        title: name,
        parentId: selectedFolderId
      });
    } else {
      const writeMode = getSelectedWriteMode();
      const selectedFolder = folderMap.get(selectedFolderId);

      if (writeMode === 'overwrite') {
        if (isProtectedOverwriteFolder(selectedFolderId) && isDirectChildOfRoot(selectedFolder)) {
          throw new Error('Overwrite is not allowed for Bookmarks Bar or Other bookmarks.');
        }

        if (overwriteDecision === null) {
          throw new Error('Please choose the overwrite behavior in the warning box first.');
        }

        await removeFolderContents(selectedFolderId, overwriteDecision.recursive);
      }
    }

    const fullPath =
      buildFolderPath(targetFolderId) ||
      folderMap.get(targetFolderId)?.rawTitle ||
      'selected folder';

    await createBookmarks(targetFolderId, highlightedTabs);
    setStatus(`Saved ${highlightedTabs.length} highlighted tab(s) to "${fullPath}".`);
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    saveBtn.disabled = highlightedTabs.length === 0;
  }
}

folderSelect.addEventListener('change', async () => {
  await persistSelectedFolder();
  await updateFolderWarning();
});

saveDirectly.addEventListener('change', async () => {
  updateModeVisibility();
  await updateFolderWarning();
});

for (const radio of document.querySelectorAll('input[name="writeMode"]')) {
  radio.addEventListener('change', async () => {
    await updateFolderWarning();
  });
}

saveBtn.addEventListener('click', handleSave);

(async function init() {
  try {
    await loadFolders();
    await loadHighlightedTabs();
    updateModeVisibility();
    await updateFolderWarning();
  } catch (error) {
    setStatus('Failed to initialize popup: ' + (error.message || error), true);
    saveBtn.disabled = true;
  }
})();