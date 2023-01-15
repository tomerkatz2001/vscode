import {IRTVController} from "vs/editor/contrib/rtv/RTVInterfaces";
import {Range} from "vs/editor/common/core/range";
import {IModelDecorationOptions, TrackedRangeStickiness } from "vs/editor/common/model";

/**
 * Class that holds and has the responsibility of the underline of the comment block
 */
export class DecorationManager{
	commentId: number; // The id of the "start synth" comment this  instance relates.
	lineno : number = 0; // the lineno of the comment. needs to change on every change!
	decorations: {[index: number]: Decoration} = {}; //map of all the current decorations {env idx -> Decoration}
	constructor(private readonly controller: IRTVController, commentId: number, lineno: number){
		this.commentId = commentId;
		this.lineno = lineno;
	}

	public addDecoration(envIdx:number, type: DecorationType, onHoverText?: string){
		this.removeDecoration(envIdx);
		let lineno = this.lineno+1+envIdx;
		let model  = this.controller.getModelForce();
		let range = new Range(lineno,model.getLineFirstNonWhitespaceColumn(lineno), lineno, model.getLineLastNonWhitespaceColumn(lineno));
		this.decorations[envIdx] = new Decoration(this.controller, range , type, onHoverText); // insert new
	}

	private removeDecoration(envIdx: number){
		if(this.decorations[envIdx]){ // if already have decoration
			this.decorations[envIdx].remove();
			delete this.decorations[envIdx]
		}
	}
	/**
	 * removes the decoration from the envs. will not remomve contradiction decoration.
	 * @param envIdxs - list of all the envs you want to remove decoration from
	 */
	public removeDecorations(envIdxs: number[]){
		for(let envIdx of envIdxs){
			if(this.decorations[envIdx]){
				this.removeDecoration(envIdx);
			}
		}
	}

	public removeAllDecoration(){
		for(let envIdx in this.decorations){
			this.removeDecoration(Number(envIdx))
		}
	}




}

export enum DecorationType{passTest, failedTest}

class Decoration{
	id : string;
	type : DecorationType;
	range :Range;
	contradiction: string[] =[];
	displayMessage: any = null;
	controller: IRTVController;
	constructor(controller: IRTVController, range :Range, type:DecorationType, onHover?: string){
		this.type = type;
		this.range = range;
		let className = "";
		this.displayMessage = onHover;
		this.controller = controller;
		switch(type){
			case DecorationType.passTest:
				className = "RTV-passed-class";
				break;
			case DecorationType.failedTest:
				className = "RTV-failed-class";
				break;
		}
		//this.updateDisplayMessage(onHover);
		this.id = this.addDecoration(range, className, this.displayMessage);

	}

	private addDecoration(range: Range, className: string, displayMessage: string=""){

		const markdownString: monaco.IMarkdownString = {
			value: displayMessage,
			isTrusted: true
		};
		const decorationOptions: IModelDecorationOptions = {
			isWholeLine: false,
			inlineClassName: className,
			stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
			hoverMessage: markdownString
		};
		return this.controller.addDecoration(range, decorationOptions);
	}

	private removeDecoration(decorationId:string){
		this.controller.removeDecoration(decorationId);
	}

	public remove(){
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
