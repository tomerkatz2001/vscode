import { CancellationToken } from 'monaco-editor';
import { FoldingContext, FoldingRange, FoldingRangeProvider, ProviderResult } from '../../../common/languages.js';
import { SYNTHESIZED_COMMENT_START } from './RTVCommentsConsts.js';
import { ITextModel } from '../../../common/model.js';

export class SpecificationsRangeProvider implements FoldingRangeProvider {

	provideFoldingRanges(model: ITextModel, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]> {
		return this.computeRanges(model);
	}

	private computeRanges(model: ITextModel): monaco.languages.FoldingRange[] {
		const startLines: number[] = [];
		const endLines: number[] = [];
		let inRegion = false;

		const lineCount = model.getLineCount();

		for (let i = 0; i < lineCount; i++) {
			const line = model.getLineContent(i + 1); // Monaco lines are 1-based

			if (line.includes(SYNTHESIZED_COMMENT_START) && !inRegion) {
				startLines.push(i);
				inRegion = true;
			} else if (line.includes(SYNTHESIZED_COMMENT_START) && inRegion) {
				endLines.push(i - 1);
				startLines.push(i);
				inRegion = true;
			} else if (!line.includes('#!') && inRegion) {
				endLines.push(i - 1);
				inRegion = false;
			}
		}

		const ranges: monaco.languages.FoldingRange[] = [];
		for (let k = 0; k < startLines.length; k++) {
			ranges.push({
				start: startLines[k] + 1, // Monaco FoldingRange uses 1-based line numbers
				end: endLines[k] + 1,
				kind: monaco.languages.FoldingRangeKind.Comment
			});
		}

		return ranges;
	}
}
