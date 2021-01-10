import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import { IRTVLogger, IRTVController, RowColMode, IRTVDisplayBox } from './RTVInterfaces';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';

export class RTVSynth {
	private logger: IRTVLogger;
	private enabled: boolean;
	private includedTimes: Set<number>;
	private allEnvs?: any[] = undefined; // TODO Can we do better than any?
	private boxEnvs?: any[] = undefined;
	private varname?: string = undefined;
	private lineno?: number = undefined;
	private box?: IRTVDisplayBox = undefined;

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
	}

	/**
	 * Stages of synthesis:
	 *  1. User enters '??' -> Listen for this, get the correct environment, move selection
	 *  2. User 'Tab's -> Record changes where appropriate, move selection
	 *  3. User 'Enter's -> Indicate synthesis started, synthesize
	 *  4. Synthesis ended -> Inform user of the results
	 */

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

		// ------------------------------------------
		// Okay, we are definitely using SnipPy here!
		// ------------------------------------------
		this.lineno = lineno;
		this.varname = l_operand;

		r_operand = r_operand.substr(0, r_operand.length - 2).trim();

		let model = this.controller.getModelForce();
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = model.getLineMaxColumn(lineno);

		let range = new Range(lineno, startCol, lineno, endCol);
		let txt = '';

		if (l_operand === 'rv') {
			txt = 'return ' + this.defaultValue(l_operand, r_operand);
		} else {
			txt = l_operand + ' = ' + this.defaultValue(l_operand, r_operand);
		}

		this.editor.executeEdits(this.controller.getId(), [
			{ range: range, text: txt },
		]);

		// Update the projection box with the new value
		const runResults: any = await this.controller.runProgram();

		this.box = this.controller.getBox(lineno);
		this.boxEnvs = this.box.getEnvs();

		let cellKey = l_operand;
		let cellContents = this.box.getCellContent()[cellKey];

		if (cellContents) {
			cellContents.forEach(function (cellContent) {
				cellContent.contentEditable = 'true';
			});

			// TODO Is there a faster/cleaner way to select the content?
			let selection = window.getSelection()!;
			let range = selection.getRangeAt(0)!;

			range.selectNodeContents(cellContents[0]);
			selection.removeAllRanges();
			selection.addRange(range);

			this.logger.projectionBoxFocus(line, r_operand !== '');
			this.logger.exampleFocus(0, cellContents[0]!.textContent!);
		} else {
			console.error(`No cell found with key "${cellKey}"`);
			this.stopSynthesis();
			return;
		}

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
			this.logger.projectionBoxExit();

			// Update the Proejection Boxes again
			this.editor.focus();
			this.controller.runProgram();

			// Reset the synth state
			this.includedTimes.clear();
			this.logger.exampleReset();
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
		let [col, row]: number[] = cell.id.split('_').map((num) => parseInt(num)).slice(1);

		const currentValue = cell!.textContent!;

		if (trackChanges) {
			// Keep track of changes!
			const env = this.boxEnvs![(this.controller.byRowOrCol === RowColMode.ByRow) ? col : row];
			if (env[this.varname!] !== currentValue) {
				this.logger.exampleChanged(row, env[this.varname!], currentValue);
				const success = await this.toggleElement(env, cell, true);

				if (!success) {
					return;
				}
			}
		}

		// Finally, select the next value.
		this.logger.exampleBlur(row, cell!.textContent!);

		if (this.controller.byRowOrCol === RowColMode.ByCol) {
			// Find the next row
			let nextRowId = backwards ? row - 1 : row + 1;
			let nextCell = this.box!.getCell(nextRowId, col);

			if (!nextCell) {
				// The cell doesn't exist, so wrap around!
				nextRowId = backwards ? (this.boxEnvs!.length - 1) : 0;
				nextCell = this.box!.getCell(nextRowId, col);
			}

			this.select(nextCell!.childNodes[0]);
			this.logger.exampleFocus(nextRowId, nextCell!.textContent!);
		} else {
			// Find the next col
			let nextColId = backwards ? col - 1 : col + 1;
			let nextCell = document.getElementById(this.box!.getCellId(row, nextColId));

			if (!nextCell) {
				// The cell doesn't exist, so wrap around!
				nextColId = backwards ? this.boxEnvs!.length : 0;
				nextCell = document.getElementById(this.box!.getCellId(row, nextColId));
			}

			this.select(nextCell!.childNodes[0]);
			this.logger.exampleFocus(
				nextColId,
				nextCell!.textContent!
			);
		}
	}

	private async toggleElement(
		env: any,
		cell: HTMLElement,
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
			const oldVal = env[this.varname!];
			const included = this.includedTimes.has(env['time']);

			env[this.varname!] = cell.innerText;
			this.includedTimes.add(env['time']);

			// Now try to update the box with this value.
			error = await this.updateBoxValues();

			if (error) {
				// The input causes an exception.
				// Rollback the changes and show the error.
				env[this.varname!] = oldVal;

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
		let varName = this.getVarAssignmentAtLine(this.lineno!);

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
			varName: varName,
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
		this.insertSynthesizedFragment(
			'# Synthesizing. Please wait...',
			this.lineno!
		);

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

	private getVarAssignmentAtLine(lineNo: number): null | string {
		let line = this.controller.getLineContent(lineNo).trim();
		if (!line) {
			return null;
		}

		let rs = null;

		if (line.startsWith('return ')) {
			rs = 'rv';
		} else {
			let content = line.split('=');
			if (content.length !== 2) {
				return null;
			}
			rs = content[0].trim();
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

	private async updateBoxValues(): Promise<string | undefined> {
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

		this.box?.updateContent(parsedResult[2]);
		this.boxEnvs = this.box?.getEnvs();
		this.setupTableCellContents();

		return undefined;
	}

	private defaultValue(varname: string, currentVal: string): string {
		// If the user specified a default value, use that.
		if (currentVal !== '') {
			return currentVal;
		}

		return '0';

		// TODO We need this.boxEnvs and this.allEnvs to be set before
		//  we can check for this.

		// // See if the variable was defined before this statement.
		// // If yes, we can set the default value to itself!
		// let earliestTime = 100000;
		// for (let env of this.boxEnvs!) {
		// 	if (env['time'] < earliestTime) {
		// 		earliestTime = env['time'];
		// 	}
		// }

		// earliestTime--;

		// for (let env of this.allEnvs!) {
		// 	if (env['time'] === earliestTime) {
		// 		if (env.hasOwnProperty(varname)) {
		// 			return varname;
		// 		}
		// 		break;
		// 	}
		// }

		// // If not, we don't have any information, so let's go with 0.
		// return '0';
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
		let contents = this.box!.getCellContent()[this.varname!];

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
							this.toggleElement(env, cellContent)
								.then((success) => {
									if (success) {
										// We're already tracked changes, so this should
										// not do that!
										this.focusNextRow(cellContent, false, false);
									}
								});
						} else {
							let togglePromise;

							if (env[this.varname!] !== cellContent.innerText) {
								this.logger.exampleChanged(
									this.findParentRow(cellContent).rowIndex,
									env[this.varname!],
									cellContent.innerText
								);

								togglePromise = this.toggleElement(env, cellContent, true);
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
						this.editor.focus();
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
