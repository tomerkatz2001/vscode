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

export class RTVSynthView {

	private _modeService: IModeService;
	private _openerService: IOpenerService;

	// core elements
	private _box: HTMLDivElement;
	private _line: HTMLDivElement;
	private _errorBox: ErrorHoverManager;

	// from service
	private _includedTimes: Set<number> = new Set<number>();
	private _rows: TableElement[][] = [[]];
	private _boxEnvs: any[] = [];

	// helper data structures/info
	private _cells?: Map<string, HTMLTableCellElement[]> = undefined;
	private _currRow: number;
	private _cursorPos?: CursorPos;
	private _synthTimer: DelayedRunAtMostOne = new DelayedRunAtMostOne();
	private _firstEditableCellId?: string = undefined;
	private _table?: HTMLTableElement;
	private _cellStyle?: CSSStyleDeclaration;

	// TODO: change type signature
	exitSynthHandler?: Function;
	requestValidateInput?: Function;
	requestSynth?: Function;
	requestUpdateBoxContent?: Function;


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
			// find the table node
			if (elm.nodeName === 'TABLE') {
				this._table = elm as HTMLTableElement;
				continue;
			}
			// make a copy of existing cell style to be inherited
			if (elm.nodeName === 'TD' && !this._cellStyle) {
				this._cellStyle = (elm as HTMLElement).style;
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

	// ------------
	// property getters and setters
	// ------------
	public show() {
		if (this.isHidden()) {
			this._box.style.opacity = '1';
			this._line.style.opacity = '1';
			let editor_div = this._editor.getDomNode();
			if (editor_div === null) {
				throw new Error('Cannot find Monaco Editor');
			}
			editor_div.appendChild(this._line);
			editor_div.appendChild(this._box);
		}
	}

	public hide() {
		this._box.style.opacity = '0';
		this._line.style.opacity = '0';
	}

	private isHidden() {
		return this._box.style.opacity === '0';
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

	public getCellId(varname: string, idx: number): string {
		return `${this.lineNumber}-${varname}-${idx}-synth`;
	}

	public getRowId(idx: number): string {
		return `${this.lineNumber}-${idx}-synth`;
	}

	public getRow(idx: number): HTMLTableRowElement | null {
		return document.getElementById(this.getRowId(idx)) as HTMLTableRowElement;
	}

	public getTableId(): string {
		return `${this.lineNumber}-table-synth`;
	}

	public getCell(varname: string, idx: number): HTMLTableCellElement | null {
		return document.getElementById(this.getCellId(varname, idx)) as HTMLTableCellElement;
	}

	// ------------
	// front-end updates
	// ------------

	// TODO: merge with updateBoxContent
	// public populateBoxContent(data: {[k: string]: any}) {
	// 	const rows: TableElement[][] = data['rows'];
	// 	const includedTimes: Set<number> = data['includedTimes'] as unknown as Set<number>;
	// 	const boxEnvs: any[] = data['boxEnvs'];

	// 	const renderer = new MarkdownRenderer(
	// 						{ 'editor': this._editor },
	// 						this._modeService,
	// 						this._openerService);
	// 	const outputVars = new Set(this.outputVars);

	// 	this._includedTimes = includedTimes;
	// 	this._boxEnvs = boxEnvs;
	// 	this._firstEditableCellId = undefined;
	// 	this._rows = rows;
	// 	this._cells = new Map<string, HTMLTableCellElement[]>();



	// 	// remove existing cells
	// 	this._table!.childNodes.forEach((child) => {
	// 		this._table!.removeChild(child)
	// 	});

	// 	this.show();


	// 	// update cell contents and add event listeners
	// 	for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
	// 		let newRow = this._table!.insertRow(-1);
	// 		const row = rows[rowIdx];
	// 		for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
	// 			let newCell = newRow.insertCell(-1);
	// 			const elmt = row[_colIdx];
	// 			const vname = elmt.vname!;

	// 			// skip the headers
	// 			if (rowIdx == 0) {
	// 				this.addCellContentAndStyle(newCell, elmt, renderer, true);
	// 			} else {
	// 				newCell.id = this.getCellId(elmt.vname!, rowIdx - 1);
	// 				this.addCellContentAndStyle(newCell, elmt, renderer, false);
	// 				if (!this._firstEditableCellId && vname === this.outputVars[0] && elmt.editable && elmt.content.trim() !== '') {
	// 					this._firstEditableCellId = this.getCellId(vname, rowIdx - 1);
	// 				}

	// 				// build this._cells
	// 				if (outputVars.has(vname)) {
	// 					let vcells = this._cells!.get(vname) ?? [];
	// 					vcells.push(newCell);
	// 					this._cells!.set(vname, vcells);
	// 				}

	// 				// finally, re-highlight rows and remove highlight of rows that are no longer valid
	// 				const env = this._boxEnvs![rowIdx - 1];
	// 				if (env) {
	// 					if (this._includedTimes.has(env['time'])) {
	// 						if (elmt.editable == false) {
	// 							this._includedTimes.delete(env['time']);
	// 							this.removeHighlight(this.findParentRow(newCell));
	// 						}
	// 						else if (elmt.editable) {
	// 							this.highlightRow(this.findParentRow(newCell));
	// 						}
	// 					}
	// 				}
	// 			}

	// 		}
	// 	}
	// }

	private addCellContentAndStyle(cell: HTMLTableCellElement, elmt: TableElement, r: MarkdownRenderer, header: boolean = false) {
		cell.style.borderLeft = this._cellStyle!.borderLeft;
		cell.style.paddingLeft = this._cellStyle!.paddingLeft;
		cell.style.paddingRight = this._cellStyle!.paddingRight;
		cell.style.paddingTop = this._cellStyle!.paddingTop;
		cell.style.paddingBottom = this._cellStyle!.paddingBottom;
		cell.style.boxSizing = this._cellStyle!.boxSizing;
		cell.align = 'center';

		this.updateCell(cell, elmt, r, header);

	}

	public updateBoxContent(data: {[k: string]: [v: any]}, init: boolean = false) {
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

		if (init) {
			// remove existing cells
			this._table!.childNodes.forEach((child) => {
				this._table!.removeChild(child)
			});
			this._table!.id = this.getTableId();

			this.show();
		}

		// update cell contents and add event listeners
		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
			let newRow: HTMLTableRowElement;
			if (init) {
				newRow = this._table!.insertRow(-1);
				if (rowIdx > 0) { // skip the headers
					newRow.id = this.getRowId(rowIdx - 1);
				}
			}
			const row = rows[rowIdx];
			for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
				let cell: HTMLTableCellElement;
				if (init) {
					cell = newRow!.insertCell(-1);
				}
				const elmt = row[_colIdx];
				const vname = elmt.vname!;

				// skip the headers
				if (rowIdx == 0) {
					if (init) {
						this.addCellContentAndStyle(cell!, elmt, renderer, true);
					}
				} else {
					if (init) {
						cell!.id = this.getCellId(elmt.vname!, rowIdx - 1);
						this.addCellContentAndStyle(cell!, elmt, renderer, false);
					} else {
						cell = this.getCell(vname, rowIdx - 1)!;
					}
					if (cell! !== null) {
						if (!init) {
							cell = this.updateCell(cell!, elmt, renderer);
						}
						if (!this._firstEditableCellId && vname === this.outputVars[0] && elmt.editable && elmt.content.trim() !== '') {
							this._firstEditableCellId = this.getCellId(vname, rowIdx - 1);
						}

						// build this._cells
						if (outputVars.has(vname)) {
							let vcells = this._cells!.get(vname) ?? [];
							vcells.push(cell!);
							this._cells!.set(vname, vcells);
						}

						// finally, re-highlight rows and remove highlight of rows that are no longer valid
						const env = this._boxEnvs![rowIdx - 1];
						if (env) {
							if (this._includedTimes.has(env['time'])) {
								if (elmt.editable == false) {
									this._includedTimes.delete(env['time']);
									this.removeHighlight(this.getRow(rowIdx - 1)!);
								}
								else if (elmt.editable) {
									this.highlightRow(this.getRow(rowIdx - 1)!);
								}
							}
						}
					}

				}


				// // Get the cell
				// let cell = this.getCell(vname, rowIdx - 1)!;
				// if (cell !== null) {
				// 	cell = this.updateCell(cell, elmt, renderer);
				// 	if (!this._firstEditableCellId && vname === this.outputVars[0] && elmt.editable && elmt.content.trim() !== '') {
				// 		this._firstEditableCellId = this.getCellId(vname, rowIdx - 1);
				// 	}

				// 	// build this._cells
				// 	if (outputVars.has(vname)) {
				// 		let vcells = this._cells!.get(vname) ?? [];
				// 		vcells.push(cell);
				// 		this._cells!.set(vname, vcells);
				// 	}

				// 	// finally, re-highlight rows and remove highlight of rows that are no longer valid
				// 	const env = this._boxEnvs![rowIdx - 1];
				// 	if (env) {
				// 		if (this._includedTimes.has(env['time'])) {
				// 			if (elmt.editable == false) {
				// 				this._includedTimes.delete(env['time']);
				// 				this.removeHighlight(this.findParentRow(cell));
				// 			}
				// 			else if (elmt.editable) {
				// 				this.highlightRow(this.findParentRow(cell));
				// 			}
				// 		}
				// 	}
				// }

			}
		}
	}

	private updateCell(cell: HTMLTableCellElement, elmt: TableElement, r: MarkdownRenderer, header: boolean = false): HTMLTableCellElement{

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
		cell.childNodes?.forEach((child) => cell.removeChild(child));

		if (elmt.editable) {
			// make the TableCellElement `td` editable if applicable
			cell.contentEditable = 'true';
		}

		const outputVars = new Set(this.outputVars);

		// Add the new content
		cell.appendChild(cellContent);

		if (!header && outputVars.has(elmt.vname!)) {
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

	// TODO: add IDs to rows, tables, etc. (HTML element)
	private findParentRow(cell: HTMLElement): HTMLTableRowElement {
		let rs = cell;
		while (rs.nodeName !== 'TR') {
			rs = rs.parentElement!;
		}
		return rs as HTMLTableRowElement;
	}

	private highlightRow(row: HTMLTableRowElement) {
		let theme = this._themeService.getColorTheme();
		row.style.fontWeight = '900';
		row.style.backgroundColor = String(theme.getColor(badgeBackground) ?? '');
	}

	private removeHighlight(row: HTMLTableRowElement) {
		row.style.fontWeight = row.style.backgroundColor = '';
	}

	// TODO: store cursor info to model
	private updateCursorPos(range: Range, node: HTMLElement) {
		if (!this._cursorPos) {
			this._cursorPos = new CursorPos(node);
		}
		this._cursorPos.node = node;
		this._cursorPos.startPos = range.startOffset ?? undefined;
		this._cursorPos.endPos = range.endOffset ?? undefined;
		this._cursorPos.collapsed = range.collapsed ?? undefined;
		const row = node.id!.split('-')[2];
		this._currRow = +row;
	}

	private addListeners(cell: HTMLElement) {
		const [varname, idx] = cell.id.split('-').slice(1);
		const env = this._boxEnvs![+idx];

		cell.onclick = (e: MouseEvent) => {
			const selection = window.getSelection()!;
			const range = selection.getRangeAt(0)!;
			this.updateCursorPos(range, cell);
		}

		cell.onblur = () => {
			this.toggleIfChanged(env, varname, cell);
		}

		cell.onkeydown = (e: KeyboardEvent) => {
			let rs: boolean = true;

			const selection = window.getSelection()!;
			const range = selection.getRangeAt(0)!;

			this.updateCursorPos(range, cell);


			switch(e.key) {
				case 'Enter':
					e.preventDefault();

					if (e.shiftKey) {
						this._synthTimer.run(1, async () => {
							const validInput = await this.toggleElement(env, cell, varname, undefined, false);
							if (validInput) {
								this.highlightRow(this.findParentRow(cell));
								await this.synthesizeFragment(cell);
							}
						})
					} else {
						// without Shift: accept and exit
						this.exitSynthHandler!(true);
					}
					break;

				case 'Escape':
					// stop synth
					rs = false;
					e.preventDefault();
					this.exitSynthHandler!();
					break;

				default:
					// TODO: how do we handle the situation where `Tab` is pressed immediately after a regular keystroke?
					// - currently we _don't_ process any synth request under this situation
					if (e.key === 'Tab') {
						e.preventDefault();
						this.focusNextRow(cell, e.shiftKey);
					}
					this._synthTimer.run(1000, async () => {
						if (env[varname] !== cell.innerText) {
							const validInput = await this.toggleElement(env, cell, varname, true, false);

							if (validInput) {
								await this.synthesizeFragment(cell);
							}

						}
					}).catch(err => {
						if (err) {
							console.error(err);
						}
					});
					break;
			}
			return rs;
		}; // end of onkeydown

	}

	// TODO: let the model figure out the next cursor pos
	private async synthesizeFragment(cell: HTMLElement) {
		const success = await this.requestSynth!();
		if (success) {
			const sel = window.getSelection()!;
			let offset = sel.anchorOffset;
			const range = document.createRange();

			let isString = cell.innerText[0] === '\'' || cell.innerText[0] === '"';

			let dest: HTMLElement = cell;
			while (dest.firstChild && (!dest.classList.contains('monaco-tokenized-source') || dest.childNodes.length == 1)) {
				dest = dest.firstChild as HTMLElement;
			}

			if (dest.childNodes.length > 1) {
				let isNegNum = dest.firstChild!.textContent == '-';
				offset = isNegNum ? cell.innerText.length : dest.childNodes.length - 1;
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
				} catch (e) {
					// TODO Better error handling
					console.error(e);
					range.selectNodeContents(dest);
					range.setStart(dest, 0);
					range.collapse(true);

					sel.removeAllRanges();
					sel.addRange(range);
				}
			}
			else {
				// console.error(`cursorPos: ${this._cursorPos!.node.id}; currCell: ${cell.id}`);
				this.select(this._cursorPos!.node);
			}
		}
	}

	// TODO: move to controller
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

	// TODO: move to controller
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
			let error = await this.requestValidateInput!(cell.textContent!);
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

	/**
	 * moves the cursor to the next editable cell
	 * @param cell
	 * @param backwards
	 * @param trackChanges
	 * @param skipLine
	 * @param updateBoxContent
	 */
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

		// this._rows include the header, so we need to ignore/skip it
		if (row >= this._rows.length - 1) {
			row = 0;
		} else if (row < 0) {
			row = this._rows.length - 2;
		}

		const nextVar = this.outputVars[varIdx];
		const vcells = this._cells!.get(nextVar)!;
		const tmpCell = vcells[row];
		let nextCell = tmpCell;

		while (nextCell.contentEditable !== 'true') {
			row += (backwards ? -1 : +1);

			if (row >= this._rows.length - 1) {
				row = 0;
			} else if (row < 0) {
				row = this._rows.length - 2;
			}

			nextCell = vcells[row];
			if (nextCell.id === tmpCell.id) {
				row = (row < 0) ? this._boxEnvs.length - 1 : 0;
				nextCell = vcells[row];
				break;
			}
		}

		this.select(nextCell!);
	}

	/**
	 * attempts to move the cursor to the first editable cell inside the table
	 * @returns ... is successful
	 */
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
	}

	/**
	 * asks errorBox to display the error msg to be attached to the synth box
	 * or a cell if specified
	 * @param error
	 * @param cell
	 * @param timeout
	 * @param fadeout
	 */
	public addError(error: string, cell?: HTMLElement, timeout?: number, fadeout?: number) {
		this._errorBox.add(cell ?? this._box, error, timeout, fadeout);
	}

}
