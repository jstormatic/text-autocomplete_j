# Text Autocomplete

Utilize text autocomplete to type more efficiently.

## Features

- A dropdown of suggested words of the currently typed word
- Replace the currently typed word with a suggestion from the dropdown by:
  - Selecting a suggestion with your cursor
  - Selecting the highlighted suggestion with the `enter`/`tab` keys 
- Navigate dropdown suggestions with the `up/down arrow` keys
- Hide the dropdown with the `esc` key at which point all keys have their default functionalities
- To use the default `enter` key functionality, additionally hold the `shift` key: `shift + enter`

### Custom dictionary

The custom dictionary is a list of words you curate that is added to the plugin's dictionary. The words from the custom dictionary can then be suggested in future dropdowns. You can view all words in the custom dictionary from the plugin settings.

#### Modification

- Words can be individually added to the custom dictionary in the following two ways:
  - From the plugin settings
  - In the context menu of selected text (accessible via `right click`)
- Words can be individually removed from the custom dictionary only from within the plugin settings
- The custom dictionary can be reset in the plugin settings

### Imported dictionaries

In addition to the custom dictionary, dictionaries can be imported. Imported dictionaries can be added/removed in the plugin settings and must be Text Files (`.txt`) with one word on each line. You can view all imported dictionaries from the plugin settings.

## Additional

- The maximum number of suggestions is modifiable in the plugin settings (0-10)
- The plugin can be disabled from the plugin settings
- English is the only supported language at the moment
- For the time being, all features are disabled within code blocks (typing within code blocks is not supported)

#### Thanks to everyone using the plugin!

---

# Text Autocomplete V2 (Using the power of AI, some new features and implementations were added/modified)

Text Autocomplete V2 provides fast, configurable word suggestions while typing in Obsidian.

## Core Suggestions

- Suggest words based on what you have started typing.
- Display between 0 and 10 suggestions at once.
- Cycle through matching suggestions with the Up and Down arrow keys.
- Accept a suggestion with **Enter** or **Tab**.
- Close suggestions with **Escape**.
- Automatically add a space after accepting a suggestion.
- Enable or disable case-sensitive matching.
- Disable autocomplete inside code blocks.

### One-Suggestion Mode

With **Maximum suggestions** set to `1`, the plugin can still show every matching alternative:

- Press **Down** to see the next suggestion.
- Press **Up** to see the previous suggestion.
- Press **Enter** or **Tab** to accept the displayed word.
- Press **Escape** to close the dropdown.

## Custom Dictionary

### Adding Words

- Add a word manually in **Settings**.
- Press Enter after typing a word to add it.
- Select text in a note and add it through the editor context menu.

#### Learned Words
A feature that was specifically implemented for the use of repeated words.

- Automatically learn frequently typed words. Modifiable value for the learning threshold to be added as a custom word (default: 3).

### Suggestion Priority
Suggestions are ranked using a priority score.

#### Ranking Rules
Pinned words receive the highest priority.
Custom words rank above ordinary built-in words.
Imported words receive their own dictionary priority.
Frequently accepted suggestions become more likely to appear first.
Frequently typed built-in words gradually increase their ranking.
Removed words are removed from the internal suggestion index.
Renamed words retain their usage history where applicable.
Accepted Suggestion Counts
The plugin tracks how many times a word is selected from the autocomplete dropdown.

These counts can be used to:

Identify frequently used words.
Sort dictionary words by usage.
Improve suggestion ordering over time.
Frequently Typed Words
Built-in words can increase in priority when they are repeatedly completed naturally.

For example, if serial and serious both match seri, repeatedly typing serious will gradually increase its score, allowing it to become the higher-priority suggestion.

### Punctuation-Aware Learning
Most punctuation is ignored when learning words:

sentence. becomes sentence
word! becomes word
example, becomes example
Common abbreviations are preserved:

etc.
e.g.
i.e.
mr.
mrs.
ms.
dr.
prof.
Typing either etc or etc. learns the canonical form etc. rather than creating a competing etc entry.

### Managing Words

- Search the custom and imported dictionaries.
- Sort words alphabetically or by accepted-suggestion count.
- Inline edit custom words.
- Remove individual words.
- Select multiple words for bulk removal.
- Undo the most recently removed word.
- Reset the entire custom dictionary.
- Export the custom dictionary as a one-word-per-line `.txt` file.
- Prevent duplicate entries.

### Large Dictionaries

- Adjustable pagination of 10–200 words per page.
- Search across all custom and imported words.
- Expanded scrollable list for long dictionaries.
- Display custom, imported, and usage statistics.
- Use a dedicated **Previous** and **Next** control for navigation.

## Automatic Word Learning

### Learning Controls

- Enable or disable automatic learning.
- Set the learning threshold from 2–10 uses. Default value is 3.
- Learned words are added to the custom dictionary.
- Words already in another dictionary are not learned again.

### Word Completion Triggers

A word can be learned after it is completed by:

- Pressing **Space**
- Typing punctuation
- Pressing **Enter**

## Imported Dictionaries

- Import one-word-per-line `.txt` files.
- Import the original source file directly from the file picker.
- View imported words alongside custom words.
- Identify each word's source dictionary.
- Display the filename and source file path.
- Remove imported dictionaries from settings.
- Detect duplicate imports.
- Reject empty or invalid dictionary files.
- Export custom entries separately.

## Pinned Words

- Pin important custom or imported words.
- Pinned words appear at the top of the settings list.
- Pinned words receive priority in suggestions.
- Unpinning restores the word's previous ranking.

## Word Ranking

- Track how many times a suggestion is accepted.
- Display **Suggestion accepts** for every dictionary word.
- Sort words by accepted-suggestion usage.
- Increase ranking after accepting a suggestion.
- Rebuild the suggestion index after adding, editing, or removing words.
- Prevent removed words from remaining in the suggestion list.
- Preserve usage data when renaming words.

## Text File Synchronization

### Plugin to Text File

- Append learned words to the selected source `.txt` file.
- Remove words from source files when removed in Obsidian.
- Rename words in source files when they are edited in Obsidian.
- Update source files during bulk removal or dictionary reset.

### Text File to Plugin

- Detect changes made outside Obsidian.
- Add newly inserted words to the plugin automatically.
- Remove deleted words from the plugin automatically.
- Use native file watching instead of repeated polling.
- Debounce save events to avoid duplicate reloads.
- Enable or disable automatic watching.
- Reload imported dictionaries manually with **Reload now**.

## Imported and Custom Dictionary Settings

The settings panel includes controls for:

- Search and sorting
- Words per page
- Manual word additions
- Inline editing
- Pinned words
- Bulk selection and removal
- Individual removal
- Undo and reset
- Dictionary export
- Source-file synchronization
- Automatic external reload
- Manual reload
- Usage statistics
- Imported dictionary management

## General Settings

- Enable or disable autocomplete.
- Choose 0–10 visible suggestions.
- Enable Enter or Tab as accept keys.
- Hold Shift with Enter to use Enter normally.
- Enable or disable automatic spaces.
- Enable or disable case sensitivity.
- Enable or disable automatic learning.
- Configure the learning threshold.
- Enable or disable updates to imported Text Files.
- Enable or disable external dictionary watching.

## Example Workflow

1. Import a one-word-per-line `.txt` dictionary.
2. Search and pin frequently used words.
3. Enable automatic learning.
4. Type words followed by Space, punctuation, or Enter.
5. Cycle through alternative suggestions using the arrow keys.
6. Edit, pin, remove, or export words in settings.
7. Edit the source Text File externally or inside Obsidian.
8. The plugin keeps suggestions synchronized with dictionary changes.

---

## 25/11/2026 Updates

This version expands Text Autocomplete with improved learning, phrase handling, dictionary synchronization, ranking, statistics, and a redesigned settings interface.

### Improved Suggestions

- Support for autocomplete after additional words on the same line.
- Suggested phrases can contain spaces.
- Optional autocomplete inside:
  - Quotation marks
  - Apostrophes
  - Square brackets
  - Braces
  - Parentheses
- Continue displaying alternatives when **Maximum suggestions** is set to `1`.
- Use nearby words and note context to improve suggestion ordering.
- Suggestions remain disabled inside code blocks.
- Suggestions can work before Obsidian-inserted closing delimiters.

### Word Learning

- Automatically learn frequently typed words and phrases.
- Manually add a learned word or phrase from the command palette.
- Configure the number of uses required before a word is learned.
- Prevent unwanted words from being learned through an ignored-word list.
- Recover ignored words after enough intentional completions.
- Track recently learned words and the most recently learned entry.
- Optional chime when a new word is learned.
- Protect imported and built-in dictionary words from being incorrectly learned or modified.
- Normalize punctuation while learning common words and abbreviations.
- Experimental replacement detection for distinguishing intentional rewrites from accidental deletions.

### Dictionary Improvements

- Import both `.txt` and `.md` files.
- Support one word or phrase per line.
- View the source filename and path for imported dictionaries.
- Remove individual imported dictionaries.
- Detect duplicate imports and reject invalid or empty files.
- Add, edit, pin, search, sort, remove, reset, and export custom words.
- Edit words inline without losing their usage history.
- Perform bulk selection and removal.
- Undo the latest removal.
- Keep imported source files synchronized when words are added, edited, removed, or reset.
- Reload dictionaries manually or watch external source files for changes.
- Rebuild the internal suggestion index after dictionary updates.

### Ranking and Usage Tracking

- Track accepted suggestions and frequently typed words.
- Increase word priority through repeated acceptance or natural completion.
- Pin important custom or imported words.
- Use context-based ranking when enabled.
- Rename dictionary entries while retaining usage history where possible.
- Display each word’s priority score, accepted-suggestion count, source, and pinned state.
- Remove deleted words from the active suggestion index immediately.

### New Statistics Dashboard

- Display total suggestions accepted.
- Track newly learned, ignored, and deleted words.
- Show first-use information.
- Visualize the most frequently accepted words.
- Display suggestion-acceptance activity by day and hour.
- Group accepted words by short, medium, and long length.
- Show recently learned words.
- Display a paginated word-priority ranking.
- Reset statistics from the settings panel.

### Settings Interface Redesign

- Added a prominent Text Autocomplete title and description.
- Organized settings into consistent category cards:
  - General
  - Suggestions
  - Punctuation
  - Learning
  - Imported Dictionaries
  - Custom Dictionary
- Grouped learned and ignored word controls within their respective settings.
- Added consistent heading lines, borders, spacing, and themed buttons.
- Improved pagination for custom words, ignored words, accepted words, and priority rankings.
- Added adjustable page sizes for larger dictionaries.
- Prevented pagination from moving lists to unrelated parts of the settings page.
- Added consistent hover and disabled states for all pagination controls.
- Improved responsive behavior and list scrolling for larger dictionaries.

### Additional Commands and Controls

New utility commands include controls for:

- Reloading dictionaries.
- Adding learned words manually.
- Removing or ignoring the most recently learned word.
- Pinning or unpinning the most recently learned word.
- Testing the learned-word chime.
- Adding ignored words.
- Removing ignored words.
- Resetting statistics.

### Maintenance

- Removed unused state, obsolete cleanup code, and unnecessary implementation fragments.
- Rebuilt the production bundle and verified the TypeScript build successfully.

## Credits

**Kind thanks to c-degni/Christ Degni for this plugin. All credits go to them.**
