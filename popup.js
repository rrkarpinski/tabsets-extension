const folderSelect = document.getElementById('folderSelect');
const childFolderWrap = document.getElementById('childFolderWrap');
const childFolderName = document.getElementById('childFolderName');
const writeModeWrap = document.getElementById('writeModeWrap');
const highlightCount = document.getElementById('highlightCount');
const folderWarning = document.getElementById('folderWarning');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

let highlightedTabs = [];
let folderMap = new Map();

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
        rawTitle: node.title || '(untitled folder)'
      });
      if (node.children?.length) flattenFolders(node.children, depth + 1, out);
    }
  }
  return out;
}

function getSelectedSaveMode() {
  return document.querySelector('input[name="saveMode"]:checked').value;
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
  folderSelect.innerHTML = folders
    .map(folder => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.title)}</option>`)
    .join('');
}

async function getFolderChildren(folderId) {
  return chrome.bookmarks.getChildren(folderId);
}

function updateModeVisibility() {
  const saveMode = getSelectedSaveMode();
  const isChildMode = saveMode === 'child';
  childFolderWrap.classList.toggle('hidden', !isChildMode);
  writeModeWrap.classList.toggle('hidden', isChildMode);
}

async function updateFolderWarning() {
  folderWarning.classList.add('hidden');
  folderWarning.textContent = '';

  if (getSelectedSaveMode() !== 'direct' || getSelectedWriteMode() !== 'overwrite') {
    return;
  }

  const folderId = folderSelect.value;
  if (!folderId) return;

  const children = await getFolderChildren(folderId);
  const subfolders = children.filter(item => !item.url);
  const bookmarks = children.filter(item => !!item.url);

  if (subfolders.length > 0) {
    folderWarning.textContent = `This folder currently contains ${bookmarks.length} bookmark(s) and ${subfolders.length} subfolder(s). When you save, you will be asked whether to overwrite recursively or overwrite bookmarks and keep folders.`;
    folderWarning.classList.remove('hidden');
  } else {
    folderWarning.textContent = `This folder currently contains ${bookmarks.length} bookmark(s) and no subfolders. Overwrite will replace those bookmarks only.`;
    folderWarning.classList.remove('hidden');
  }
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

async function askOverwriteBehaviorIfNeeded(folderId) {
  const children = await chrome.bookmarks.getChildren(folderId);
  const hasSubfolders = children.some(item => !item.url);

  if (!hasSubfolders) {
    const proceed = confirm('Overwrite this folder? Existing bookmarks in the selected folder will be replaced.');
    return proceed ? { proceed: true, recursive: false } : { proceed: false, recursive: false };
  }

  const recursive = confirm(
    'This folder contains subfolders.\n\nPress OK to overwrite recursively (delete bookmarks and subfolders inside it).\nPress Cancel to keep subfolders and overwrite bookmarks only.'
  );

  const proceed = confirm(
    recursive
      ? 'Confirm recursive overwrite? This deletes bookmarks and subfolders inside the selected folder before saving.'
      : 'Confirm overwrite while keeping subfolders? This deletes existing bookmarks in the selected folder but keeps its subfolders.'
  );

  return { proceed, recursive };
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

    const selectedFolder = folderMap.get(selectedFolderId);
    const saveMode = getSelectedSaveMode();

    let targetFolderId = selectedFolderId;
    let targetFolderName = selectedFolder?.rawTitle || 'selected folder';

    if (saveMode === 'child') {
      const name = childFolderName.value.trim();
      if (!name) {
        throw new Error('Please enter a name for the new child folder.');
      }

      const createdFolder = await chrome.bookmarks.create({
        parentId: selectedFolderId,
        title: name
      });

      targetFolderId = createdFolder.id;
      targetFolderName = name;
    } else {
      const writeMode = getSelectedWriteMode();
      if (writeMode === 'overwrite') {
        const overwriteDecision = await askOverwriteBehaviorIfNeeded(selectedFolderId);
        if (!overwriteDecision.proceed) {
          setStatus('Cancelled.');
          return;
        }
        await removeFolderContents(selectedFolderId, overwriteDecision.recursive);
      }
    }

    await createBookmarks(targetFolderId, highlightedTabs);
    setStatus(`Saved ${highlightedTabs.length} highlighted tab(s) to "${targetFolderName}".`);
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    saveBtn.disabled = highlightedTabs.length === 0;
  }
}

folderSelect.addEventListener('change', async () => {
  await updateFolderWarning();
});

for (const radio of document.querySelectorAll('input[name="saveMode"], input[name="writeMode"]')) {
  radio.addEventListener('change', async () => {
    updateModeVisibility();
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