import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import { IRTVLogger, IRTVController, IRTVDisplayBox, Process } from './RTVInterfaces';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';

class SynthResult {
	constructor(
		public done: boolean,
		public program?: string,
		public outputs?: string[]
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
	private process?: Process;
	private done: boolean = false;
	private program?: string;
	private outputs?: string[];
	private waitingOnNext: boolean = false;

	private onNextFn?: (output?: string[]) => void;
	private onProgramFn?: (result?: string) => void;

	constructor(
		public problem: SynthProblem,
		private logger: IRTVLogger,
	) { }

	start() {
		// Bad name, but reset everything, since we're done;
		const lineno = this.problem.line_no!;
		const exampleCount = this.problem.envs.length;

		this.waitingOnNext = true;
		this.process = utils.synthesizeSnippet(JSON.stringify(this.problem));
		this.logger.synthStart(this.problem, exampleCount, lineno);

		this.process.onStdout((data) => {
			this.logger.synthOut(String(data));

			const result = JSON.parse(data) as SynthResult;
			this.program = result.program;
			this.outputs = result.outputs;
			this.done = result.done;
			this.waitingOnNext = false;

			if (result.done && this.onProgramFn) {
				this.onProgramFn(result.program);
			} else if (this.onNextFn) {
				this.onNextFn(result.outputs);
			}
		});

		this.process.onStderr((data) => this.logger.synthErr(String(data)));
		this.process.onExit(() => {
			this.done = true;
			if (this.onProgramFn) {
				this.onProgramFn(this.program);
			}
		});
	}

	next(): void {
		if (!this.waitingOnNext) {
			this.waitingOnNext = true;
			this.process?.toStdin('next\n');
		}
	}

	onProgram(fn: (program?: string) => void) {
		if (this.done) {
			fn(this.program);
		}
		this.onProgramFn = fn;
	}

	onNext(fn: (output?: string[]) => void) {
		if (this.outputs) {
			fn(this.outputs);
		}
		this.onNextFn = fn;
	}

	public dispose() {
		this.onNextFn = this.onProgramFn = undefined;
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

		// -- LooPy only --
		// TODO Is there a better way to capture undo events?
		// editor.onDidChangeModelContent((e) => this.handleUndoEvent(e));
		//controller.onUpdateEvent((e) => this.handleBoxUpdateEvent(e));
		// -- End of LooPy only --
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

			this.instance?.dispose();
			this.instance = undefined;

			this.lineno = undefined;
			this.varnames = [];
			this.box = undefined;
			this.boxEnvs = undefined;
			this.allEnvs = undefined;
			this.row = undefined;

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
		this.instance.onNext((outputs?: string[]) => {
			outputs?.forEach((output, i) => {
				this.box!.getCell(this.varnames![0], rows[i])!.childNodes[0].textContent = output;
			});
		});
		this.instance.onProgram((program?: string) => {
			this.insertSynthesizedFragment(program? program : '# Synthesis failed', this.lineno!);
			this.stopSynthesis();
		});
		this.instance.start();
		this.insertSynthesizedFragment('# Please wait. Synthesizing...', this.lineno!);
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
		// Highligh the row
		let theme = this._themeService.getColorTheme();
		row.style.fontWeight = '900';
		row.style.backgroundColor = String(theme.getColor(badgeBackground) ?? '');
	}

	private setupTableCellContents() {
		for (const varname of this.varnames!) {
			let contents = this.box!.getCellContent()[varname];

			contents.forEach((cellContent, i) => {
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
						case 'ArrowRight':
							if (e.altKey) {
								rs = false;
								this.instance?.next();
							}
							break;
					}
					return rs;
				};

				// Re-highlight the rows
				if (this.includedRows.has(i)) {
					this.highlightRow(this.findParentRow(cellContent));
				}
			});
		}
	}
}
