import {IRTVController, IRTVLogger, /*IRTVLogger*/} from "./RTVInterfaces";
import {Range as RangeClass, Range} from 'vs/editor/common/core/range';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import { ICodeEditor } from "vs/editor/browser/editorBrowser";
import * as assert from "assert";
import {Selection} from "vs/editor/common/core/selection";
// eslint-disable-next-line no-duplicate-imports
import {getUtils} from "vs/editor/contrib/rtv/RTVUtils";
import {RTVSynthModel} from "vs/editor/contrib/rtv/RTVSynthModel";
import {DecorationManager, DecorationType} from "vs/editor/contrib/rtv/RTVDecorations";

const  SYNTHESIZED_COMMENT_START = `#! Start of synth number: `;
const SYNTHESIZED_COMMENT_END = `#! End of synth number: `;
const FAKE_TIME = 100;


enum env_status{pass, fail, live}
/**
 * class that represents a block of examples, aka a comment, inserted automatically by the synth or manually by the user
 */
export class ParsedComment{
	synthesizedVarNames: string[] = [];
	private readonly envs : any[] =[];
	private readonly envs_status :env_status[] =[]; //
	out : any[] = []; //right of the "=>"
	commentID:number = 0;
	size: number; // number of line from start_synth to end_synth
	constructor(synthesizedVarNames: string[], envs: any[], envs_status: env_status[], out: any[], commentID:number, size:number ){
		this.synthesizedVarNames = synthesizedVarNames;
		this.envs = envs;
		this.envs_status = envs_status;
		this.out = out;
		this.commentID = commentID;
		this.size = size;
	}

	public getEnvsToResynth(){
		let envs = [];
		for(let [i, env] of utils.enumerate(this.envs)){
			let tmp = env;
			for(let varName in tmp){
				if(varName.endsWith("_in")){
					delete env[varName];
				}
			}
			if(!tmp["#"]){
				tmp["#"] = "";
			}
			if(!tmp["$"]){
				tmp["$"] = "";
			}
			envs.push({...tmp, ... this.out[i]});
		}
		return envs;
	}

	public removeEnv(envIdx:number){
		this.envs.splice(envIdx,1);
		this.out.splice(envIdx,1);
	}

	public getEnvStatus(envIdx:number){
		assert(this.envs_status.length > envIdx,);
		return this.envs_status[envIdx];
	}
}



// this class is in charge of all the comments in the file.
export class CommentsManager{
	private logger: IRTVLogger;
	private comments :{[index: number] : DecorationManager} = {}; // map from synthID and comment idx to the decorations ids
	private synthCounter: number = 0; // the largest comment id there is in the file

	constructor(private readonly controller: IRTVController, private readonly editor:ICodeEditor){
		this.logger = getUtils().logger(editor);
	}
	/**
	 * needs to be called after every synth.
	 */
	public newSynthBlock(){
		this.comments[this.synthCounter] = new DecorationManager(this.controller, this.synthCounter);
		this.synthCounter ++ ;
	}

	/**
	 * @param box- the box you want its values to be inserted
	 * @param outVars - The variables that synthesized
	 * @param preEnvs - a map from time i to the env with time i-1.
	 * @returns the number of lines that lineno needs to be increased.
	 */
	public insertExamples(synthModel: RTVSynthModel, outVars:string[], prevEnvs?:Map<number, any>){
		let examplesCounter = 0;
		let examples:string = ``;
		let synthExamples= synthModel.getExample();
		for(let example of synthExamples){
			let leftSide = `#! ${++examplesCounter}) `;


			Object.keys(example.inputs).forEach((inputVar) => {
				leftSide += `${inputVar} = ${example.inputs[inputVar]}, `; // add the input vars
			});
			leftSide = leftSide.substring(0, leftSide.length - 2); //remove the last ', '

			let rightSide = ``;
			Object.keys(example.outputs).forEach((outputVar) => {
				rightSide += `${outputVar} = ${example.outputs[outputVar]}, `; // add the output vars
			});
			rightSide = rightSide.substring(0, rightSide.length - 2); //remove the last ', '

			examples += `${leftSide} => ${rightSide} \n`

		}
		this.newSynthBlock();
		this.logger.insertComments(synthModel.getLineno(), examples);
		this.insertExamplesToEditor(examples, outVars, synthModel.getLineno());

		// increasing lineno so the synth won't override these comments
		return (examples.split("\n")).length;
	}

	/**
	 * this function is in charge of inserting the text at the right place in the editor.
	 * it will also update the cursor position to point to the next line.
	 * @param examples- the examples to insert
	 * @param outVars - the variables that were synthesized
	 * @param lineno - the line number to insert the text at
	 */
	private insertExamplesToEditor(examples: string, outVars: string[], lineno: number){
		let model = this.controller.getModelForce();
		let cursorPos = this.editor.getPosition();
		let startCol: number ;
		let endCol: number ;
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
		let range = new RangeClass(lineno, startCol, lineno, endCol);
		let oldText = model.getValueInRange(range);
		let prolog = SYNTHESIZED_COMMENT_START + this.synthCounter.toString() + " of: " + outVars.toString().replace("[","").replace("]","")  +"\n";
		let epilog = "\n" + SYNTHESIZED_COMMENT_END + this.synthCounter.toString() + "\n";
		let newText = prolog + examples + oldText + epilog;

		let indent = (model.getOptions()!.insertSpaces) ? ' ' : '\t';
		newText = newText.split('\n').join('\n' + indent.repeat(startCol - 1));

		this.editor.pushUndoStop();
		let selection = new Selection(
			lineno + newText.split('\n').length - 2,
			startCol,
			lineno + newText.split('\n').length - 2,
			startCol + newText.length
		);

		this.editor.executeEdits(
			this.controller.getId(),
			[{ range: range, text: newText }],
			[selection]
		);
	}

	/**
	 * This function will clean the comment starting from lineno.
	 *
	 * @returns the indent of the code that was deleted .
	 */
	public removeCommentsAndCode(lineno: number,lines: number){
		let model = this.controller.getModelForce();
		this.editor.pushUndoStop(); //TODO: fix the bug of ctrl+z
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = startCol;
		for(let i= lineno; i<lineno+lines;i++){
			let curr_end_col = model.getLineMaxColumn(i);
			if(curr_end_col > endCol){
				endCol = curr_end_col;
			}
		}
		let range = new Range(lineno, startCol, lineno+lines, endCol);
		this.editor.executeEdits("", [{ range: range, text: null }]); //delete lines
		return startCol;
	}

	/**
	* This function parse the comments that the synthesizer left after synth.
	* @param lineno - the line of the "Start synth" annotation
	* @returns ParsedComment
	*/
	public async parseComment(lineno: number) {
		let l = this.getCommentValuesAndScopeSize(lineno);
		//let comment = l["comment"];
		let parsedJson:any = null//await utils.parse(comment)
		let parsed =new ParsedComment(parsedJson!["varnames"],parsedJson!["envs"], parsedJson!["envs_status"], parsedJson!["out"], parsedJson!["synthCount"], l["size"]);
		return parsed;
	}

	private async runUnitests(parsedComment:ParsedComment, envIdxs:number[], program: string, baseLineno:number){
		for(const envIdx of envIdxs){
			let error = await this.runUnitest(parsedComment, envIdx, program )
			if(!error){
				this.comments[parsedComment.commentID].addDecoration(envIdx+baseLineno, envIdx, DecorationType.passTest);
			}
			else{
				this.comments[parsedComment.commentID].addDecoration(envIdx+baseLineno, envIdx, DecorationType.failedTest, error);
			}
		}
	}

	/**
	 *
	 * @param parsedComment - the comment that we are tring to test its envs
	 * @param envIdx - the env we want to test
	 * @param program - the program that we want to run the test on
	 * @returns  "" if test passes or string with why it fails if it falis.
	 */
	private async runUnitest(parsedComment:ParsedComment, envIdx:number, program: string ){ //todo Make this more general not only linear programs.
		console.log(`running test on env ${envIdx}}`);
		let startTestEnv = parsedComment.getEnvsToResynth()[envIdx];
		let assignments = "";
		for(let varName in startTestEnv){
			assignments += varName + " = " + startTestEnv[varName] + "\n";
		}
		program = assignments + program;
		let [, , parsedResult] = await this.controller.runProgram();//null, program);
		let returnCode = parsedResult[0];

		if(returnCode!=0){
			console.log("test fails!!!");
			return `The program exited with return code of: ${returnCode}`;
		}
		let maxTime=-1;
		let lastEnv = null;
		for(let key in parsedResult[2]){
			let env = parsedResult[2][key];
			env = env[env.length-1];
			if(env && env["time"] && env["time"]>maxTime){
				maxTime = env["time"];
				lastEnv = env;
			}
		}

		let error = "";
		for(let outVar in parsedComment.out[envIdx]){
			if(lastEnv[outVar] != startTestEnv[outVar]){
				console.log("test fails!!!");
				error += `expected: ${outVar} to be ${startTestEnv[outVar]}, but got ${lastEnv[outVar]} \n`;
			}
		}

		console.log("test passed");
		return error;

	}

	public async initDecorations(){
		//this.logger.initDecoration()
		let model = this.controller.getModelForce();
		let maxSynthID = 0;
		for(var lineno = 1; lineno< model.getLineCount(); lineno++){
			if(model.getLineContent(lineno).trim().startsWith(SYNTHESIZED_COMMENT_START)){
				let parsedComments:ParsedComment = await this.parseComment(lineno);
				this.comments[parsedComments.commentID] = new DecorationManager(this.controller, parsedComments.commentID); // new maneger for the comment
				if(parsedComments.commentID>maxSynthID){
					maxSynthID = parsedComments.commentID;
				}
			}
		}

		this.synthCounter = maxSynthID+1;
		await this.checkForChanges();
		await this.checkForContradictions(1,this.controller.getModelForce().getLineCount(), {});

	}

	public async updateLiveComments(){
		let liveIds = []; //list off all comments that are still on the screen.
		let model = this.controller.getModelForce();
		for(var lineno = 1; lineno < model.getLineCount(); lineno++){
			if(model.getLineContent(lineno).trim().startsWith(SYNTHESIZED_COMMENT_START)){
				let parsedComment:ParsedComment = await this.parseComment(lineno);
				liveIds.push(parsedComment.commentID);
			}
		}
		//this.logger.liveEnvs(liveIds.length);
		for(let commentId in this.comments){
			if(!liveIds.includes(Number(commentId))){
				this.comments[commentId].removeAllDecoration();
				delete this.comments[commentId];
			}
		}
	}

	/**
	 * this function
	 */
	public async checkForChanges() {
		//this.logger.scanAllFile();
		let model = this.controller.getModelForce();
		for(var lineno = 1; lineno < model.getLineCount(); lineno++){
			if(model.getLineContent(lineno).trim().startsWith(SYNTHESIZED_COMMENT_START)){
				let commentAndSize = this.getCommentValuesAndScopeSize(lineno);
				let endSynthLineno = commentAndSize["size"] + lineno;
				let parsedComment:ParsedComment = await this.parseComment(lineno);
				let commentEnvs = parsedComment.getEnvsToResynth();

				let currentEnv = this.controller.envs[endSynthLineno-1];
				//let synthesizedVars = parsedComment.synthesizedVarNames;
				let commentsStatus = this.findChanges(commentEnvs, currentEnv, []);

				if(commentsStatus["notChanged"]){
					this.comments[parsedComment.commentID].removeDecorations(commentsStatus["notChanged"]);
				}

				let program = this.controller.getProgram( )//[lineno, endSynthLineno]);
				await this.runUnitests(parsedComment,commentsStatus["cahnged"], program, lineno+1);
			}
		}

	}

	/**
	 * This funcion finds contridictions in the current program.
	 * @param startLineno - line number to start looking contridictions
	 * @param endLineno - line number to stop the contridictions looking
	 * @param examples - map from synth lineno to the parsed comment of it. {lineno : parsedComment#id}
	 * @returns
	 */
	public async checkForContradictions(startLineno : number, endLineno :number, examples:any){
		if(startLineno>=endLineno){
			return;
		}
		let model = this.controller.getModelForce();
		let lineno = startLineno;
		//let scopes = [];
		while(lineno<=endLineno){
			if(model.getLineContent(lineno).trim().startsWith(SYNTHESIZED_COMMENT_START)){ //if we see start scope
				let endScope = this.getCommentValuesAndScopeSize(lineno)["size"] + lineno;
				let parsedComment:ParsedComment = await this.parseComment(lineno);
				this.markConteradictions(parsedComment, lineno, examples);
				//scopes.push([lineno, endScope]); // pushing tuple of start and end scope
				examples[lineno] = parsedComment;
				await this.checkForContradictions(lineno + 1, endScope, examples);
				delete examples[lineno];
				lineno = endScope+1;
			}
			else{
				lineno+=1;
			}
		}
	}

	private markConteradictions(currComment:ParsedComment, currCommentLineno:number, prevComments:{[key : number] : ParsedComment}){
		let targetVars = currComment.synthesizedVarNames;
		for(let lineno in prevComments){
			let oldComment:ParsedComment = prevComments[lineno];
			let i = -1;
			let j = -1;
			for(let env of currComment.getEnvsToResynth()){
				i++;
				for(let oldEnv of oldComment.getEnvsToResynth()){
					j++;
					if(Object.keys(env).length != Object.keys(oldEnv).length){
						continue;
					}
					let contradiction = false;
					for(let varname in env){
						if(targetVars.includes(varname) && env[varname] != oldEnv[varname]){ // the target var is diffret
							contradiction = true;
						}
						if(!targetVars.includes(varname) && env[varname] != oldEnv[varname]){ //diffrent inputs
							contradiction = false;
							break; // no need to continue because the envs cant make contridiction
						}
					}
					if(contradiction){
						let badLineno = Number(lineno)+ 1 +j;
						this.comments[oldComment.commentID].addDecoration(badLineno, j,DecorationType.conteradiction, (currCommentLineno +1 + i).toString());
						this.comments[currComment.commentID].addDecoration(currCommentLineno +1 + i , i, DecorationType.conteradiction, (badLineno+j).toString());
						// let range = new Range(badLineno, model.getLineFirstNonWhitespaceColumn(badLineno), badLineno, model.getLineLastNonWhitespaceColumn(badLineno));
						// let decorationID = this.controller.addDecoration(range, { className: 'squiggly-error' ,hoverMessage: {value: "conflict with env number"+i.toString() +"at comment "+currComment.commentID}});

						// if(this.squigglyLines[oldComment.commentID][j]){
						// 	this.controller.removeDecoration(this.squigglyLines[oldComment.commentID][j]); // remove prev warning
						// }
						// this.squigglyLines[oldComment.commentID][j] = "";
						// this.squigglyLines[oldComment.commentID][j]= decorationID;
					}
					else{
						//this.squigglyLines[oldComment.commentID].removeDecoration(j);
					}

				}
			}
		}
	}

	/**
	 * This function finds out all the envs that was changed in the old env compare to the new envs.
	 * @param oldEnvs - list of envs you want to check.
	 * @param newEnvs - the current envs of the program.
	 * @returns two lists, one of oldEnvs that have matching env in the new envs ("notChanged"), and a list of envs without matching envs.
	 */
	private findChanges(oldEnvs:any[], newEnvs:any, varnames:string[]){
		let badComments:number[] = [];
		let restoredLines = Array(newEnvs.length).fill(false);
		oldEnvs.forEach((env,idx) => {
			if(this.findMatchingEnv(newEnvs,env, restoredLines, varnames)==-1){//not found
				badComments.push(idx);
			}
		});
		let arr = [];
		for(var i=0; i<oldEnvs.length; i++){
			arr.push(i);
		}
		let goodComments = arr.filter(number=>!badComments.includes(number));
		return {"cahnged":badComments, "notChanged": goodComments};
	}

	/**
	 *
	 * @param lineno - the start of the synth block
	 * @returns {"comment": the raw comment block, "size": the number of lines this comment takes }
	 */
	private getCommentValuesAndScopeSize(lineno: number){
		let model = this.controller.getModelForce();
		let comment = "";
		let code_counter = 0;
		let ends_until_finish = 1
		let line = model.getLineContent(lineno + code_counter).trim();
		comment = line.replace("!!", "")+ "\n";
		while (ends_until_finish > 0){
			code_counter++
			line = model.getLineContent(lineno + code_counter).trim();
			if(line != "#!"){
				comment += line + "\n";
			}
			if (line == SYNTHESIZED_COMMENT_END)
			{
				ends_until_finish--;
			}
			if(line.startsWith(SYNTHESIZED_COMMENT_START)){
				ends_until_finish++;
			}
		}

		return {"comment": comment,"size": code_counter};
	}

	public async getValuesFromCommentsRecursive(lineno : number):Promise<any[]>{
		let model = this.controller.getModelForce();
		let commentsParsed = [];
		let codeCounter = this.getCommentValuesAndScopeSize(lineno)["size"];
		commentsParsed.push(await this.parseComment(lineno));

		for(let i = lineno+1; i < codeCounter+lineno; i ++){
			if(model.getLineContent(i).trim().startsWith(SYNTHESIZED_COMMENT_START)){
				commentsParsed.push(...await this.getValuesFromCommentsRecursive(i));
				return commentsParsed;
			}
		}
		return commentsParsed;
	}

	public mergeCommentsValues(parsedComments : ParsedComment[]){

		let finalParsedComment = parsedComments[0];
		for(let parsedComment of parsedComments){
			parsedComment.synthesizedVarNames.forEach(varName =>{
				if(!finalParsedComment.synthesizedVarNames.includes(varName)){
					finalParsedComment.synthesizedVarNames.push(varName);
					finalParsedComment.getEnvsToResynth().forEach((env, idx) => {
						if(parsedComment.getEnvsToResynth()[idx] && parsedComment.getEnvsToResynth()[idx][varName]){ // may be null if in if stmt
							let matches = this.findMatchingEnvAux(finalParsedComment.getEnvsToResynth(), parsedComment.getEnvsToResynth()[idx], [varName] );
							if(matches){
								finalParsedComment.getEnvsToResynth()[matches[0]][varName] = parsedComment.getEnvsToResynth()[idx][varName] ;
							}
							}
					});

				}

			} );
		}
		return finalParsedComment;
	}

	/**
	 * this function modify the real run envs to the envs that appeared in the comment.
	 * if new envs were added they will be added
	 * @param runresults
	 * @param parsedComment
	 * @returns
	 */
	public modifyRunResults(runresults: any, parsedComment :ParsedComment, lineno: number, restoredLines: boolean[]){

		let pastBoxEnvs:any[] = parsedComment.getEnvsToResynth();
		let currBoxEnvs = runresults[2][lineno-1];

		for(let env of pastBoxEnvs){
			let envidx = this.findMatchingEnv(currBoxEnvs, env, restoredLines, parsedComment.synthesizedVarNames);
			if(envidx != -1){
				restoredLines[envidx] = true;
				//all the var values are the same
				for(let synthesizedVar of parsedComment.synthesizedVarNames){
					currBoxEnvs[envidx][synthesizedVar] = env[synthesizedVar]; //replace with the comment value
				}
			}
			else{ // new env
				currBoxEnvs[currBoxEnvs.length] = env; //replace with the comment value
				currBoxEnvs[currBoxEnvs.length-1]["$"]="";
				currBoxEnvs[currBoxEnvs.length-1]["#"] = "";
				currBoxEnvs[currBoxEnvs.length-1]["time"] = FAKE_TIME;
			}
		}

		return runresults;
	}

	/**
	 * This function tries to find the target env in the given list.
	 *
	 * Two envs will be called matched if they have the same varnames with the same values.
	 *
	 *  varnames is a list of varnames you what this function to ignore will comparing the values.(usefull in the resynth)
	 * @param envsList - where to look for
	 * @param targetEnv - what to look
	 * @returns the idx of the matching env in envList. or -1 if not found
	 *
	 * affects: []
	 */
	public findMatchingEnv(envsList:any[], targetEnv:any, restoredLines: boolean[], varnames: string[] ){
		for(let idx =0 ; idx< envsList.length; idx++){
			let env = envsList[idx];
			let isSame = true;
			if(!restoredLines[idx]){ // if we didn't say this env is somthing else
				for(let varName of Object.keys(targetEnv)){
					if(!varnames.includes(varName)){ //if this is not synthized var
						let eq = (first:any, second:any)=>{
							if(typeof first =="number"){
								return first === second;
							}
							return first.trim() === second.trim();
						}
						if(env[varName]==null || !eq(targetEnv[varName], env[varName])){
							isSame = false;
							break;
						}
					}
				}
				//if we got here all the vars in comment are in the run result env
				if(isSame){
					return idx;
				}
			}
		}
		return -1;
	}

	private findMatchingEnvAux(envsList:any[], targetEnv:any, igrnoredVars: string[]){
		let matches = [];
		for(let idx =0 ; idx< envsList.length; idx++){
			let env = envsList[idx];
			let isSame = true;
				for(let varName of Object.keys(targetEnv)){
					if(!igrnoredVars.includes(varName)){ //if this is not synthized var
						if(env[varName]==null || targetEnv[varName] != env[varName]){
							isSame = false;
							break;
						}
					}
				}
				//if we got here all the vars in comment are in the run result env
				if(isSame){
					matches.push(idx);
				}

		}
		return matches;
	}

	public shiftRestoredLines(runResults: any, lineno:number, box:any, restoredLines: boolean[]){
		let currBoxEnvs: any[] = runResults[2][lineno-1];
		currBoxEnvs.forEach((env,idx)=>{
			if(env["begin_loop"]!= null||env["end_loop"]!=null){//the i env is a dummy env
				if(!(box.getEnvs()[idx] && !box.getEnvs()[idx]["time"])){ //we dont want to delete empty rows that are caused by an if stmt
					restoredLines.splice(idx, 1); //remove it from the list
				}
			}
		});

	}

	/**
	 * will loop over all the comments that surround this line and will return all the commented envs that are not part of the real program run
	 * @param lineno will start to look from this line up
	 */
	public async getDummyEnvs(lineno:number){
		var starts = 0;
		var envs: any[] = [];
		var lastEnvs: any[] =[];
		for(var i = lineno; i>=1; i--){
			if(starts > 1){break;} // we are out of nesting scope
			var lineContent = this.controller.getLineContent(i);
			if(lineContent.startsWith(SYNTHESIZED_COMMENT_END)){starts--;}
			else if(lineContent.startsWith(SYNTHESIZED_COMMENT_START)){
				starts--;
				var parsedComment = await this.parseComment(i);
				parsedComment.getEnvsToResynth().forEach((env)=>{
					if(this.findMatchingEnv(lastEnvs, env,[],parsedComment.synthesizedVarNames)=== -1){ //this env is fake
						envs.push(env);
					}
				});

			}
			if(this.controller.envs[i-1]){
				lastEnvs = this.controller.envs[i-1];
			}
		}
		return envs;
	}
}
