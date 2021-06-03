import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { getUtils } from 'vs/editor/contrib/rtv/RTVUtils';
import { Utils, RunResult, SynthResult, SynthProblem, IRTVLogger, IRTVController, IRTVDisplayBox, ViewMode, SynthProcess, DelayedRunAtMostOne } from './RTVInterfaces';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';

// const SYNTHESIZING_MESSAGE: string = '# Please wait. Synthesizing...';
// const SPEC_AWAIT_INDICATOR: string = '??';

enum EditorState {
	Synthesizing,
	Failed,
	HasProgram,
}

class EditorStateManager {
	private readonly SYNTHESIZING_INDICATOR: string;
	private readonly SYNTH_FAILED_INDICATOR: string;
	private _state: EditorState = EditorState.HasProgram;

	constructor(
		l_operand: string,
		private lineno: number,
		private editor: ICodeEditor,
		private controller: IRTVController) {
		this.SYNTHESIZING_INDICATOR = `${l_operand} = ...`;
		this.SYNTH_FAILED_INDICATOR = `${l_operand} = '🤯'`;
	}

	get state(): EditorState {
		return this._state;
	}

	synthesizing() {
		if (this._state == EditorState.Synthesizing) return;
		this._state = EditorState.Synthesizing;
		this.insertFragment(this.SYNTHESIZING_INDICATOR);
	}

	failed() {
		if (this._state == EditorState.Failed) return;
		this._state = EditorState.Failed;
		this.insertFragment(this.SYNTH_FAILED_INDICATOR);
	}

	program(program: string) {
		this._state = EditorState.HasProgram;
		this.insertFragment(program);
	}

	private insertFragment(fragment: string) {
		// Cleanup fragment
		// TODO We don't support return ?? sadly.
		// if (fragment.startsWith('rv = ')) {
		// 	fragment = fragment.replace('rv = ', 'return ');
		// }

		let model = this.controller.getModelForce();
		let cursorPos = this.editor.getPosition();
		let startCol: number;
		let endCol: number;

		if (
			model.getLineContent(this.lineno).trim() === '' &&
			cursorPos !== null &&
			cursorPos.lineNumber === this.lineno
		) {
			startCol = cursorPos.column;
			endCol = cursorPos.column;
		} else {
			startCol = model.getLineFirstNonWhitespaceColumn(this.lineno);
			endCol = model.getLineMaxColumn(this.lineno);
		}
		let range = new Range(this.lineno, startCol, this.lineno, endCol);

		// Add spaces for multiline results
		if (fragment.includes('\n')) {
			let indent = (model.getOptions()!.insertSpaces) ? ' ' : '\t';
			fragment = fragment.split('\n').join('\n' + indent.repeat(startCol - 1));
		}

		this.editor.pushUndoStop();
		let selection = new Selection(
			this.lineno,
			startCol,
			this.lineno,
			startCol + fragment.length
		);
		this.editor.executeEdits(
			this.controller.getId(),
			[{ range: range, text: fragment }],
			[selection]
		);
	}
}

class ErrorHoverManager {
	private errorHover?: HTMLElement = undefined;
	private addHoverTimer = new DelayedRunAtMostOne();

	constructor(private editor: ICodeEditor) {}

	public remove() {
		this.addHoverTimer.cancel();
		this.errorHover?.remove();
		this.errorHover = undefined;
	}

	public add(element: HTMLElement, msg: string, timeout: number = 0) {
		this.addHoverTimer.run(timeout, async () => {
			if (this.errorHover) {
				this.errorHover.remove();
				this.errorHover = undefined;
			}

			// First, squiggly lines!
			// element.className += 'squiggly-error';

			// Use monaco's monaco-hover class to keep the style the same
			this.errorHover = document.createElement('div');
			this.errorHover.className = 'monaco-hover visible';
			this.errorHover.id = 'snippy-example-hover';

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
			this.errorHover.appendChild(scrollable);

			let position = element.getBoundingClientRect();
			this.errorHover.style.position = 'fixed';
			this.errorHover.style.top = position.bottom.toString() + 'px';
			this.errorHover.style.left = position.right.toString() + 'px';
			this.errorHover.style.padding = '3px';

			// Add it to the DOM
			let editorNode = this.editor.getDomNode()!;
			editorNode.appendChild(this.errorHover);

			this.errorHover.ontransitionend = () => {
				if (this.errorHover) {
					if (this.errorHover.style.opacity === '0') {
						this.errorHover.remove();
					}
				}
			};

			setTimeout(() => {// TODO Make the error fade over time
				if (this.errorHover) {
					this.errorHover.style.transitionDuration = '1s';
					this.errorHover.style.opacity = '0';
				}
			}, 1000);
		});
	}
}

export class RTVSynth {
	private logger: IRTVLogger;
	enabled: boolean;
	includedTimes: Set<number> = new Set();
	allEnvs?: any[] = undefined;
	prevEnvs?: Map<number, any>;
	boxEnvs?: any[] = undefined;
	varnames?: string[] = undefined;
	row?: number = undefined;
	lineno?: number = undefined;
	box?: IRTVDisplayBox = undefined;
	utils: Utils;
	process: SynthProcess;
	rowsValid?: boolean[];
	synthTimer: DelayedRunAtMostOne = new DelayedRunAtMostOne();
	editorState?: EditorStateManager = undefined;
	errorBox: ErrorHoverManager;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly controller: IRTVController,
		@IThemeService readonly _themeService: IThemeService
	) {
		this.utils = getUtils();
		this.logger = this.utils.logger(editor);
		this.process = this.utils.synthesizer();
		this.errorBox = new ErrorHoverManager(editor);
		this.enabled = false;

		// In case the user click's out of the boxes.
		editor.onDidFocusEditorText(() => {
			this.stopSynthesis();
		});

		// The output selection process blocks everything!
		window.onkeydown = (e: KeyboardEvent) => {
			if (!this.enabled) {
				// The rest of this only applies when waiting on synth result.
				return true;
			}

			let rs = false;

			switch (e.key) {
				case 'Escape':
					this.stopSynthesis();
					break;
				default:
					rs = true;
			}

			return rs;
		};
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

		// if (line.startsWith('return ')) {
		// 	l_operand = 'rv';
		// 	r_operand = line.substr('return '.length);
		// } else {
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

		if (l_operand === '' || r_operand === '' || !r_operand.endsWith('??')) {
			this.stopSynthesis();
			return;
		}

		// ------------------------------------------
		// Okay, we are definitely using SnipPy here!
		// ------------------------------------------
		this.controller.changeViewMode(ViewMode.Cursor);

		this.lineno = lineno;
		this.varnames = this.extractVarnames(lineno);
		this.row = 0;
		this.editorState = new EditorStateManager(l_operand, this.lineno, this.editor, this.controller);

		this.logger.synthStart(this.varnames, this.lineno);

		r_operand = r_operand.substr(0, r_operand.length - 2).trim();

		let model = this.controller.getModelForce();
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = model.getLineMaxColumn(lineno);

		let range = new Range(lineno, startCol, lineno, endCol);

		let defaultValue = await this.defaultValue(r_operand);
		let txt: string;

		if (l_operand === 'rv') {
			txt = `return ${defaultValue}`;
		} else {
			txt = `${l_operand} = ${defaultValue}`;
		}

		this.editor.executeEdits(this.controller.getId(), [
			{ range: range, text: txt },
		]);

		// Update the projection box with the new value
		const runResults: any = await this.controller.updateBoxes();

		// Keep the view mode up to date.
		this.controller.disable();

		this.box = this.controller.getBox(lineno);
		this.boxEnvs = this.box.getEnvs();

		// TODO Cleanup all available envs
		this.updateAllEnvs(runResults);

		// Now that we have all the info, update the box again!
		await this.updateBoxValues();

		// Get all cell contents for the variable
		this.setupTableCellContents();

		this.varnames.forEach((varname, idx) => {
			let cellContents = this.box!.getCellContent()[varname];

			if (cellContents) {
				if (idx === 0) {
					let selection = window.getSelection()!;
					let range = selection.getRangeAt(0)!;

					// Find first non-empty cell
					const cellIdx = cellContents.findIndex(c => (c.textContent as string).trim());
					const cell = cellContents[cellIdx];

					if (cell) {
						range.selectNodeContents(cell);
						selection.removeAllRanges();

						cell.contentEditable = 'true';
						this.row = cellIdx;

						selection.addRange(range);
					} else {
						console.error(`All cells for key "${varname} were empty."`);
						this.stopSynthesis();
						return;
					}
				}
			} else {
				console.error(`No cell found with key "${varname}"`);
				this.stopSynthesis();
				return;
			}
		});
	}

	public stopSynthesis() {
		if (this.enabled) {
			this.logger.synthEnd();
			this.enabled = false;
			this.process.stop();

			// Clear the state
			this.includedTimes = new Set();
			this.errorBox.remove();

			this.lineno = undefined;
			this.varnames = [];
			this.box = undefined;
			this.boxEnvs = undefined;
			this.allEnvs = undefined;
			this.row = undefined;
			this.editorState = undefined;

			// Then reset the Projection Boxes
			this.controller.changeViewMode(ViewMode.Full);
			this.editor.focus();
			this.controller.enable();
			this.controller.updateBoxes();
		}
	}

	// -----------------------------------------------------------------------------------
	// Recording changes
	// -----------------------------------------------------------------------------------

	private findCell(cellContent: HTMLElement): HTMLTableCellElement | undefined {
		let cell: HTMLTableCellElement | undefined = undefined;

		for (
			let cellIter: Node = cellContent;
			cellIter.parentNode;
			cellIter = cellIter.parentNode
		) {
			if (cellIter.nodeName === 'TD') {
				cell = cellIter as HTMLTableCellElement;
				break;
			}
		}

		return cell;
	}

	private async toggleIfChanged(env: any, varname: string, cellContent: HTMLElement, updateBoxContent: boolean = true): Promise<boolean> {
		// Keep track of changes!
		let success = false;
		const cell = this.findCell(cellContent);
		if (cell) {
			const currentValue = cell.textContent!;
			if (env[varname] !== currentValue) {
				success = await this.toggleElement(env, cell, varname, true, updateBoxContent);
			} else {
				success = true;
			}
		} else {
			console.error('toggleIfChanged called, but parent can\' be found: ');
			console.error(cellContent);
		}
		return success;
	}

	/**
	 * Checks whether the current row's value is valid. If yes, it selects the next "row".
	 * If not, it keeps the cursor position, but adds an error message to the value to
	 * indicate the issue.
	 */
	private async focusNextRow(
		cellContent: HTMLElement,
		backwards: boolean = false,
		trackChanges: boolean = true,
		skipLine: boolean = false,
		updateBoxContent: boolean = true
	): Promise<void> {
		// Get the current value
		let cell: HTMLTableCellElement = this.findCell(cellContent)!;

		// Extract the info from the cell ID, skip the first, which is the lineno
		const [varname, idxStr]: string[] = cell.id.split('-').slice(1);
		const idx: number = parseInt(idxStr);
		const env = this.boxEnvs![idx];

		if (trackChanges) {
			const success = await this.toggleIfChanged(env, varname, cell, updateBoxContent);
			if (!success) {
				return;
			}
		}

		// Finally, select the next value.
		let varIdx: number;

		if (skipLine) {
			// Go to the first variable in the next line
			varIdx = 0;
			this.row! += backwards ? -1 : +1;
		} else {
			// Check what the next variable is
			varIdx = this.varnames!.indexOf(varname) + (backwards ? -1 : +1);
			if (varIdx < 0) {
				varIdx = this.varnames!.length - 1;
				this.row! -= 1;
			} else if (varIdx >= this.varnames!.length) {
				varIdx = 0;
				this.row! += 1;
			}
		}

		if (this.row! >= this.rowsValid!.length) {
			this.row = 0;
		} else if (this.row! < 0) {
			this.row = this.rowsValid!.length - 1;
		}

		while (!this.rowsValid![this.row!]) {
			this.row! += (backwards) ? -1 : +1;

			if (this.row! >= this.rowsValid!.length) {
				this.row = 0;
			} else if (this.row! < 0) {
				this.row = this.rowsValid!.length - 1;
			}
		}

		// Find the next row
		let nextCell = this.box!.getCell(this.varnames![varIdx], this.row!);

		if (!nextCell) {
			// The cell doesn't exist, so wrap around!
			this.row = (this.row! < 0) ? this.boxEnvs!.length - 1 : 0;
			nextCell = this.box!.getCell(this.varnames![varIdx], this.row!);
		}

		this.select(nextCell!.childNodes[0]);
	}

	private async toggleElement(
		env: any,
		cell: HTMLElement,
		varname: string,
		force: boolean | null = null,
		updateBoxContent: boolean = true
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

			// Check if value was valid
			let error = await this.utils.validate(cell.textContent!);

			if (error) {
				// Show error message if not
				this.errorBox.add(cell, error, 500);
				return false;
			}

			// let error;

			// Toggle on
			// const oldVal = env[varname];
			// const included = this.includedTimes.has(env['time']);

			env[varname] = cell.innerText;
			this.includedTimes.add(time);

			/*
			// [Lisa, 5/30] original code for input checking,
			// commented out to avoid new specs being removed from `this.includedTimes`
			// error = await this.updateBoxValues(updateBoxContent);

			if (error) {
				// The input causes an exception.
				// Rollback the changes and show the error.
				// if (updateBoxContent) {
				// 	env[varname] = oldVal;
				// }

				// if (!included) {
				// 	this.includedTimes.delete(env['time']);
				// }

				// removed `addError` to avoid error indicators as the user types in a string
				// this.addError(cell, error);
				return false;
			}
			*/

			this.highlightRow(row);
		} else {
			// Toggle off
			this.includedTimes.delete(time);

			// Update box values
			let error = await this.updateBoxValues(updateBoxContent);
			if (error) {
				// Undoing this causes an exception.
				// Rollback the changes and show the error.
				this.includedTimes.add(time);
				// this.addError(cell, error);
				return false;
			}

			this.removeHighlight(row);
		}

		return true;
	}

	// -----------------------------------------------------------------------------------
	// Synthesize from current data
	// -----------------------------------------------------------------------------------

	public async synthesizeFragment(cellContent: HTMLTableCellElement): Promise<boolean> {
		// Build and write the synth_example.json file content
		let envs = [];

		let boxEnvs = this.box!.getEnvs(); // instead of this.boxEnvs!

		for (const env of boxEnvs) {
			const time = env['time'];

			if (this.includedTimes!.has(time)) {
				envs.push(env);
			}
		}

		let previousEnvs: { [t: string]: any } = {};
		for (const [time, env] of this.prevEnvs!) {
			previousEnvs[time.toString()] = env;
		}

		let problem = new SynthProblem(this.varnames!, previousEnvs, envs);
		this.logger.synthSubmit(problem);
		this.editorState!.synthesizing();

		try {
			const rs: SynthResult | undefined = await this.process.synthesize(problem);

			if (!rs) {
				// The request was cancelled!
				return false;
			}

			this.logger.synthResult(rs);
			// console.log(completion);
			if (rs.success) {
				this.editorState!.program(rs.program!);
				const res = await this.controller.updateBoxesNoRefresh(cellContent);

				if (res) {
					this.boxEnvs = this.box!.getEnvs();

					this.logger.synthEnd();
					// this.process.stop();

					this.setupTableCellContents();

					let cell = this.findCell(res)!;

					const sel = window.getSelection()!;
					const range = document.createRange();

					let isString = cell.innerText[0] === '\'' || cell.innerText[0] === '"';
					let offset = isString ? (cell.innerText.length - 1) : (cell.innerText.length);

					let dest: HTMLElement = cell;
					while (dest.firstChild) {
						dest = dest.firstChild as HTMLElement;
					}
					range.selectNodeContents(dest);
					range.setStart(dest, offset);
					range.collapse(true);

					sel.removeAllRanges();
					sel.addRange(range);
				}

				return true;
			} else {
				this.editorState!.failed();
			}
		} catch (err) {
			// If the synth promise is rejected
			console.error('Synth problem rejected.');
			if (err) {
				console.error(err);
				this.editorState!.failed();
			}
		}

		return false;
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

	private extractVarnames(lineno: number): string[] {
		let line = this.controller.getLineContent(lineno).trim();
		let rs = undefined;

		if (line.startsWith('return ')) {
			rs = ['rv'];
		} else {
			let content = line.split('=');
			rs = content[0].trim().split(',').map((varname) => varname.trim());
		}

		return rs;
	}


	/**
	 * Tries to update the box values with the given values. It can fail
	 * if the code causes an exception/error somewhere.
	 *
	 * @return the error string, or `undefined` if no error occurs.
	 **/
	private async updateBoxValues(updateBoxContent: boolean = true, content?: any[]): Promise<string | undefined> {
		if (!content) {
			let values: any = {};
			for (let env of this.boxEnvs!) {
				if (this.includedTimes.has(env['time'])) {
					values[`(${env['lineno']},${env['time']})`] = env;
				}
			}

			let c = this.utils.runProgram(this.controller.getProgram(), values);
			const results: RunResult = await c;
			const errorMsg = results.stderr;
			const result = results.result;

			if (!result) {
				console.error('Failed to run program');
				return 'Error: Failed to run program.';
			}

			let parsedResult = JSON.parse(result);
			let returnCode = parsedResult[0];

			if (errorMsg && returnCode !== 0) {
				// Extract the error message
				const errorLines = errorMsg.split(/\n/).filter((s) => s);
				const message = errorLines[errorLines.length - 1];
				return message;
			}

			content = parsedResult;
		}

		// First, update our envs
		this.updateAllEnvs(content!);

		// only create new boxes when `updateBoxContent` is true
		if (updateBoxContent) {
			this.box?.updateContent(content![2], undefined, this.varnames!, this.prevEnvs!);
		}
		this.boxEnvs = this.box?.getEnvs();
		this.setupTableCellContents();

		return undefined;
	}

	private async defaultValue(currentVal: string): Promise<string> {
		// If the user specified a default value, use that.
		if (currentVal !== '') {
			return currentVal;
		}

		// Otherwise, find the best default for each variable
		let defaults: string[] = [];

		// We need to check the latest envs, so let's make sure it's up to date.
		await this.controller.pythonProcess;

		// See if the variable was defined before this statement.
		// If yes, we can set the default value to itself!
		// HACK
		let earliestTime = 100000;

		let boxEnvs = this.controller.getBox(this.lineno!)!.getEnvs();
		if (boxEnvs.length === 0) {
			boxEnvs = this.controller.getBox(this.lineno! - 1)?.getEnvs();
			if (boxEnvs) {
				if (boxEnvs) {
					for (let env of boxEnvs!) {
						if (env['time'] < earliestTime) {
							earliestTime = env['time'];
						}
					}
				}
			}
		} else {
			if (boxEnvs) {
				for (let env of boxEnvs!) {
					if (env['time'] < earliestTime) {
						earliestTime = env['time'];
					}
				}
			}
			earliestTime--;
		}

		for (const varname of this.varnames!) {
			let val = '0';

			for (let line in this.controller.envs) {
				for (let env of this.controller.envs[line]) {
					if (env['time'] === earliestTime) {
						if (env.hasOwnProperty(varname)) {
							val = varname;
						}
						break;
					}
				}
			}

			// If not, we don't have any information, so let's go with 0.
			defaults.push(val);
		}

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
		let theme = this._themeService.getColorTheme();
		row.style.fontWeight = '900';
		row.style.backgroundColor = String(theme.getColor(badgeBackground) ?? '');
	}

	private removeHighlight(row: HTMLTableRowElement) {
		row.style.fontWeight = row.style.backgroundColor = '';
	}

	private setupTableCellContents() {
		const boxEnvs = this.box!.getEnvs();
		if (boxEnvs.some(env => Object.keys(env).length <= 2)) {
			// We have empty rows, so we must be inside a conditional :(
			// Any non-empty row is valid here, since this counts as small-step.
			this.rowsValid = boxEnvs.map((env, _) => Object.keys(env).length > 2);
		} else {
			this.rowsValid = boxEnvs.map((env, i) => {
				let time;
				let rs = false;
				if (env) {
					time = env['time'];
					rs = !env['#'] ||
						env['#'] === '0' ||
						(i > 0 && this.includedTimes.has(boxEnvs[i - 1]['time']));
				}

				// This row is no longer valid. Remove it from the included time!
				if (!rs && this.includedTimes.has(time)) {
					this.includedTimes.delete(time);
					this.removeHighlight(this.findParentRow(this.box!.getCell(this.varnames![0], i)!));
				}

				return rs;
			});
		}

		if (this.rowsValid!.length === 0) {
			console.error('No rows found.');
			this.rowsValid = [true];
		} else if (!this.rowsValid!.includes(true)) {
			console.error('All rows invalid!');
			this.rowsValid[0] = true;
		}

		for (const varname of this.varnames!) {
			let contents = this.box!.getCellContent()[varname];

			contents.forEach((cellContent, i) => {
				// not available when synth solution has multi lines
				const env = this.boxEnvs![i];

				if (this.rowsValid![i]) {
					// Only enable this for cells that the user is allowed to modify.
					cellContent.contentEditable = 'true';
				}
				cellContent.onblur = () => {
					this.toggleIfChanged(env, varname, cellContent);
				};
				cellContent.onkeydown = (e: KeyboardEvent) => {
					let rs: boolean = true;

					switch (e.key) {
						case 'Enter':
							e.preventDefault();

							if (this.editorState!.state === EditorState.HasProgram) {
								// The use must have accepted the solution.
								this.stopSynthesis();
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
						default:
							// discard previous synth requests
							this.process.stop();

							// Remove any error box
							this.errorBox.remove();

							// TODO: auto-closing quotes, brackets etc. per corresponding key down
							// const mapping: { [c: string]: string} = {'\'': '\'', '"':'"', '[':']', '{':'}'};
							// 	if (e.key in mapping) {
							// 		let selection = window.getSelection()!;
							// 		let range = selection.getRangeAt(0)!;
							// 		let pos = range.startOffset;
							// 		let currContent = cellContent.innerText;
							// 		let newContent = [currContent.slice(0,pos),
							// 							mapping[e.key],
							// 							currContent.slice(pos)].join('');
							// 		cellContent.innerText = newContent;

							// 		// var dest: HTMLElement = cellContent;
							// 		// while (dest.firstChild) {
							// 		// 	dest = dest.firstChild as HTMLElement;
							// 		// }

							// 		// // move cursor right before the ending quote
							// 		// range.setStart(dest, pos);
							// 		// range.collapse(true);
							// 		// selection.removeAllRanges();
							// 		// selection.addRange(range);
							// 	}
							this.synthTimer.run(500, async () => {
								// the following pasted from snippy-plus-temp

								// do not create a new box when synth succeeds
								// or roll back to prev values when synth fails

								// TODO: auto-inserting missing closing quotes

								// let pattern = new RegExp("^(('[^']*)|(\"[^\"]*))$");
								// let incomplete = pattern.test(cellContent.innerText);


								// let selection = window.getSelection()!;
								// let range = selection.getRangeAt(0)!;
								// if (incomplete) {
								// 	cellContent.innerText += cellContent.innerText[0];
								// 	let selection = window.getSelection()!;
								// 	let range = selection.getRangeAt(0)!;
								// 	range.setStart(cellContent.childNodes[0], cellContent.innerText.length-1);
								// 	range.collapse(true);
								// 	selection.removeAllRanges();
								// 	selection.addRange(range);

								// }
								if (env[varname] !== cellContent.innerText) {
									let updateBoxContent = false;
									const validInput = await this.toggleElement(env, cellContent, varname, true, updateBoxContent);

									if (validInput) {
										let cell: HTMLTableCellElement = this.findCell(cellContent)!;
										await this.synthesizeFragment(cell);
									}
								}
							});
							break;
					}

					return rs;
				};

				// Re-highlight the rows
				if (env) {
					if (this.includedTimes.has(env['time'])) {
						this.highlightRow(this.findParentRow(cellContent));
					}
				}
			});
		}
	}

	private updateAllEnvs(runResults: any): void {
		this.allEnvs = [];
		for (let line in (runResults[2] as { [k: string]: any[]; })) {
			this.allEnvs = this.allEnvs.concat(runResults[2][line]);
		}

		this.prevEnvs = new Map<number, any>();

		for (const startEnv of this.allEnvs) {
			const start = startEnv['time'];
			let minDelta = 1024 * 1024;
			let minEnv = undefined;

			for (const env of this.allEnvs) {
				const time = env['time'];
				if (time) {
					const delta = start - time;
					if (delta > 0 && delta < minDelta) {
						minDelta = delta;
						minEnv = env;

						if (delta === 1) {
							break;
						}
					}
				}
			}

			if (minEnv) {
				this.prevEnvs.set(start, minEnv);
			}
		}
	}
}
