// eslint-disable-next-line code-import-patterns
import {IRTVController, IRTVLogger,} from "../RTVInterfaces";
import {Range as RangeClass, Range} from 'vs/editor/common/core/range';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import {getUtils} from 'vs/editor/contrib/rtv/RTVUtils';
import {ICodeEditor} from "vs/editor/browser/editorBrowser";
import * as assert from "assert";
import {Selection} from "vs/editor/common/core/selection";
import {RTVSynthModel} from "vs/editor/contrib/rtv/RTVSynthModel";
import {DecorationManager, DecorationType} from "vs/editor/contrib/rtv/RTVDecorations";
import {RTVSpecification} from "vs/editor/contrib/rtv/RTVSpecification";
import {FoldingRangeProviderRegistry} from "vs/editor/common/modes";
import {SpecificationsRangeProvider} from "vs/editor/contrib/rtv/comments/SpecificationsRangeProvider";
import {IModelContentChangedEvent} from "vs/editor/common/model/textModelEvents";
import {RTVController} from "vs/editor/contrib/rtv/RTVDisplay";


export  const  SYNTHESIZED_COMMENT_START = `#! Start of synth number: `;
export  const SYNTHESIZED_COMMENT_END = `#! End of synth number: `;
//const FAKE_TIME = 100;


enum env_status{pass, fail, live}
/**
 * class that represents a block of examples, aka a comment, inserted automatically by the synth or manually by the user
 */
export class ParsedComment{
	synthesizedVarNames: string[] = []; //
	private readonly envs : any[] =[];
	private readonly envs_status :env_status[] =[]; //
	out : {[varName: string]: string}[] = []; //right of the "=>"
	commentID:number = 0;
	size: number; // number of line envs
	constructor(synthesizedVarNames: string[], envs: any[], envs_status: env_status[], out: any[], commentID:number,){
		this.synthesizedVarNames = synthesizedVarNames;
		this.envs = envs;
		this.envs_status = envs_status;
		this.out = out;
		for (let o of out) {
			for (let [key, value] of Object.entries(o)) {
				if (typeof value === "string") {
					o[key] = `'${value}'`;
				}
				else {
					o[key] = String(value);
				}
			}
		}
		this.commentID = commentID;
		this.size = envs.length;
	}

	public getEnvsToResynth(){
		let envs = [];
		for(let [i, env] of utils.enumerate(this.envs)){
			let tmp = env;
			for(let varName in tmp){
				if(varName.endsWith("_in")){
					delete env[varName];
				}
				//if the var is not string, make it a string
				else if(typeof tmp[varName] !== "string"){
					tmp[varName] = tmp[varName].toString();
				}
				else if(!tmp[varName].startsWith("[")){// if the var is string and not arr add another quote
					tmp[varName] = `'${tmp[varName]}'`;
				}
			}
			if(!tmp["#"]){
				tmp["#"] = "";
			}
			if(!tmp["$"]){
				tmp["$"] = "";
			}
			tmp['time'] = -1;
			// make each elemnt in the list a string
			envs.push({...tmp, ... this.out[i]});
		}
		return envs;
	}

	public toJson(){
		return {
			"outputVarNames": this.synthesizedVarNames,
			"commentExamples": this.getEnvsToResynth(),
			"assignments": {},
			"commentId": this.commentID
		};
	}
	public removeEnv(envIdx:number){
		this.envs.splice(envIdx,1);
		this.out.splice(envIdx,1);
	}

	public getEnvStatus(envIdx:number){
		assert(this.envs_status.length > envIdx,);
		return this.envs_status[envIdx];
	}

	public asString():string{
		let s:string = "";
		let examplesCounter:number = 0;
		for (let [index,example] of this.envs.entries()) {
			let leftSide = `#! ${++examplesCounter}) `;
			Object.keys(example).forEach((inputVar) => {
				if(! ["#", "$", "time"].includes(inputVar)) {
					leftSide += `${inputVar} = ${example[inputVar]}, `;
				}
			});
			leftSide = leftSide.substring(0, leftSide.length - 2); //remove the last ', '

			let rightSide = ``;
			Object.keys(this.out[index]).forEach((outputVar) => {
				rightSide += `${outputVar} = ${this.out[index][outputVar]}, `; // add the output vars
			});
			rightSide = rightSide.substring(0, rightSide.length - 2); //remove the last ', '

			s += `${leftSide} => ${rightSide} \n`
		}
		return s;
	}
}


// this class is in charge of all the comments in the editor.
export class CommentsManager {
	private logger: IRTVLogger;
	private comments: { [index: number]: DecorationManager } = {}; // map from synthID and comment idx to the decorations ids
	private synthCounter: number = 0; // the largest comment id there is in the file
	private specifications: RTVSpecification;
	constructor(private readonly controller: RTVController, private readonly editor: ICodeEditor) {
		this.logger = getUtils().logger(editor);
		this.specifications = new RTVSpecification();
		FoldingRangeProviderRegistry.register("*", new SpecificationsRangeProvider());
		this.editor.onDidChangeModelContent((e) => { this.onDidChangeModelContent(e); });	}

	/**
	 * needs to be called after every synth.
	 */
	private newSynthBlock() {
		//this.comments[this.synthCounter] = new DecorationManager(this.controller, this.synthCounter);
		this.synthCounter++;
	}
	public async getScopeSpecification()  {
		let model =  this.controller.getModelForce();
		await this.specifications.gatherComments(model.getLinesContent().join("\n"));
		return this.specifications.ToJSON();
	}

	public   getExamples()  {
		let model =  this.controller.getModelForce();
		return  this.specifications.getExamples(model.getLinesContent().join("\n"));
	}

	/**
	 * @param box- the box you want its values to be inserted
	 * @param outVars - The variables that synthesized
	 * @param preEnvs - a map from time i to the env with time i-1.
	 * @returns the number of lines that lineno needs to be increased.
	 */
	public insertExamples(synthModel: RTVSynthModel, outVars: string[]) {
		let examplesCounter = 0;
		let examples: string = ``;
		let synthExamples = synthModel.getExamples();
		for (let example of synthExamples) {
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

		this.logger.insertComments(synthModel.getLineno(), examples);
		this.insertExamplesToEditor(examples, outVars, synthModel.getLineno());
		this.newSynthBlock();
		// increasing lineno so the synth won't override these comments
		return (examples.split("\n")).length;
	}

	public insertStaticExamples(parsedComment:ParsedComment, lineno:number): void {
		let examples:string = parsedComment.asString();
		this.logger.insertComments(lineno, examples);
		this.insertExamplesToEditor(examples, parsedComment.synthesizedVarNames, lineno);
		this.newSynthBlock();
	}

	/**
	 * this function is in charge of inserting the text at the right place in the editor.
	 * it will also update the cursor position to point to the next line.
	 * @param examples- the examples to insert
	 * @param outVars - the variables that were synthesized
	 * @param lineno - the line number to insert the text at
	 */
	private insertExamplesToEditor(examples: string, outVars: string[], lineno: number) {
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
		let range = new RangeClass(lineno, startCol, lineno, endCol);
		let oldText = model.getValueInRange(range);
		let prolog = SYNTHESIZED_COMMENT_START + this.synthCounter.toString() + " of: " + outVars.toString().replace("[", "").replace("]", "") + "\n";
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
			[{range: range, text: newText}],
			[selection]
		);
	}

	/**
	 * This function will clean the comment starting from lineno.
	 *
	 * @returns the indent of the code that was deleted .
	 */
	static removeCommentsAndCode(controller: IRTVController, editor: ICodeEditor, lineno: number, endLineno: number, replacedText: string=""){
		let model = controller.getModelForce();
		editor.pushUndoStop(); //TODO: fix the bug of ctrl+z
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = startCol;
		for (let i = lineno; i < endLineno; i++) {
			let curr_end_col = model.getLineMaxColumn(i);
			if (curr_end_col > endCol) {
				endCol = curr_end_col;
			}
		}
		let range = new Range(lineno, startCol, endLineno, endCol);
		let selection = new Selection(
			lineno,
			startCol,
			lineno,
			startCol //+ replacedText.length
		);
		editor.executeEdits(
			controller.getId(),
			[{ range: range, text: replacedText }],
			[selection]
		);
		return startCol;
	}

	/**
	 * This function will search the end of the block that starts at lineno.
	 * @param lineno
	 * @param controller
	 */
	public getBlockSize(lineno:number):number{
		let model = this.controller.getModelForce();
		//scan all lines until we find equal number of #start and #end
		let startCount = 0;
		let endCount = 0;
		let i = lineno;
		while (i < model.getLineCount()){
			let line = model.getLineContent(i);
			if (line.includes(SYNTHESIZED_COMMENT_START)){
				startCount++;
			}
			if (line.includes(SYNTHESIZED_COMMENT_END)){
				endCount++;
			}
			if (startCount === endCount){
				return i - lineno;
			}
			i++;
		}
		return -1;// error - no end found
	}

	public updateComments(testResults:RTVTestResults,) {
		const blocksLines = testResults.commentsLocation;
		//delete all the decorations in previous blocks
		for (let decorationManager of Object.values(this.comments)) {
			decorationManager.removeAllDecoration();
		}
		this.comments = {};
		for(let blockId of testResults.getLiveBlockIds()){
			const results = testResults.getResultsForBlock(blockId);
			this.comments[blockId] = new DecorationManager(this.controller, blockId, blocksLines[blockId]+1!);
			results.forEach((result, index) => {
				let type = DecorationType.passTest;
				if(result[0] === false){
					type = DecorationType.failedTest;
				}
				this.comments[blockId].addDecoration(index, type, result[1]);
			});
		}
	}

	public async getParsedComment(lineno: number): Promise<ParsedComment> {
		let model = this.controller.getModelForce();
		let program = model.getLinesContent().slice(lineno);
		let utils = getUtils();
		let pythonProcess = utils.runCommentsParser(program.join(""));
		let parsedComment = await pythonProcess;
		return parsedComment;
	}

	private async onDidChangeModelContent(e: IModelContentChangedEvent){
		let cursorPos = this.editor.getPosition();
		if (cursorPos === null) {
			return;
		}
		let lineno = cursorPos.lineNumber;
		const lineContent = this.controller.getLineContent(lineno).trim();
		if(lineContent.startsWith("#!")){
			this.logger.projectionBoxCreated();
			// TODO: split to cases, above a function def, additional example to synth or range?
			let box = this.controller.getBox(lineno);
			box.setTextInBox("this is a test");
			this.controller.hideAllOtherBoxes(box);
		}
	}
}



export class RTVTestResults{
	private results: any;
	private commentsLines: any;

	constructor(testResults: any){
		const parsed= JSON.parse(testResults);
		this.results = parsed[0]; //
		this.commentsLines = parsed[1];

	}
	get commentsLocation(): any{
		return this.commentsLines;
	}

	public getLiveBlockIds(){
		// return the ids of the live blocks. it is the first element in the keys of the results separated by ..
		var ids=  Object.keys(this.results).map((key)=> {
			return parseInt(key.match(/\d+/g)![0], 10);
		});
		return Array.from(new Set(ids).values());
	}

	public getResultsForBlock(blockId: number,){
		const tupleKeys:any[]  = Object.keys(this.results).map(tupleString => tupleString.match(/\d+/g)!.map(x => parseInt(x, 10))) ;
		const keys = tupleKeys.filter(x => x[0] === blockId);
		const results = new Map<number, any>();
		for (let key of keys){
			const envIdx:number = key[1];
			results.set(envIdx, this.results[`(${key.join(", ")})`]);
		}
		return results;
	}
}