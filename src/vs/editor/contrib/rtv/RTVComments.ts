import {IRTVController, IRTVLogger,} from "./RTVInterfaces";
import {Range as RangeClass, Range} from 'vs/editor/common/core/range';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';
import {getUtils} from 'vs/editor/contrib/rtv/RTVUtils';
import {ICodeEditor} from "vs/editor/browser/editorBrowser";
import * as assert from "assert";
import {Selection} from "vs/editor/common/core/selection";
import {RTVSynthModel} from "vs/editor/contrib/rtv/RTVSynthModel";
import {DecorationManager, DecorationType} from "vs/editor/contrib/rtv/RTVDecorations";
import {FoldingController} from "vs/editor/contrib/folding/folding";
import {FoldingRegions} from "vs/editor/contrib/folding/foldingRanges";
import {FoldingModel, CollapseMemento} from "vs/editor/contrib/folding/foldingModel";

export  const  SYNTHESIZED_COMMENT_START = `#! Start of synth number: `;
const SYNTHESIZED_COMMENT_END = `#! End of synth number: `;
//const FAKE_TIME = 100;


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
	constructor(synthesizedVarNames: string[], envs: any[], envs_status: env_status[], out: any[], commentID:number,){
		this.synthesizedVarNames = synthesizedVarNames;
		this.envs = envs;
		this.envs_status = envs_status;
		this.out = out;
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
export class CommentsManager {
	private logger: IRTVLogger;
	private comments: { [index: number]: DecorationManager } = {}; // map from synthID and comment idx to the decorations ids
	private synthCounter: number = 0; // the largest comment id there is in the file

	constructor(private readonly controller: IRTVController, private readonly editor: ICodeEditor) {
		this.logger = getUtils().logger(editor);
	}

	/**
	 * needs to be called after every synth.
	 */
	private newSynthBlock() {
		//this.comments[this.synthCounter] = new DecorationManager(this.controller, this.synthCounter);
		this.synthCounter++;
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

		// TODO: make this actually work
		const foldingController = FoldingController.get(this.editor);
		const commentsEndLineno = lineno + examples.split("\n").length -1;
		const foldingRange = new FoldingRegions(new Uint32Array([range.startLineNumber]), new Uint32Array([commentsEndLineno]), []);
		const memento: CollapseMemento = [{startLineNumber: range.startLineNumber, endLineNumber:commentsEndLineno}];
		foldingRange.setCollapsed(0, true);
		foldingController.getFoldingModel()?.then((foldingModel:FoldingModel|null) => {
			foldingModel?.update(foldingRange);
			foldingModel?.applyMemento(memento);
		});


	}

	/**
	 * This function will clean the comment starting from lineno.
	 *
	 * @returns the indent of the code that was deleted .
	 */
	public removeCommentsAndCode(lineno: number, lines: number) {
		let model = this.controller.getModelForce();
		this.editor.pushUndoStop(); //TODO: fix the bug of ctrl+z
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = startCol;
		for (let i = lineno; i < lineno + lines; i++) {
			let curr_end_col = model.getLineMaxColumn(i);
			if (curr_end_col > endCol) {
				endCol = curr_end_col;
			}
		}
		let range = new Range(lineno, startCol, lineno + lines, endCol);
		this.editor.executeEdits("", [{range: range, text: null}]); //delete lines
		return startCol;
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

	public async getStaticEnvs(lineno: number) {
		let model = this.controller.getModelForce();
		let program = model.getLinesContent().slice(lineno);
		let utils = getUtils();
		let pythonProcess = utils.runCommentsParser(program.join(""));
		let parsedComment = await pythonProcess;
		console.log(parsedComment.getEnvsToResynth());
		return parsedComment.getEnvsToResynth();


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