# TabSets Sync

TabSets Sync is a Brave/Chrome extension that uses **bookmark folders as saved tab sets**, where a tab set is just a group of tabs related to one topic/project/task - like tab groups or workspaces.

Instead of relying on tab groups to hold that state, TabSets uses bookmark folders as the saved state. Bookmarks already have strong native support: they are stable, easy to inspect, organise, back up, export/import, and are widely supported across browsers. Managing tab groups is much less supported.

What bookmarks lack is a good way to keep that saved state in sync with your live tabs. That is what this extension adds.

Given all tabs in the current window or only highlighted tabs, TabSets Sync compares that **current set** against a **saved set** stored in a bookmark folder, shows the URL diff, then lets you update the saved set explicitly with **Merge** or **Sync**.

## Actions

- **Merge into saved set** — add URLs from the current set that are missing from the saved set, without removing anything
- **Sync saved set** — make the saved set match the current set by adding missing URLs and removing URLs that exist only in the saved set

## Notes

- Comparison is based on **URL**
- Duplicate URLs in the current set are collapsed before comparison
- The popup can use **all window tabs** or **highlighted tabs only** [web:2][web:14]

## Install locally

1. Open `brave://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder
