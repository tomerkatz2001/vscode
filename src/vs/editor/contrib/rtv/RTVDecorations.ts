import { IRTVController } from "./RTVInterfaces.js";
import { Range } from "../../common/core/range.js";
import { ICodeEditor } from '../../browser/editorBrowser.js';
import { IModelDecorationOptions, IModelDeltaDecoration, TrackedRangeStickiness } from '../../common/model.js';

/**
 * Class that holds and has the responsibility of the underline of the comment block
 */


export class DecorationManager {
	commentId: number; // The id of the "start synth" comment this  instance relates.
	lineno: number = 0; // the lineno of the comment. needs to change on every change!
	scopeSize: number = 0; //number of lines from the start of the block to the end of it. including the code.
	decorations: { [index: number]: UnderlineDecoration } = {}; //map of all the current decorations {env idx -> UnderlineDecoration} -1 key saved for the prefix line.
	indentGuides: string[] = [];
	deltaCol: number = 0;
	decorationsTypes: { [index: number]: DecorationType } = {} = {}
	isFolded: boolean // flag if the block is folded
	constructor(private readonly controller: IRTVController, private readonly editor: ICodeEditor, commentId: number, lineno: number, scopeSize: number, isFolded: boolean, deltaCol: number = 0) {
		this.commentId = commentId;
		this.lineno = lineno;
		this.scopeSize = scopeSize;
		this.isFolded = isFolded;
		this.deltaCol = deltaCol;
		if (commentId > 0) // no guide for functions
			this.addCustomIndentGuides();

	}

	public addDecoration(envIdx: number, type: DecorationType, onHoverText?: string) {
		this.removeDecoration(envIdx);
		let lineno = this.lineno + 1 + envIdx;
		let model = this.controller.getModelForce();
		let range = new Range(lineno, model.getLineFirstNonWhitespaceColumn(lineno), lineno, model.getLineLastNonWhitespaceColumn(lineno));
		this.decorations[envIdx] = new UnderlineDecoration(this.controller, range, type, onHoverText); // insert new
		this.decorationsTypes[envIdx] = type;
	}

	public fold() {
		if (this.isFolded) return
		this.isFolded = true;
		let lineno = this.lineno;
		let model = this.controller.getModelForce();
		let range = new Range(lineno, model.getLineFirstNonWhitespaceColumn(lineno), lineno, model.getLineLastNonWhitespaceColumn(lineno));
		let containFailedTests = Object.values(this.decorationsTypes).findIndex(x => x == DecorationType.failedTest) != -1;
		let type = containFailedTests ? DecorationType.failedTest : DecorationType.passTest
		let onHover = containFailedTests ? "Some tests failed. Unfold the block to see which" : "All tests pass";
		this.decorations[-1] = new UnderlineDecoration(this.controller, range, type, onHover); // insert new
		this.decorationsTypes[-1] = type;
	}

	public unfold() {
		if (!this.isFolded) return
		this.isFolded = false;
		this.decorations[-1].remove();
		delete this.decorations[-1]
		delete this.decorationsTypes[-1]
	}

	public render() {
		if (this.isFolded) {// we want to color new blocks
			this.isFolded = false;
			this.fold()
		}
	}

	private removeDecoration(envIdx: number) {
		if (this.decorations[envIdx]) { // if already have decoration
			this.decorations[envIdx].remove();
			delete this.decorations[envIdx]
			delete this.decorationsTypes[envIdx]
		}
	}
	/**
	 * removes the decoration from the envs. will not remomve contradiction decoration.
	 * @param envIdxs - list of all the envs you want to remove decoration from
	 */
	public removeDecorations(envIdxs: number[]) {
		for (let envIdx of envIdxs) {
			if (this.decorations[envIdx]) {
				this.removeDecoration(envIdx);
			}
		}
	}

	public removeAllDecoration() {
		this.removeIndentGuides();
		for (let envIdx in this.decorations) {
			this.removeDecoration(Number(envIdx))
		}
		this.editor.layout();
	}

	private addCustomIndentGuides() {
		const indentGuides: IModelDeltaDecoration[] = [];
		const col = this.editor.getModel()?.getLineFirstNonWhitespaceColumn(this.lineno)!;
		let options_top: IModelDecorationOptions;
		let options_bottom: IModelDecorationOptions;
		let options_rest: IModelDecorationOptions;

		if (col == 1 && this.deltaCol == 0) {
			options_top = {
				isWholeLine: true,
				linesDecorationsClassName: "custom-indent-guide-col0-top",
				description: ''
			};
			options_rest = {
				isWholeLine: true,
				linesDecorationsClassName: "custom-indent-guide-col0",
				description: ''
			}
			options_bottom = {
				isWholeLine: true,
				linesDecorationsClassName: "custom-indent-guide-col0-bottom",
				description: ''
			};
		}
		else if (col == 1 && this.deltaCol != 0) {
			options_top = {
				isWholeLine: true,
				linesDecorationsClassName: "custom-indent-guide-col-1-top",
				description: ''
			};
			options_rest = {
				isWholeLine: true,
				linesDecorationsClassName: "custom-indent-guide-col-1",
				description: ''
			}
			options_bottom = {
				isWholeLine: true,
				linesDecorationsClassName: "custom-indent-guide-col-1-bottom",
				description: ''
			};
		}
		else {
			options_top = {
				isWholeLine: false,
				className: 'custom-indent-guide-top', // CSS class to style the indent guide
				description: ''
			};
			options_rest = {
				isWholeLine: false,
				className: 'custom-indent-guide', // CSS class to style the indent guide
				description: ''
			};
			options_bottom = {
				isWholeLine: false,
				className: 'custom-indent-guide-bottom', // CSS class to style the indent guide
				description: ''
			};
		}

		const guide_col = col + this.deltaCol - 1;
		indentGuides.push(
			{
				range: new Range(this.lineno, guide_col, this.lineno, guide_col),
				options: options_top,
			}
		);
		for (let i = this.lineno + 1; i < this.lineno + this.scopeSize; i++) {
			indentGuides.push(
				{
					range: new Range(i, guide_col, i, guide_col),
					options: options_rest,
				}
			);
		}
		indentGuides.push(
			{
				range: new Range(this.lineno + this.scopeSize, guide_col, this.lineno + this.scopeSize, guide_col),
				options: options_bottom,
			}
		);

		this.indentGuides = this.editor.deltaDecorations([], indentGuides);
		this.editor.layout();
	}

	private removeIndentGuides() {
		this.editor.deltaDecorations(this.indentGuides, []);

	}


}

export enum DecorationType { passTest, failedTest, conflict }

class UnderlineDecoration {
	id: string;
	type: DecorationType;
	range: Range;
	contradiction: string[] = [];
	displayMessage: any = null;
	controller: IRTVController;
	constructor(controller: IRTVController, range: Range, type: DecorationType, onHover?: string) {
		this.type = type;
		this.range = range;
		let className = "";
		this.displayMessage = onHover;
		this.controller = controller;
		switch (type) {
			case DecorationType.passTest:
				className = "RTV-passed-class";
				break;
			case DecorationType.failedTest:
				className = "RTV-failed-class";
				break;
			case DecorationType.conflict:
				className = "RTV-conflict-class";
				break;
		}
		//this.updateDisplayMessage(onHover);
		this.id = this.addDecoration(range, className, this.displayMessage);

	}

	private addDecoration(range: Range, className: string, displayMessage: string = "") {

		const markdownString: monaco.IMarkdownString = {
			value: displayMessage,
			isTrusted: true
		};
		const decorationOptions: IModelDecorationOptions = {
			isWholeLine: false,
			inlineClassName: className,
			stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
			hoverMessage: markdownString,
			description: ''
		};
		return this.controller.addDecoration(range, decorationOptions);
	}

	private removeDecoration(decorationId: string) {
		this.controller.removeDecoration(decorationId);
	}

	public remove() {
		this.removeDecoration(this.id);
		this.id = '';
	}

	/*
	public addContradictionLine(controller: IRTVController, lineno? : string){
		this.updateDisplayMessage(lineno);
		this.remove(controller);
		this.id = this.addDecoration(this.range, "squiggly-error"  });

	}

	private updateDisplayMessage(onHover? :string){
		if(onHover && this.type === DecorationType.failedTest){
			this.displayMessage = onHover;
			return;
		}
		if(this.type === DecorationType.passTest){
			this.displayMessage = "This env is not longer part of the real running program, but if it were it would be valid."
			return;
		}

	}
	 */
}
