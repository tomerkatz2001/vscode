// eslint-disable-next-line code-import-patterns
import {ITextModel} from "vs/editor/common/model";
import {CancellationToken} from "vs/base/common/cancellation";
import {SYNTHESIZED_COMMENT_START} from "./RTVCommentsManager";
import {
	FoldingContext,
	FoldingRange,
	FoldingRangeKind,
	FoldingRangeProvider,
	ProviderResult
} from "vs/editor/common/modes";

export class SpecificationsRangeProvider implements FoldingRangeProvider{
	readonly id = "specification";

	provideFoldingRanges(model: ITextModel, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]>{
		return this.computeRanges(model);
	}

	private computeRanges(model: ITextModel): FoldingRange[]{
		let startLines = [];
		let endLines = [];
		let inRegion = false;
		for(let lineno= 1 ; lineno<=model.getLineCount(); lineno++ ){
			if(model.getLineContent(lineno).includes(SYNTHESIZED_COMMENT_START)){
				startLines.push(lineno);
				inRegion = true;
			}
			else if(!model.getLineContent(lineno).includes("#!") && inRegion){
				endLines.push(lineno - 1);
				inRegion = false;
			}
		}
		let ranges:FoldingRange[] = [];
		for(let k =0; k<startLines.length; k++){
			ranges.push({start: startLines[k], end: endLines[k], kind: new FoldingRangeKind("specifications")});
		}
		return ranges;
	}
}