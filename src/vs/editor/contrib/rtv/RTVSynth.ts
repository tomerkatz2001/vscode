import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import { IRTVLogger, IRTVController, IRTVDisplayBox, BoxUpdateEvent } from './RTVInterfaces';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IModelContentChangedEvent } from 'vs/editor/common/model/textModelEvents';

const SYNTHESIZING_MESSAGE: string = '# Synthesizing. Please wait...';

class RTVSynthBackup {
	includedTimes: Set<number>;
	allEnvs?: any[];
	boxEnvs?: any[];
	varnames?: string[];
	row?: number;
	lineno?: number;
	box?: IRTVDisplayBox;
	lastRunResults?: any[];

	constructor(readonly synth: RTVSynth) {
		this.includedTimes = new Set(synth.includedTimes);
		this.allEnvs = synth.allEnvs;
		this.boxEnvs = new Array(synth.boxEnvs);
		this.varnames = synth.varnames;
		this.row = synth.row;
		this.lineno = synth.lineno;
		this.box = synth.box;
		this.lastRunResults = synth.lastRunResults;
	}

	restore(synth: RTVSynth) {
		synth.includedTimes = new Set(this.includedTimes);
		synth.allEnvs = this.allEnvs;
		synth.boxEnvs = this.boxEnvs;
		synth.varnames = this.varnames;
		synth.row = this.row;
		synth.lineno = this.lineno;
		synth.box = this.box;
		synth.lastRunResults = this.lastRunResults;
	}
}


/**
 * For manually keeping track of the undo state and
 * the state of the Projection Boxes.
 * Wait for message
 * --[See SYNTHESIZING_MESSAGE in Undo event]--> WaitForUndo
 * --[See another Undp event right after]--> WaitForUpdateStart
 * --[See the next PB update start event]--> WaitForUpdateFinish
 * --[See the PB update finish event]--> Restore the projection box!
 */
enum UndoState {
	WaitForMessage,
	WaitForUndo,
	WaitForUpdateStart,
	WaitForUpdateFinish
}

export class RTVSynth {
	private logger: IRTVLogger;
	enabled: boolean;
	includedTimes: Set<number>;
	allEnvs?: any[] = undefined; // TODO Can we do better than any?
	boxEnvs?: any[] = undefined;
	varnames?: string[] = undefined;
	row?: number = undefined;
	lineno?: number = undefined;
	box?: IRTVDisplayBox = undefined;

	// For restoring the PBs on Undo
	private backup?: RTVSynthBackup = undefined;
	private undoState: UndoState = UndoState.WaitForMessage;
	public lastRunResults?: any[] = undefined;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly controller: IRTVController,
		@IThemeService readonly _themeService: IThemeService
	) {
		this.logger = utils.getLogger(editor);
		this.includedTimes = new Set();
		this.enabled = false;

		// In case the user click's out of the boxes.
		editor.onDidFocusEditorText(() => {
			this.stopSynthesis();
		});

		// -- LooPy only --
		// TODO Is there a better way to capture undo events?
		// editor.onDidChangeModelContent((e) => this.handleUndoEvent(e));
		//controller.onUpdateEvent((e) => this.handleBoxUpdateEvent(e));
		// -- End of LooPy only --
	}

	private handleBoxUpdateEvent(e: BoxUpdateEvent) {
		if (e.isStart && this.undoState === UndoState.WaitForUpdateStart) {
			this.undoState = UndoState.WaitForUpdateFinish;
		} else if (e.isFinish && this.undoState === UndoState.WaitForUpdateFinish) {
			Promise.resolve().then(async () => {
				// Time to undo!
				this.backup!.restore(this);

				await this.controller.pythonProcess?.toPromise();

				let error = await this.updateBoxValues(this.lastRunResults);

				if (!error) {
					for (let varname of this.varnames!) {
						let cellContents = this.box!.getCellContent()[varname];

						if (cellContents) {
							cellContents.forEach((cellContent) => {
								cellContent.contentEditable = 'true';
							});

							let selection = window.getSelection()!;
							let range = selection.getRangeAt(0)!;

							range.selectNodeContents(cellContents[0]);
							selection.removeAllRanges();
							selection.addRange(range);

							// TODO Log events!
						}
					}
				}

				this.undoState = UndoState.WaitForUndo;
			});
		}
	}

	private handleUndoEvent(e: IModelContentChangedEvent) {
		if (!this.backup ||
			!e.isUndoing ||
			e.changes.length !== 1 ||
			e.changes[0].range.startLineNumber !== e.changes[0].range.endLineNumber ||
			e.changes[0].range.startLineNumber !== this.lineno) {
			// Not relevant to us.
			this.undoState = UndoState.WaitForMessage;
			return;
		}

		// e is an undo event for this line.

		if (e.changes[0].text === SYNTHESIZING_MESSAGE) {
			this.undoState = UndoState.WaitForUndo;
		} else if (this.undoState === UndoState.WaitForUndo) {
			this.undoState = UndoState.WaitForUpdateStart;
		}
	}

	// -----------------------------------------------------------------------------------
	// Interface
	// -----------------------------------------------------------------------------------

	public async startSynthesis(lineno: number) {
		this.enabled = true;

		// First of all, we need to disable Projection Boxes since we are going to be
		// modifying both the editor content, and the current projection box, and don't
		// want the boxes to auto-update at any point.
		const line = this.controller.getLineContent(lineno).trim();
		let l_operand: string = '';
		let r_operand: string = '';

		// TODO Handling `return ??` with the environment update is broken
		// Consider:
		// def f(x): return ??
		// rs = f(f(1))
		// The `rv` value is never updated. This however works fine:
		// def f(x):
		//     y = ??
		//     return y
		// rs = f(f(1))

		if (line.startsWith('return ')) {
			l_operand = 'rv';
			r_operand = line.substr('return '.length);
		} else {
			let listOfElems = line.split('=');

			if (listOfElems.length !== 2) {
				// TODO Can we inform the user of this?
				console.error(
					'Invalid input format. Must be of the form <varname> = ??'
				);
			} else {
				l_operand = listOfElems[0].trim();
				r_operand = listOfElems[1].trim();
			}
		}

		if (l_operand === '' || r_operand === '' || !r_operand.endsWith('??')) {
			this.stopSynthesis();
			return;
		}

		const varnames = this.extractVarnames();

		if (varnames.length != 1) {
			this.stopSynthesis();
			return;
		}

		// ------------------------------------------
		// Okay, we are definitely using SnipPy here!
		// ------------------------------------------
		this.lineno = lineno;
		this.varnames = varnames;
		this.row = 0;

		r_operand = r_operand.substr(0, r_operand.length - 2).trim();

		let model = this.controller.getModelForce();
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = model.getLineMaxColumn(lineno);

		let range = new Range(lineno, startCol, lineno, endCol);
		let txt = '';

		let defaultValue = await this.defaultValue(r_operand);

		if (l_operand === 'rv') {
			txt = `return ${defaultValue}`;
		} else {
			txt = `${l_operand} = ${defaultValue}`;
		}

		this.editor.executeEdits(this.controller.getId(), [
			{ range: range, text: txt },
		]);

		// Update the projection box with the new value
		const runResults: any = await this.controller.runProgram();

		this.box = this.controller.getBox(lineno);
		this.boxEnvs = this.box.getEnvs();

		this.varnames.forEach((varname, idx) => {
			let cellContents = this.box!.getCellContent()[varname];

			if (cellContents) {
				cellContents.forEach((cellContent) => cellContent.contentEditable = 'true');

				if (idx === 0) {
					// TODO Is there a faster/cleaner way to select the content?
					let selection = window.getSelection()!;
					let range = selection.getRangeAt(0)!;

					range.selectNodeContents(cellContents[0]);
					selection.removeAllRanges();
					selection.addRange(range);

					this.logger.projectionBoxFocus(line, r_operand !== '');
					this.logger.exampleFocus(0, cellContents[0]!.textContent!);
				}
			} else {
				console.error(`No cell found with key "${varname}"`);
				this.stopSynthesis();
				return;
			}
		});

		// TODO Cleanup all available envs
		this.allEnvs = [];

		for (let line in (runResults[2] as { [k: string]: any[]; })) {
			this.allEnvs = this.allEnvs.concat(runResults[2][line]);
		}

		// Get all cell contents for the variable
		this.setupTableCellContents();
	}

	public stopSynthesis() {
		if (this.enabled) {
			// First take a backup
			this.backup = new RTVSynthBackup(this);

			// Then clear the state
			this.includedTimes.clear();
			this.logger.exampleReset();
			this.enabled = false;

			// Finally reset the Projection Boxes
			this.editor.focus();
			this.logger.projectionBoxExit();
			this.controller.runProgram();
		}
	}

	// -----------------------------------------------------------------------------------
	// Recording changes
	// -----------------------------------------------------------------------------------

	/**
	 * Checks whether the current row's value is valid. If yes, it selects the next "row".
	 * If not, it keeps the cursor position, but adds an error message to the value to
	 * indicate the issue.
	 */
	private async focusNextRow(cellContent: HTMLElement, backwards: boolean = false, trackChanges: boolean = true): Promise<void> {
		// Get the current value
		let cell: HTMLTableCellElement;

		for (
			let cellIter = cellContent.parentNode!;
			cellIter.parentNode;
			cellIter = cellIter.parentNode
		) {
			if (cellIter.nodeName === 'TD') {
				cell = cellIter as HTMLTableCellElement;
				break;
			}
		}

		cell = cell!;

		// Extract the info from the cell ID, skip the first, which is the lineno
		const [varname, idxStr]: string[] = cell.id.split('_').slice(1);
		const idx: number = parseInt(idxStr);

		const currentValue = cell!.textContent!;

		if (trackChanges) {
			// Keep track of changes!
			const env = this.boxEnvs![idx];
			if (env[varname] !== currentValue) {
				this.logger.exampleChanged(idx, env[varname], currentValue);
				const success = await this.toggleElement(env, cell, varname, true);

				if (!success) {
					return;
				}
			}
		}

		// Finally, select the next value.
		this.logger.exampleBlur(idx, cell!.textContent!);

		let varIdx = this.varnames!.indexOf(varname) + (backwards ? -1 : +1);
		if (varIdx < 0) {
			varIdx = this.varnames!.length - 1;
			this.row! -= 1;
		} else if (varIdx >= this.varnames!.length) {
			varIdx = 0;
			this.row! += 1;
		}

		// Find the next row
		let nextCell = this.box!.getCell(this.varnames![varIdx], this.row!);

		if (!nextCell) {
			// The cell doesn't exist, so wrap around!
			this.row = (this.row! < 0) ? this.boxEnvs!.length - 1 : 0;
			nextCell = this.box!.getCell(this.varnames![varIdx], this.row!);
		}

		this.select(nextCell!.childNodes[0]);
		this.logger.exampleFocus(idx, nextCell!.textContent!);
	}

	private async toggleElement(
		env: any,
		cell: HTMLElement,
		varname: string,
		force: boolean | null = null
	): Promise<boolean> {
		let time = env['time'];
		let row = this.findParentRow(cell);
		let on: boolean;

		if (!time) {
			on = true;
		} else if (force !== null) {
			on = force;
		} else {
			on = !this.includedTimes.has(time);
		}

		if (on) {
			// Make sure the values are correct and up to date

			// -- LooPy only --
			// Check if value was valid
			// let error = await utils.validate(cell.textContent!);

			// if (error) {
			// 	// Show error message if not
			// 	this.addError(cell, error);
			// 	return false;
			// }
			// ---------------

			// Toggle on
			const oldVal = env[varname];
			const included = this.includedTimes.has(env['time']);

			env[varname] = cell.innerText;
			this.includedTimes.add(env['time']);

			// Now try to update the box with this value.
			let error = await this.updateBoxValues();

			if (error) {
				// The input causes an exception.
				// Rollback the changes and show the error.
				env[varname] = oldVal;

				if (!included) {
					this.includedTimes.delete(env['time']);
				}

				this.addError(cell, error);
				return false;
			}

			this.highlightRow(row);

			this.logger.exampleInclude(
				this.findParentRow(cell).rowIndex,
				cell.innerText
			);
		} else {
			// TODO Check if we need to remove else case

			// Toggle off
			this.includedTimes.delete(time);

			// Update box values
			let error = await this.updateBoxValues();
			if (error) {
				// Undoing this causes an exception.
				// Rollback the changes and show the error.
				this.includedTimes.add(time);
				this.addError(cell, error);
				return false;
			}

			// Remove row highlight
			row.style.fontWeight = row.style.backgroundColor = '';

			this.logger.exampleExclude(
				this.findParentRow(cell).rowIndex,
				cell.innerText
			);
		}

		return true;
	}

	// -----------------------------------------------------------------------------------
	// Synthesize from current data
	// -----------------------------------------------------------------------------------

	public synthesizeFragment() {
		// Build and write the synth_example.json file content
		let prev_time: number = Number.MAX_VALUE;

		this.includedTimes.forEach((time, _) => {
			if (time < prev_time) {
				prev_time = time;
			}
		});

		prev_time -= 1;

		let previous_env = {};
		let envs: any[] = [];

		// Look for the previous env in allEnvs
		for (let env of this.allEnvs!) {
			if (!env['time']) {
				continue;
			}

			if (env['time'] === prev_time) {
				previous_env = env;
			}
		}

		// Read the user's values from this box's envs
		for (let env of this.boxEnvs!) {
			if (!env['time']) {
				continue;
			}

			if (env['time'] === prev_time) {
				previous_env = env;
			}

			if (this.includedTimes.has(env['time'])) {
				envs.push(env);
			}
		}

		let problem = {
			varNames: this.varnames!,
			previous_env: previous_env,
			envs: envs,
			program: this.controller.getProgram(),
			line_no: this.lineno,
		};


		// Bad name, but reset everything, since we're done;
		const lineno = this.lineno!;
		const exampleCount = this.includedTimes.size;
		this.stopSynthesis();

		const c = utils.synthesizeSnippet(JSON.stringify(problem));
		this.logger.synthStart(problem, exampleCount, lineno);
		this.insertSynthesizedFragment(SYNTHESIZING_MESSAGE, this.lineno!);

		c.onStdout((data) => this.logger.synthOut(String(data)));
		c.onStderr((data) => this.logger.synthErr(String(data)));

		c.onExit((exitCode, result) => {
			let error: boolean = exitCode !== 0;

			if (!error) {
				this.logger.synthEnd(exitCode, result);
				error = result === undefined || result === 'None';
				if (!error) {
					this.insertSynthesizedFragment(result!!, lineno);
				}
			} else {
				this.logger.synthEnd(exitCode);
			}

			if (error) {
				this.insertSynthesizedFragment('# Synthesis failed', lineno);
			}
		});
	}

	private insertSynthesizedFragment(fragment: string, lineno: number) {
		// Cleanup fragment
		if (fragment.startsWith('rv = ')) {
			fragment = fragment.replace('rv = ', 'return ');
		}

		let model = this.controller.getModelForce();
		let cursorPos = this.editor.getPosition();
		let startCol: number;
		let endCol: number;

		if (
			model.getLineContent(lineno).trim() === '' &&
			cursorPos !== null &&
			cursorPos.lineNumber === lineno
		) {
			startCol = cursorPos.column;
			endCol = cursorPos.column;
		} else {
			startCol = model.getLineFirstNonWhitespaceColumn(lineno);
			endCol = model.getLineMaxColumn(lineno);
		}
		let range = new Range(lineno, startCol, lineno, endCol);

		// Add spaces for multiline results
		if (fragment.includes('\n')) {
			fragment = fragment.split('\n').join('\n' + ' '.repeat(startCol - 1));
		}

		this.editor.pushUndoStop();
		let selection = new Selection(
			lineno,
			startCol,
			lineno,
			startCol + fragment.length
		);
		this.editor.executeEdits(
			this.controller.getId(),
			[{ range: range, text: fragment }],
			[selection]
		);
	}

	// -----------------------------------------------------------------------------------
	// Utility functions
	// -----------------------------------------------------------------------------------

	private findParentRow(cell: HTMLElement): HTMLTableRowElement {
		let rs = cell;
		while (rs.nodeName !== 'TR') {
			rs = rs.parentElement!;
		}
		return rs as HTMLTableRowElement;
	}

	private extractVarnames(): string[] {
		let line = this.controller.getLineContent(this.lineno!).trim();
		let rs = undefined;

		if (line.startsWith('return ')) {
			rs = ['rv'];
		} else {
			let content = line.split('=');
			rs = content[0].trim().split(',').map((varname) => varname.trim());
		}

		return rs;
	}

	private addError(element: HTMLElement, msg: string) {
		// First, squiggly lines!
		element.className += 'squiggly-error';

		// Use monaco's monaco-hover class to keep the style the same
		const hover = document.createElement('div');
		hover.className = 'monaco-hover visible';
		hover.id = 'snippy-example-hover';

		const scrollable = document.createElement('div');
		scrollable.className = 'monaco-scrollable-element';
		scrollable.style.position = 'relative';
		scrollable.style.overflow = 'hidden';

		const row = document.createElement('row');
		row.className = 'hover-row markdown-hover';

		const content = document.createElement('div');
		content.className = 'monaco-hover-content';

		const div = document.createElement('div');
		const p = document.createElement('p');
		p.innerText = msg;

		div.appendChild(p);
		content.appendChild(div);
		row.appendChild(content);
		scrollable.appendChild(row);
		hover.appendChild(scrollable);

		let position = element.getBoundingClientRect();
		hover.style.position = 'fixed';
		hover.style.top = position.bottom.toString() + 'px';
		hover.style.left = position.right.toString() + 'px';

		// Add it to the DOM
		let editorNode = this.editor.getDomNode()!;
		editorNode.appendChild(hover);

		// Finally, add a listener to remove the hover and annotation
		let removeError = (ev: Event) => {
			element.removeEventListener('input', removeError);
			editorNode.removeChild(hover);
			element.className = element.className.replace('squiggly-error', '');
		};

		element.addEventListener('input', removeError);
	}

	private async updateBoxValues(content?: any[]): Promise<string | undefined> {

		// -- LooPy Only --
		// if (!content) {
		// 	let values: any = {};
		// 	for (let env of this.boxEnvs!) {
		// 		if (this.includedTimes.has(env['time'])) {
		// 			values[`(${env['lineno']},${env['time']})`] = env;
		// 		}
		// 	}

		// 	let c = utils.runProgram(this.controller.getProgram(), values);
		// 	let errorMsg: string = '';
		// 	c.onStderr((msg) => {
		// 		errorMsg += msg;
		// 	});

		// 	const results: any = await c.toPromise();
		// 	const result = results[1];

		// 	let parsedResult = JSON.parse(result);
		// 	let returnCode = parsedResult[0];

		// 	if (errorMsg && returnCode !== 0) {
		// 		// Extract the error message
		// 		const errorLines = errorMsg.split(/\n/).filter((s) => s);
		// 		const message = errorLines[errorLines.length - 1];
		// 		return message;
		// 	}

		// 	this.lastRunResults = parsedResult;
		// 	content = parsedResult;
		// }


		// this.box?.updateContent(content![2]);
		// this.boxEnvs = this.box?.getEnvs();
		// this.setupTableCellContents();
		// -- End of LooPy Only --

		return undefined;
	}

	private async defaultValue(currentVal: string): Promise<string> {
		// If the user specified a default value, use that.
		if (currentVal !== '') {
			return currentVal;
		}

		// -- PopPy Only
		const defaults = this.varnames!.map(_ => '0');
		// -- LooPy Only --
		// // Otherwise, find the best default for each variable
		// let defaults: string[] = [];

		// // We need to check the latest envs, so let's make sure it's up to date.
		// // await this.controller.pythonProcess?.toPromise();
		// await this.controller.runProgram();

		// // See if the variable was defined before this statement.
		// // If yes, we can set the default value to itself!
		// const boxEnvs = this.controller.getBox(this.lineno!)!.getEnvs();

		// let earliestTime = 100000;
		// for (let env of boxEnvs!) {
		// 	if (env['time'] < earliestTime) {
		// 		earliestTime = env['time'];
		// 	}
		// }

		// earliestTime--;

		// for (const varname of this.varnames!) {
		// 	let val = '0';

		// 	for (let line in this.controller.envs) {
		// 		for (let env of this.controller.envs[line]) {
		// 			if (env['time'] === earliestTime) {
		// 				if (env.hasOwnProperty(varname)) {
		// 					val = varname;
		// 				}
		// 				break;
		// 			}
		// 		}
		// 	}

		// 	// If not, we don't have any information, so let's go with 0.
		// 	defaults.push(val);
		// }
		// -- End of LooPy Only --

		return defaults.join(', ');
	}

	private select(node: Node) {
		let selection = window.getSelection()!;
		let range = selection.getRangeAt(0);
		range.selectNodeContents(node);
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	private highlightRow(row: HTMLTableRowElement) {
		// Highligh the row
		let theme = this._themeService.getColorTheme();
		row.style.fontWeight = '900';
		row.style.backgroundColor = String(theme.getColor(badgeBackground) ?? '');
	}

	private setupTableCellContents() {
		for (const varname of this.varnames!) {
			let contents = this.box!.getCellContent()[varname];

			for (let i in contents) {
				const cellContent = contents[i];
				const env = this.boxEnvs![i];

				cellContent.contentEditable = 'true';
				cellContent.onkeydown = (e: KeyboardEvent) => {
					let rs: boolean = true;

					switch (e.key) {
						case 'Enter':
							e.preventDefault();

							if (e.shiftKey) {
								this.toggleElement(env, cellContent, varname)
									.then((success) => {
										if (success) {
											// We're already tracked changes, so this should
											// not do that!
											this.focusNextRow(cellContent, false, false);
										}
									});
							} else {
								let togglePromise;

								if (env[varname] !== cellContent.innerText) {
									this.logger.exampleChanged(
										this.findParentRow(cellContent).rowIndex,
										env[varname],
										cellContent.innerText
									);

									togglePromise = this.toggleElement(env, cellContent, varname, true);
								} else {
									togglePromise = Promise.resolve(true);
								}

								togglePromise.then((success: boolean) => {
									if (success) {
										this.synthesizeFragment();

										cellContent.contentEditable = 'false';
										this.editor.focus();
										this.logger.projectionBoxExit();
										this.includedTimes.clear();
										this.logger.exampleReset();
									}
								});
							}
							break;
						case 'Tab':
							// ----------------------------------------------------------
							// Use Tabs to go over values of the same variable
							// ----------------------------------------------------------
							e.preventDefault();
							this.focusNextRow(cellContent, e.shiftKey);
							break;
						case 'Escape':
							rs = false;
							this.stopSynthesis();
							break;
					}

					return rs;
				};

				// Re-highlight the rows
				if (this.includedTimes.has(env['time'])) {
					this.highlightRow(this.findParentRow(cellContent));
				}
			}
		}
	}
}
