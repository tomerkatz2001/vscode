import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { DelayedRunAtMostOne } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { TableElement, isHtmlEscape, removeHtmlEscape } from 'vs/editor/contrib/rtv/RTVUtils';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';


class CursorPos {
	constructor (
		public node: HTMLElement,
		public startPos?: number,
		public endPos?: number,
		public collapsed?: boolean
	) {}
}

export class ErrorHoverManager {
	private errorHover?: HTMLElement = undefined;
	private addHoverTimer = new DelayedRunAtMostOne();

	constructor(private editor: ICodeEditor) {}

	public remove() {
		this.addHoverTimer.cancel();
		this.errorHover?.remove();
		this.errorHover = undefined;
	}

	public add(element: HTMLElement, msg: string, timeout: number = 0, fadeout: number = 1000) {
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
			this.errorHover.style.top = position.top.toString() + 'px';
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
					this.errorHover.style.transitionDuration = '2s'; // increased from 1s
					this.errorHover.style.opacity = '0';
				}
			}, fadeout);
		})
		.catch(err => {
			if (err) {
				console.error(err);
			}
		});
	}
}

// Create RTVSynthDisplayBox at first, but keep the HTML element (a clone of the original PB) hidden.
// Only change opacity to 1 when we're sure about to start synth, by calling `RTVSynthDisplayBox.
export class RTVSynthDisplayBox {
	private _box: HTMLDivElement;
	private _line: HTMLDivElement;
	private _errorBox: ErrorHoverManager;
	private _modeService: IModeService;
	private _openerService: IOpenerService;
	private _cells?: Map<string, HTMLTableCellElement[]> = undefined;
	// from service
	private _includedTimes: Set<number> = new Set<number>();
	private _rows: TableElement[][] = [[]];
	private _currRow: number;
	private _cursorPos?: CursorPos;
	// private _tmpVal?: string;
	private _boxEnvs: any[] = [];
	private _synthTimer: DelayedRunAtMostOne = new DelayedRunAtMostOne();
	private _firstEditableCellId?: string = undefined;

	ksHandler?: Function;
	exitSynthHandler?: Function;
	requestValidateInput?: Function;
	requestSynth?: Function;
	requestUpdateBoxContent?: Function;
	synthesizing?: Function;

	constructor(
		private readonly _editor: ICodeEditor,
		readonly originalLineNode: HTMLElement,
		readonly originalBoxNode: HTMLElement,
		readonly modeService: IModeService,
		readonly openerService: IOpenerService,
		readonly lineNumber: number,
		readonly outputVars: string[],
		@IThemeService readonly _themeService: IThemeService
	) {
		this._box = originalBoxNode.cloneNode(true) as HTMLDivElement;
		this._line = originalLineNode.cloneNode(true) as HTMLDivElement;
		this._modeService = modeService;
		this._openerService = openerService;
		this._box.id = 'rtv-synth-box';
		this._box.style.opacity = '0';
		this._line.id = 'rtv-synth-line';
		this._line.style.opacity = '0';
		this._currRow = 0;
		this._errorBox = new ErrorHoverManager(this._editor);

		for (
			let elm: Node = this._box;
			elm.firstChild;
			elm = elm.firstChild
		) {
			// if (elm.nodeName === 'TABLE') {
			// 	this._table = elm as HTMLTableElement;
			// 	continue;
			// }
			if (elm.nodeName === 'TBODY') {
				let rows = Array.from(elm.childNodes!).slice(1); // skip the header
				rows.forEach((r) => {
					let cells = Array.from(r.childNodes!) as HTMLTableCellElement[]; // td elements
					cells.forEach((cell) => {
						if (cell.id !== '') { // should be always true
							cell.id = this.transformCellId(cell.id);
						}
					});
				});
				break;
			}
		}

	}

	bindExitSynth(handler: Function) {
		this.exitSynthHandler = handler;
	}

	bindValidateInput(handler: Function) {
		this.requestValidateInput = handler;
	}

	bindSynth(handler: Function) {
		this.requestSynth = handler;
	}

	bindUpdateBoxContent(handler: Function) {
		this.requestUpdateBoxContent = handler;
	}

	bindSynthState(handler: Function) {
		this.synthesizing = handler;
	}

	// ------------
	// property getters and setters
	// ------------
	public show() {
		this._box.style.opacity = '1';
		this._line.style.opacity = '1';
		let editor_div = this._editor.getDomNode();
		if (editor_div === null) {
			throw new Error('Cannot find Monaco Editor');
		}
		editor_div.appendChild(this._line);
		editor_div.appendChild(this._box);
	}

	public hide() {
		this._box.style.opacity = '0';
		this._line.style.opacity = '0';
	}

	public isSynthBox() {
		return true;
	}

	public destroy() {
		if (this._box) {
			this._box.remove();
		}
		if (this._line) {
			this._line.remove();
		}
	}

	public getElement(): HTMLElement {
		return this._box!;
	}

	public transformCellId(cellId: string) : string {
		return `${cellId}-synth`;
	}

	public getCellId(varname: string, idx: number): string {
		return `${this.lineNumber}-${varname}-${idx}-synth`;
	}

	public getCell(varname: string, idx: number): HTMLTableCellElement | null {
		return document.getElementById(this.getCellId(varname, idx)) as HTMLTableCellElement;
	}

	// ------------
	// front-end updates
	// ------------

	public updateBoxContent(data: {[k: string]: [v: any]}) {
		const rows: TableElement[][] = data['rows'];
		const includedTimes: Set<number> = data['includedTimes'] as unknown as Set<number>;
		const boxEnvs: any[] = data['boxEnvs'];

		const renderer = new MarkdownRenderer(
							{ 'editor': this._editor },
							this._modeService,
							this._openerService);
		const outputVars = new Set(this.outputVars);

		this._includedTimes = includedTimes;
		this._boxEnvs = boxEnvs;
		this._firstEditableCellId = undefined;
		this._rows = rows;
		this._cells = new Map<string, HTMLTableCellElement[]>();

		// update cell contents and add event listeners
		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
			const row = rows[rowIdx];
			for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
				const elmt = row[_colIdx];
				const vname = elmt.vname!;
				// Get the cell
				// Note: use `rowIdx` instead of `... - 1` here because we didn't include the header row in the first place
				let cell = this.getCell(vname, rowIdx)!;
				if (cell !== null) {
					cell = this.updateCell(cell, elmt, renderer);
					if (!this._firstEditableCellId && vname === this.outputVars[0] && elmt.editable && elmt.content.trim() !== '') {
						this._firstEditableCellId = this.getCellId(vname, rowIdx);
					}

					// build this._cells
					if (outputVars.has(vname)) {
						let vcells = this._cells!.get(vname) ?? [];
						vcells.push(cell);
						this._cells!.set(vname, vcells);
					}

					// finally, re-highlight rows and remove highlight of rows that are no longer valid
					const env = this._boxEnvs![rowIdx];
					if (env) {
						if (this._includedTimes.has(env['time'])) {
							if (elmt.editable == false) {
								this._includedTimes.delete(env['time']);
								this.removeHighlight(this.findParentRow(cell));
							}
							else if (elmt.editable) {
								this.highlightRow(this.findParentRow(cell));
							}
						}
					}
				}

			}
		}
	}

	private updateCell(cell: HTMLTableCellElement, elmt: TableElement, r: MarkdownRenderer): HTMLTableCellElement{

		let s = elmt.content;
		let cellContent: HTMLElement;
		if (s === '') {
			// Make empty strings into a space to make sure it's allocated a space
			// Otherwise, the divs in a row could become invisible if they are
			// all empty
			cellContent = document.createElement('div');
			cellContent.innerHTML = '&nbsp';
		}
		else if (isHtmlEscape(s)) {
			cellContent = document.createElement('div');
			cellContent.innerHTML = removeHtmlEscape(s);
		} else {
			let renderedText = r.render(new MarkdownString(s));
			cellContent = renderedText.element;
		}


		// Remove any existing content
		cell.childNodes.forEach((child) => cell.removeChild(child));

		if (elmt.editable) {
			// make the TableCellElement `td` editable if applicable
			cell.contentEditable = 'true';
		}

		const outputVars = new Set(this.outputVars);

		// Add the new content
		cell.appendChild(cellContent);

		if (outputVars.has(elmt.vname!)) {
			this.addListeners(cell);
		}

		return cell;
	}

	// ------------
	// utility functions
	// ------------

	private select(node: Node) {
		let selection = window.getSelection()!;
		let range = selection.getRangeAt(0);
		range.selectNodeContents(node);
		selection.removeAllRanges();
		selection.addRange(range);
		this.updateCursorPos(range, node as HTMLElement);
	}

	private findParentRow(cell: HTMLElement): HTMLTableRowElement {
		let rs = cell;
		while (rs.nodeName !== 'TR') {
			rs = rs.parentElement!;
		}
		return rs as HTMLTableRowElement;
	}

	// private findCell(cellContent: HTMLElement): HTMLTableCellElement | undefined {
	// 	let cell: HTMLTableCellElement | undefined = undefined;

	// 	for (
	// 		let cellIter: Node = cellContent;
	// 		cellIter.parentNode;
	// 		cellIter = cellIter.parentNode
	// 	) {
	// 		if (cellIter.nodeName === 'TD') {
	// 			cell = cellIter as HTMLTableCellElement;
	// 			break;
	// 		}
	// 	}

	// 	return cell;
	// }

	private highlightRow(row: HTMLTableRowElement) {
		let theme = this._themeService.getColorTheme();
		row.style.fontWeight = '900';
		row.style.backgroundColor = String(theme.getColor(badgeBackground) ?? '');
	}

	private removeHighlight(row: HTMLTableRowElement) {
		row.style.fontWeight = row.style.backgroundColor = '';
	}

	private updateCursorPos(range: Range, node: HTMLElement) {
		if (!this._cursorPos) {
			this._cursorPos = new CursorPos(node);
		}
		this._cursorPos.node = range.startContainer as HTMLElement;
		this._cursorPos.startPos = range.startOffset ?? undefined;
		this._cursorPos.endPos = range.endOffset ?? undefined;
		this._cursorPos.collapsed = range.collapsed ?? undefined;
	}

	// TODO
	private addListeners(cell: HTMLElement) {
		cell.onclick = (e: MouseEvent) => {
			const selection = window.getSelection()!;
			const range = selection.getRangeAt(0)!;
			this.updateCursorPos(range, cell);
		}

		cell.onblur = () => {
			// TODO
			//this.toggleIfChanged();
		}

		cell.onkeydown = (e: KeyboardEvent) => {
			let rs: boolean = true;

			const selection = window.getSelection()!;
			const range = selection.getRangeAt(0)!;

			this.updateCursorPos(range, cell);

			const cellInfo = cell.id.split('-');
			const varname = cellInfo[1];
			const idx = cellInfo[2];
			const env = this._boxEnvs![+idx];


			switch(e.key) {
				case 'Enter':
					e.preventDefault();

					// with Shift:
					/*
					1. check if input is valid
					2. if so, highlight this row, ask controller to request synth
						3. if result available, insert program accordingly
					4. if not, show error message
					*/
					if (e.shiftKey) {
						this._synthTimer.run(1, async () => {
							const validInput = await this.toggleElement(env, cell, varname, undefined, false);
							if (validInput) {
								this.highlightRow(this.findParentRow(cell));
								await this.synthesizeFragment(cell);
							}
						})
					}
					// without Shift: accept and exit
					this.exitSynthHandler!(true);
					break;

				case 'Tab':
					/*
					0. check if a synth update is about to return. if so, wait??
					1. update cursor position
					2. record tmpVal of the node before move
					3. ask controller to check if tmpVal is valid
					4. if so, highlight current row and move cursor to next cell available and select the entire node
					6. if not, add an error message
					7. move cursor back to the recorded position
					*/
					while (this.synthesizing!()) {
						// do nothing
					}
					e.preventDefault();
					//await
					this.focusNextRow(cell, e.shiftKey);
					break;

				case 'Escape':
					// stop synth
					rs = false;
					e.preventDefault();
					this.exitSynthHandler!();
					break;
				default:
					this._synthTimer.run(1000, async () => {
						if (env[varname] !== cell.innerText) {
							const validInput = await this.toggleElement(env, cell, varname, true, false);

							if (validInput) {
								// let cell: HTMLTableCellElement = this.findCell(cell)!;
								await this.synthesizeFragment(cell);

							}
						}
					}).catch(err => {
						if (err) {
							console.error(err);
						}
					})
					// TODO: update cursorPos
					/*
					0. immediately ask controller to discard any ongoing synth requests
					1. set tmpVal to whatever's in the cell
					2. record cursorPos
					3. remove any error box
					... 1000ms later ...
					4. if cellcontent is the same as env[varname], prompt the user to use Shift+Enter to include this row
					5. if not the same, ask controller to check valid input (including parser check)
					6. if so, controller sends synth request
						if not, prompt the user with error msg
					7. when results are available, editor inserts synth'd fragment, service updates backend data accordingly,
						consequently, display updates box values when backend data is up to date
					8. check if cursorPos is the same as before (same node)
					9. if so, move cursor accordingly
					10. if not, don't move (reselect the original)
					*/
					this.ksHandler!(e);
					break;
			}
			return rs;
		}; // end of onkeydown

	}

	private async synthesizeFragment(cell: HTMLElement) {
		const success = await this.requestSynth!(cell);
		if (success) {
			const sel = window.getSelection()!;
			let offset = sel.anchorOffset;
			const range = document.createRange();

			let isString = cell.innerText[0] === '\'' || cell.innerText[0] === '"';

			let dest: HTMLElement = cell;
			while (dest.firstChild && (!dest.classList.contains('monaco-tokenized-source') || dest.childNodes.length == 1)) {
				dest = dest.firstChild as HTMLElement;
			}

			// the following conditional is buggy for negative numbers
			if (dest.childNodes.length > 1) {
				let isNegNum = dest.firstChild!.textContent == '-';
				offset = isNegNum ? cell.innerText.length : dest.childNodes.length - 1;
			// } else if (!offset) {
			} else {
				// We need to carefully pick the offset based on the type

				// Select the actual text
				while (dest.firstChild) {
					dest = dest.firstChild as HTMLElement;
				}

				offset = isString ? cell.innerText.length - 1 : cell.innerText.length;
			}

			if (this._cursorPos!.node.id === cell.id) {
				try {
					range.selectNodeContents(dest);
					range.setStart(dest, offset);
					range.collapse(true);

					sel.removeAllRanges();
					sel.addRange(range);
				} catch {
					// TODO Better error handling
					range.selectNodeContents(dest);
					range.setStart(dest, 0);
					range.collapse(true);

					sel.removeAllRanges();
					sel.addRange(range);
				}
			}
		}
	}

	// TODO
	private async toggleIfChanged(
		env: any,
		varname: string,
		cell: HTMLElement,
		updateBoxContent: boolean = true
	): Promise<boolean> {
		// Keep track of changes
		let success = false;
		if (cell) {
			const currentValue = cell.textContent!;
			if (env[varname] !== currentValue) {
				success = await this.toggleElement(env, cell, varname, true, updateBoxContent);
			} else {
				success = true;
			}
		} else {
			console.error('toggleIfChanged called, but parent can\' be found: ');
			console.error(cell);
		}
		return success;
	}

	private async toggleElement(
		env: any,
		cell: HTMLElement,
		varname: string,
		force?: boolean,
		updateSynthBox: boolean = true
	): Promise<boolean> {
		let time = env['time'];
		let row = this.findParentRow(cell);
		let on: boolean;

		if (!time) {
			on = true;
		} else if (force !== undefined) {
			on = force;
		} else {
			on = !this._includedTimes!.has(time);
		}

		if (on) {
			let error = await this.requestValidateInput!(env, cell, varname, undefined, false);
			if (error) {
				this.addError(error, cell, 500);
				return false;
			}

			env[varname] = cell.innerText.trim();
			console.log(`env[${varname}] = ${env[varname]}`);
			this._includedTimes!.add(time);
			// if error, then controller / service won't know the most recent `_includedTimes`;
			// however, the newest info will be delivered again when another request is made
			error = await this.requestUpdateBoxContent!(updateSynthBox, this._includedTimes);
			if (error) {
				this.addError(error, cell);
				return false;
			}
			this.highlightRow(row);
		} else {
			this._includedTimes!.delete(time);
			let error = await this.requestUpdateBoxContent!(updateSynthBox, this._includedTimes);
			if (error) {
				this._includedTimes!.add(time);
				return false;
			}

			this.removeHighlight(row);
		}
		return true;
	}

	// TODO
	private async focusNextRow(
		cell: HTMLElement,
		backwards: boolean = false,
		trackChanges: boolean = true,
		skipLine: boolean = false,
		updateBoxContent: boolean = true
	): Promise<void> {
		// Extract the info from the cell ID, skip the first, which is the lineno
		const [varname, idxStr]: string[] = cell.id.split('-').slice(1);
		const idx: number = parseInt(idxStr);
		const env = this._boxEnvs![idx];

		if (trackChanges) {
			const success = await this.toggleIfChanged(env, varname, cell, updateBoxContent);
			if (!success) {
				return;
			}
		}

		// Finally, select the next value.

		let varIdx: number;
		let row = this._currRow;

		if (skipLine) {
			varIdx = 0;
			row += backwards ? -1 : +1;
		} else {
			// Check what the next variable is
			varIdx = this.outputVars.indexOf(varname) + (backwards ? -1 : +1);
			if (varIdx < 0) {
				varIdx = this.outputVars.length - 1;
				row -= 1;
			} else if (varIdx >= this.outputVars!.length) {
				varIdx = 0;
				row += 1;
			}
		}

		if (row >= this._rows.length) {
			row = 0;
		} else if (row < 0) {
			row = this._rows.length - 1;
		}

		const nextVar = this.outputVars[varIdx];
		const vcells = this._cells!.get(nextVar)!;
		const tmpCell = vcells[row];
		let nextCell = tmpCell;

		while (nextCell.contentEditable !== 'true') {
			row += (backwards ? -1 : +1);

			if (row >= this._rows.length) {
				row = 0;
			} else if (row < 0) {
				row = this._rows.length - 1;
			}

			nextCell = vcells[row];
			if (nextCell.id === tmpCell.id) {
				row = (row < 0) ? this._boxEnvs.length - 1 : 0;
				nextCell = vcells[row];
				break;
			}
		}

		this.select(nextCell!.childNodes[0]);
		// TODO
		/*
		1. given the current cell, find the next/prev cell of the same var to select using this._cells
		2. if not editable, continue
		3. if reached the end/head and there is no more cells from other variables to select, start over;
		4. otherwise, repeat the steps with other variables
		*/
	}

	public selectFirstEditableCell() : boolean {
		const firstVar = this.outputVars[0];
		try {
			const cellInfo = this._firstEditableCellId!.split('-');
			const cellVar = cellInfo[1];
			const cellId = cellInfo[2];

			if (firstVar !== cellVar) {
				console.error(`No cell found with key "${firstVar}"`);
				return false;
			}

			this._currRow = +cellId;
			let cell = document.getElementById(this._firstEditableCellId!);
			cell!.contentEditable = 'true';
			this.select(cell!);
			return true;

		} catch (err) {
			console.error(`No non-empty cells found for key "${firstVar}".`);
			return false;
		}

		// const firstVar = this.outputVars[0]; // first var
		// let cellIds = this._cells!.get(firstVar);
		// if (cellIds && cellIds.size > 0) {
		// 	for (let cellId of cellIds) {
		// 		let cell = this.getCell(firstVar, cellId)!;
		// 		if ((cell.textContent as string).trim()) {
		// 			cell.contentEditable = 'true';
		// 			this._currRow = cellId;
		// 			this.select(cell);
		// 			return true;
		// 		}
		// 	}
		// 	console.error(`All cells for key "${firstVar}" were empty.`);
		// 	return false;
		// } else {
		// 	console.error(`No cell found with key "${firstVar}"`);
		// 	return false;
		// }
	}

	public addError(error: string, cell?: HTMLElement, timeout?: number, fadeout?: number) {
		this._errorBox.add(cell ?? this._box, error, timeout, fadeout);
	}

}
