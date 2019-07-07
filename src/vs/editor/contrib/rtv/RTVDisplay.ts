

import * as cp from 'child_process';
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
//import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IModelContentChangedEvent } from 'vs/editor/common/model/textModelEvents';
import { IEditorContribution, IScrollEvent } from 'vs/editor/common/editorCommon';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { EditorLayoutInfo } from 'vs/editor/common/config/editorOptions';
import * as strings from 'vs/base/common/strings';
import { IRange, Range } from 'vs/editor/common/core/range';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { MarkdownRenderer } from 'vs/editor/contrib/markdown/markdownRenderer';
import { Position } from 'vs/editor/common/core/position';
import { IMarkdownString, MarkdownString, isEmptyMarkdownString, markedStringsEquals } from 'vs/base/common/htmlContent';
import { assertMapping } from 'vs/workbench/services/keybinding/test/keyboardMapperTestUtils';
import { IConfigurationService,  IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { localize } from 'vs/nls';



// setInterval(() => {
// 	let editor_div = document.getElementsByClassName("monaco-editor")[0];
// 	if (editor_div === undefined)
// 		return;
// 	if (global_editor === undefined)
// 		return;
// 	//console.log(editor_div);
// 	if (box === undefined) {
// 		global_editor.onDidChangeCursorPosition(onChangeCursorPosition);
// 		global_editor.onDidChangeModelContent(onChangeModelContent);
// 		//global_editor.onDidScrollChange((e) => {console.log(e)});
// 		box = document.createElement('div');
// 		box.textContent = "AAA";
// 		box.style.position = "absolute";
// 		box.style.top = "100px";
// 		box.style.left = "100px";
// 		box.style.maxWidth = "1366px";
// 		box.style.transitionProperty = "all";
// 		box.style.transitionDuration = "0.3s";
// 		box.style.transitionDelay = "0s";
// 		box.style.transitionTimingFunction = "ease-in";
// 		//box.style.transform = "scale(2.5)";
// 		//box.style.zoom = "1";
// 		box.className = "monaco-editor-hover";
// 		editor_div.appendChild(box);
// 	} else {
// 		return;
// 		// let currpos = global_editor.getPosition();
// 		// if (currpos === null)
// 		// 	return;
// 		// let pixelP = global_editor.getScrolledVisiblePosition(currpos);
// 		// if (pixelP === null)
// 		// 	return;
// 		// // console.log(pixelP);
// 		// counter = counter + 1;
// 		// let zoom = 1.2 + (Math.sin(counter/50)*0.2);
// 		// box.style.top = (pixelP.top / zoom).toString() + "px";
// 		// box.style.left = ((pixelP.left+ 100) / zoom ).toString() + "px";
// 		// //console.log(zoom);
// 		// box.style.zoom = zoom.toString();
// 	}
// },20);

class RTVLine {
	private _div: HTMLDivElement;
	constructor(
		editor: ICodeEditor,
		x1: number,
		y1: number,
		x2: number,
		y2: number
	) {
		let editor_div = editor.getDomNode();
		if (editor_div === null) {
			throw new Error('Cannot find Monaco Editor');
		}

		this._div = document.createElement('div');
		this._div.style.position = "absolute";
		this._div.style.borderTop = "1px solid grey";
		this._div.style.transitionProperty = "all";
		this._div.style.transitionDuration = "0.3s";
		this._div.style.transitionDelay = "0s";
		this._div.style.transitionTimingFunction = "ease-in";
		this._div.style.transformOrigin = "0% 0%";
		this.move(x1,y1,x2,y2);
		editor_div.appendChild(this._div);
	}

	public destroy() {
		this._div.remove();
	}

	public move(x1: number, y1: number, x2: number, y2: number) {
		this._div.style.left = x1.toString() + "px";
		this._div.style.top = y1.toString() + "px";
		let deltaX = (x2 - x1);
		let deltaY = (y2 - y1);
		let length = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
		this._div.style.width = length.toString() + "px";
		let angle = 0;
		if (length !== 0) {
			angle = Math.atan(deltaY / deltaX) * 180 / Math.PI;
		}
		this._div.style.transform = "rotate(" + angle.toString() + "deg)";
	}

	public setOpacity(opacity: number) {
		this._div.style.opacity = opacity.toString();
	}

	public hide(){
		this._div.style.display = "none";
	}

	public show(){
		this._div.style.display = "block";
	}

}

class TableElement {
	constructor(public content: string, public loop: string = "") {}
}

type MapLoopsToCells = { [k:string]: HTMLTableDataCellElement[]; };

class RTVDisplayBox {
	private _box: HTMLDivElement;
	private _line: RTVLine;
	private _zoom: number = 1;
	private _opacity: number = 1;
	private _hiddenByUser: boolean = false;
	private _hasContent: boolean = false;
	constructor(
		private readonly _coordinator:RTVCoordinator,
		private readonly _editor: ICodeEditor,
		private readonly _modeService: IModeService,
		private readonly _openerService: IOpenerService | null,
		private _lineNumber: number
	) {
		let editor_div = this._editor.getDomNode();
		if (editor_div === null) {
			throw new Error('Cannot find Monaco Editor');
		}
		this._box = document.createElement('div');
		this._box.textContent = "";
		this._box.style.position = "absolute";
		this._box.style.top = "100px";
		this._box.style.left = "100px";
		this._box.style.maxWidth = "1366px";
		this._box.style.transitionProperty = "all";
		this._box.style.transitionDuration = "0.3s";
		this._box.style.transitionDelay = "0s";
		this._box.style.transitionTimingFunction = "ease-in";
		this._box.className = "monaco-editor-hover";
		this._box.onclick = (e) => {
			this.onClick(e);
		};
		editor_div.appendChild(this._box);
		this._line = new RTVLine(this._editor, 0, 0, 0, 0);
		this.hide();
	}

	get visible() {
		return !this._hiddenByUser && this._hasContent;
	}

	get hiddenByUser() {
		return this._hiddenByUser;
	}

	set hiddenByUser(h:boolean) {
		this._hiddenByUser = h;
	}

	get lineNumber() {
		return this._lineNumber;
	}

	set lineNumber(l:number) {
		this._lineNumber = l;
	}

	public destroy() {
		this._box.remove();
		this._line.destroy();
	}

	public hide() {
		this._hasContent = false;
		this._box.textContent = "";
		this._box.style.display = "none";
		this._line.hide();
	}

	public show() {
		this._hasContent = true;
		this._box.style.display = "block";
		this._line.show();
	}

	private onClick(e: MouseEvent) {
		e.stopImmediatePropagation();
		e.preventDefault();
		this._coordinator.flipVisMode(this._lineNumber);
	}

	private isControlLine(): boolean {
		let lineContent = this._coordinator.getLineContent(this._lineNumber).trim();
		return strings.endsWith(lineContent, ":") &&
			   (strings.startsWith(lineContent, "if") ||
			    strings.startsWith(lineContent, "for") ||
				strings.startsWith(lineContent, "else") ||
				strings.startsWith(lineContent, "while"));
	}

	private bringToLoopCount(envs:any[], active_loops:number[], iterCount:number) {
		while (active_loops[active_loops.length-1] < iterCount ) {
			envs.push({ "#" : active_loops.join(",") });
			active_loops[active_loops.length-1]++;
		}
	}

	private addMissingLines(envs: any[]): any[] {
		let active_loops: number[] = [];
		let envs2: any[] = [];
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			if (env.begin_loop !== undefined) {
				if (active_loops.length > 0) {
					let loop = env.begin_loop.split(",");
					this.bringToLoopCount(envs2, active_loops, +loop[loop.length-2]);
				}
				active_loops.push(0);
			} else if (env.end_loop !== undefined) {
				let loop = env.end_loop.split(",");
				this.bringToLoopCount(envs2, active_loops, +loop[loop.length-1]);
				active_loops.pop();
				active_loops[active_loops.length-1]++;
			} else {
				let loop = env["#"].split(",");
				this.bringToLoopCount(envs2, active_loops, +loop[loop.length-1]);
				envs2.push(env);
				active_loops[active_loops.length-1]++;
			}
		}
		return envs2;
	}

	private isHtmlEscape(s:string):boolean {
		return strings.startsWith(s, "```html\n") && strings.endsWith(s, "```")
	}

	private addCellContentAndStyle(cell: HTMLTableCellElement, s:string, r:MarkdownRenderer) {
		if (this._coordinator.colBorder) {
			cell.style.borderLeft = "1px solid #454545";
		}
		let padding = this._coordinator.cellPadding + "px";
		cell.style.paddingLeft = padding;
		cell.style.paddingRight = padding;
		cell.style.paddingTop = "0";
		cell.style.paddingBottom = "0";
		cell.align = 'left';

		let cellContent: HTMLElement;
		if (this.isHtmlEscape(s)) {
			cellContent = document.createElement('div');
			cellContent.innerHTML = s;
		} else {
			let renderedText = r.render(new MarkdownString(s));
			cellContent = renderedText.element;
		}
		cell.appendChild(cellContent);
	}

	private populateTableByCols(table: HTMLTableElement, renderer: MarkdownRenderer, rows: TableElement[][]) {
		rows.forEach((row:TableElement[]) => {
			let newRow = table.insertRow(-1);
			row.forEach((item: TableElement) => {
				let newCell = newRow.insertCell(-1);
				this.addCellContentAndStyle(newCell, item.content, renderer);
			});
		});
	}

	private populateTableByRows(table: HTMLTableElement, renderer: MarkdownRenderer, rows: TableElement[][]) {
		let tableCellsByLoop = this._coordinator.tableCellsByLoop;
		for (let colIdx = 0; colIdx < rows[0].length; colIdx++) {
			let newRow = table.insertRow(-1);
			for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
				let elmt = rows[rowIdx][colIdx];
				let newCell = newRow.insertCell(-1);
				this.addCellContentAndStyle(newCell, elmt.content, renderer);
				if (elmt.loop !== "") {
					if (tableCellsByLoop[elmt.loop] === undefined) {
						tableCellsByLoop[elmt.loop] = [];
					}
					tableCellsByLoop[elmt.loop].push(newCell);
				}
			}
		}
	}

	// private createTableByRows2(rows: TableElement[][]) {
	// 	this._box.textContent = "";
	// 	let tableCellsByLoop = this._coordinator.tableCellsByLoop;
	// 	const renderer = new MarkdownRenderer(this._editor, this._modeService, this._openerService);
	// 	let table = document.createElement('div');
	// 	table.style.display = "table";
	// 	for (let colIdx = 0; colIdx < rows[0].length; colIdx++) {
	// 		let newRow = document.createElement('div');
	// 		newRow.style.display = "table-row";
	// 		table.appendChild(newRow);
	// 		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
	// 			let elmt = rows[rowIdx][colIdx];
	// 			let newCell = this.computeCellContent(elmt.content, renderer)
	// 			newCell.style.display = "table-cell";
	// 			newCell.style.width = "120px";
	// 			newRow.appendChild(newCell);
	// 		}
	// 	}
	// 	this._box.appendChild(table);
	// }

	public updateContent() {

		if (this._hiddenByUser) {
			this.hide();
			console.log("Hidden by user");
			return
		}

		if (this.isControlLine()) {
			this.hide();
			console.log("Control line");
			return;
		}

		// Get all envs at this line number
		let envsAtLine = this._coordinator.envs[this._lineNumber-1];
		if (envsAtLine === undefined) {
			this.hide();
			console.log("Did not find entry");
			return;
		}

		this.show();

		// collect all next step envs
		let envs: any[] = [];
		envsAtLine.forEach((env) => {
			if (env.begin_loop !== undefined) {
				envs.push(env);
			} else if (env.end_loop !== undefined) {
				envs.push(env);
			} else if (env.next_lineno !== undefined) {
				let nextEnvs = this._coordinator.envs[env.next_lineno];
				if (nextEnvs !== undefined) {
					nextEnvs.forEach((nextEnv) => {
						if (nextEnv.time === env.time + 1) {
							envs.push(nextEnv);
						}
					});
				}
			}
		});

		envs = this.addMissingLines(envs);

		// Compute set of keys in all envs
		let keys_set = new Set<string>();
		console.log(this._coordinator.writes);
		console.log(this._lineNumber);
		let writesAtLine = this._coordinator.writes[this._lineNumber-1];
		envs.forEach((env) => {
			for (let key in env) {
				if (key !== "prev_lineno" && key !== "next_lineno" && key !== "lineno" && key !== "time") {
					if (!this._coordinator.displayOnlyModifiedVars || key === "rv" ||
					    (writesAtLine !== undefined && writesAtLine.some(x => x === key))) {
						keys_set.add(key);
					}
				}
			}
		});

		// Generate header
		let rows: TableElement [][] = [];
		let header:TableElement[] = [];
		keys_set.forEach((v:string) => {
			header.push(new TableElement("**" + v + "**", "header"));
		});
		rows.push(header);

		// Generate all rows
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			let loop = env["#"];
			let row:TableElement [] = [];
			keys_set.forEach((v:string) => {
				var v_str:string;
				if (env[v] === undefined) {
					v_str = "";
				} else if (this.isHtmlEscape(env[v])) {
					v_str = env[v];
				} else {
					v_str = "```python\n" + env[v] + "```";
				}
				// if (env[v] !== undefined && i > 0 && env[v] === envs[i-1][v]) {
				// 	v_str = "&darr;";
				// }
				row.push(new TableElement(v_str, loop));
			});
			rows.push(row);
		};

		// Set border
		if (this._coordinator.boxBorder) {
			this._box.style.border = "";
		} else {
			this._box.style.border = "0";
		}

		// Create html table from rows
		this._box.textContent = "";
		const renderer = new MarkdownRenderer(this._editor, this._modeService, this._openerService);
		let table = document.createElement('table');
		table.style.borderSpacing = "0px";
		table.style.paddingLeft = "13px";
		table.style.paddingRight = "13px";
		if (this._coordinator.byRowOrCol === RowColMode.ByRow) {
			this.populateTableByRows(table, renderer, rows);
		} else {
			this.populateTableByCols(table, renderer, rows);
		}
		this._box.appendChild(table);

		// Add green/red dot to show out of date status
		let stalenessIndicator = document.createElement('div');
		stalenessIndicator.style.width = '5px';
		stalenessIndicator.style.height = '5px';
		stalenessIndicator.style.position = 'absolute';
		stalenessIndicator.style.top = '5px';
		stalenessIndicator.style.left = '3px';
		stalenessIndicator.style.borderRadius = '50%';
		let x = this._coordinator._changedLinesWhenOutOfDate;
		if (x === null) {
			stalenessIndicator.style.backgroundColor = 'green';
		} else {
			let green = 165 - (x.size-1) * 35;
			if (green < 0) {
				green = 0;
			}
			stalenessIndicator.style.backgroundColor = 'rgb(255,' + green.toString() + ',0)';
		}

		this._box.appendChild(stalenessIndicator);

		this.addConfigButton();

	}

	public addConfigButton() {
		let configButton = document.createElement('div');
		let lines: HTMLElement[] = [];

		for(let i = 0; i < 3; i++){
			let hamburgerIconLine = document.createElement('div');
			hamburgerIconLine.style.width = '90%';
			hamburgerIconLine.style.height = '10%';
			hamburgerIconLine.style.margin =  '20% 0%';
			hamburgerIconLine.style.backgroundColor = 'black';
			configButton.appendChild(hamburgerIconLine);
			lines.push(hamburgerIconLine);
		}
		lines[0].style.transition = 'transform 0.2s';
		lines[2].style.transition = 'transform 0.2s';

		configButton.style.width = '10px';
		configButton.style.height = '10px';
		configButton.style.position = 'absolute';
		configButton.style.top = '5px';
		configButton.style.right = '2px';
		if(configButton){
			configButton.onclick = (e) =>{
				e.stopPropagation();
				if(this._coordinator._configBox){
					console.log(this._coordinator._configBox.style.display);
					this._coordinator.showOrHideConfigDialogBox();
				}
				else{
					this._coordinator.addConfigDialogBox();
				}
				if(lines[1].style.opacity !== '0'){
					lines[0].style.transform = 'translate(0%, 3px) rotate(-45deg)';
					lines[2].style.transform = 'translate(0%, -3px) rotate(45deg)';
					lines[1].style.opacity = '0';
					console.log(lines[2]);
				}else{
					lines[0].style.transform = 'translate(0%, 0px) rotate(0deg)';
					lines[1].style.opacity = '1';
					lines[2].style.transform = 'translate(0%, 0px) rotate(0deg)';
				}

			};
		}
		this._box.appendChild(configButton);
	}


	public getHeight() {
		return this._box.offsetHeight*this._zoom;
	}

	public updateLayout(top: number) {
		let pixelPosAtLine = this._coordinator.getLinePixelPos(this._lineNumber);

		let boxTop = top;
		if (this._coordinator.boxAlignsToTopOfLine) {
			boxTop = boxTop - (pixelPosAtLine.height/2);
		}
		let left = this._coordinator.maxPixelCol+130;
		let zoom_adjusted_left =  left - ((1-this._zoom) * (this._box.offsetWidth / 2));
		let zoom_adjusted_top = boxTop - ((1-this._zoom) * (this._box.offsetHeight / 2));
		this._box.style.top = zoom_adjusted_top.toString() + "px";
		this._box.style.left = zoom_adjusted_left.toString() + "px";
		this._box.style.transform = "scale(" + this._zoom.toString() +")";
		this._box.style.opacity = this._opacity.toString();

		// update the line
		let midPointTop = pixelPosAtLine.top + (pixelPosAtLine.height / 2);

		this._line.move(this._coordinator.maxPixelCol+30, midPointTop, left, top);

	}

	public updateZoomAndOpacity(dist: number) {
		let distAbs = Math.abs(dist);
		let zoom_upper = 1;
		let zoom_lower = 1 / (distAbs*0.5 + 1);
		this._zoom = zoom_lower + (zoom_upper-zoom_lower) * this._coordinator.zoomLevel;

		this._opacity = 1;
		if (distAbs !== 0) {
			let opacity_upper = 1;
			let opacity_lower = 1/distAbs;
			this._opacity = opacity_lower + (opacity_upper-opacity_lower) * this._coordinator.opacityLevel;
		}
		this._line.setOpacity(this._opacity);
	}

	public fade() {
		let oldOpacity = this._box.style.opacity === "" ? '1' : this._box.style.opacity;
		if (oldOpacity) {
			let newOpacity = parseFloat(oldOpacity) * 0.9;
			this._box.style.opacity = newOpacity.toString();
			this._line.setOpacity(newOpacity);
			this._opacity = newOpacity;
		}
	}

}

enum VisibilityMode {
	AllBoxes,
	SingleBox
}

enum RowColMode {
	ByRow,
	ByCol
}

export class RTVCoordinator implements IEditorContribution {
	public envs: { [k:string]: any []; } = {};
	public writes: { [k:string]: string[]; } = {};
	private _boxes: RTVDisplayBox[] = [];
	private _maxPixelCol = 0;
	private _prevModel: string[] = [];
	private _visMode: VisibilityMode = VisibilityMode.AllBoxes;
	public _changedLinesWhenOutOfDate: Set<number> | null = new Set();
	private _row: boolean = false;
	public _configBox: HTMLDivElement | null = null;
	public tableCellsByLoop: MapLoopsToCells;

	constructor(
		private readonly _editor: ICodeEditor,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IModeService private readonly _modeService: IModeService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		this._editor.onDidChangeCursorPosition((e) => {	this.onChangeCursorPosition(e);	});
		this._editor.onDidScrollChange((e) => { this.onScrollChange(e); });
		this._editor.onDidLayoutChange((e) => { this.onLayoutChange(e); });
		this._editor.onDidChangeModelContent((e) => { this.onChangeModelContent(e); });
		for (let i = 0; i < this.getLineCount(); i++) {
			this._boxes.push(new RTVDisplayBox(this, _editor, _modeService, _openerService, i+1));
		}
		// for (let i = 0; i < this.getLineCount(); i++) {
		// 	this._boxes[i].hiddenByUser = true;
		// }
		// this._boxes[10].hiddenByUser = false;
		// this._boxes[5].hiddenByUser = false;
		this.updateMaxPixelCol();
		this.updatePrevModel();
		this.configurationService.onDidChangeConfiguration((e) => { this.onChangeConfiguration(e); });
	}

	public getId(): string {
		return 'editor.contrib.rtv';
	}

	public dispose():void {
	}
	public saveViewState(): any {
		this._boxes = [];
		console.log("saveViewState");
	}
	public restoreViewState(state: any): void {
		this.updateContentAndLayout();
		console.log("restoreViewState");
	}

	// Configurable properties
	get boxAlignsToTopOfLine(): boolean {
		return this.configurationService.getValue(boxAlignsToTopOfLineKey);
	}
	set boxAlignsToTopOfLine(v: boolean) {
		this.configurationService.updateValue(boxAlignsToTopOfLineKey, v);
	}

	get boxBorder(): boolean {
		return this.configurationService.getValue(boxBorderKey);
	}
	set boxBorder(v: boolean) {
		this.configurationService.updateValue(boxBorderKey, v);
	}

	get byRowOrCol(): RowColMode {
		return this.configurationService.getValue(byRowOrColKey) === 'byRow' ? RowColMode.ByRow : RowColMode.ByCol;
	}
	set byRowOrCol(v: RowColMode) {
		this.configurationService.updateValue(byRowOrColKey, v ===  RowColMode.ByRow ? 'byRow' : 'byCol');
	}

	get cellPadding(): number {
		return this.configurationService.getValue(cellPaddingKey);
	}
	set cellPadding(v: number) {
		this.configurationService.updateValue(cellPaddingKey, v);
	}

	get colBorder(): boolean {
		return this.configurationService.getValue(colBorderKey);
	}
	set colBorder(v: boolean) {
		this.configurationService.updateValue(colBorderKey, v);
	}

	get displayOnlyModifiedVars(): boolean {
		return this.configurationService.getValue(displayOnlyModifiedVarsKey);
	}
	set displayOnlyModifiedVars(v: boolean) {
		this.configurationService.updateValue(displayOnlyModifiedVarsKey, v);
	}

	get opacityLevel(): number {
		return this.configurationService.getValue(opacityKey);
	}
	set opacityLevel(v: number) {
		this.configurationService.updateValue(opacityKey, v);
	}

	get spaceBetweenBoxes(): number {
		return this.configurationService.getValue(spaceBetweenBoxesKey);
	}
	set spaceBetweenBoxes(v: number) {
		this.configurationService.updateValue(spaceBetweenBoxesKey, v);
	}

	get zoomLevel(): number {
		return this.configurationService.getValue(zoomKey);
	}
	set zoomLevel(v: number) {
		this.configurationService.updateValue(zoomKey, v);
	}
	// End of configurable properties

	get maxPixelCol() {
		return this._maxPixelCol;
	}

	private onChangeConfiguration(e: IConfigurationChangeEvent) {
		if (e.affectedKeys.indexOf(presetsKey) != -1) {
			let v:string = this.configurationService.getValue(presetsKey);
			console.log(v);
			if (v === 'full') {
				this.boxAlignsToTopOfLine = false;
				this.boxBorder = true;
				this.byRowOrCol = RowColMode.ByCol;
				this.cellPadding = 6;
				this.colBorder = false;
				this.displayOnlyModifiedVars = false;
				this.opacityLevel = 0;
				this.spaceBetweenBoxes = 20;
				this.zoomLevel = 0;
			} else if (v === 'compact') {
				this.boxAlignsToTopOfLine = true;
				this.boxBorder = false;
				this.byRowOrCol = RowColMode.ByRow;
				this.cellPadding = 6;
				this.colBorder = true;
				this.displayOnlyModifiedVars = true;
				this.opacityLevel = 1;
				this.spaceBetweenBoxes = -4;
				this.zoomLevel = 1;
			}
		}
	}

	private getLineCount(): number {
		let model = this._editor.getModel();
		if (model === null) {
			return 0;
		}
		return model.getLineCount();
	}

	public getLineContent(lineNumber: number): string {
		let model = this._editor.getModel();
		if (model === null) {
			return "";
		}
		return model.getLineContent(lineNumber);
	}

	private updateMaxPixelCol() {
		let model = this._editor.getModel();
		if (model === null) {
			return;
		}
		let max = 0;
		let lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			let col = model.getLineMaxColumn(line);
			let pixelPos = this._editor.getScrolledVisiblePosition(new Position(line,col));
			if (pixelPos !== null && pixelPos.left > max) {
				max = pixelPos.left;
			}
		}
		this._maxPixelCol = max;
	}

	public showOrHideConfigDialogBox(){
		if(!this._configBox){
			return;
		}
		this._configBox.style.display = this._configBox.style.display === 'block' ? 'none' : 'block';
	}

	public addConfigDialogBox(){
		let editor_div = this._editor.getDomNode();
		if(!editor_div){
			return;
		}
		let div = document.createElement('div');
		div.textContent = "";
		div.style.position = "absolute";
		div.style.top = "200px";
		div.style.left = "800px";
		div.style.width = '100px';
		div.style.textAlign = 'left';
		div.style.transitionProperty = "all";
		div.style.transitionDuration = "0.3s";
		div.style.transitionDelay = "0s";
		div.style.transitionTimingFunction = "ease-in";
		div.style.boxShadow = "0px 2px 8px black";
		div.className = "monaco-editor-hover";
		div.style.display = 'block';

		/*Creates the row selector
		let row = document.createElement('div');
		let currColor = '#9effb1';
		row.textContent = 'Row';
		row.style.backgroundColor = this._row ? currColor : 'transparent';
		row.onclick = (e) => {
			e.stopImmediatePropagation();
			//Change row
			this._row = true;
			row.style.backgroundColor = this._row ? currColor : 'transparent';
			column.style.backgroundColor = this._row ? 'transparent' : currColor;
		};
		row.style.cssFloat = 'left';
		row.style.width = '35%';
		row.style.margin = '8px';
		row.style.padding = '5px';
		div.appendChild(row);

		//Creates the column selector
		let column = document.createElement('div');
		column.textContent = 'Column';
		column.style.backgroundColor = this._row ? 'transparent' : currColor;
		column.onclick = (e) => {
			e.stopImmediatePropagation();
			//Change col
			this._row = false;
			column.style.backgroundColor = this._row ? 'transparent' : currColor;
			row.style.backgroundColor = this._row ? currColor : 'transparent';
		};
		column.style.width = '35%';
		column.style.margin = '8px';
		column.style.cssFloat = 'right';
		column.style.padding = '5px';
		div.appendChild(column);*/

		let row = document.createElement('input');
		row.type = 'radio';
		row.name = 'row-or-col';
		row.value = 'row';
		row.textContent = 'Row';

		let rowText = document.createElement('label');
		rowText.innerText = 'Row';


		div.appendChild(row);
		div.appendChild(rowText);
		div.appendChild(document.createElement('br'));

		let col = document.createElement('input');
		col.type = 'radio';
		col.name = 'row-or-col';
		col.value = 'col';

		let colText = document.createElement('label');
		colText.innerText = 'Col';
		div.appendChild(col);
		div.appendChild(colText);
		div.appendChild(document.createElement('br'));

		editor_div.appendChild(div);
		this._configBox = div;
	}

	private updateLinesWhenOutOfDate(e: IModelContentChangedEvent, exitCode: number | null) {
		if (exitCode === 0) {
			this._changedLinesWhenOutOfDate = null;
		} else {
			if (this._changedLinesWhenOutOfDate === null) {
				this._changedLinesWhenOutOfDate = new Set();
			}
			let s = this._changedLinesWhenOutOfDate;
			e.changes.forEach((change) => {
				for (let i = change.range.startLineNumber; i <= change.range.endLineNumber; i++){
					s.add(i);
				}
			});
		}
	}

	private getBox(lineNumber:number) {
		let i = lineNumber - 1;
		if (i >= this._boxes.length) {
			for (let j = this._boxes.length; j <= i; j++) {
				this._boxes[j] = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, j+1);
			}
		}
		return this._boxes[i];
	}

	private padBoxArray() {
		let lineCount = this.getLineCount();
		if (lineCount > this._boxes.length) {
			// This should not happen, given our understanding of how changes are reported to us from VSCode.
			// BUT: just to be safe, we have this here to make sure we're not missing something.
			console.log("Adding boxes");
			for (let j = this._boxes.length; j < lineCount; j++) {
				this._boxes[j] = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, j+1);
			}
		}
	}

	private onChangeCursorPosition(e: ICursorPositionChangedEvent) {
		this.updateLayout();
	}

	private onScrollChange(e:IScrollEvent) {
		if (e.scrollHeightChanged || e.scrollWidthChanged) {
			// this means the content also changed, so we will let the onChangeModelContent event handle it
			return;
		}
		this.updateMaxPixelCol();
		this.updateLayout();
	}

	private onLayoutChange(e: EditorLayoutInfo) {
		console.log("onLayoutChange");
		this.updateMaxPixelCol();
		this.updateLayout();
	}

	private updateCellSizesForNewContent() {
		if (this.byRowOrCol !== RowColMode.ByRow) {
			return;
		}

		// Compute set of loop iterations
		let loops: string[] = [];
		for (let loop in this.tableCellsByLoop) {
			loops.push(loop);
		}
		// sort by deeper iterations first
		loops = loops.sort((a,b) => b.split(',').length - a.split(',').length);

		let widths: { [k:string]: number; } = {};
		loops.forEach((loop:string) => {
			widths[loop] = Math.max(...this.tableCellsByLoop[loop].map(e=>e.offsetWidth));
			console.log("Max for " + loop + " :" + widths[loop]);
		});

		let spaceBetweenCells = 2 * this.cellPadding;
		if (this.colBorder) {
			spaceBetweenCells = spaceBetweenCells + 1;
		}
		for (let i = 1; i < loops.length; i++) {
			let width = 0;
			let parent_loop = loops[i];
			for (let j = 0; j < i; j++) {
				let child_loop = loops[j];
				if (child_loop.split(',').length === 1 + parent_loop.split(',').length &&
					strings.startsWith(child_loop, parent_loop)) {
					width = width + widths[child_loop];
					//width = width + widths[child_loop] + spaceBetweenCells;
				}
			}
			if (width !== 0) {
				//width = width - spaceBetweenCells;
				widths[parent_loop] = width;
			}
		}

		loops.forEach((loop:string) => {
			console.log("Computed width for " + loop + ": " + widths[loop]);
			this.tableCellsByLoop[loop].forEach(e => { e.width = (widths[loop] - spaceBetweenCells) + "px"; });
		});

	}
	private updateContentAndLayout() {
		this.tableCellsByLoop = {};
		this.updateContent();
		// for (let x in this.tableCellsByLoop) {
		// 	this.tableCellsByLoop[x].forEach(y => {
		// 		console.log(x + " " + y.offsetWidth + " " + y.clientWidth);
		// 	});
		// }
		// The following seems odd, but it's really a thing in browsers.
		// We need to let layout threads catch up after we updated content to
		// get the correct sizes for boxes.
		//setTimeout(() => { this.updateLayout();	}, 0);
		setTimeout(() => {
			for (let x in this.tableCellsByLoop) {
				this.tableCellsByLoop[x].forEach(y => {
					//console.log("Delayed: " + x + " " + y.offsetWidth + " " + y.clientWidth);
				});
			}
			this.updateCellSizesForNewContent();
			this.updateLayout();
		}, 0);
	}

	private updateContent() {
		this.padBoxArray();
		this._boxes.forEach((b) => {
			b.updateContent();
		});
	}

	private updateLayout() {
		this.padBoxArray();

		let cursorPos = this._editor.getPosition();
		if (cursorPos === null) {
			return;
		}

		// Compute focused line, which is the closest line to the cursor with a visible box
		let minDist = Infinity;
		let focusedLine = 0;
		for (let line = 1; line <= this.getLineCount(); line++) {
			if (this.getBox(line).visible) {
				let dist = Math.abs(cursorPos.lineNumber - line);
				if (dist <  minDist) {
					minDist = dist;
					focusedLine = line;
				}
			}
		}
		// this can happen if no boxes are visible
		if (minDist === Infinity) {
			return
		}

		// compute distances from focused line, ignoring hidden lines.
		// Start from focused line and go outward.
		let distancesFromFocus: number[] = new Array(this._boxes.length);
		let dist = 0;
		for (let line = focusedLine; line >= 1; line--) {
			if (this.getBox(line).visible) {
				distancesFromFocus[line-1] = dist;
				dist = dist - 1;
			}
		}
		dist = 1;
		for (let line = focusedLine+1; line <= this.getLineCount(); line++) {
			if (this.getBox(line).visible) {
				distancesFromFocus[line-1] = dist;
				dist = dist + 1;
			}
		}

		for (let line = 1; line <= this.getLineCount(); line++) {
			let box = this.getBox(line);
			if (box.visible) {
				box.updateZoomAndOpacity(distancesFromFocus[line-1]);
			}
		}
		// let cursorPixelPos = this._editor.getScrolledVisiblePosition(cursorPos);
		// let nextLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(cursorPos.lineNumber+1,cursorPos.column));
		// if (cursorPixelPos === null || nextLinePixelPos === null) {
		// 	return;
		// }

		let focusedLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(focusedLine, 1));
		let nextLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(focusedLine+1, 1));
		if (focusedLinePixelPos === null || nextLinePixelPos === null) {
			return;
		}

		let spaceBetweenBoxes = this.spaceBetweenBoxes;
		// let top_start = focusedLinePixelPos.top + (focusedLinePixelPos.height / 2);
		//let top_start = (focusedLinePixelPos.top + nextLinePixelPos.top) / 2;
		//let top_start = focusedLinePixelPos.top;
		let top_start = this.getLinePixelMid(focusedLine);
		let top = top_start;
		for (let line = focusedLine-1; line >= 1; line--) {
			let box = this.getBox(line);
			if (box.visible) {
				top = top - spaceBetweenBoxes - box.getHeight();
				let lineMidPoint = this.getLinePixelMid(line);
				if (lineMidPoint < top) {
					top = lineMidPoint;
				}
				box.updateLayout(top);
			}
		}
		top = top_start;
		for (let line = focusedLine; line <= this.getLineCount(); line++) {
			let box = this.getBox(line);
			if (box.visible) {
				let lineMidPoint = this.getLinePixelMid(line);
				if (lineMidPoint > top) {
					top = lineMidPoint;
				}
				box.updateLayout(top);
				top = top + box.getHeight() + spaceBetweenBoxes;
			}
		}

	}

	public getLinePixelPos(line:number): { top: number; left: number; height: number; } {
		let result = this._editor.getScrolledVisiblePosition(new Position(line, 1));
		if (result === null) {
			throw new Error();
		}
		return result;
	}

	public getLinePixelMid(line: number): number {
		let pixelPos = this.getLinePixelPos(line);
		return pixelPos.top + (pixelPos.height / 2)
	}

	private updatePrevModel() {
		let model = this._editor.getModel();
		if (model !== null) {
			this._prevModel = model.getLinesContent().map((x) => x);
		}
	}

	public getLineLastNonWhitespaceColumn(lineNumber: number): number {
		const result = strings.lastNonWhitespaceIndex(this._prevModel[lineNumber-1]);
		if (result === -1) {
			return 0;
		}
		return result + 2;
	}

	private addRemoveBoxes(e: IModelContentChangedEvent) {
		let orig = this._boxes.map((x) => x);
		let changes = e.changes.sort((a,b) => Range.compareRangesUsingStarts(a.range,b.range));
		console.log(changes);
		let changeIdx = 0;
		let origIdx = 0;
		let i = 0;
		while (i < this.getLineCount()) {
			if (changeIdx >= changes.length) {
				this._boxes[i++] = orig[origIdx++];
				this._boxes[i-1].lineNumber = i;
			} else {
				let line = i + 1;
				let change = changes[changeIdx];
				let numAddedLines = change.text.split("\n").length-1;
				let changeStartLine = change.range.startLineNumber;
				let changeEndLine = change.range.endLineNumber;
				let numRemovedLines = changeEndLine - changeStartLine;
				let deltaNumLines = numAddedLines - numRemovedLines;
				let changeStartCol = change.range.startColumn;
				if ((deltaNumLines <= 0 && changeStartLine === line) ||
					(deltaNumLines > 0 && ((changeStartLine === line && changeStartCol < this.getLineLastNonWhitespaceColumn(line)) ||
						 				   (changeStartLine === line-1 && changeStartCol >= this.getLineLastNonWhitespaceColumn(line-1))))) {
					changeIdx++;
					if (deltaNumLines === 0) {
						// nothing to do
					} else if (deltaNumLines > 0) {
						for (let j = 0; j < deltaNumLines; j++) {
							let new_box = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, i+1);
							//new_box.hiddenByUser = orig[origIdx].hiddenByUser;
							new_box.hiddenByUser = this._visMode == VisibilityMode.SingleBox;
							this._boxes[i++] = new_box;
						}
					} else {
						for (let j = origIdx; j < origIdx + (-deltaNumLines); j++) {
							this._boxes[j].destroy();
						}
						// need to make the removed boxes disapear
						origIdx = origIdx + (-deltaNumLines);
					}
				}
				else {
					this._boxes[i++] = orig[origIdx++];
					this._boxes[i-1].lineNumber = i;
				}
			}

		}
		this.updatePrevModel();
	}

	private onChangeModelContent(e: IModelContentChangedEvent) {
		let py3 = process.env["PYTHON3"];
		if (py3 === undefined) {
			return;
		}
		let runpy = process.env["RUNPY"];
		if (runpy === undefined) {
			return;
		}
		console.log("onChangeModelContent");
		//console.log(e);
		this.padBoxArray();
		this.addRemoveBoxes(e);
		this.updateMaxPixelCol();
		let code_fname = os.tmpdir() + path.sep + "tmp.py";
		let model = this._editor.getModel();
		if (model === null) {
			return;
		}
		let lines = model.getLinesContent();
		fs.writeFileSync(code_fname, lines.join("\n"));
		let c = cp.spawn(py3, [runpy, code_fname]);

		c.stdout.on("data", (data) => {
			//console.log(data.toString())
		});
		c.stderr.on("data", (data) => {
			//console.log(data.toString())
		});
		c.on('exit', (exitCode, signalCode) => {
			console.log("Exit code from run.py: " + exitCode);
			this.updateLinesWhenOutOfDate(e, exitCode);
			if (exitCode === 0) {
				this.updateData(fs.readFileSync(code_fname + ".out").toString());
				this.updateContentAndLayout();
				//console.log(envs);
			}
			else {
				this.updateContentAndLayout();
			}
		});

	}

	private updateData(str: string) {
		let data = JSON.parse(str);
		this.envs = data[1];
		this.writes = data[0];
	}

	public flipVisMode(line: number) {
		if (this._visMode == VisibilityMode.AllBoxes) {
			this._visMode = VisibilityMode.SingleBox;
			this._boxes.forEach((b) => {
				b.hiddenByUser = (b.lineNumber !== line);
			});
		} else {
			this._visMode = VisibilityMode.AllBoxes;
			this._boxes.forEach((b) => {
				b.hiddenByUser = false;
			});
		}
		this.updateContentAndLayout();
	}

	// public focusOnBox(line: number) {
	// 	console.log("In focusOnBox: " + line.toString())
	// 	this._boxes.forEach((b) => {
	// 		b.hiddenByUser = (b.lineNumber !== line);
	// 	});
	// 	this.updateContentAndLayout();
	// }

}

registerEditorContribution(RTVCoordinator);

const boxAlignsToTopOfLineKey = 'rtv.box.alignsToTopOfLine';
const boxBorderKey = 'rtv.box.border';
const byRowOrColKey = 'rtv.box.byRowOrColumn';
const cellPaddingKey = "rtv.box.cellPadding";
const colBorderKey = 'rtv.box.colBorder';
const displayOnlyModifiedVarsKey = 'rtv.box.displayOnlyModifiedVars';
const opacityKey = 'rtv.box.opacity';
const spaceBetweenBoxesKey = 'rtv.box.spaceBetweenBoxes';
const zoomKey = 'rtv.box.zoom';
const presetsKey = 'rtv.presets';

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	'id': 'rtv',
	'order': 110,
	'type': 'object',
	'title': localize('rtvConfigurationTitle', "RTV"),
	'properties': {
		[presetsKey]: {
			'type': 'string',
			'enum': ['compact', 'full', 'custom'],
			'enumDescriptions': [
				localize('presets.compact', 'Compact mode'),
				localize('presets.full', 'Full mode')
			],
			'default': 'full',
			'description': localize('mode', 'Allows you to choose some preset configurations')
		},
		[boxAlignsToTopOfLineKey]: {
			'type': 'boolean',
			'default': false,
			'description': localize('boxalignstop', 'Controls whether box aligns to top of line (true: align to top of line; false: align to middle of line )')
		},
		[boxBorderKey]: {
			'type': 'boolean',
			'default': true,
			'description': localize('boxborder', 'Controls whether boxes have a border')
		},
		[byRowOrColKey]: {
			'type': 'string',
			'enum': ['byCol', 'byRow'],
			'enumDescriptions': [
				localize('byRowOrColumn.byCol', 'Each column is a variable'),
				localize('byRowOrColumn.byRow', 'Each row is a variable')
			],
			'default': 'byCol',
			'description': localize('byroworcol', 'Controls if variables are displayed in rows or columns')
		},
		[cellPaddingKey]: {
			'type': 'number',
			'default': 6,
			'description': localize('padding', 'Controls padding for each data cell')
		},
		[colBorderKey]: {
			'type': 'boolean',
			'default': false,
			'description': localize('colborder', 'Controls whether columns in box have a border')
		},
		[displayOnlyModifiedVarsKey]: {
			'type': 'boolean',
			'default': false,
			'description': localize('modvarsonly', 'Controls whether only modified vars are shown (true: display only mod vars; false: display all vars)')
		},
		[opacityKey]: {
			'type': 'number',
			'default': 0,
			'description': localize('zoom', 'Controls opacity level (value between 0 and 1; 0: see-through; 1: no see-through)')
		},
		[spaceBetweenBoxesKey]: {
			'type': 'number',
			'default': 20,
			'description': localize('boxspace', 'Controls spacing between boxes')
		},
		[zoomKey]: {
			'type': 'number',
			'default': 0,
			'description': localize('zoom', 'Controls zoom level (value between 0 and 1; 0 means shrink; 1 means no shrinking)')
		}
	}
});
