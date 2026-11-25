import { App, Editor, EditorPosition, Plugin, Menu, MenuItem, Modal, Notice, Setting } from 'obsidian';
import { TASettingsTab, DEFAULT_SETTINGS, TASettings, DictionaryFile } from './settings/settings';
import { createTAUI, destroyTAUI, updateSuggestions } from './settings/ui';
import { closingDelimiterAfterCursor, inCodeBlock, Result, stringInWordOrBeforePunctuation, wordBeforeString } from './utils';
import { DEFAULT_DICTIONARIES, Dictionary } from './dictionary/dictionary';
import { Trie } from './dictionary/trie';
import { ACCEPTED_SUGGESTION_BUMP, CUSTOM_WORD_SCORE, DEFAULT_WORD_SCORE, DUPLICATE_FILE, DUPLICATE_WORD, EMPTY_FILE, IMPORT_WORD_SCORE, NOT_OK, OK, PUNCTUATED_WORDS } from './constants';

class WordPromptModal extends Modal {
	private submitted: (word: string) => void;
	private submittedOnce: boolean = false;

	constructor(app: App, submitted: (word: string) => void) {
		super(app);
		this.submitted = submitted;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Add learned word' });

		let value = '';
		new Setting(contentEl)
			.setName('Word or phrase')
			.addText((text) => {
				text.setPlaceholder('Enter word or phrase');
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						this.submitOnce(text.getValue().trim());
					}
				});
				value = text.getValue();
			})
			.addButton((button) =>
				button
					.setButtonText('Add')
					.setCta()
					.onClick(() => {
						const input = contentEl.querySelector('input') as HTMLInputElement | null;
						this.submitOnce(input?.value.trim() ?? value);
					}));

		window.setTimeout(() => contentEl.querySelector('input')?.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submitOnce(word: string): void {
		if (this.submittedOnce) return;
		this.submittedOnce = true;
		this.submitted(word);
		this.close();
	}
}

export default class TAPlugin extends Plugin {
	settings!: TASettings;
	wordTrie!: Trie;
	lastCursor!: EditorPosition | null;
	settingsTab!: TASettingsTab | null;
	private importedDictionaryWatchers: Map<string, { close(): void }> = new Map();
	private importedDictionaryWatchTimers: Map<string, number> = new Map();
	private availableSuggestions: string[] = [];
	private suggestionIndex: number = 0;
	private pendingDeletedWords: Set<string> = new Set();
	private chimeContext: AudioContext | null = null;
	private lastWordCompletion: { word: string; line: number; ch: number } | null = null;
	private slashMenuEl: HTMLUListElement | null = null;

	async onload() {
		await this.loadSettings();
		await this.loadWordTrie();

		this.settingsTab = new TASettingsTab(this.app, this);
		this.addSettingTab(this.settingsTab);
		this.registerUtilityCommands();

		this.registerEvent(this.app.workspace.on('editor-change', this.handleEditorChange.bind(this)));
		this.registerEvent(this.app.workspace.on('editor-menu', this.handleContextMenu.bind(this)));
		this.registerDomEvent(document, 'keydown', this.handleKeyDown.bind(this), { capture: true });
		this.registerEditorExtension(createTAUI());
		this.startImportedDictionaryWatching();
		if (this.settings.learnedWordChime) {
			window.setTimeout(() => {
				void this.playLearnedWordChime();
			}, 500);
		}
	}

	onunload() {
		this.destroySlashMenu();
		for (const watcher of this.importedDictionaryWatchers.values()) watcher.close();
		this.importedDictionaryWatchers.clear();
		for (const timer of this.importedDictionaryWatchTimers.values()) window.clearTimeout(timer);
		this.importedDictionaryWatchTimers.clear();
		if (this.chimeContext) {
			void this.chimeContext.close();
			this.chimeContext = null;
		}
		destroyTAUI();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings.learnedWordCounts ??= {};
		this.settings.typedWordCounts ??= {};
		this.settings.ignoredWords ??= [];
		this.settings.lastLearnedWord ??= null;
		this.settings.learnedWordHistory ??= [];
		this.settings.ignoredWordRecoveryThreshold ??= 4;
		this.settings.ignoredWordRecoveryCounts ??= {};
		this.settings.experimentalReplacementDetection ??= false;
		this.settings.replacementSimilarityThreshold ??= 55;
		this.settings.contextRankingEnabled ??= true;
		this.settings.contextWordCounts ??= {};
		this.settings.deletedWordCount ??= 0;
		this.settings.ignoredWordCount ??= 0;
		this.settings.newlyLearnedWordCount ??= 0;
		this.settings.firstUsedAt ??= new Date().toISOString();
		this.settings.ignoredWords = [...new Set(
			this.settings.ignoredWords
				.filter((word) => /^[A-Za-z][A-Za-z'-]{1,40}$/.test(word))
				.map((word) => word.toLowerCase())
		)];

		for (const word of [...this.settings.customDict,
			...this.settings.dictFiles.flatMap((file) => file.words)]) {
			delete this.settings.learnedWordCounts[word];
		}

		this.settings.customDict = this.settings.customDict
			.map((word) => word.replace(/'+$/, ''))
			.filter((word) => word.length >= 3);
		this.settings.customDict = [...new Set(this.settings.customDict)];

		this.settings.customDict = [...new Set(
			this.settings.customDict.filter((word) =>
				!this.settings.ignoredWords.includes(word.toLowerCase())
			)
		)];

		this.settings.pinnedWords = this.settings.pinnedWords.filter((word) =>
			!this.settings.ignoredWords.includes(word.toLowerCase())
		);
		this.settings.learningThreshold ??= 3;
		this.settings.learnFromTyping ??= true;
		this.settings.learnedWordChime ??= false;
		this.settings.punctuationAutocomplete ??= false;
		this.settings.punctuationQuotes ??= true;
		this.settings.punctuationApostrophes ??= true;
		this.settings.punctuationSquareBrackets ??= true;
		this.settings.punctuationBraces ??= true;
		this.settings.punctuationParentheses ??= true;
		this.settings.updateImportedDictionary ??= true;
		this.settings.autoReloadImportedDictionaries ??= true;
		this.settings.acceptedWordCounts ??= {};
		this.settings.acceptedActivity ??= {};
		this.settings.acceptedWordLengths ??= { short: 0, medium: 0, long: 0 };
		this.settings.pinnedWords ??= [];
		this.settings.pinnedWordScores ??= {};
		this.settings.customDictPageSize ??= 50;


		for (const punctuatedWord of PUNCTUATED_WORDS) {
			const bareWord = punctuatedWord.slice(0, -1);
			const bareIndex = this.settings.customDict.indexOf(bareWord);
			if (bareIndex !== -1 && !this.settings.customDict.includes(punctuatedWord)) {
				this.settings.customDict[bareIndex] = punctuatedWord;
				if (this.settings.wordScores[bareWord] !== undefined) {
					this.settings.wordScores[punctuatedWord] = this.settings.wordScores[bareWord];
				}
				if (this.settings.acceptedWordCounts[bareWord] !== undefined) {
					this.settings.acceptedWordCounts[punctuatedWord] =
						this.settings.acceptedWordCounts[bareWord];
				}
				delete this.settings.acceptedWordCounts[bareWord];
				delete this.settings.wordScores[bareWord];
			}
		}
	}

	async loadWordTrie() {
		this.wordTrie = new Trie(this.settings.maxSuggestions);

		DEFAULT_DICTIONARIES.forEach((dict: Dictionary) => {
			dict.words.forEach((word: string) => {
				const score: number = this.settings.wordScores[word] ?? DEFAULT_WORD_SCORE;
				this.settings.wordScores[word] = score;
				this.wordTrie.insert(word, score);
			});
		});

		this.settings.customDict.forEach((word: string) => {
			const score: number = this.settings.wordScores[word] ?? CUSTOM_WORD_SCORE;
			this.settings.wordScores[word] = score;
			this.wordTrie.insert(word, score);
		});

		this.settings.dictFiles.forEach((file: DictionaryFile) => {
			file.words.forEach((word: string) => {
				const score: number = this.settings.wordScores[word] ?? IMPORT_WORD_SCORE;
				this.settings.wordScores[word] = score;
				this.wordTrie.insert(word, score)
			});
		});

		this.settings.pinnedWords.forEach((word: string) => {
			this.settings.wordScores[word] = 1000000;
			this.wordTrie.setWordScore(word, 1000000);
		});
		PUNCTUATED_WORDS.forEach((word) => {
			if (!this.wordTrie.getScore(word)) this.wordTrie.insert(word, CUSTOM_WORD_SCORE);
		});

		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async rebuildWordTrie(): Promise<void> {
		this.wordTrie = new Trie(this.settings.maxSuggestions);

		for (const dict of DEFAULT_DICTIONARIES) {
			for (const word of dict.words) {
				const score = this.settings.wordScores[word] ?? DEFAULT_WORD_SCORE;
				this.settings.wordScores[word] = score;
				this.wordTrie.insert(word, score);
			}
		}

		for (const word of this.settings.customDict) {
			const score = this.settings.wordScores[word] ?? CUSTOM_WORD_SCORE;
			this.settings.wordScores[word] = score;
			this.wordTrie.insert(word, score);
		}

		for (const file of this.settings.dictFiles) {
			for (const word of file.words) {
				const score = this.settings.wordScores[word] ?? IMPORT_WORD_SCORE;
				this.settings.wordScores[word] = score;
				this.wordTrie.insert(word, score);
			}
		}

		for (const word of this.settings.pinnedWords) {
			this.settings.wordScores[word] = 1000000;
			this.wordTrie.setWordScore(word, 1000000);
		}

		for (const word of PUNCTUATED_WORDS) {
			if (!this.wordTrie.getScore(word)) this.wordTrie.insert(word, CUSTOM_WORD_SCORE);
		}
	}

	private startImportedDictionaryWatching(): void {
		if (!this.settings.autoReloadImportedDictionaries) return;

		const fs = require('fs') as {
			existsSync(path: string): boolean;
			watchFile(path: string, options: { persistent: boolean; interval: number }, listener: () => void): void;
			unwatchFile(path: string, listener?: () => void): void;
		};

		for (const dictionary of this.settings.dictFiles) {
			if (!dictionary.sourcePath || !fs.existsSync(dictionary.sourcePath)) continue;
			if (this.importedDictionaryWatchers.has(dictionary.sourcePath)) continue;

			const listener = () => {
				const existingTimer = this.importedDictionaryWatchTimers.get(dictionary.sourcePath!);
				if (existingTimer !== undefined) window.clearTimeout(existingTimer);

				const timer = window.setTimeout(async () => {
					this.importedDictionaryWatchTimers.delete(dictionary.sourcePath!);
					await this.reloadImportedDictionaries(false);
				}, 250);
				this.importedDictionaryWatchTimers.set(dictionary.sourcePath!, timer);
			};

			fs.watchFile(dictionary.sourcePath, { persistent: false, interval: 2000 }, listener);
			this.importedDictionaryWatchers.set(dictionary.sourcePath, {
				close: () => fs.unwatchFile(dictionary.sourcePath!, listener)
			});
		}
	}

	async setImportedDictionaryWatching(enabled: boolean): Promise<void> {
		if (enabled) {
			this.startImportedDictionaryWatching();
		} else {
			for (const watcher of this.importedDictionaryWatchers.values()) watcher.close();
			this.importedDictionaryWatchers.clear();
			for (const timer of this.importedDictionaryWatchTimers.values()) window.clearTimeout(timer);
			this.importedDictionaryWatchTimers.clear();
		}
	}

	async reloadImportedDictionaries(showNotice: boolean): Promise<void> {
		if (this.settings.dictFiles.length === 0) {
			if (showNotice) new Notice('There are no imported dictionaries.');
			return;
		}

		let changed = false;
		const fs = require('fs') as {
			existsSync(path: string): boolean;
			readFileSync(path: string, encoding: BufferEncoding): string;
		};

		for (const dictionary of this.settings.dictFiles) {
			if (!dictionary.sourcePath) continue;
			if (!fs.existsSync(dictionary.sourcePath)) continue;

			try {
				const words = [...new Set(
					fs.readFileSync(dictionary.sourcePath, 'utf8')
						.split(/\r?\n/)
						.map((word) => this.normalizeDictionaryEntry(word, dictionary.filename))
						.filter((word) => word.length > 0)
				)];

				if (words.length === dictionary.words.length &&
					words.every((word, index) => word === dictionary.words[index])) {
					continue;
				}

				const removedWords = dictionary.words.filter((word) => !words.includes(word));
				dictionary.words = words;
				changed = true;

				for (const word of removedWords) {
						const remainingInAnotherImportedFile =
							this.settings.dictFiles.some((file) => file.words.includes(word));
						if (!remainingInAnotherImportedFile &&
							!DEFAULT_DICTIONARIES.some((dict) => dict.words.includes(word))) {
							this.settings.customDict =
								this.settings.customDict.filter((entry) => entry !== word);
							this.settings.pinnedWords =
								this.settings.pinnedWords.filter((entry) => entry !== word);
							delete this.settings.pinnedWordScores[word];
							delete this.settings.acceptedWordCounts[word];
							delete this.settings.learnedWordCounts[word];
							delete this.settings.typedWordCounts[word];
							delete this.settings.wordScores[word];
						}
				}

				for (const word of words) {
					if (!this.settings.wordScores[word]) {
						this.settings.wordScores[word] = this.settings.pinnedWords.includes(word)
							? 1000000
							: IMPORT_WORD_SCORE;
					}
				}
			} catch (error) {
				console.error(`Text Autocomplete: failed to reload "${dictionary.filename}".`, error);
			}
		}

		if (changed) {
			await this.rebuildWordTrie();
			await this.saveSettings();
			this.refreshSettingsTab();
			if (showNotice) new Notice('Imported dictionaries reloaded.');
		} else if (showNotice) {
			new Notice('Imported dictionaries are already up to date.');
		}
	}

	handleEditorChange(editor: Editor) {
		if (!this.settings.enabled) return;

		const cursor: EditorPosition = editor.getCursor();
		const line: string = editor.getLine(cursor.line);
		const beforeCursor: string = line.substring(0, cursor.ch);
		const afterCursor: string = line.substring(cursor.ch);
		void this.recordCompletedWord(beforeCursor, false, cursor.line, cursor.ch);

		if (this.handleSlashMenu(editor, beforeCursor)) return;

		if (inCodeBlock(editor, cursor)) {
			destroyTAUI();
			this.lastCursor = cursor;
			return;
		}

		const punctuationMatch = wordBeforeString(
			beforeCursor,
			this.settings.punctuationAutocomplete,
			{
				quotes: this.settings.punctuationQuotes,
				apostrophes: this.settings.punctuationApostrophes,
				squareBrackets: this.settings.punctuationSquareBrackets,
				braces: this.settings.punctuationBraces,
				parentheses: this.settings.punctuationParentheses
			}
		);
		const closingDelimiterOnly =
			closingDelimiterAfterCursor(afterCursor, this.settings.punctuationAutocomplete);
		if (this.lastCursor &&
			((stringInWordOrBeforePunctuation(afterCursor) && !closingDelimiterOnly) ||
			!punctuationMatch)) {
			destroyTAUI();
			return;
		}

		this.lastCursor = cursor;
		const match: RegExpMatchArray | null = wordBeforeString(
			beforeCursor,
			this.settings.punctuationAutocomplete,
			{
				quotes: this.settings.punctuationQuotes,
				apostrophes: this.settings.punctuationApostrophes,
				squareBrackets: this.settings.punctuationSquareBrackets,
				braces: this.settings.punctuationBraces,
				parentheses: this.settings.punctuationParentheses
			}
		);

		if ((stringInWordOrBeforePunctuation(afterCursor) && !closingDelimiterOnly) || !match) {
			destroyTAUI();
			return;
		}

		const word: string = match[1];
		let suggestions: string[] = [];
		try {
			suggestions = this.wordTrie.findWordsWithPrefix(
				word,
				this.settings.maxSuggestions === 1 ? 100 : this.settings.maxSuggestions,
				this.settings.caseSensitive
			);
		} catch (error) {
			console.error('Text Autocomplete: trie lookup failed; rebuilding.', error);
			void this.rebuildWordTrie();
			try {
				suggestions = this.wordTrie.findWordsWithPrefix(
					word,
					this.settings.maxSuggestions === 1 ? 100 : this.settings.maxSuggestions,
					this.settings.caseSensitive
				);
			} catch (retryError) {
				console.error('Text Autocomplete: trie recovery failed.', retryError);
				destroyTAUI();
				return;
			}
		}

		if (this.settings.contextRankingEnabled) {
			const nearbyWords = beforeCursor
				.match(/[A-Za-z][A-Za-z'-]{2,}/g)
				?.slice(-6)
				.map((entry) => entry.toLowerCase()) ?? [];
			suggestions = [...suggestions].sort((left, right) => {
				const leftContext = nearbyWords.reduce((total, nearby) =>
					total + (this.settings.contextWordCounts[left]?.[nearby] ?? 0), 0);
				const rightContext = nearbyWords.reduce((total, nearby) =>
					total + (this.settings.contextWordCounts[right]?.[nearby] ?? 0), 0);
				return rightContext - leftContext;
			});
		}

		if (suggestions.length > 0) {
			this.availableSuggestions = suggestions;
			this.suggestionIndex = 0;
			updateSuggestions(
				this.settings.maxSuggestions === 1 ? suggestions.slice(0, 1) : suggestions.slice(0, this.settings.maxSuggestions),
				editor,
				this
			);
		} else {
			destroyTAUI();
		}
	}

	handleContextMenu(menu: Menu, editor: Editor) {
		const selectedText: string = editor.getSelection()?.trim();
		if (!selectedText) return;

		menu.addItem((item: MenuItem) =>
			item.setTitle(`Add "${selectedText}" to custom dictionary`)
				.onClick(async () => {
					const result: Result = await this.addCustomWord(selectedText);
					if (result.ok) {
						new Notice(`Added "${selectedText}" to custom dictionary`, 1000);
						this.refreshSettingsTab();
					} else if (result === DUPLICATE_WORD){
						new Notice(`"${selectedText}" is already in custom dictionary`, 1000);
					}
				})
		);
	}

	handleKeyDown(evt: KeyboardEvent) {
		if (!this.settings.enabled) return;

		const target = evt.target as HTMLElement | null;
		if (target?.closest('.modal-container') ||
			document.querySelector('.modal-container')) {
			return;
		}

		if (this.slashMenuEl) {
			if (evt.key === 'Escape') {
				evt.preventDefault();
				this.destroySlashMenu();
				return;
			}
			if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
				evt.preventDefault();
				const items = Array.from(this.slashMenuEl.querySelectorAll('li'));
				const active = this.slashMenuEl.querySelector('li.active');
				let index = items.indexOf(active as HTMLLIElement);
				index = evt.key === 'ArrowDown'
					? (index + 1) % items.length
					: (index - 1 + items.length) % items.length;
				items.forEach((item, itemIndex) =>
					item.classList.toggle('active', itemIndex === index));
				return;
			}
			if (evt.key === 'Enter' || evt.key === 'Tab') {
				evt.preventDefault();
				const active = this.slashMenuEl.querySelector('li.active') as HTMLLIElement | null;
				(active ?? this.slashMenuEl.querySelector('li'))?.dispatchEvent(
					new Event('mousedown')
				);
				return;
			}
		}

		if (evt.key === 'Backspace' || evt.key === 'Delete') {
			void this.recordDeletedWord();
		}

		const dropdown: Element | null = document.querySelector('.autocomplete-dropdown');
		if (!dropdown) return;

		if (evt.key === 'Enter') {
			const editor = this.app.workspace.activeEditor?.editor;
			if (editor) {
				const cursor = editor.getCursor();
				const beforeCursor = editor.getLine(cursor.line).substring(0, cursor.ch);
				void this.recordCompletedWord(beforeCursor, true, cursor.line, cursor.ch);
			}
		}

		const acceptKeyEnabled: boolean =
			(evt.key == 'Enter' && this.settings.enterAcceptKey) || (evt.key == 'Tab' && this.settings.tabAcceptKey);

		if (evt.shiftKey && acceptKeyEnabled) return;

		// Enter/Tab that aren't accept keys: close the dropdown and let the normal behaviour happen
		if ((evt.key === 'Enter' || evt.key === 'Tab') && !acceptKeyEnabled) {
			destroyTAUI();
			return;
		}

		if (['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'Escape'].includes(evt.key)) {
			evt.preventDefault();

			if (evt.key === 'Escape') {
				destroyTAUI();
				return;
			}

			const items: HTMLLIElement[] = Array.from(dropdown.querySelectorAll('li'));
			const active: Element | null = dropdown.querySelector('li.active');
			let index: number = items.indexOf(active as HTMLLIElement);

			if (acceptKeyEnabled) {
				const selected = active || items[0];
				if (selected) {
					selected.dispatchEvent(new Event('mousedown'));
				}
				destroyTAUI();
				return;
			}

			if (evt.key === 'ArrowDown') {
				if (this.settings.maxSuggestions === 1 && this.availableSuggestions.length > 1) {
					this.suggestionIndex = (this.suggestionIndex + 1) % this.availableSuggestions.length;
					const item = items[0];
					item.textContent = this.availableSuggestions[this.suggestionIndex];
				} else {
					index = (index + 1) % items.length;
				}
			}

			if (evt.key === 'ArrowUp') {
				if (this.settings.maxSuggestions === 1 && this.availableSuggestions.length > 1) {
					this.suggestionIndex =
						(this.suggestionIndex - 1 + this.availableSuggestions.length) %
						this.availableSuggestions.length;
					const item = items[0];
					item.textContent = this.availableSuggestions[this.suggestionIndex];
				} else {
					index = (index - 1 + items.length) % items.length;
				}
			}

			items.forEach((item, i) => item.classList.toggle('active', i === index));
		}
	}

	private refreshSettingsTab(): void {
		if (this.settingsTab) this.settingsTab.display();
	}

	async reloadPlugin(): Promise<void> {
		try {
			await this.loadSettings();
			await this.rebuildWordTrie();
			this.lastCursor = null;
			this.availableSuggestions = [];
			this.suggestionIndex = 0;
			this.destroySlashMenu();
			destroyTAUI();

			for (const watcher of this.importedDictionaryWatchers.values()) watcher.close();
			this.importedDictionaryWatchers.clear();
			for (const timer of this.importedDictionaryWatchTimers.values()) window.clearTimeout(timer);
			this.importedDictionaryWatchTimers.clear();
			this.startImportedDictionaryWatching();

			this.refreshSettingsTab();
			new Notice('Text Autocomplete reloaded.');
		} catch (error) {
			console.error('Text Autocomplete: failed to reload plugin state.', error);
			new Notice('Text Autocomplete could not reload. Please reopen Obsidian.');
		}
	}

	private destroySlashMenu(): void {
		this.slashMenuEl?.remove();
		this.slashMenuEl = null;
	}

	private handleSlashMenu(editor: Editor, beforeCursor: string): boolean {
		const slashMatch = beforeCursor.match(/\/([^\s]*)$/);
		if (!slashMatch) {
			this.destroySlashMenu();
			return false;
		}

		const query = slashMatch[1].toLowerCase();
		const commands = [
			{ label: 'Remove last learned word', insert: '/learned remove-last', execute: () => void this.removeLastLearnedWord(false) },
			{ label: 'Ignore last learned word', insert: '/learned ignore-last', execute: () => void this.removeLastLearnedWord(true) },
			{ label: 'Undo last removal', insert: '/learned undo', execute: () => void this.undoRemoveCustomWord() },
			{ label: 'Add learned word', insert: '/learned add', execute: () => new WordPromptModal(this.app, (word) => {
				if (!word) return;
				void this.addLearnedWordFromPrompt(word);
			}).open() },
			{ label: 'Pin last learned word', insert: '/learned pin', execute: () => void this.toggleLastLearnedPinned(true) },
			{ label: 'Unpin last learned word', insert: '/learned unpin', execute: () => void this.toggleLastLearnedPinned(false) },
			{ label: 'Reload imported dictionaries', insert: '/dictionary reload', execute: () => void this.reloadImportedDictionaries(true) },
			{ label: 'Reload Text Autocomplete', insert: '/autocomplete reload', execute: () => void this.reloadPlugin() },
			{ label: 'Reset ignored words', insert: '/ignored reset', execute: () => void this.clearIgnoredWords() },
			{ label: 'Test learned-word chime', insert: '/chime test', execute: () => void this.testLearnedWordChime() },
			{ label: 'Open Text Autocomplete settings', insert: '/settings', execute: () => {
				const setting = (this.app as App & {
					setting: { open(): void; openTabById(id: string): void };
				}).setting;
				setting.open();
				setting.openTabById('text-autocomplete_v2');
			} }
		].filter((command) =>
			command.label.toLowerCase().includes(query) ||
			command.insert.toLowerCase().includes(query)
		);

		if (commands.length === 0) {
			this.destroySlashMenu();
			return true;
		}

		this.destroySlashMenu();
		const cm = (editor as Editor & {
			cm: {
				coordsAtPos: (pos: number) => { left: number; bottom: number } | null;
				state: { selection: { main: { head: number } } };
			};
		}).cm;
		const coords = cm?.coordsAtPos(cm.state.selection.main.head);

		this.slashMenuEl = document.createElement('ul');
		this.slashMenuEl.className = 'text-autocomplete-slash-menu';

		commands.forEach((command, index) => {
			const item = document.createElement('li');
			item.textContent = command.label;
			item.classList.toggle('active', index === 0);
			item.addEventListener('mousedown', (event) => {
				event.preventDefault();
				const cursor = editor.getCursor();
				editor.replaceRange(
					'',
					{ line: cursor.line, ch: cursor.ch - slashMatch[0].length },
					cursor
				);
				this.destroySlashMenu();
				command.execute();
			});
			this.slashMenuEl?.appendChild(item);
		});

		this.slashMenuEl.style.cssText =
			`position:absolute;left:${coords?.left ?? 20}px;top:${(coords?.bottom ?? 20) + window.scrollY}px;`;
		document.body.appendChild(this.slashMenuEl);
		return true;
	}

	private registerUtilityCommands(): void {
		this.addCommand({
			id: 'text-autocomplete-reload-plugin',
			name: 'Reload Text Autocomplete',
			callback: () => void this.reloadPlugin()
		});
		this.addCommand({
			id: 'text-autocomplete-remove-last-learned',
			name: 'Remove last learned word',
			callback: () => void this.removeLastLearnedWord(false)
		});
		this.addCommand({
			id: 'text-autocomplete-ignore-last-learned',
			name: 'Ignore and remove last learned word',
			callback: () => void this.removeLastLearnedWord(true)
		});
		this.addCommand({
			id: 'text-autocomplete-add-learned-word',
			name: 'Add learned word',
			callback: () => new WordPromptModal(this.app, (word) => {
				if (!word) return;
				void this.addLearnedWordFromPrompt(word);
			}).open()
		});
		this.addCommand({
			id: 'text-autocomplete-undo-last-removal',
			name: 'Undo last custom word removal',
			callback: () => void this.undoRemoveCustomWord().then((result) => {
				if (result.ok) new Notice('Restored the last removed word.');
				this.refreshSettingsTab();
			})
		});
		this.addCommand({
			id: 'text-autocomplete-reload-dictionaries',
			name: 'Reload imported dictionaries',
			callback: () => void this.reloadImportedDictionaries(true)
		});
		this.addCommand({
			id: 'text-autocomplete-pin-last-learned',
			name: 'Pin last learned word',
			callback: () => void this.toggleLastLearnedPinned(true)
		});
		this.addCommand({
			id: 'text-autocomplete-unpin-last-learned',
			name: 'Unpin last learned word',
			callback: () => void this.toggleLastLearnedPinned(false)
		});
		this.addCommand({
			id: 'text-autocomplete-clear-ignored',
			name: 'Reset ignored words',
			callback: () => void this.clearIgnoredWords().then(() => {
				new Notice('Ignored words reset.');
				this.refreshSettingsTab();
			})
		});
		this.addCommand({
			id: 'text-autocomplete-test-chime',
			name: 'Test learned-word chime',
			callback: () => void this.testLearnedWordChime()
		});
		this.addCommand({
			id: 'text-autocomplete-open-settings',
			name: 'Open Text Autocomplete settings',
			callback: () => {
				(this.app as App & {
					setting: { open(): void; openTabById(id: string): void };
				}).setting.open();
				(this.app as App & {
					setting: { open(): void; openTabById(id: string): void };
				}).setting.openTabById('text-autocomplete_v2');
			}
		});
	}

	private showLearnedWordNotice(message: string): void {
		const existingContainer =
			document.querySelector('.text-autocomplete-learned-notices');
		const container = existingContainer ?? document.createElement('div');

		if (!existingContainer) {
			container.className = 'text-autocomplete-learned-notices';
			document.body.appendChild(container);
		}

		const toast = document.createElement('div');
		toast.className = 'text-autocomplete-learned-notice';
		const label = document.createElement('div');
		label.className = 'text-autocomplete-learned-notice-label';
		label.textContent = 'Text Autocomplete';
		const body = document.createElement('div');
		body.className = 'text-autocomplete-learned-notice-body';
		body.textContent = message;
		toast.append(label, body);
		container.appendChild(toast);

		window.setTimeout(() => {
			toast.remove();
			if (!container.hasChildNodes()) container.remove();
		}, 4000);
	}

	async testLearnedWordChime(): Promise<void> {
		const enabled = this.settings.learnedWordChime;
		this.settings.learnedWordChime = true;
		await this.playLearnedWordChime();
		this.settings.learnedWordChime = enabled;
	}

	async unlockLearnedWordChime(): Promise<void> {
		try {
			const AudioContextClass =
				window.AudioContext ??
				(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AudioContextClass) return;

			const context = this.chimeContext ?? new AudioContextClass();
			this.chimeContext = context;
			if (context.state !== 'running') await context.resume();

			const gain = context.createGain();
			gain.gain.value = 0;
			gain.connect(context.destination);
			const oscillator = context.createOscillator();
			oscillator.connect(gain);
			oscillator.start();
			oscillator.stop(context.currentTime + 0.01);
		} catch (error) {
			console.warn('Text Autocomplete: could not unlock learned-word chime audio.', error);
		}
	}

	private async playLearnedWordChime(): Promise<void> {
		if (!this.settings.learnedWordChime) return;

		try {
			const AudioContextClass =
				window.AudioContext ??
				(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AudioContextClass) return;

			const context = this.chimeContext ?? new AudioContextClass();
			this.chimeContext = context;
			if (context.state !== 'running') {
				await context.resume();
			}
			if (context.state !== 'running') return;
			await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
			const gain = context.createGain();
			gain.gain.setValueAtTime(0.075, context.currentTime);
			gain.gain.exponentialRampToValueAtTime(
				0.001,
				context.currentTime + 0.12
			);
			gain.connect(context.destination);

			const startFrequency = 660;
			const secondToneDelay = 0.045;

			const firstTone = context.createOscillator();
			firstTone.type = 'sine';
			firstTone.frequency.value = startFrequency;
			firstTone.connect(gain);
			firstTone.start(context.currentTime);
			firstTone.stop(context.currentTime + 0.055);

			const secondTone = context.createOscillator();
			secondTone.type = 'sine';
			secondTone.frequency.value = 880;
			secondTone.connect(gain);
			secondTone.start(context.currentTime + secondToneDelay);
			secondTone.stop(context.currentTime + 0.12);
		} catch (error) {
			console.warn('Text Autocomplete: learned-word chime could not be played.', error);
		}
	}

	private async recordDeletedWord(): Promise<void> {
		if (!this.settings.learnFromTyping) return;
		this.settings.deletedWordCount =
			(this.settings.deletedWordCount ?? 0) + 1;

		const editor = this.app.workspace.activeEditor?.editor;
		if (!editor) return;

		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const beforeCursor = line.substring(0, cursor.ch);
		const afterCursor = line.substring(cursor.ch);

		const selectedText = editor.getSelection?.()?.trim();
		const candidates = [
			selectedText,
			beforeCursor.match(/([A-Za-z][A-Za-z'-]*\.)$|([A-Za-z][A-Za-z'-]*)$/)?.[0],
			afterCursor.match(/^([A-Za-z][A-Za-z'-]*\.?)/)?.[1]
		].filter((word): word is string => Boolean(word));

		for (const candidate of candidates) {
			const word = candidate.trim().toLowerCase().replace(/^\W+|\W+$/g, '');
			if (word.length < 3) continue;
			if (this.isProtectedDictionaryWord(word)) continue;
			this.pendingDeletedWords.add(word);
			delete this.settings.ignoredWordRecoveryCounts[word];
		}

		await this.saveSettings();
	}

	private async commitPendingDeletedWords(exceptWord?: string): Promise<void> {
		let changed = false;

		for (const word of this.pendingDeletedWords) {
			if (exceptWord && word === exceptWord) continue;

			if (this.settings.experimentalReplacementDetection && exceptWord) {
				const similarity = this.wordSimilarity(word, exceptWord);
				const isInflection =
					word === exceptWord + 's' ||
					exceptWord === word + 's' ||
					word === exceptWord + 'es' ||
					exceptWord === word + 'es' ||
					word === exceptWord + 'ed' ||
					exceptWord === word + 'ed' ||
					word === exceptWord + 'ing' ||
					exceptWord === word + 'ing';

				if (isInflection ||
					similarity * 100 < this.settings.replacementSimilarityThreshold) {
					continue;
				}
			}

			if (!this.isProtectedDictionaryWord(word) &&
				!this.settings.ignoredWords.includes(word)) {
				this.settings.ignoredWords.push(word);
				changed = true;
			}
		}

		this.pendingDeletedWords.clear();
		if (changed) await this.saveSettings();
	}

	async addIgnoredWord(word: string): Promise<void> {
		const normalized = word.trim().toLowerCase();
		if (!/^[A-Za-z][A-Za-z'-]{1,40}$/.test(normalized)) return;
		if (!this.settings.ignoredWords.includes(normalized)) {
			this.settings.ignoredWords.push(normalized);
			this.settings.ignoredWordCount =
				(this.settings.ignoredWordCount ?? 0) + 1;
		}
		await this.saveSettings();
	}

	async removeIgnoredWord(word: string): Promise<void> {
		this.settings.ignoredWords =
			this.settings.ignoredWords.filter((entry) => entry !== word);
		delete this.settings.ignoredWordRecoveryCounts[word];
		await this.saveSettings();
	}

	async clearIgnoredWords(): Promise<void> {
		this.settings.ignoredWords = [];
		this.settings.ignoredWordRecoveryCounts = {};
		await this.saveSettings();
	}

	private isProtectedDictionaryWord(word: string): boolean {
		return DEFAULT_DICTIONARIES.some((dictionary) => dictionary.words.includes(word)) ||
			this.settings.customDict.includes(word) ||
			this.settings.dictFiles.some((file) => file.words.includes(word));
	}

	private wordSimilarity(left: string, right: string): number {
		if (left === right) return 1;
		const leftValue = left.toLowerCase();
		const rightValue = right.toLowerCase();
		if (leftValue.length === 0 || rightValue.length === 0) return 0;

		const previous = Array.from({ length: rightValue.length + 1 }, (_, index) => index);
		for (let leftIndex = 1; leftIndex <= leftValue.length; leftIndex++) {
			const current = [leftIndex];
			for (let rightIndex = 1; rightIndex <= rightValue.length; rightIndex++) {
				current[rightIndex] = Math.min(
					current[rightIndex - 1] + 1,
					previous[rightIndex] + 1,
					previous[rightIndex - 1] +
						(leftValue[leftIndex - 1] === rightValue[rightIndex - 1] ? 0 : 1)
				);
			}
			previous.splice(0, previous.length, ...current);
		}

		const distance = previous[rightValue.length];
		return 1 - distance / Math.max(leftValue.length, rightValue.length);
	}

	async bumpAcceptedWord(word: string): Promise<void> {
		this.wordTrie.bumpWordScore(word, ACCEPTED_SUGGESTION_BUMP);
		this.settings.wordScores[word] = this.wordTrie.getScore(word);
		this.settings.acceptedWordCounts[word] = (this.settings.acceptedWordCounts[word] ?? 0) + 1;
		const now = new Date();
		const activityKey = `${now.getDay()}-${now.getHours()}`;
		this.settings.acceptedActivity[activityKey] =
			(this.settings.acceptedActivity[activityKey] ?? 0) + 1;

		const length = word.replace(/[^A-Za-z]/g, '').length;
		if (length <= 4) this.settings.acceptedWordLengths.short++;
		else if (length <= 8) this.settings.acceptedWordLengths.medium++;
		else this.settings.acceptedWordLengths.long++;
		this.recordContextWords(word);
		await this.saveSettings();
	}

	private recordContextWords(currentWord: string): void {
		if (!this.settings.contextRankingEnabled) return;
		const editor = this.app.workspace.activeEditor?.editor;
		if (!editor) return;

		const cursor = editor.getCursor();
		const words = editor
			.getLine(cursor.line)
			.slice(0, cursor.ch)
			.match(/[A-Za-z][A-Za-z'-]{2,}/g);
		if (!words || words.length === 0) return;

		const nearby = words.slice(-6).map((word) => word.toLowerCase());
		for (const previous of nearby) {
			if (previous === currentWord.toLowerCase()) continue;
			const relations =
				this.settings.contextWordCounts[currentWord] ??
				(this.settings.contextWordCounts[currentWord] = {});
			relations[previous] = (relations[previous] ?? 0) + 1;
		}

		const contextKeys = Object.keys(this.settings.contextWordCounts);
		if (contextKeys.length > 500) {
			delete this.settings.contextWordCounts[contextKeys[0]];
		}
	}

	async resetStatistics(): Promise<void> {
		this.settings.deletedWordCount = 0;
		this.settings.ignoredWordCount = this.settings.ignoredWords.length;
		this.settings.newlyLearnedWordCount = 0;
		this.settings.acceptedWordCounts = {};
		this.settings.typedWordCounts = {};
		this.settings.acceptedActivity = {};
		this.settings.acceptedWordLengths = { short: 0, medium: 0, long: 0 };
		this.settings.learnedWordHistory = [];
		this.settings.lastLearnedWord = null;
		await this.saveSettings();
	}

	async setWordPinned(word: string, pinned: boolean): Promise<void> {
		if (pinned) {
			if (!this.settings.pinnedWords.includes(word)) this.settings.pinnedWords.push(word);
			this.settings.pinnedWordScores[word] =
				this.settings.wordScores[word] ?? this.getNormalWordScore(word);
			this.settings.wordScores[word] = 1000000;
		} else {
			this.settings.pinnedWords = this.settings.pinnedWords.filter((entry) => entry !== word);
			this.settings.wordScores[word] =
				this.settings.pinnedWordScores[word] ?? this.getNormalWordScore(word);
			delete this.settings.pinnedWordScores[word];
		}

		this.wordTrie.setWordScore(word, this.settings.wordScores[word] ?? DEFAULT_WORD_SCORE);
		await this.saveSettings();
	}

	private getNormalWordScore(word: string): number {
		if (this.settings.customDict.includes(word)) return CUSTOM_WORD_SCORE;
		if (this.settings.dictFiles.some((file) => file.words.includes(word))) return IMPORT_WORD_SCORE;
		return this.settings.acceptedWordCounts[word] ? DEFAULT_WORD_SCORE : DEFAULT_WORD_SCORE;
	}

	async addCustomWord(word: string): Promise<Result> {
		const phrase = word.trim().replace(/\s+/g, ' ');
		if (!phrase) return EMPTY_FILE;
		if (this.settings.customDict.some((entry) =>
			entry === phrase || entry.toLowerCase() === phrase.toLowerCase()
		)) return DUPLICATE_WORD;

		this.settings.customDict.push(phrase);

		const score: number = this.settings.wordScores[phrase] ?? CUSTOM_WORD_SCORE;
		this.settings.wordScores[phrase] = score;

		this.wordTrie.insert(phrase, score);
		await this.saveSettings();
		return OK;
	}

	async addLearnedWordFromPrompt(word: string): Promise<Result> {
		const normalized = word.trim().replace(/\s+/g, ' ');
		if (!normalized) return EMPTY_FILE;

		const result = await this.addCustomWord(normalized);
		if (!result.ok) {
			if (result === DUPLICATE_WORD) {
				const alreadyInImported = this.settings.dictFiles.some((file) =>
					file.words.some((entry) =>
						entry.toLowerCase() === normalized.toLowerCase()
					)
				);

				if (!alreadyInImported && this.settings.updateImportedDictionary) {
					await this.appendToImportedDictionary(normalized);
					new Notice(`"${normalized}" was already in the custom dictionary and was added to the imported file.`);
				} else {
					new Notice(`"${normalized}" is already in both the custom dictionary and the imported file.`);
				}
			} else {
				new Notice('Please enter a word or phrase.');
			}
			return result;
		}

		this.recordLearnedWord(normalized);
		if (this.settings.updateImportedDictionary) {
			await this.appendToImportedDictionary(normalized);
		}
		new Notice(`Added "${normalized}" to the custom dictionary.`);
		this.refreshSettingsTab();
		return OK;
	}

	private recordLearnedWord(word: string): void {
		const normalized = word.trim();
		if (!normalized) return;
		this.settings.lastLearnedWord = normalized;
		this.settings.learnedWordHistory = [
			normalized,
			...this.settings.learnedWordHistory.filter((entry) => entry !== normalized)
		].slice(0, 20);
		void this.saveSettings();
	}

	async removeLastLearnedWord(ignore: boolean): Promise<void> {
		const word = this.settings.lastLearnedWord;
		if (!word) {
			new Notice('No recently learned word is available.');
			return;
		}

		const index = this.settings.customDict.indexOf(word);
		if (index === -1) {
			new Notice(`"${word}" is no longer in the custom dictionary.`);
			this.settings.lastLearnedWord = this.settings.learnedWordHistory.find((entry) =>
				this.settings.customDict.includes(entry)
			) ?? null;
			await this.saveSettings();
			this.refreshSettingsTab();
			return;
		}

		if (ignore) {
			await this.removeIgnoredWord(word);
			if (!this.settings.ignoredWords.includes(word)) {
				this.settings.ignoredWords.push(word);
			}
		}

		await this.removeCustomWord(index);
		if (!ignore) {
			await this.removeIgnoredWord(word);
		}
		this.settings.learnedWordHistory =
			this.settings.learnedWordHistory.filter((entry) => entry !== word);
		this.settings.lastLearnedWord =
			this.settings.learnedWordHistory.find((entry) =>
				this.settings.customDict.includes(entry)
			) ?? null;
		await this.saveSettings();
		new Notice(ignore
			? `Ignored and removed "${word}".`
			: `Removed "${word}".`);
		this.refreshSettingsTab();
	}

	async toggleLastLearnedPinned(pinned: boolean): Promise<void> {
		const word = this.settings.lastLearnedWord;
		if (!word) {
			new Notice('No recently learned word is available.');
			return;
		}
		await this.setWordPinned(word, pinned);
		new Notice(pinned ? `Pinned "${word}".` : `Unpinned "${word}".`);
		this.refreshSettingsTab();
	}

	async removeCustomWord(index: number): Promise<Result> {
		const word: string = this.settings.customDict[index];
		if (!word) return NOT_OK;

		this.settings.lastRemovedWord = { word, index };
		this.settings.customDict.splice(index, 1);
		const ignoredWord = word.trim().toLowerCase();
		if (ignoredWord.length >= 3 && !this.settings.ignoredWords.includes(ignoredWord)) {
			this.settings.ignoredWords.push(ignoredWord);
		}
		delete this.settings.acceptedWordCounts[word];
		delete this.settings.learnedWordCounts[word];
		delete this.settings.typedWordCounts[word];
		this.settings.pinnedWords =
			this.settings.pinnedWords.filter((entry) => entry !== word);

		await this.removeWordFromImportedDictionaries(word);
		await this.rebuildWordTrie();
		if (!this.wordExistsInAnySource(word)) {
			delete this.settings.wordScores[word];
		}
		await this.saveSettings();
		return OK;
	}

	async removeCustomWords(words: string[]): Promise<void> {
		for (const word of [...words].reverse()) {
			const index = this.settings.customDict.indexOf(word);
			if (index !== -1) await this.removeCustomWord(index);
		}
	}

	async editCustomWord(index: number, newWord: string): Promise<Result> {
		const oldWord = this.settings.customDict[index];
		const word = newWord.trim();
		if (!oldWord || !word) return NOT_OK;
		if (word !== oldWord && this.settings.customDict.includes(word)) return DUPLICATE_WORD;

		this.settings.customDict[index] = word;
		if (oldWord !== word) {
			delete this.settings.wordScores[oldWord];
			delete this.settings.learnedWordCounts[oldWord];
			const acceptedCount = this.settings.acceptedWordCounts[oldWord];
			if (acceptedCount !== undefined) {
				this.settings.acceptedWordCounts[word] =
					(this.settings.acceptedWordCounts[word] ?? 0) + acceptedCount;
				delete this.settings.acceptedWordCounts[oldWord];
			}
			const score = this.settings.wordScores[word] ?? CUSTOM_WORD_SCORE;
			this.settings.wordScores[word] = score;
			await this.replaceWordInImportedDictionaries(oldWord, word);
			await this.rebuildWordTrie();
		}

		await this.saveSettings();
		return OK;
	}

	async undoRemoveCustomWord(): Promise<Result> {
		const removed = this.settings.lastRemovedWord;
		if (!removed) return NOT_OK;
		if (!this.settings.customDict.includes(removed.word)) {
			this.settings.customDict.splice(
				Math.min(removed.index, this.settings.customDict.length),
				0,
				removed.word
			);
			const score = this.settings.wordScores[removed.word] ?? CUSTOM_WORD_SCORE;
			this.settings.wordScores[removed.word] = score;
			this.wordTrie.insert(removed.word, score);
			await this.appendToImportedDictionary(removed.word);
		}
		delete this.settings.lastRemovedWord;
		await this.saveSettings();
		return OK;
	}

	async clearCustomWords(): Promise<void> {
		const removedWords = [...this.settings.customDict];
		this.settings.customDict.forEach((word: string) => {
			if (!this.wordExistsInAnotherDict(word, -1)) {
				this.wordTrie.remove(word);
				delete this.settings.wordScores[word];
			}
			delete this.settings.acceptedWordCounts[word];
			delete this.settings.learnedWordCounts[word];
		});

		this.settings.customDict = [];
		for (const word of removedWords) {
			await this.removeWordFromImportedDictionaries(word);
		}
		await this.rebuildWordTrie();
		await this.saveSettings();
	}

	private async recordCompletedWord(
		beforeCursor: string,
		fromEnter: boolean = false,
		line: number = 0,
		ch: number = 0
	): Promise<void> {
		const terminated = /[ \t.,!?;:()[\]{}"'“”]/.test(beforeCursor.slice(-1));
		if (!this.settings.learnFromTyping || (!terminated && !fromEnter)) return;

		const match = beforeCursor.match(/([A-Za-z][A-Za-z'-]{2,}(?:\.)?)[^A-Za-z'-]*$/);
		if (!match) return;

		const typedWord = match[1].trim().replace(/'+$/, '');
		if (typedWord.length < 3) return;
		const normalizedWord = typedWord.replace(/\.$/, '');
		const normalizedLookup = normalizedWord.toLowerCase();
		const punctuatedForm = PUNCTUATED_WORDS.find((candidate) =>
			candidate.slice(0, -1) === normalizedLookup
		);
		const word = punctuatedForm ?? normalizedWord;

		if (this.lastWordCompletion &&
			this.lastWordCompletion.word === word &&
			this.lastWordCompletion.line === line &&
			ch - this.lastWordCompletion.ch >= 0 &&
			ch - this.lastWordCompletion.ch <= 2) {
			return;
		}
		this.lastWordCompletion = { word, line, ch };

		const retypedDeletedWord =
			this.pendingDeletedWords.has(word) ||
			this.pendingDeletedWords.has(normalizedWord);
		if (retypedDeletedWord) {
			this.pendingDeletedWords.delete(word);
			this.pendingDeletedWords.delete(normalizedWord);
			delete this.settings.ignoredWordRecoveryCounts[word];
			delete this.settings.ignoredWordRecoveryCounts[normalizedWord];
		} else {
			await this.commitPendingDeletedWords(word);
		}

		const ignoredLookup = this.settings.ignoredWords.find((ignored) =>
			ignored.toLowerCase() === word.toLowerCase() ||
			ignored.toLowerCase() === normalizedWord.toLowerCase()
		);
		if (ignoredLookup) {
			const ignoredWord = ignoredLookup;
			this.settings.ignoredWordRecoveryCounts[ignoredWord] =
				(this.settings.ignoredWordRecoveryCounts[ignoredWord] ?? 0) + 1;

			if (this.settings.ignoredWordRecoveryCounts[ignoredWord] >=
				this.settings.ignoredWordRecoveryThreshold) {
				await this.removeIgnoredWord(ignoredWord);
				await this.addCustomWord(ignoredWord);
				if (this.settings.updateImportedDictionary) {
					await this.appendToImportedDictionary(ignoredWord);
				}
				this.recordLearnedWord(ignoredWord);
				this.showLearnedWordNotice(
					`"${ignoredWord}" recovered and added to the custom dictionary.`
				);
				this.playLearnedWordChime();
				this.refreshSettingsTab();
			} else {
				await this.saveSettings();
			}
			return;
		}

		const isDefaultWord = DEFAULT_DICTIONARIES.some((dictionary) => dictionary.words.includes(word));
		if (isDefaultWord) {
			this.settings.typedWordCounts[word] = (this.settings.typedWordCounts[word] ?? 0) + 1;
			const score = (this.settings.wordScores[word] ?? DEFAULT_WORD_SCORE) + 1;
			this.settings.wordScores[word] = score;
			this.wordTrie.setWordScore(word, score);
			await this.saveSettings();
			return;
		}

		if (this.settings.customDict.some((entry) =>
			entry.toLowerCase() === word.toLowerCase()
		) || this.settings.dictFiles.some((file) =>
			file.words.some((entry) => entry.toLowerCase() === word.toLowerCase())
		)) {
			return;
		}

		const currentCount = this.settings.learnedWordCounts[word] ?? 0;
		const nextCount = currentCount + 1;
		this.settings.learnedWordCounts[word] = nextCount;
		this.lastWordCompletion = { word, line, ch };

		if (nextCount >= this.settings.learningThreshold) {
			delete this.settings.learnedWordCounts[word];
			const result = await this.addCustomWord(word);
			if (result.ok) {
				this.settings.newlyLearnedWordCount =
					(this.settings.newlyLearnedWordCount ?? 0) + 1;
				let destinationMessage = 'custom dictionary';
				if (this.settings.updateImportedDictionary) {
					await this.appendToImportedDictionary(word);
					destinationMessage = 'dictionary';
				}
				this.recordLearnedWord(word);
				this.showLearnedWordNotice(
					`Learned "${word}" and added it to the ${destinationMessage}.`
				);
				this.playLearnedWordChime();
				this.refreshSettingsTab();
			}
			return;
		}

		await this.saveSettings();
	}

	private async appendToImportedDictionary(word: string): Promise<void> {
		if (!this.settings.updateImportedDictionary) return;
		const dictionary = [...this.settings.dictFiles].reverse().find((file) => file.sourcePath);
		if (!dictionary?.sourcePath) return;

		try {
			const fs = require('fs') as {
				appendFileSync(path: string, data: string): void;
			};
			fs.appendFileSync(dictionary.sourcePath, `\n${word}`);
			dictionary.words.push(word);
			await this.saveSettings();
		} catch (error) {
			console.error('Text Autocomplete: failed to update imported dictionary file.', error);
			new Notice(`Learned "${word}", but could not update the imported Text File.`);
		}
	}

	private async removeWordFromImportedDictionaries(word: string): Promise<void> {
		if (!this.settings.updateImportedDictionary) return;

		for (const dictionary of this.settings.dictFiles) {
			dictionary.words = [...new Set(dictionary.words)].filter((entry) => entry !== word);
			if (!dictionary.sourcePath) continue;
			try {
				const fs = require('fs') as {
					readFileSync(path: string, encoding: BufferEncoding): string;
					writeFileSync(path: string, data: string): void;
				};
				const text = fs.readFileSync(dictionary.sourcePath, 'utf8');
				const words = text
					.split(/\r?\n/)
					.map((entry) => entry.trim())
					.filter((entry) => {
						if (!entry) return false;
						return this.normalizeDictionaryEntry(entry, dictionary.filename) !== word;
					});
				fs.writeFileSync(dictionary.sourcePath, [...new Set(words)].join('\n'));
			} catch (error) {
				console.error('Text Autocomplete: failed to remove word from imported dictionary file.', error);
				new Notice(`"${word}" was removed from the plugin, but could not update the imported Text File.`);
			}
		}
	}

	private async replaceWordInImportedDictionaries(oldWord: string, newWord: string): Promise<void> {
		if (!this.settings.updateImportedDictionary) return;

		for (const dictionary of this.settings.dictFiles) {
			const containsOldWord = dictionary.words.includes(oldWord);
			dictionary.words = [...new Set(dictionary.words)].filter((entry) => entry !== oldWord);
			if (containsOldWord) dictionary.words.push(newWord);
			dictionary.words = [...new Set(dictionary.words)];
			if (!dictionary.sourcePath) continue;
			try {
				const fs = require('fs') as {
					readFileSync(path: string, encoding: BufferEncoding): string;
					writeFileSync(path: string, data: string): void;
				};
				const text = fs.readFileSync(dictionary.sourcePath, 'utf8');
				const words = text
					.split(/\r?\n/)
					.map((entry) => entry.trim())
					.map((entry) =>
						this.normalizeDictionaryEntry(entry, dictionary.filename) === oldWord
							? newWord
							: entry
					)
					.filter((entry) => entry.length > 0);
				fs.writeFileSync(dictionary.sourcePath, [...new Set(words)].join('\n'));
			} catch (error) {
				console.error('Text Autocomplete: failed to rename word in imported dictionary file.', error);
				new Notice(`"${oldWord}" was renamed in the plugin, but could not update the imported Text File.`);
			}
		}
	}

	private normalizeDictionaryEntry(line: string, filename: string): string {
		let value = line.trim();
		if (!value) return '';

		if (/\.md$/i.test(filename)) {
			value = value
				.replace(/^#{1,6}\s*/, '')
				.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
				.replace(/^\[[ xX]\]\s*/, '')
				.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
				.replace(/(`{1,3})(.*?)\1/g, '$2')
				.replace(/\*\*([^*]+)\*\*/g, '$1')
				.replace(/__([^_]+)__/g, '$1')
				.replace(/\*([^*]+)\*/g, '$1')
				.replace(/_([^_]+)_/g, '$1')
				.trim();

			if (/^(?:-{3,}|_{3,}|={3,}|```|~~~)$/.test(value)) return '';
			if (/^<!--.*-->$/.test(value)) return '';
			if (/^\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(value)) return '';
		}

		return value.trim();
	}

	async importDictFile(file: File, sourcePath?: string): Promise<{ result: Result , wordCount?: number }> {
		if (this.settings.dictFiles.some((f) => f.filename === file.name)) {
			return { result: DUPLICATE_FILE };
		}

		const text: string = await file.text();
		let words: string[] = text
			.split(/\r?\n/)
			.map((w: string) => this.normalizeDictionaryEntry(w, file.name))
			.filter((w: string) => w.length > 0);
		words = [...new Set(words)];

		if (words.length === 0) return { result: EMPTY_FILE };

		words.forEach((word: string) => {
			const score: number = this.settings.wordScores[word] ?? IMPORT_WORD_SCORE;
			this.settings.wordScores[word] = score;
			this.wordTrie.insert(word, score);
		});

		const dictFile: DictionaryFile = {
			filename: file.name,
			sourcePath,
			words: words
		};
		this.settings.dictFiles.push(dictFile);

		await this.saveSettings();
		return { result: OK, wordCount: words.length };
	}

	async removeImportedDictFile(index: number): Promise<Result> {
		const dictFile: DictionaryFile = this.settings.dictFiles[index];
		if (!dictFile) return NOT_OK;

		dictFile.words.forEach((word: string) => {
			if (!this.wordExistsInAnotherDict(word, index)) {
				this.wordTrie.remove(word);
				delete this.settings.wordScores[word];
			}
		});
		this.settings.dictFiles.splice(index, 1);

		await this.saveSettings();
		return OK;
	}

	private wordExistsInAnotherDict(word: string, referenceDictIndex: number): boolean {
		let customDict: boolean = false;
		if (referenceDictIndex === -1) {
			referenceDictIndex = this.settings.dictFiles.length + 1;
		} else {
			customDict = this.settings.customDict.includes(word);
		}

		return this.settings.dictFiles.some((dict, dictIndex) =>
			dictIndex !== referenceDictIndex && dict.words.includes(word)
		) || customDict;
	}

	private wordExistsInAnySource(word: string): boolean {
		if (this.settings.customDict.includes(word)) return true;
		return this.settings.dictFiles.some((dict) => dict.words.includes(word));
	}
}
