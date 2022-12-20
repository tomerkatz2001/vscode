import {IRTVController} from "vs/editor/contrib/rtv/RTVInterfaces";
import {Range} from "vs/editor/common/core/range";

/**
 * Class that holds and has the responsibility of the underline of the comment block
 */
export class DecorationManager{
	commentId: number; // The id of the "start synth" comment this  instance relates.
	lineno : number = 0; // the lineno of the comment. needs to change on every change!
	decorations: {[index: number]: Decoration} = {}; //map of all the current decorations {env idx -> Decoration}
	constructor(private readonly controller: IRTVController, commentId: number){
		this.commentId = commentId;
	}

	public addDecoration(lineno: number ,envIdx:number, type: DecorationType, onHoverText?: string){
		if(type === DecorationType.invalid && this.decorations[envIdx]){
			return;
		}
		if(this.decorations[envIdx] && this.decorations[envIdx].type ==type &&type == DecorationType.conteradiction && this.decorations[envIdx].range.startLineNumber == lineno) // both are conteradictions
		{
			this.decorations[envIdx].addContradictionLine(this.controller, onHoverText);
			return;
		}
		this.removeDecoration(envIdx);
		let model  = this.controller.getModelForce();
		let range = new Range(lineno,model.getLineFirstNonWhitespaceColumn(lineno), lineno, model.getLineLastNonWhitespaceColumn(lineno));
		this.decorations[envIdx] = new Decoration(this.controller, range , type, onHoverText ); // insert new
	}

	private removeDecoration(envIdx: number){
		if(this.decorations[envIdx]){ // if alrady have decoration
			this.decorations[envIdx].remove(this.controller);
			delete this.decorations[envIdx]
		}
	}
	/**
	 * removes the decoration from the envs. will not remomve contradiction decoration.
	 * @param envIdxs - list of all the envs you want to remove decoration from
	 */
	public removeDecorations(envIdxs: number[]){
		for(let envIdx of envIdxs){
			if(this.decorations[envIdx] && this.decorations[envIdx].type != DecorationType.conteradiction){
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

export enum DecorationType{conteradiction,invalid, passTest, failedTest};

class Decoration{
	id : string;
	type : DecorationType;
	range :Range;
	contradiction: string[] =[];
	displayMessage: any = null;
	constructor(controller: IRTVController, range :Range, type:DecorationType, onHover?: string){
		this.type = type;
		this.range = range;
		let className = "";
		switch(type){
			case DecorationType.conteradiction:
				className="squiggly-error";
				break;
			case DecorationType.invalid:
				className = "squiggly-warning";
				break;
			case DecorationType.passTest:
				className = "squiggly-info";
				break;
			case DecorationType.failedTest:
				className = "squiggly-error";
				break;
		}

		this.updateDisplayMessage(onHover);
		this.id = controller.addDecoration(range, { className: className, hoverMessage:this.displayMessage });

	}

	public remove(controller: IRTVController){
		controller.removeDecoration(this.id);
		this.id = '';
	}

	public addContradictionLine(controller: IRTVController, lineno? : string){
		this.updateDisplayMessage(lineno);
		this.remove(controller);
		this.id = controller.addDecoration(this.range, { className: "squiggly-error", hoverMessage:this.displayMessage });

	}

	private updateDisplayMessage(onHover? :string){
		if(onHover && this.type == DecorationType.conteradiction){
			if(!this.contradiction.includes(onHover)){
				this.contradiction.push(onHover);
			}
		}
		if(onHover && this.type === DecorationType.failedTest){
			this.displayMessage = onHover;
			return;
		}
		if(this.type === DecorationType.passTest){
			this.displayMessage = "This env is not longer part of the real running program, but if it were it whould be valid."
			return;
		}
		if(this.type === DecorationType.invalid){
			this.displayMessage = {value: "This specification is no longer valid."};
			return;
		}
		if(this.contradiction.length!==0){
			this.displayMessage = {value: "This specification is in contradiction with the specifications on lines: " + this.contradiction.toString()};
		}
	}
}
