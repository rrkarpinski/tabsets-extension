const STORAGE_KEY_LAST_FOLDER_ID = 'lastSelectedFolderId';

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

function getSelectedSourceMode() {
  return document.querySelector('input[name="sourceMode"]:checked').value;
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

async function getSourceTabs() {
  const mode = getSelectedSourceMode();
  if (mode === 'highlighted') {
    const highlighted = await chrome.tabs.query({ highlighted: true, currentWindow: true });
    return uniqueByUrl(filterBookmarkableTabs(highlighted));
  }
  const windowTabs = await chrome.tabs.query({ currentWindow: true });
  return uniqueByUrl(filterBookmarkableTabs(windowTabs));
}

async function getFolderBookmarks(folderId) {
  const children = await chrome.bookmarks.getChildren(folderId);
  return uniqueByUrl(children.filter(item => !!item.url));
}

function makeUrlMap(items) {
  return new Map(items.map(item => [item.url, item]));
}

function renderUrlList(element, items) {
  if (!items.length) {
    element.innerHTML = '<li>None</li>';
    return;
  }

  element.innerHTML = items
    .slice(0, 50)
    .map(item => `<li>${escapeHtml(item.title || item.url)} — ${escapeHtml(item.url)}</li>`)
    .join('');

  if (items.length > 50) {
    element.innerHTML += `<li>...and ${items.length - 50} more</li>`;
  }
}

function computeDiff(sourceTabs, folderBookmarks) {
  const sourceMap = makeUrlMap(sourceTabs);
  const folderMapByUrl = makeUrlMap(folderBookmarks);

  const same = [];
  const add = [];
  const remove = [];

  for (const tab of sourceTabs) {
    if (folderMapByUrl.has(tab.url)) same.push(tab);
    else add.push(tab);
  }

  for (const bookmark of folderBookmarks) {
    if (!sourceMap.has(bookmark.url)) remove.push(bookmark);
  }

  return { sourceTabs, folderBookmarks, same, add, remove };
}

function renderDiff(diff) {
  currentDiff = diff;
  sameCount.textContent = String(diff.same.length);
  addCount.textContent = String(diff.add.length);
  removeCount.textContent = String(diff.remove.length);

  renderUrlList(sameList, diff.same);
  renderUrlList(addList, diff.add);
  renderUrlList(removeList, diff.remove);

  sourceSummary.textContent = `Source contains ${diff.sourceTabs.length} unique bookmarkable tab(s). Folder contains ${diff.folderBookmarks.length} bookmark(s).`;

  if (diff.add.length === 0 && diff.remove.length === 0) {
    warningBox.textContent = 'Workspace and folder are already in sync. Merge and sync would make no changes.';
  } else if (diff.remove.length === 0) {
    warningBox.textContent = `Merge will add ${diff.add.length} bookmark(s). Sync will produce the same result because there are no folder-only bookmarks to remove.`;
  } else {
    warningBox.textContent = `Merge will add ${diff.add.length} bookmark(s) and remove nothing. Sync will add ${diff.add.length} bookmark(s) and remove ${diff.remove.length} folder-only bookmark(s) so the folder matches the source exactly.`;
  }
}

async function refreshDiff() {
  const folderId = folderSelect.value;
  if (!folderId) {
    setStatus('Please choose a target folder.', true);
    mergeBtn.disabled = true;
    syncBtn.disabled = true;
    return;
  }

  const folderPath = buildFolderPath(folderId);
  folderPathPreview.textContent = folderPath ? `Target path: ${folderPath}` : '';

  const sourceTabs = await getSourceTabs();
  const folderBookmarks = await getFolderBookmarks(folderId);
  const diff = computeDiff(sourceTabs, folderBookmarks);
  renderDiff(diff);

  const selectedFolder = folderMap.get(folderId);
  const noSourceTabs = diff.sourceTabs.length === 0;

  mergeBtn.disabled = noSourceTabs;
  syncBtn.disabled = noSourceTabs || (isProtectedOverwriteFolder(folderId) && isDirectChildOfRoot(selectedFolder));

  if (noSourceTabs) {
    setStatus('No bookmarkable tabs found in the selected source mode.', true);
    return;
  }

  if (syncBtn.disabled && isProtectedOverwriteFolder(folderId) && isDirectChildOfRoot(selectedFolder)) {
    setStatus('Sync is disabled for top-level folders like Bookmarks Bar and Other bookmarks. You can still merge into them.', true);
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
  const children = await chrome.bookmarks.getChildren(folderId);
  for (const child of children) {
    if (child.url && urlsToRemove.includes(child.url)) {
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

    const path = buildFolderPath(folderId) || 'selected folder';
    setStatus(`Merged workspace into "${path}". Added ${addedCount} new bookmark(s).`);
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

    if (isProtectedOverwriteFolder(folderId) && isDirectChildOfRoot(selectedFolder)) {
      throw new Error('Sync is not allowed for Bookmarks Bar or Other bookmarks.');
    }

    await persistSelectedFolder();
    await removeBookmarksByUrl(folderId, currentDiff.remove.map(item => item.url));
    await createBookmarks(folderId, currentDiff.add);
    await refreshDiff();

    const path = buildFolderPath(folderId) || 'selected folder';
    setStatus(`Synced folder "${path}". Added ${addTotal} and removed ${removeTotal} bookmark(s).`);
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    await refreshDiff().catch(() => {});
  }
}

folderSelect.addEventListener('change', async () => {
  await persistSelectedFolder();
  await refreshDiff();
});

for (const radio of document.querySelectorAll('input[name="sourceMode"]')) {
  radio.addEventListener('change', async () => {
    await refreshDiff();
  });
}

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