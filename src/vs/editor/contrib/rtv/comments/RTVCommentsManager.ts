// eslint-disable-next-line code-import-patterns
import {IRTVController, IRTVLogger, ViewMode,} from "../RTVInterfaces";
import {Range as RangeClass, Range} from 'vs/editor/common/core/range';
import {example, getFunctionCode, getUtils, makeEmptyTable, TableElement} from 'vs/editor/contrib/rtv/RTVUtils';
import {ICodeEditor} from "vs/editor/browser/editorBrowser";
import {Selection} from "vs/editor/common/core/selection";
import {RTVSynthModel} from "vs/editor/contrib/rtv/RTVSynthModel";
import {DecorationManager, DecorationType} from "vs/editor/contrib/rtv/RTVDecorations";
import {FoldingRangeProviderRegistry} from "vs/editor/common/modes";
import {SpecificationsRangeProvider} from "vs/editor/contrib/rtv/comments/SpecificationsRangeProvider";
import {IModelContentChangedEvent} from "vs/editor/common/model/textModelEvents";
import {RTVController} from "vs/editor/contrib/rtv/RTVDisplay";
import {MarkdownRenderer} from "vs/editor/browser/core/markdownRenderer";
import {RTVInputBox, RTVSpecification} from "vs/editor/contrib/rtv/index";
import {ParsedComment} from "./RTVComment";
import {parse, createVisitor} from 'python-ast';
import { TfpdefContext} from "python-ast/dist/parser/Python3Parser";
import {FoldingController} from "vs/editor/contrib/folding/folding";


export  const  SYNTHESIZED_COMMENT_START = `#! Start of synth number: `;
export  const SYNTHESIZED_COMMENT_END = `#! End of synth number: `;
//const FAKE_TIME = 100;





// this class is in charge of all the comments in the editor.
export class CommentsManager {
	private logger: IRTVLogger;
	private comments: { [index: number]: DecorationManager } = {}; // map from synthID and comment idx to the decorations ids
	private synthCounter: number = 0; // the largest comment id there is in the file
	private specifications: RTVSpecification;
	private inputBox: RTVInputBox|undefined = undefined; // used to get user's input for more examples.
	constructor(private readonly controller: RTVController, private readonly editor: ICodeEditor) {
		this.logger = getUtils().logger(editor);
		this.specifications = new RTVSpecification();
		FoldingRangeProviderRegistry.register("*", new SpecificationsRangeProvider());
		const registerOnDidChangeFolding = ()=> {
			const foldingController: FoldingController = FoldingController.get(editor);
			foldingController.getFoldingModel()?.then(foldingModel => {
				foldingModel!.onDidChange(() => {
					setTimeout(()=>this.controller.renderLayout(), 200); // after the folding happens.
				});
			});
		};
		this.editor.onDidChangeModel((e)=> registerOnDidChangeFolding());
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

	private convertExampleToString(example: example, idx:number){
		let leftSide = `#! ${idx}) `;
		Object.keys(example.inputs).forEach((inputVar) => {
			leftSide += `${inputVar} = ${example.inputs[inputVar]}, `; // add the input vars
		});
		leftSide = leftSide.substring(0, leftSide.length - 2); //remove the last ', '

		let rightSide = ``;
		Object.keys(example.outputs).forEach((outputVar) => {
			rightSide += `${outputVar} = ${example.outputs[outputVar]}, `; // add the output vars
		});
		rightSide = rightSide.substring(0, rightSide.length - 2); //remove the last ', '
		return `${leftSide} => ${rightSide} \n`;
	}
	/**
	 * @param box- the box you want its values to be inserted
	 * @param outVars - The variables that synthesized
	 * @param preEnvs - a map from time i to the env with time i-1.
	 * @returns the number of lines that lineno needs to be increased.
	 */
	public insertExamples(synthModel: RTVSynthModel, outVars: string[]) {
		let examplesCounter = 1;
		let examples: string = ``;
		let synthExamples = synthModel.getExamples();
		for (let example of synthExamples) {
			examples += this.convertExampleToString(example, examplesCounter++);
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

	public insertOneExample(example:example, lineno:number, examplesIdx:number):void{
		const exampleString  = this.convertExampleToString(example, examplesIdx).replace("\n","");
		this.insertExamplesToEditor(exampleString, Object.keys(example.outputs), lineno, false);
	}


	/**
	 * this function is in charge of inserting the text at the right place in the editor.
	 * it will also update the cursor position to point to the next line.
	 * @param examples- the examples to insert
	 * @param outVars - the variables that were synthesized
	 * @param lineno - the line number to insert the text at
	 */
	private insertExamplesToEditor(examples: string, outVars: string[], lineno: number, withProlog:boolean = true) {
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
		let newText;
		if (withProlog)
			newText = prolog + examples + oldText + epilog;
		else
			newText = examples;

		let indent = (model.getOptions()!.insertSpaces) ? ' ' : '\t';
		newText = newText.split('\n').join('\n' + indent.repeat(startCol - 1));

		this.editor.pushUndoStop();
		let startLine = withProlog ? lineno + newText.split('\n').length - 2 : lineno;


		let selection = new Selection(
			startLine,
			startCol,
			startLine,
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
		if(lineContent === "#!" && !this.inputBox){
			this.logger.projectionBoxCreated();

			this.controller.changeViewMode(ViewMode.Stealth);
			this.controller.disable();


			// TODO: split to cases, above a function def, additional example to synth or range?
			let box = this.controller.getBox(lineno);
			//enter a dummy box
			box.setTableInBox(new Set(["x", "y", "z"]), ["y"], [], false);
			let inputVarNames = this.getInputVars(lineno);
			let outVarNames = this.getOutputVars(lineno);
			let rows = makeEmptyTable(inputVarNames, outVarNames, lineno);

			this.inputBox = new RTVInputBox(
				this.editor,
				box.getLine().getElement(),
				box.getElement(),
				box.getModeService(),
				box.getOpenerService(),
				lineno,
				this.controller.getThemeService(),
				inputVarNames,
				outVarNames,
				rows
				);


			this.inputBox.bindExitSynth(()=>this.onExit(lineno));
			this.inputBox.bindOnEnterPresses(()=>{this.onEnter(lineno)});


			this.inputBox.updateBoxContent(rows, true);
			this.makeTableEditable(rows);

			this.inputBox.selectFirstEditableCell();


		}
	}

	//------------------------------------------------ helping functions-------------------------------------



	private makeTableEditable(rows: TableElement[][]){
		const renderer = new MarkdownRenderer(
			{ 'editor': this.editor },
			this.controller.getModeService(),
			this.controller.getOpenerService());
		for(let rowIdx = 1; rowIdx < rows.length; rowIdx++){
			const row = rows[rowIdx];
			for (let _colIdx = 0; _colIdx < row.length; _colIdx++){
				const elmt = row[_colIdx];
				const vname = elmt.vname!;
				let cell = this.inputBox!.getCell(vname, rowIdx - 1)!;
				this.inputBox!.addCellContentAndStyle(cell, elmt, renderer, rowIdx == 0);

			}
		}
	}
	private onEnter(lineno:number){
		const exampleIdx = this.getPrevCommentIndex(lineno) + 1;
		this.insertOneExample(this.inputBox?.getBoxAsExample()!, lineno, exampleIdx);
		this.onExit(lineno);
	}
	private onExit(lineno:number){
		this.inputBox!.destroy();
		this.inputBox = undefined;
		this.controller.getBox(lineno).destroy();
		this.controller.enable();
		this.controller.resetChangedLinesWhenOutOfDate();
		this.controller.updateBoxes();
		this.controller.changeViewMode(ViewMode.Full);
		this.editor.focus();
	}


	 getInputVars =(lineno:number)=>{
		let lineContent = this.editor.getModel()?.getLineContent(lineno+1);
		if(lineContent?.trim().startsWith("def")){
			let functionStr = getFunctionCode(this.editor.getModel()?.getLinesContent()!, lineno+1);
			const tree = parse(functionStr);
			let vars:string[] = []

			let TfpdefVisitor =  (ctx: TfpdefContext) => {
				vars.push(ctx.getChild(0).toString());
			};

			createVisitor({ visitTfpdef:TfpdefVisitor}).visit(tree);
			return  vars;

		}
		return ["tmp_in"];
	}

	 getOutputVars = (lineno:number)=>{
		let lineContent = this.editor.getModel()?.getLineContent(lineno+1);
		if(lineContent?.trim().startsWith("def")){
			return ["rv"];
		}
		return ["tmp_out"];

	}

	getPrevCommentIndex = (lineno:number)=>{
		if(lineno == 1) return 0;
		let lineContent = this.editor.getModel()?.getLineContent(lineno-1).trim()!;
		const regex = /^#! *(\d+)/;
		const match = lineContent.match(regex);
		if(match && match[1]){
			return parseInt(match[1]);
		}
		return 0;

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