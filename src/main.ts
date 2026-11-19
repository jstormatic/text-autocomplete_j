import { Editor, EditorPosition, Plugin, Menu, MenuItem, Notice } from 'obsidian';
import { TASettingsTab, DEFAULT_SETTINGS, TASettings, DictionaryFile } from './settings/settings';
import { createTAUI, destroyTAUI, updateSuggestions } from './settings/ui';
import { inCodeBlock, Result, stringInWordOrBeforePunctuation, wordBeforeString } from './utils';
import { DEFAULT_DICTIONARIES, Dictionary } from './dictionary/dictionary';
import { Trie } from './dictionary/trie';
import { ACCEPTED_SUGGESTION_BUMP, CUSTOM_WORD_SCORE, DEFAULT_WORD_SCORE, DUPLICATE_FILE, DUPLICATE_WORD, EMPTY_FILE, IMPORT_WORD_SCORE, NOT_OK, OK } from './constants';

export default class TAPlugin extends Plugin {
	settings!: TASettings;
	wordTrie!: Trie;
	lastCursor!: EditorPosition | null;
	settingsTab!: TASettingsTab | null;
	private importedDictionaryWatchers: Map<string, { close(): void }> = new Map();
	private importedDictionaryWatchTimers: Map<string, number> = new Map();
	private availableSuggestions: string[] = [];
	private suggestionIndex: number = 0;

	async onload() {
		await this.loadSettings();
		await this.loadWordTrie();

		this.settingsTab = new TASettingsTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		this.registerEvent(this.app.workspace.on('editor-change', this.handleEditorChange.bind(this)));
		this.registerEvent(this.app.workspace.on('editor-menu', this.handleContextMenu.bind(this)));
		this.registerDomEvent(document, 'keydown', this.handleKeyDown.bind(this), { capture: true });
		this.registerEditorExtension(createTAUI());
		this.startImportedDictionaryWatching();
	}

	onunload() {
		for (const watcher of this.importedDictionaryWatchers.values()) watcher.close();
		this.importedDictionaryWatchers.clear();
		for (const timer of this.importedDictionaryWatchTimers.values()) window.clearTimeout(timer);
		this.importedDictionaryWatchTimers.clear();
		destroyTAUI();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings.learnedWordCounts ??= {};
		this.settings.learningThreshold ??= 3;
		this.settings.learnFromTyping ??= true;
		this.settings.updateImportedDictionary ??= true;
		this.settings.autoReloadImportedDictionaries ??= true;
		this.settings.acceptedWordCounts ??= {};
		this.settings.pinnedWords ??= [];
		this.settings.pinnedWordScores ??= {};
		this.settings.customDictPageSize ??= 50;
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
						.map((word) => word.trim())
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
					if (!this.wordExistsInAnySource(word) &&
						!DEFAULT_DICTIONARIES.some((dict) => dict.words.includes(word))) {
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
		void this.recordCompletedWord(beforeCursor);

		// TODO - Add code block support
		if (inCodeBlock(editor, cursor)) {
			destroyTAUI();
			this.lastCursor = cursor;
			return;
		}

		if (this.lastCursor && (stringInWordOrBeforePunctuation(afterCursor) || !wordBeforeString(beforeCursor))) {
			destroyTAUI();
			return;
		}

		this.lastCursor = cursor;
		const match: RegExpMatchArray | null = wordBeforeString(beforeCursor);

		if (stringInWordOrBeforePunctuation(afterCursor) || !match) {
			destroyTAUI();
			return;
		}

		const word: string = match[1];
		const suggestions: string[] = this.wordTrie.findWordsWithPrefix(
			word,
			this.settings.maxSuggestions === 1 ? 100 : this.settings.maxSuggestions,
			this.settings.caseSensitive
		);

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

		const dropdown: Element | null = document.querySelector('.autocomplete-dropdown');
		if (!dropdown) return;

		if (evt.key === 'Enter') {
			const editor = this.app.workspace.activeEditor?.editor;
			if (editor) {
				const cursor = editor.getCursor();
				const beforeCursor = editor.getLine(cursor.line).substring(0, cursor.ch);
				void this.recordCompletedWord(beforeCursor, true);
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

	async bumpAcceptedWord(word: string): Promise<void> {
		this.wordTrie.bumpWordScore(word, ACCEPTED_SUGGESTION_BUMP);
		this.settings.wordScores[word] = this.wordTrie.getScore(word);
		this.settings.acceptedWordCounts[word] = (this.settings.acceptedWordCounts[word] ?? 0) + 1;
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
		if (!word) return EMPTY_FILE;
		if (this.settings.customDict.includes(word)) return DUPLICATE_WORD;

		this.settings.customDict.push(word);

		const score: number = this.settings.wordScores[word] ?? CUSTOM_WORD_SCORE;
		this.settings.wordScores[word] = score;

		this.wordTrie.insert(word, score);
		await this.saveSettings();
		return OK;
	}

	async removeCustomWord(index: number): Promise<Result> {
		const word: string = this.settings.customDict[index];
		if (!word) return NOT_OK;

		this.settings.lastRemovedWord = { word, index };
		this.settings.customDict.splice(index, 1);
		delete this.settings.acceptedWordCounts[word];
		delete this.settings.learnedWordCounts[word];

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

	private async recordCompletedWord(beforeCursor: string, fromEnter: boolean = false): Promise<void> {
		const terminated = /[ \t.,!?;:()[\]{}"'“”]/.test(beforeCursor.slice(-1));
		if (!this.settings.learnFromTyping || (!terminated && !fromEnter)) return;

		const match = beforeCursor.match(/([A-Za-z][A-Za-z'-]{2,})[^A-Za-z'-]*$/);
		if (!match) return;

		const word = match[1];
		if (this.settings.customDict.includes(word) ||
			DEFAULT_DICTIONARIES.some((dictionary) => dictionary.words.includes(word)) ||
			this.settings.dictFiles.some((file) => file.words.includes(word))) {
			return;
		}

		const currentCount = this.settings.learnedWordCounts[word] ?? 0;
		const nextCount = currentCount + 1;
		this.settings.learnedWordCounts[word] = nextCount;

		if (nextCount >= this.settings.learningThreshold) {
			delete this.settings.learnedWordCounts[word];
			const result = await this.addCustomWord(word);
			if (result.ok) {
				let destinationMessage = 'custom dictionary';
				if (this.settings.updateImportedDictionary) {
					await this.appendToImportedDictionary(word);
					destinationMessage = 'dictionary';
				}
				new Notice(`Learned "${word}" and added it to the ${destinationMessage}.`, 2000);
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
					.filter((entry) => entry.length > 0 && entry !== word);
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
					.map((entry) => entry === oldWord ? newWord : entry)
					.filter((entry) => entry.length > 0);
				fs.writeFileSync(dictionary.sourcePath, [...new Set(words)].join('\n'));
			} catch (error) {
				console.error('Text Autocomplete: failed to rename word in imported dictionary file.', error);
				new Notice(`"${oldWord}" was renamed in the plugin, but could not update the imported Text File.`);
			}
		}
	}

	async importDictFile(file: File, sourcePath?: string): Promise<{ result: Result , wordCount?: number }> {
		if (this.settings.dictFiles.some((f) => f.filename === file.name)) {
			return { result: DUPLICATE_FILE };
		}

		const text: string = await file.text();
		let words: string[] = text
			.split(/\r?\n/)
			.map((w: string) => w.trim())
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
