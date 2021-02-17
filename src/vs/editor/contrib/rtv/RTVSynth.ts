import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import { IRTVLogger, IRTVController, IRTVDisplayBox, Process } from './RTVInterfaces';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';

const SYNTHESIZING_MESSAGE: string = '# Please wait. Synthesizing...';
const SELECT_OUTPUT_MESSAGE: string = '# Please select output';

class SynthResult {
	constructor(
		public program: string,
		public done: boolean,
		public runpyResults?: any[]
	) {}
}

class SynthProblem {
	constructor(
		public varNames: string[],
		public previous_env: any,
		public envs: any[],
		public program: string,
		public line_no: number,
	) {}
}

class SynthInstance {
	private _results: SynthResult[] = [];
	private _currIdx: number = -1;
	private _done: boolean = false;
	private _killTimer?: ReturnType<typeof setTimeout>;

	private process?: Process;
	private onNextFn?: () => void;
	private onEndFn?: (results: SynthResult[]) => void;

	constructor(
		public problem: SynthProblem,
		private logger: IRTVLogger,
	) { }

	get done(): boolean {
		return this._done;
	}

	get results(): SynthResult[] {
		return [...this._results];
	}

	private restartTimer() {
		this._killTimer = setTimeout(() =>
		{
			this._done = true;
			this.process?.kill();
		}, 7000);
	}

	public remove(elem: SynthResult) {
		this._results.splice(this._results.findIndex((val) => val === elem), 1);
	}

	public next(): SynthResult | undefined {
		let rs;
		if (this.hasNext()) {
			rs = this._results[++this._currIdx];
		} else {
			if (!this._killTimer) {
				// We are at the end. Start a kill timer.
				this.restartTimer();
			}
			rs = undefined;
		}
		return rs;
	}

	public previous(): SynthResult | undefined {
		let rs = undefined;
		if (this.hasPrevious()) {
			rs = this._results[--this._currIdx];

			if (this._killTimer) {
				clearTimeout(this._killTimer);
				this._killTimer = undefined;
			}
		}
		return rs;
	}

	public current(): SynthResult | undefined {
		let rs = undefined;
		if (this._currIdx >= 0 && this._currIdx < this._results.length) {
			rs = this._results[this._currIdx];
		}
		return rs;
	}

	public hasNext(): boolean {
		return this._currIdx + 1 < this._results.length;
	}

	public hasPrevious() {
		return this._currIdx >= 1;
	}

	public start() {
		// Bad name, but reset everything, since we're done;
		const lineno = this.problem.line_no!;
		const exampleCount = this.problem.envs.length;

		this.process = utils.synthesizeSnippet(JSON.stringify(this.problem));
		this.logger.synthStart(this.problem, exampleCount, lineno);

		this.process.onStdout((data) => {
			const results = String.fromCharCode.apply(null, data)
				.split('\n')
				.filter(line => line)
				.map(line => JSON.parse(line) as SynthResult);

			results.forEach(rs =>{
				this._results.push(rs);
			});

			if (this.onNextFn) {
				this.onNextFn();
			}
		});

		this.process.onStderr((data) => this.logger.synthErr(String(data)));
		this.process.onExit(() => {
			this._done = true;
			if (this.onEndFn) {
				this.onEndFn(this.results);
			}
		});

		// Finally, start timer!
		this.restartTimer();
	}

	onEnd(fn: (results: SynthResult[]) => void) {
		if (this.done) {
			fn([...this.results]);
		}
		this.onEndFn = fn;
	}

	onNext(fn: () => void) {
		this.onNextFn = fn;

		if (this._results) {
			fn();
		}
	}

	public dispose() {
		this.onNextFn = this.onEndFn = undefined;
		this.process?.kill();
	}
}

export class RTVSynth {
	private logger: IRTVLogger;
	enabled: boolean;
	includedRows: Set<number>;
	allEnvs?: any[] = undefined; // TODO Can we do better than any?
	boxEnvs?: any[] = undefined;
	varnames?: string[] = undefined;
	row?: number = undefined;
	lineno?: number = undefined;
	box?: IRTVDisplayBox = undefined;
	instance?: SynthInstance;
	waitingOnNextResult: boolean = false;
	errorHover?: HTMLElement;

	// For restoring the PBs on Undo
	public lastRunResults?: any[] = undefined;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly controller: IRTVController,
		@IThemeService readonly _themeService: IThemeService
	) {
		this.logger = utils.getLogger(editor);
		this.includedRows = new Set();
		this.enabled = false;

		// In case the user click's out of the boxes.
		editor.onDidFocusEditorText(() => {
			this.stopSynthesis();
		});

		// The output selection process blocks everything!
		window.onkeydown = (e: KeyboardEvent) => {
			if (!this.instance) {
				// The rest of this only applies when in "output view" mode.
				return true;
			}

			let rs = false;

			switch (e.key) {
				case 'Enter':
					const solution = this.instance.current();
					if (solution) {
						this.insertSynthesizedFragment(solution.program, this.lineno!);
						this.stopSynthesis();
					}
					break;
				case 'Escape':
					this.stopSynthesis();
					break;
				case 'ArrowRight':
					this.nextResult();
					break;
				case 'ArrowLeft':
					this.previousResult();
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

		const varnames = this.extractVarnames(lineno);

		if (varnames.length !== 1) {
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
			this.enabled = false;

			// Clear the state
			this.includedRows = new Set();
			this.logger.exampleReset();

			this.waitingOnNextResult = false;
			this.instance?.dispose();
			this.instance = undefined;

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
			this.waitingOnNextResult = false;

			// Then reset the Projection Boxes
			this.editor.focus();
			this.logger.projectionBoxExit();
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
			on = !this.includedRows.has(this.row!);
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
			env[varname] = cell.innerText;
			this.includedRows.add(this.row!);
			this.highlightRow(row);

			this.logger.exampleInclude(
				this.findParentRow(cell).rowIndex,
				cell.innerText
			);
		} else {
			// TODO Check if we need to remove else case

			// Toggle off
			this.includedRows.delete(this.row!);

			// Remove row highlight
			this.removeHighlight(row);

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

	public async synthesizeFragment(): Promise<void> {
		// Build and write the synth_example.json file content
		let rows = Array.from(this.includedRows).sort();
		let prev_time: number = this.boxEnvs![rows[0]] - 1;

		let previous_env: any = {};

		// Look for the previous env in allEnvs
		for (let env of this.allEnvs!) {
			if (!env['time']) {
				continue;
			}

			if (env['time'] === prev_time) {
				previous_env = env;
			}
		}

		let envs: any[] = rows.map(i => this.boxEnvs![i]);

		let problem = new SynthProblem(
			this.varnames!,
			previous_env,
			envs,
			this.controller.getProgram(),
			this.lineno!
		);

		this.instance = new SynthInstance(problem, this.logger);
		this.instance.onNext(() => {
			if (this.waitingOnNextResult) {
				this.waitingOnNextResult = false;
				this.updateBoxValues(this.instance!.next()!);
			}
		});
		this.instance.onEnd((results: SynthResult[]) => {
			if (results.length === 0) {
				this.insertSynthesizedFragment('# Synthesis failed', this.lineno!);
				this.stopSynthesis();
			} else if (results[results.length - 1].done) {
				// This is not partial synth, just insert as usual
				const solution = results[results.length - 1];
				this.insertSynthesizedFragment(solution.program, this.lineno!);
				this.stopSynthesis();
			} else {
				let p: Promise<any>;

				if (this.waitingOnNextResult) {
					// Go to the last found solution
					this.waitingOnNextResult = false;

					if (this.instance?.hasNext()) {
						p = this.updateBoxValues(this.instance.next()!);
					} else {
						p = this.updateBoxValues(results[results.length - 1]);
					}
				} else {
					// Let the user know that's it
					p = Promise.resolve();
				}

				p.then(() => this.insertSynthesizedFragment(SELECT_OUTPUT_MESSAGE, this.lineno!));
			}
		});

		this.insertSynthesizedFragment(SYNTHESIZING_MESSAGE, this.lineno!);
		this.nextResult();

		this.instance.start();
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

		// Finally, add a listener to remove the hover and annotation
		// let removeError = (ev: Event) => {
		// 	element.removeEventListener('input', removeError);
		// 	editorNode.removeChild(hover);
		// 	element.className = element.className.replace('squiggly-error', '');
		// };
		// element.addEventListener('input', removeError);
	}

	/**
	 * Tries to update the box values with the given synthesis results. It can fail
	 * if the code causes an exception/error somewhere.
	 *
	 * @return true if it succeeds.
	 **/
	private async updateBoxValues(synthResult: SynthResult): Promise<boolean> {
		let content = synthResult.runpyResults;

		if (!content) {
			// First, run `run.py` with the synthesis result to get the values
			// TODO This only works for single-line outputs
			const program = this.controller.getProgram()
				.replace(SYNTHESIZING_MESSAGE, synthResult.program)
				.replace(SELECT_OUTPUT_MESSAGE, synthResult.program);
			let c = utils.runProgram(program);
			let errorMsg: string = '';
			c.onStderr((msg) => { errorMsg += msg; });

			const results: any = await c.toPromise().catch((e) => console.error(e));
			const result = results[1];

			let parsedResult = JSON.parse(result);
			let returnCode = parsedResult[0];

			// Return false if there were any errors

			if (errorMsg && returnCode !== 0) {
				return false;
			}

			// Update the box with the new values!
			this.lastRunResults = parsedResult;
			content = parsedResult;
		}

		this.box?.updateContent(content![2]);
		this.boxEnvs = this.box?.getEnvs();
		this.setupTableCellContents(false);

		// Reset the selection
		// this.select(this.box?.getCell(this.varnames![0], this.row!)!.childNodes[0]!);

		return true;
	}

	private async defaultValue(currentVal: string): Promise<string> {
		// If the user specified a default value, use that.
		if (currentVal !== '') {
			return currentVal;
		}

		return this.varnames!.map(_ => '0').join(', ');
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

	private setupTableCellContents(editable: boolean = true) {
		for (const varname of this.varnames!) {
			let contents = this.box!.getCellContent()[varname];

			contents.forEach((cellContent, i) => {
				const env = this.boxEnvs![i];

				cellContent.contentEditable = editable.toString();
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
			});
		}
	}

	private async previousResult(): Promise<void> {
		if (this.instance && this.instance.hasPrevious()) {
			this.waitingOnNextResult = false;

			if (this.errorHover) {
				this.errorHover.remove();
				this.errorHover = undefined;
			}

			let prev = this.instance.previous()!;
			this.updateBoxValues(prev);
		}
	}

	private async nextResult(): Promise<void> {
		if (this.instance) {
			if (this.errorHover) {
				this.errorHover.remove();
				this.errorHover = undefined;
			}

			if (this.instance.hasNext()) {
				this.waitingOnNextResult = false;

				let next = this.instance.next()!;
				let success = await this.updateBoxValues(next);

				if (!success) {
					this.instance.remove(next);
					this.nextResult();
				}
			} else if (!this.instance.done) {
				this.waitingOnNextResult = true;
				this.includedRows.forEach(i => {
					this.box!.getCellContent()[this.varnames![0]].forEach(cellContent => {
						cellContent.textContent = '...';
					});
				});
				this.select(this.box?.getCell(this.varnames![0], this.row!)!.childNodes[0]!);
			} else {
				this.addError(this.box?.getCell(this.varnames![0], this.row!)!, 'End of results');
			}
		}
	}
}
