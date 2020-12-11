import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import { IRTVLogger, IRTVController, RowColMode } from './RTVInterfaces';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';

export class RTVSynth {
	private logger: IRTVLogger;
	private includedTimes: Set<number>;
	private envs?: any[] = undefined; // TODO Can we do better than any?
	private varname?: string = undefined;
	private lineno?: number = undefined;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly controller: IRTVController,
		@IThemeService readonly _themeService: IThemeService
	) {
		this.logger = utils.getLogger(editor);
		this.includedTimes = new Set();
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

	public startSynthesis(lineno: number) {
		// First of all, we need to disable Projection Boxes since we are going to be
		// modifying both the editor content, and the current projection box, and don't
		// want the boxes to auto-update at any point.
		const box = this.controller.getBox(lineno);
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
			return;
		}

		// ------------------------------------------
		// Okay, we are definitely using SnipPy here!
		// ------------------------------------------

		this.lineno = lineno;
		this.varname = l_operand;

		// TODO If we're in an if-branch, we need to run this for a
		// modified version of the code instead.
		this.controller.runProgram();
		this.controller.disable();

		r_operand = r_operand.substr(0, r_operand.length - 2).trim();

		let model = this.controller.getModelForce();
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = model.getLineMaxColumn(lineno);

		let range = new Range(lineno, startCol, lineno, endCol);
		let txt = '';

		if (l_operand === 'rv') {
			txt = 'return ' + (r_operand ? r_operand : '0');
		} else {
			txt = l_operand + ' = ' + (r_operand ? r_operand : '0');
		}

		this.editor.executeEdits(this.controller.getId(), [
			{ range: range, text: txt },
		]);

		setTimeout(() => {
			let cellKey = l_operand;
			let cellContents = box.getCellContent()[cellKey];

			if (cellContents) {
				cellContents.forEach(function (cellContent) {
					cellContent.contentEditable = 'true';
				});
				cellContents[0].focus();

				// TODO Is there a faster/cleaner way to select the content?
				let selection = window.getSelection()!;
				let range = selection.getRangeAt(0)!;
				range.selectNodeContents(selection.focusNode!);
				selection.addRange(range);

				this.logger.projectionBoxFocus(line, r_operand !== '');
				this.logger.exampleFocus(0, cellContents[0]!.textContent!);
			} else {
				console.error(`No cell found with key "${cellKey}"`);
			}
		}, 300);

		// Get all cell contents for the variable
		let contents = box.getCellContent()[this.varname];
		let elmt = box;
		this.envs = box.getEnvs();

		for (let i in contents) {
			let cellContent = contents[i];
			let env = this.envs![i];

			cellContent.onblur = (e: FocusEvent) => {
				if (env[this.varname!] !== cellContent.innerText) {
					this.logger.exampleChanged(
						this.findParentRow(cellContent).rowIndex,
						env[this.varname!],
						cellContent.innerText
					);
					this.toggleElement(env, cellContent, true);
				}
			};

			cellContent.onkeydown = (e: KeyboardEvent) => {
				let rs: boolean = true;

				switch (e.key) {
					case 'Enter':
						e.preventDefault();

						if (e.shiftKey) {
							this.toggleElement(env, cellContent);
							this.focusNextRow();
						} else {
							if (env[this.varname!] !== cellContent.innerText) {
								this.logger.exampleChanged(
									this.findParentRow(cellContent).rowIndex,
									env[this.varname!],
									cellContent.innerText
								);
								this.toggleElement(elmt, cellContent, true);
							}
							cellContent.contentEditable = 'false';
							this.editor.focus();
							this.logger.projectionBoxExit();
							setTimeout(() => {
								// Pressing enter also triggers the blur event, so we don't need to record any changes here.
								this.synthesizeFragment();
								this.includedTimes.clear();
								this.logger.exampleReset();
							}, 200);
						}
						break;
					case 'Tab':
						// ----------------------------------------------------------
						// Use Tabs to go over values of the same variable
						// ----------------------------------------------------------
						e.preventDefault();
						this.focusNextRow(e.shiftKey);
						break;
					case 'Escape':
						rs = false;
						this.editor.focus();
						this.stopSynthesis();
						break;
				}

				return rs;
			};
		}
	}

	public stopSynthesis() {
		this.logger.projectionBoxExit();

		// Update the Proejection Boxes again
		this.editor.focus();
		this.controller.enable();
		this.controller.runProgram();

		// Reset the synth state
		this.includedTimes.clear();
		this.logger.exampleReset();
	}

	// -----------------------------------------------------------------------------------
	// Recording changes
	// -----------------------------------------------------------------------------------

	private focusNextRow(backwards: boolean = false): void {
		let selection = window.getSelection()!;
		let cell: HTMLTableCellElement;
		let row: HTMLTableRowElement;

		for (
			let cellIter = selection.focusNode!;
			cellIter.parentNode;
			cellIter = cellIter.parentNode
		) {
			if (cellIter.nodeName === 'TD') {
				cell = cellIter as HTMLTableCellElement;
				break;
			}
		}

		for (
			let rowIter = cell!.parentNode!;
			rowIter.parentNode;
			rowIter = rowIter.parentNode
		) {
			if (rowIter.nodeName === 'TR') {
				row = rowIter as HTMLTableRowElement;
				break;
			}
		}

		this.logger.exampleBlur(row!.rowIndex, cell!.textContent!);

		if (this.controller.byRowOrCol === RowColMode.ByCol) {
			let table: HTMLTableElement = row!.parentNode as HTMLTableElement;
			let nextRowIdx =
				((row!.rowIndex - 1 + (backwards ? -1 : 1)) % (table.rows.length - 1)) +
				1;
			if (nextRowIdx <= 0) {
				nextRowIdx += table.rows.length - 1;
			}
			let nextRow = table.rows[nextRowIdx];
			let col = nextRow.childNodes[cell!.cellIndex!];
			let newFocusNode = col.childNodes[0];
			let range = selection?.getRangeAt(0);
			range.selectNodeContents(newFocusNode);
			selection?.removeAllRanges();
			selection?.addRange(range);
			this.logger.exampleFocus(
				nextRowIdx,
				newFocusNode!.textContent!
			);
		} else {
			let nextCellIdx =
				((cell!.cellIndex - 1 + (backwards ? -1 : 1)) %
					(row!.childNodes.length - 1)) +
				1;
			if (nextCellIdx <= 0) {
				nextCellIdx += row!.childNodes.length - 1;
			}
			let col = row!.childNodes[nextCellIdx];
			let newFocusNode = col.childNodes[0];
			let range = selection?.getRangeAt(0);
			range.selectNodeContents(newFocusNode);
			selection?.removeAllRanges();
			selection?.addRange(range);
			this.logger.exampleFocus(
				nextCellIdx,
				newFocusNode!.textContent!
			);
		}
	}

	private toggleElement(
		env: any,
		cell: HTMLElement,
		force: boolean | null = null
	) {
		let time = env['time'];
		let row = this.findParentRow(cell);
		let on: boolean;

		if (time === undefined) {
			on = true;
		} else if (force !== null) {
			on = force;
		} else {
			on = !this.includedTimes.has(time);
		}

		if (on) {
			// TODO Check if we need to add else case

			// Toggle on
			env[this.varname!] = cell.innerText;
			this.includedTimes.add(env['time']);

			// Highligh the row
			let theme = this._themeService.getColorTheme();
			row.style.fontWeight = '900';
			row.style.backgroundColor = String(theme.getColor(badgeBackground) ?? '');

			this.logger.exampleInclude(
				this.findParentRow(cell).rowIndex,
				cell.innerText
			);
		} else {
			// TODO Check if we need to remove else case

			// Toggle off
			this.includedTimes.delete(time);

			// Remove row highlight
			row.style.fontWeight = row.style.backgroundColor = '';

			this.logger.exampleExclude(
				this.findParentRow(cell).rowIndex,
				cell.innerText
			);
		}
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

		prev_time--;

		let previous_env = {};
		let envs: any[] = [];

		// search_loop:
		for (let env of this.envs!) {
			// TODO Is it safe to assume that the env_list is in order of time?
			// if (envs.length === timesToInclude.size) { break search_loop; }

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

			this.stopSynthesis();
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
}
