import {ParsedComment, SYNTHESIZED_COMMENT_END, SYNTHESIZED_COMMENT_START} from "vs/editor/contrib/rtv/RTVComments";
import {getUtils} from "vs/editor/contrib/rtv/RTVUtils";

enum BranchType {
	T,
	F,
	NoBranch,
}

export class RTVSpecification{
	private _commentsTree: {[key: number] : Map<BranchType, any>}; // represents the scoops of the comments.
	private _comments: {[key: number] : ParsedComment}; // map from comment id to comment

	constructor(){
		this._commentsTree = {};
		this._comments = {};
	}

	public addComment(comment: ParsedComment, parent: number, branch: BranchType){
		let succeeded = this.addCommentAux(comment, parent, branch, this._commentsTree);
		if(!succeeded && this._comments[parent] == undefined){ // the same scope as the "root" - can be more than one root
			this._commentsTree[comment.commentID] = new Map<BranchType, any>();
			this._comments[comment.commentID] = comment;
		}
	}

	private addCommentAux(comment: ParsedComment, parent: number, branch: BranchType, tree: {[key: number] : Map<BranchType, any>}): boolean{
		if(tree[parent] != undefined) {// parent is root
			let node: {[key: number] : Map<BranchType, any>} = {[comment.commentID]: new Map<BranchType, any>()};
			tree[parent].set(branch, node);
			this._comments[comment.commentID] = comment;
			return true;
		}
		for (const _branch of Object.values(tree)) {// try to find parent in the tree
			for (const root of Object.values(_branch)) {
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
			if (line.trim().startsWith(SYNTHESIZED_COMMENT_START)) {
				let utils = getUtils();
				let pythonProcess = utils.runCommentsParser(lines.slice(i).join('\n'));
				let parsedComment = await pythonProcess;

				const parentId = scopeIds[scopeIds.length - 1];

				// Call the function with the comment ID and scope ID
				this.addComment(parsedComment, parentId, branches[branches.length - 1]);
				scopeIds.push(parsedComment.commentID);
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
}





