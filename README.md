# TabSets Sync

TabSets Sync is a Brave/Chrome extension that treats a **bookmark folder as a saved tab set**.

It compares your **current set** of tabs — either all tabs in the current window or only highlighted tabs — against a chosen **saved set** stored in bookmarks, then shows the URL diff before you update anything.

## What it does

- Compare the current set with an existing saved set
- Show which URLs are already saved
- Show which URLs exist only in the current set
- Show which URLs exist only in the saved set
- Update the saved set with **Merge** or **Sync**

## Actions

- **Merge into saved set** — add URLs from the current set that are missing from the saved set, without removing anything
- **Sync saved set** — make the saved set match the current set by adding missing URLs and removing URLs that exist only in the saved set

## What makes it different

This is **not** a general bookmark manager, tab manager, or tab-group extension.

Its core idea is simple:

- live browser tabs = the **current set**
- one bookmark folder = the **saved set**
- the extension compares them and updates the saved set intentionally

That makes it useful when you want to keep a bookmark-backed tab set up to date without constantly creating new bookmark folders.

## Notes

- Comparison is based on **URL**
- Duplicate URLs in the current set are collapsed before comparison
- The popup can use **all window tabs** or **highlighted tabs only**
- The saved set is any bookmark folder you choose

## Install locally

1. Open `brave://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

## Files

```text
manifest.json
popup.html
popup.js
README.md
icon16.png
icon48.png
icon128.png
```
