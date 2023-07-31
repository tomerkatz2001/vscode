// import {MarkdownRenderer} from "vs/editor/browser/core/markdownRenderer";
// import {MarkdownString} from "vs/base/common/htmlContent";
import {ICodeEditor} from "vs/editor/browser/editorBrowser";
import {IModeService} from "vs/editor/common/services/modeService";
import {IOpenerService} from "vs/platform/opener/common/opener";
import {IThemeService} from "vs/platform/theme/common/themeService";
import {RTVSynthView} from "vs/editor/contrib/rtv/RTVSynthView";
import {isHtmlEscape, removeHtmlEscape, TableElement } from "./RTVUtils";
import {MarkdownRenderer} from "vs/editor/browser/core/markdownRenderer";
import { MarkdownString } from 'vs/base/common/htmlContent';

export class RTVInputBox extends RTVSynthView{

	onEnterPressed?: ()=>void;
	constructor(
		_editor: ICodeEditor,
		originalLineNode: HTMLElement,
		originalBoxNode: HTMLElement,
		modeService: IModeService,
		openerService: IOpenerService,
		lineNumber: number,
		@IThemeService _themeService: IThemeService,
	){
		super(_editor, originalLineNode, originalBoxNode, modeService, openerService, lineNumber, [], _themeService);
	}
	public updateBoxContent(rows: TableElement[][], init: boolean = false) {
		const renderer = new MarkdownRenderer(
			{ 'editor': this._editor },
			this._modeService,
			this._openerService);

		this._firstEditableCellId = undefined;
		let cellElements = new Map<string, HTMLTableCellElement[]>();

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
				let cell: HTMLTableCellElement | undefined;
				const elmt = row[_colIdx];
				const vname = elmt.vname!;
				if (init) {
					cell = newRow!.insertCell(-1);
					if (rowIdx > 0) {
						cell!.id = this.getCellId(elmt.vname!, rowIdx - 1);
					}
					this.addCellContentAndStyle(cell!, elmt, renderer, rowIdx == 0);
				}

				// skip the headers
				if (rowIdx > 0) {
					if (!cell) {
						// not init
						cell = this.getCell(vname, rowIdx - 1)!;
					}
					if (cell! !== null) {
						if (!init) {
							cell = this.updateCell(cell!, elmt, renderer);
						}
						if (!this._firstEditableCellId && elmt.editable) {
							this._firstEditableCellId = this.getCellId(vname, rowIdx - 1);
						}

						// build cellElements
						let vcells = cellElements!.get(vname) ?? [];
						vcells.push(cell!);
						cellElements!.set(vname, vcells);

					}

				}
			}
		}

		// send vcells info back to Model
		this.onCellElementsChanged!(cellElements);
	}

	protected updateCell(cell: HTMLTableCellElement, elmt: TableElement, r: MarkdownRenderer, header: boolean = false): HTMLTableCellElement{

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


		// Add the new content
		cell.appendChild(cellContent);

		if (!header) {
			this.addListeners(cell);
		}

		return cell;
	}

	protected addListeners(cell: HTMLElement) {
		if (cell.id) { // won't work for cells w/o id, i.e., the header cells
			const [varname, idx] = cell.id.split('-').slice(1);

			cell.onclick = (e: MouseEvent) => {
				const selection = window.getSelection()!;
				const range = selection.getRangeAt(0)!;
				this.updateCursorPos!(range, cell);
			}

			cell.onblur = async () => {
				await this.requestToggleIfChanged!(+idx, varname, cell);
			}

			cell.onkeydown = (e: KeyboardEvent) => {
				let rs: boolean = true;

				const selection = window.getSelection()!;
				const range = selection.getRangeAt(0)!;

				this.updateCursorPos!(range, cell);

				switch(e.key) {
					case 'Enter':
						e.preventDefault();

						if (e.shiftKey) {
							this.onEnterPressed!();
						}
						break;

					case 'Escape':
						// stop synth
						rs = false;
						e.preventDefault();
						this.exitSynthHandler!();
						break;

					default:
						// how do we handle the situation where `Tab` is pressed immediately after a regular keystroke?
						// - currently we _don't_ process any synth request under this situation
						if (e.key === 'Tab') {
							e.preventDefault();
							this.focusNextRow(cell, e.shiftKey, false);
						}
					// this._synthTimer.run(1000, async () => {
					// 	const success = await this.requestSynth!(+idx, varname, cell, true, false, false);
					// 	if (success) {
					// 		this.synthesizeFragment(cell);
					// 	}
					// }).catch(err => {
					// 	if (err) {
					// 		console.error(err);
					// 	}
					// });
					// break;
				}
				return rs;
			}; // end of onkeydown
		}

	}

	public selectFirstEditableCell() : boolean {
		try {
			//this._currRow = +cellId; // already handled by this.select
			let cell = document.getElementById(this._firstEditableCellId!);
			cell!.contentEditable = 'true';
			this.select(cell!);
			return true;

		} catch (err) {
			console.error(`can't fid the first editable cell.`);
			return false;
		}
	}
	public bindOnEnterPresses(handler: ()=> void){
		this.onEnterPressed = handler;
	}
}