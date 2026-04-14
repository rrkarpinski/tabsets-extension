const tabMode = document.getElementById('tabMode');
const destMode = document.getElementById('destMode');
const folderSelect = document.getElementById('folderSelect');
const existingFolderWrap = document.getElementById('existingFolderWrap');
const newFolderWrap = document.getElementById('newFolderWrap');
const folderName = document.getElementById('folderName');
const overwrite = document.getElementById('overwrite');
const recursive = document.getElementById('recursive');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

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
                title: folderDepthTitle(node, depth)
            });

            if (node.children?.length) {
                flattenFolders(node.children, depth + 1, out);
            }
        }
    }
    return out;
}

async function loadFolders() {
    const tree = await chrome.bookmarks.getTree();
    const folders = flattenFolders(tree);

    folderSelect.innerHTML = folders
        .map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.title)}</option>`)
        .join('');
}

async function getTabsToSave(mode) {
    if (mode === 'active') {
        return chrome.tabs.query({ active: true, currentWindow: true });
    }

    if (mode === 'all') {
        return chrome.tabs.query({ currentWindow: true });
    }

    const highlighted = await chrome.tabs.query({
        highlighted: true,
        currentWindow: true
    });

    if (highlighted.length > 0) return highlighted;

    return chrome.tabs.query({ active: true, currentWindow: true });
}

function filterBookmarkableTabs(tabs) {
    return tabs.filter(tab => {
        const url = tab.url || '';
        return /^https?:/i.test(url) || /^file:/i.test(url);
    });
}

async function removeChildren(folderId, deep) {
    const [folder] = await chrome.bookmarks.getSubTree(folderId);
    const children = folder?.children || [];

    for (const child of children) {
        if (child.url) {
            await chrome.bookmarks.remove(child.id);
        } else if (deep) {
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

function toggleDestinationUi() {
    const isNew = destMode.value === 'new';

    existingFolderWrap.classList.toggle('hidden', isNew);
    newFolderWrap.classList.toggle('hidden', !isNew);

    overwrite.disabled = isNew;
    recursive.disabled = isNew || !overwrite.checked;

    if (isNew) {
        overwrite.checked = false;
        recursive.checked = false;
    }
}

overwrite.addEventListener('change', () => {
    recursive.disabled = destMode.value === 'new' || !overwrite.checked;

    if (recursive.disabled) {
        recursive.checked = false;
    }
});

destMode.addEventListener('change', toggleDestinationUi);

saveBtn.addEventListener('click', async () => {
    try {
        saveBtn.disabled = true;
        setStatus('Working...');

        const tabs = filterBookmarkableTabs(
            await getTabsToSave(tabMode.value)
        );

        if (!tabs.length) {
            throw new Error(
                'No bookmarkable tabs found. Internal browser pages like brave:// are skipped.'
            );
        }

        let targetFolderId;

        if (destMode.value === 'new') {
            const name = folderName.value.trim();

            if (!name) {
                throw new Error('Please enter a new folder name.');
            }

            const created = await chrome.bookmarks.create({ title: name });
            targetFolderId = created.id;
        } else {
            targetFolderId = folderSelect.value;

            if (!targetFolderId) {
                throw new Error('Please choose an existing folder.');
            }

            if (overwrite.checked) {
                const proceed = confirm(
                    recursive.checked
                        ? 'Overwrite recursively? This deletes all bookmarks and subfolders inside the selected folder before saving.'
                        : 'Overwrite folder? This deletes current bookmarks inside the selected folder before saving.'
                );

                if (!proceed) {
                    setStatus('Cancelled.');
                    saveBtn.disabled = false;
                    return;
                }

                await removeChildren(targetFolderId, recursive.checked);
            }
        }

        await createBookmarks(targetFolderId, tabs);

        setStatus(`Saved ${tabs.length} bookmark(s) successfully.`);
    } catch (err) {
        setStatus(err.message || String(err), true);
    } finally {
        saveBtn.disabled = false;
    }
});

(async function init() {
    try {
        await loadFolders();
        toggleDestinationUi();
        setStatus('Ready.');
    } catch (err) {
        setStatus(
            'Failed to load bookmarks folders: ' + (err.message || err),
            true
        );
    }
})();