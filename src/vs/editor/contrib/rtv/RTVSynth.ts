import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import { SynthResult, SynthProblem, IRTVLogger, IRTVController, IRTVDisplayBox, Process, ViewMode } from './RTVInterfaces';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';

const SYNTHESIZING_MESSAGE: string = '# Please wait. Synthesizing...';

class SynthProcess {
	private _resolve?: (value: SynthResult) => void = undefined;
	private _reject?: () => void = undefined;
	private _problemIdx: number;
	private process: Process;

	constructor() {
		this._problemIdx = -1;
		this.process = utils.synthProcess();

		// Set up the listeners we use to communicate with the synth
		this.process.onStdout((data) => {
			const resultStr = String.fromCharCode.apply(null, data);

			if (this._resolve && this._reject) {
				try {
					// TODO Check result id
					const rs = JSON.parse(resultStr) as SynthResult;
					this._resolve(rs);
					this._resolve = undefined;
					this._reject = undefined;
				} catch (e) {
					console.error('Failed to parse synth output: ' + String.fromCharCode.apply(null, data));
				}
			} else {
				console.error('Synth output when not waiting on promise: ');
				console.error(resultStr);
			}
		});

		this.process.onExit(() => {
			// This REALLY shouldn't happen.
			// TODO Make synthProcess check if the process is alive,
			//   and if not, restart it.
			this.process = utils.synthProcess();
		});
	}

	public start(problem: SynthProblem): Promise<SynthResult> {
		if (this._reject) {
			this._reject();
			this._resolve = undefined;
			this._reject = undefined;
		}

		// First, create the promise we're returning.
		const rs: Promise<SynthResult> = new Promise((resolve, reject) => {
			this._resolve = resolve;
			this._reject = reject;
		});

		// Then send the problem to the synth
		problem.id = ++this._problemIdx;
		console.log(JSON.stringify(problem));
		this.process.toStdin(JSON.stringify(problem) + '\n');

		// And we can return!
		return rs;
	}

	public stop(): Boolean {
		if (this._reject) {
			// TODO Actually stop the synthesizer.
			this._reject();
			this._reject = undefined;
			this._resolve = undefined;
			return true;
		}
		return false;
	}

	public dispose() {
		if (this._reject) {
			this._reject();
		}
		this.process?.kill();
	}
}

export class RTVSynth {
	private _logger: IRTVLogger;
	enabled: boolean;
	includedTimes: Set<number> = new Set();
	allEnvs?: any[] = undefined; // TODO Can we do better than any?
	boxEnvs?: any[] = undefined;
	varnames?: string[] = undefined;
	row?: number = undefined;
	lineno?: number = undefined;
	box?: IRTVDisplayBox = undefined;
	process: SynthProcess;
	errorHover?: HTMLElement = undefined;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly controller: IRTVController,
		@IThemeService readonly _themeService: IThemeService
	) {
		this._logger = utils.getLogger(editor);
		this.process = new SynthProcess();
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

		const varnames = this.extractVarnames(lineno);

		// ------------------------------------------
		// Okay, we are definitely using SnipPy here!
		// ------------------------------------------
		this.controller.changeViewMode(ViewMode.Cursor);

		this.lineno = lineno;
		this.varnames = varnames;
		this.row = 0;

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
			this.enabled = false;
			this.process.stop();

			// Clear the state
			this.includedTimes = new Set();

			if (this.errorHover) {
				this.errorHover.remove();
				this.errorHover = undefined;
			}

			this.lineno = undefined;
			this.varnames = [];
			this.box = undefined;
			this.boxEnvs = undefined;
			this.allEnvs = undefined;
			this.row = undefined;

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
		const [varname, idxStr]: string[] = cell.id.split('-').slice(1);
		const idx: number = parseInt(idxStr);

		const currentValue = cell!.textContent!;

		if (trackChanges) {
			// Keep track of changes!
			const env = this.boxEnvs![idx];
			if (env[varname] !== currentValue) {
				const success = await this.toggleElement(env, cell, varname, true);

				if (!success) {
					return;
				}
			}
		}

		// Finally, select the next value.
		let varIdx = this.varnames!.indexOf(varname) + (backwards ? -1 : +1);
		if (varIdx < 0) {
			varIdx = this.varnames!.length - 1;
			this.row! -= 1;
		} else if (varIdx >= this.varnames!.length) {
			// TODO Prevent going to next row if this row is not included?
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

			// Check if value was valid
			let error = await utils.validate(cell.textContent!);

			if (error) {
				// Show error message if not
				this.addError(cell, error);
				return false;
			}

			// Toggle on
			const oldVal = env[varname];
			const included = this.includedTimes.has(env['time']);

			env[varname] = cell.innerText;
			this.includedTimes.add(time);

			error = await this.updateBoxValues();

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
		} else {
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

			this.removeHighlight(row);
		}

		return true;
	}

	// -----------------------------------------------------------------------------------
	// Synthesize from current data
	// -----------------------------------------------------------------------------------

	public async synthesizeFragment(): Promise<void> {
		// Build and write the synth_example.json file content
		let times = Array.from(this.includedTimes).sort((a, b) => a - b);
		let prev_time: number = times[0] - 1;

		let previous_env: any | undefined = this.allEnvs!.find(env => env['time'] && env['time'] === prev_time);
		let envs: any[] = times.map(time => this.boxEnvs!.find(env => env['time'] && env['time'] === time));

		let problem = new SynthProblem(this.varnames!, previous_env, envs);
		this.insertSynthesizedFragment(SYNTHESIZING_MESSAGE, this.lineno!);
		this.controller.changeViewMode(ViewMode.Cursor);

		try {
			const rs = await this.process.start(problem);
			if (rs.success) {
				this.insertSynthesizedFragment(rs.program!, this.lineno!);
				this.stopSynthesis();
			} else {
				this.insertSynthesizedFragment('# Synthesis failed', this.lineno!);
				this.stopSynthesis();
			}
		} catch (err) {
			console.error('Synth problem rejected: ');
			console.error(err);
		}
	}

	private insertSynthesizedFragment(fragment: string, lineno: number) {
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
			fragment = fragment.split('\n').join('\n' + '\t'.repeat(startCol - 1));
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

	private addError(element: HTMLElement, msg: string) {
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
	}

	/**
	 * Tries to update the box values with the given values. It can fail
	 * if the code causes an exception/error somewhere.
	 *
	 * @return the error string, or `undefined` if no error occurs.
	 **/
	private async updateBoxValues(content?: any[]): Promise<string | undefined> {
		if (!content) {
			let values: any = {};
			for (let env of this.boxEnvs!) {
				if (this.includedTimes.has(env['time'])) {
					values[`(${env['lineno']},${env['time']})`] = env;
				}
			}

			let c = utils.runProgram(this.controller.getProgram(), values);
			let errorMsg: string = '';
			c.onStderr((msg) => {
				errorMsg += msg;
			});

			const results: any = await c.toPromise();
			const result = results[1];

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

		this.box?.updateContent(content![2]);
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
		await this.controller.pythonProcess?.toPromise();

		// See if the variable was defined before this statement.
		// If yes, we can set the default value to itself!
		// HACK
		let earliestTime = 100000;

		let boxEnvs = this.controller.getBox(this.lineno!)!.getEnvs();
		if (boxEnvs.length === 0) {
			boxEnvs = this.controller.getBox(this.lineno!-1)?.getEnvs();
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
		for (const varname of this.varnames!) {
			let contents = this.box!.getCellContent()[varname];

			contents.forEach((cellContent, i) => {
				const env = this.boxEnvs![i];

				cellContent.contentEditable = 'true';
				cellContent.onchange = () => {
					if (this.errorHover) {
						this.errorHover.remove();
						this.errorHover = undefined;
					}
				};
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
									togglePromise = this.toggleElement(env, cellContent, varname, true);
								} else {
									togglePromise = Promise.resolve(true);
								}

								togglePromise.then((success: boolean) => {
									if (success) {
										// Cleanup the UI
										this.box!.getCellContent()[varname].forEach(cellContent => this.removeHighlight(this.findParentRow(cellContent)));
										this.synthesizeFragment();
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
			});
		}
	}
}
