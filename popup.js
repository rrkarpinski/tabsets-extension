const STORAGE_KEY_LAST_FOLDER_ID = 'lastSelectedFolderId';

const modeSelect = document.getElementById('modeSelect');
const folderSelect = document.getElementById('folderSelect');
const folderPathPreview = document.getElementById('folderPathPreview');
const sourceSummary = document.getElementById('sourceSummary');
const sameCount = document.getElementById('sameCount');
const addCount = document.getElementById('addCount');
const removeCount = document.getElementById('removeCount');
const sameList = document.getElementById('sameList');
const addList = document.getElementById('addList');
const removeList = document.getElementById('removeList');
const warningBox = document.getElementById('warningBox');
const mergeBtn = document.getElementById('mergeBtn');
const syncBtn = document.getElementById('syncBtn');
const statusEl = document.getElementById('status');

let folderMap = new Map();
let protectedFolderIds = new Set();
let currentDiff = null;

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

function isDirectChildOfRoot(folder) {
  return folder && folder.parentId === '0';
}

function isProtectedTopLevelFolder(folderId) {
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

function filterBookmarkableTabs(tabs) {
  return tabs.filter(tab => {
    const url = tab.url || '';
    return /^https?:/i.test(url) || /^file:/i.test(url);
  });
}

function uniqueByUrl(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.url) continue;
    if (!map.has(item.url)) {
      map.set(item.url, item);
    }
  }
  return [...map.values()];
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

async function getCurrentSetTabs() {
  if (modeSelect.value === 'highlighted') {
    const highlighted = await chrome.tabs.query({ highlighted: true, currentWindow: true });
    return uniqueByUrl(filterBookmarkableTabs(highlighted));
  }
  const windowTabs = await chrome.tabs.query({ currentWindow: true });
  return uniqueByUrl(filterBookmarkableTabs(windowTabs));
}

async function getSavedSetBookmarks(folderId) {
  const children = await chrome.bookmarks.getChildren(folderId);
  return uniqueByUrl(children.filter(item => !!item.url));
}

function makeUrlMap(items) {
  return new Map(items.map(item => [item.url, item]));
}

function renderItemList(element, items) {
  if (!items.length) {
    element.innerHTML = '<li class="details-item"><div class="details-title">None</div></li>';
    return;
  }

  element.innerHTML = items
    .slice(0, 50)
    .map(item => {
      const title = escapeHtml(item.title || item.url);
      const url = escapeHtml(item.url);
      return `<li class="details-item"><div class="details-title">${title}</div><div class="details-url">${url}</div></li>`;
    })
    .join('');

  if (items.length > 50) {
    element.innerHTML += `<li class="details-item"><div class="details-title">...and ${items.length - 50} more</div></li>`;
  }
}

function computeDiff(currentSetTabs, savedSetBookmarks) {
  const currentMap = makeUrlMap(currentSetTabs);
  const savedMap = makeUrlMap(savedSetBookmarks);

  const same = [];
  const add = [];
  const remove = [];

  for (const tab of currentSetTabs) {
    if (savedMap.has(tab.url)) same.push(tab);
    else add.push(tab);
  }

  for (const bookmark of savedSetBookmarks) {
    if (!currentMap.has(bookmark.url)) remove.push(bookmark);
  }

  return { currentSetTabs, savedSetBookmarks, same, add, remove };
}

function renderDiff(diff) {
  currentDiff = diff;
  sameCount.textContent = String(diff.same.length);
  addCount.textContent = String(diff.add.length);
  removeCount.textContent = String(diff.remove.length);

  renderItemList(sameList, diff.same);
  renderItemList(addList, diff.add);
  renderItemList(removeList, diff.remove);

  sourceSummary.textContent = `Current set contains ${diff.currentSetTabs.length} unique tab(s). Saved set contains ${diff.savedSetBookmarks.length} bookmark(s).`;

  if (diff.add.length === 0 && diff.remove.length === 0) {
    warningBox.textContent = 'Merge: no changes.\nSync: no changes. The current set already matches the saved set.';
  } else if (diff.remove.length === 0) {
    warningBox.textContent = `Merge: add ${diff.add.length} tab(s) to the saved set.\nSync: same result. Nothing would be removed from the saved set.`;
  } else {
    warningBox.textContent = `Merge: add ${diff.add.length} tab(s) to the saved set.\nSync: add ${diff.add.length} tab(s) and remove ${diff.remove.length} item(s) that exist only in the saved set.`;
  }
}

async function refreshDiff() {
  const folderId = folderSelect.value;
  if (!folderId) {
    setStatus('Please choose a saved set folder.', true);
    mergeBtn.disabled = true;
    syncBtn.disabled = true;
    return;
  }

  const folderPath = buildFolderPath(folderId);
  folderPathPreview.textContent = folderPath ? `Path: ${folderPath}` : '';

  const currentSetTabs = await getCurrentSetTabs();
  const savedSetBookmarks = await getSavedSetBookmarks(folderId);
  const diff = computeDiff(currentSetTabs, savedSetBookmarks);
  renderDiff(diff);

  const selectedFolder = folderMap.get(folderId);
  const noCurrentTabs = diff.currentSetTabs.length === 0;

  mergeBtn.disabled = noCurrentTabs;
  syncBtn.disabled = noCurrentTabs || (isProtectedTopLevelFolder(folderId) && isDirectChildOfRoot(selectedFolder));

  if (noCurrentTabs) {
    setStatus('No bookmarkable tabs found in the current set.', true);
    return;
  }

  if (syncBtn.disabled && isProtectedTopLevelFolder(folderId) && isDirectChildOfRoot(selectedFolder)) {
    setStatus('Sync is disabled for top-level folders like Bookmarks Bar and Other bookmarks. Merge still works there.', true);
    return;
  }

  setStatus('Diff updated.');
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

async function removeBookmarksByUrl(folderId, urlsToRemove) {
  if (!urlsToRemove.length) return;
  const removeSet = new Set(urlsToRemove);
  const children = await chrome.bookmarks.getChildren(folderId);
  for (const child of children) {
    if (child.url && removeSet.has(child.url)) {
      await chrome.bookmarks.remove(child.id);
    }
  }
}

async function handleMerge() {
  try {
    mergeBtn.disabled = true;
    syncBtn.disabled = true;
    setStatus('Merging...');

    if (!currentDiff) {
      throw new Error('No diff available.');
    }

    const folderId = folderSelect.value;
    const addedCount = currentDiff.add.length;

    await persistSelectedFolder();
    await createBookmarks(folderId, currentDiff.add);
    await refreshDiff();

    const path = buildFolderPath(folderId) || 'saved set';
    setStatus(`Merged current set into "${path}". Added ${addedCount} item(s).`);
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    await refreshDiff().catch(() => {});
  }
}

async function handleSync() {
  try {
    mergeBtn.disabled = true;
    syncBtn.disabled = true;
    setStatus('Syncing...');

    if (!currentDiff) {
      throw new Error('No diff available.');
    }

    const folderId = folderSelect.value;
    const selectedFolder = folderMap.get(folderId);
    const addTotal = currentDiff.add.length;
    const removeTotal = currentDiff.remove.length;

    if (isProtectedTopLevelFolder(folderId) && isDirectChildOfRoot(selectedFolder)) {
      throw new Error('Sync is not allowed for Bookmarks Bar or Other bookmarks.');
    }

    await persistSelectedFolder();
    await removeBookmarksByUrl(folderId, currentDiff.remove.map(item => item.url));
    await createBookmarks(folderId, currentDiff.add);
    await refreshDiff();

    const path = buildFolderPath(folderId) || 'saved set';
    setStatus(`Synced "${path}". Added ${addTotal} item(s) and removed ${removeTotal} item(s).`);
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    await refreshDiff().catch(() => {});
  }
}

modeSelect.addEventListener('change', refreshDiff);
folderSelect.addEventListener('change', async () => {
  await persistSelectedFolder();
  await refreshDiff();
});
mergeBtn.addEventListener('click', handleMerge);
syncBtn.addEventListener('click', handleSync);

(async function init() {
  try {
    await loadFolders();
    await refreshDiff();
  } catch (error) {
    setStatus('Failed to initialize popup: ' + (error.message || error), true);
    mergeBtn.disabled = true;
    syncBtn.disabled = true;
  }
})();