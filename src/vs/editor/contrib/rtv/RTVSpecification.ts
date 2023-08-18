import {
	CommentsManager,
	ParsedComment,
	SYNTHESIZED_COMMENT_END,
	SYNTHESIZED_COMMENT_START
} from "vs/editor/contrib/rtv/comments/index";
import {getUtils} from "vs/editor/contrib/rtv/RTVUtils";

enum BranchType {
	T,
	F,
	NoBranch,
}


export class RTVSpecification{
	get comments(): { [p: number]: ParsedComment } {
		return this.scopes;
	}
	private scopesTree: {[key: number] : Map<BranchType, any>}; // represents the scoops of the comments.
	private scopes: {[key: number] : ParsedComment}; // map from comment id to comment

	constructor(tree: {[key: number] : Map<BranchType, any>} = {}, scopes:{[key: number] : ParsedComment} = {}){
		this.scopesTree = tree;
		this.scopes = scopes;
	}


	private clear(){
		this.scopesTree = {};
		this.scopes = {};
	}
	public getSpecificationOfScope(scopeIdx:number){
		let correctSubtree = null;
		for(const key of Object.keys(this.scopesTree).map(x=>parseInt(x))){
			let subtree: {[p: number]: Map<BranchType, any>} = {};
			subtree[key] = this.scopesTree[key];
			let res = this.getSubtreeAux(scopeIdx, subtree);
			if(res){
				correctSubtree = res;
				break;
			}
		}

		return new RTVSpecification(correctSubtree!, this.scopes)
	}
	private getSubtreeAux(scopeIdx:number, _commentTree: {[key: number] : Map<BranchType, any>}): {[key: number] : Map<BranchType, any>} | null
	{
		const root = parseInt(Object.keys(_commentTree)[0]); // there is only one root
		if(root == scopeIdx){
			return _commentTree
		}
		else{
			if(_commentTree[root].has(BranchType.T)){
				const sons: {[key: number] : Map<BranchType, any>} = _commentTree[root].get(BranchType.T);
				for(const key of Object.keys(sons).map(x=>parseInt(x))){
					let subtree: {[p: number]: Map<BranchType, any>} = {};
					subtree[key] = sons[key];
					let res: {[key: number] : Map<BranchType, any>} | null = this.getSubtreeAux(scopeIdx, subtree)
					if(res){
						return res
					}
				}
			}
			if(_commentTree[root].has(BranchType.F)){
				const sons: {[key: number] : Map<BranchType, any>} = _commentTree[root].get(BranchType.F);
				for(const key of Object.keys(sons).map(x=>parseInt(x))){
					let subtree: {[p: number]: Map<BranchType, any>} = {};
					subtree[key] = sons[key];
					let res: {[key: number] : Map<BranchType, any>} | null = this.getSubtreeAux(scopeIdx, subtree)
					if(res){
						return res
					}
				}
			}
			if(_commentTree[root].has(BranchType.NoBranch)){
				const sons: {[key: number] : Map<BranchType, any>} = _commentTree[root].get(BranchType.NoBranch);
				for(const key of Object.keys(sons).map(x=>parseInt(x))){
					let subtree: {[p: number]: Map<BranchType, any>} = {};
					subtree[key] = sons[key];
					let res: {[key: number] : Map<BranchType, any>} | null = this.getSubtreeAux(scopeIdx, subtree)
					if(res){
						return res
					}
				}
			}
			return null
		}
	}
	public addComment(comment: ParsedComment, parent: number, branch: BranchType){
		let succeeded = this.addCommentAux(comment, parent, branch, this.scopesTree);
		if(!succeeded && this.scopes[parent] == undefined){ // the same scope as the "root" - can be more than one root
			this.scopesTree[comment.scopeId] = new Map<BranchType, any>();
			this.scopes[comment.scopeId] = comment;
		}
	}

	private addCommentAux(comment: ParsedComment, parent: number, branch: BranchType, tree: {[key: number] : Map<BranchType, any>}): boolean{
		if(tree[parent] != undefined) {// parent is root
			let prevSon: {[key: number] : Map<BranchType, any>} = tree[parent].get(branch);
			let node: {[key: number] : Map<BranchType, any>} = {[comment.scopeId]: new Map<BranchType, any>()};
			tree[parent].set(branch, {...node, ...prevSon});
			this.scopes[comment.scopeId] = comment;
			return true;
		}
		for (const _branch of Object.values(tree)) {// try to find parent in the tree
			for (const root of _branch.values()) {
				let result = this.addCommentAux(comment, parent, branch, root);
				if (result) return true;
			}
		}
		return false; // did not find parent
	}

	/**
	 * get code with comments and gather all of the comments in it
	 */
	public async gatherComments(code: string) {
		this.clear()
		const lines = code.split('\n');
		let scopeIds: number[] = [-1];
		let branches: BranchType[] = [BranchType.NoBranch];
		let branchesIndent: number[] = [0];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			let lineIndent = line.length - line.trim().length;

			if (lineIndent < branchesIndent[branchesIndent.length - 1]) { // end of scope
				branches.pop();
				branchesIndent.pop();
			}

			// Check if the line is a comment
			if (line.trim().includes(SYNTHESIZED_COMMENT_START)) {
				let utils = getUtils();
				let pythonProcess = utils.runCommentsParser(lines.slice(i).join('\n'));
				let parsedComment = await pythonProcess;
				parsedComment.scopeId =  CommentsManager.getScopeIdx(i, lines);
				parsedComment.lineno = i + 1;
				const parentId = scopeIds[scopeIds.length - 1];

				// Call the function with the comment ID and scope ID
				this.addComment(parsedComment, parentId, branches[branches.length - 1]);
				scopeIds.push(parsedComment.scopeId);
			} else if (line.includes(SYNTHESIZED_COMMENT_END)) {
				// End of a scope, remove the last scope ID
				scopeIds.pop();
			} else if (line.trim().startsWith('if')) {
				// in if branch
				branches.push(BranchType.T);
				branchesIndent.push(lineIndent);
			} else if (line.trim().startsWith('else')) {
				branches.push(BranchType.F);
				branchesIndent.push(lineIndent);
			}
		}
	}



	private my_stringify2(data: object) :string{
		var keyValueArray = new Array();
		for (const [k, v] of Object.entries(data)) {
			var keyValueString = '"' + k + '":';
			var objValue = v;
			if (objValue.constructor == Map) {
				let thenString = objValue.get(BranchType.T) != undefined ? '"T": '+this.my_stringify2(objValue.get(BranchType.T)) : "";
				let elseString = objValue.get(BranchType.F) != undefined ? '"F": '+this.my_stringify2(objValue.get(BranchType.F)) : "";
				let noBranchString = objValue.get(BranchType.NoBranch) != undefined ? '"NB": '+this.my_stringify2(objValue.get(BranchType.NoBranch)) : "";
				keyValueString += '{' + thenString + elseString +  noBranchString + '}';
			}
			else {
				keyValueString += this.my_stringify2(objValue);
			}
			keyValueArray.push(keyValueString);
		}
		return "{" + keyValueArray.join(",") + "}";
	}
	public ToJSON(): string{
		return "{" +
			`"scopesTree": ${this.my_stringify2(this.scopesTree)},`+
			`"scopes": ${this.examplesToJson()}` +
			"}";
	}

	private examplesToJson():string{
		//this.makeSpecReadyForStringify();
		var examples = new Array();
		for(const [commentId,parrsedComment] of Object.entries(this.scopes)){
			parrsedComment.getEnvsToResynth();
			examples.push(`"${commentId}"` + ":" + JSON.stringify(parrsedComment));
		}
		return "{" + examples.join(",") + "}";
}
	public   getExamples(code:string){
		// if(this._comments == {}){
		// 	await this.gatherComments(code)
		// }
		return this.examplesToJson()
	}

	// private makeSpecReadyForStringify(){
	// 	//this will make each parsed comment to contain the field the synthesizer expects.
	// 	Object.entries(this.scopes).forEach(([idx, comment])=>comment.getEnvsToResynth());
	// }
}





